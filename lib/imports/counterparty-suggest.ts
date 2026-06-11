import { and, desc, eq, inArray, or, sql, type SQL } from 'drizzle-orm';
import { getDb } from '@/lib/db/client';
import { importLines, imports, transactions, transactionTags } from '@/db/schema';
import type { Counterparty, ParsedTxLine } from '@/lib/imports/parsers/types';
import { domesticServiceMetaSchema, type DomesticServiceMeta } from '@/lib/schemas/transaction';

/**
 * Sugerencias basadas en la CONTRAPARTE (no en la descripción): cuando se le paga
 * a la misma persona/entidad en distintos meses, la descripción del resumen suele
 * cambiar (referencias, montos) pero los identificadores de la contraparte
 * (CUIL/CBU/cuenta/alias) o el nombre se mantienen. Este módulo busca en el
 * historial por esos identificadores para precargar categoría y etiqueta.
 *
 * Espeja el patrón de `category-suggest.ts` (más frecuente, desempate por más
 * reciente, fallback a import_lines). El jsonb no está indexado; a la escala del
 * household (2 usuarios) es suficiente.
 */

// Identidad canónica: definida una sola vez en counterparty-identity.ts.
import { counterpartyHasIdentity, STRONG_ID_FIELDS } from '@/lib/imports/counterparty-identity';

export { counterpartyHasIdentity };

/**
 * Construye la condición SQL que matchea una contraparte histórica con `cp`.
 * `cpExpr` es la expresión jsonb que apunta al objeto counterparty (ej.
 * `meta -> 'counterparty'`). Matchea por CUALQUIER identificador fuerte presente,
 * o por nombre normalizado (lower+trim) como último recurso.
 */
function buildCounterpartyMatch(cpExpr: SQL, cp: Counterparty): SQL | undefined {
  const conds: SQL[] = [];
  for (const field of STRONG_ID_FIELDS) {
    const value = cp[field]?.trim();
    if (value) conds.push(sql`${cpExpr} ->> ${field} = ${value}`);
  }
  const name = cp.name?.trim();
  if (name) conds.push(sql`lower(trim(${cpExpr} ->> 'name')) = lower(${name})`);
  if (conds.length === 0) return undefined;
  return or(...conds);
}

/** Categoría no-nula más frecuente; desempate: la más reciente (filas ya ordenadas date desc). */
function pickMostFrequentCategory(rows: Array<{ categoryId: string | null }>): string | null {
  const counts = new Map<string, number>();
  for (const r of rows) {
    if (r.categoryId) counts.set(r.categoryId, (counts.get(r.categoryId) ?? 0) + 1);
  }
  let best: string | null = null;
  let bestCount = 0;
  // Filas en orden date desc → con `>` estricto, los empates se quedan con la más reciente.
  for (const r of rows) {
    if (!r.categoryId) continue;
    const c = counts.get(r.categoryId)!;
    if (c > bestCount) {
      best = r.categoryId;
      bestCount = c;
    }
  }
  return best;
}

function pickLatestLabel(rows: Array<{ label: string | null }>): string | null {
  const found = rows.find((r) => r.label?.trim());
  return found?.label?.trim() ?? null;
}

/** Valor booleano más frecuente; desempate: el más reciente (filas ya date desc). */
function pickMostFrequentBool(values: boolean[]): boolean | null {
  if (values.length === 0) return null;
  const trues = values.filter(Boolean).length;
  const falses = values.length - trues;
  if (trues === falses) return values[0]!;
  return trues > falses;
}

export type CounterpartyHistory = {
  categoryId: string | null;
  label: string | null;
  /** null = sin señal en el historial (no forzar false sobre el default). */
  deducible: boolean | null;
  /** Tags de la transacción matcheada más reciente que tenga alguna. */
  tagIds: string[];
  /** Datos del empleado de la tx domestic_service más reciente (sin `periodo`,
   * que es mensual — el caller lo deriva de la fecha de la línea). */
  domesticService: Omit<DomesticServiceMeta, 'periodo'> | null;
};

const EMPTY_HISTORY: CounterpartyHistory = {
  categoryId: null,
  label: null,
  deducible: null,
  tagIds: [],
  domesticService: null,
};

/**
 * Busca en el historial (transactions, fallback import_lines) por contrapartes que
 * matcheen `cp` y devuelve lo aprendido para precargar: categoría, etiqueta,
 * deducible Ganancias, tags (también para transferencias — ahí el tag es el
 * clasificador) y datos de servicio doméstico.
 */
export async function lookupCounterpartyHistory(
  householdId: string,
  cp: Counterparty,
): Promise<CounterpartyHistory> {
  if (!counterpartyHasIdentity(cp)) return EMPTY_HISTORY;
  const db = getDb();

  // ── 1) Transactions confirmadas ──────────────────────────────────
  const txCpExpr = sql`${transactions.meta} -> 'counterparty'`;
  const txMatch = buildCounterpartyMatch(txCpExpr, cp);
  if (!txMatch) return EMPTY_HISTORY;

  const txRows = await db
    .select({
      id: transactions.id,
      categoryId: transactions.categoryId,
      label: sql<string | null>`${txCpExpr} ->> 'label'`,
      date: transactions.date,
      kind: transactions.kind,
      deducible: transactions.deducibleGanancias,
      subtype: transactions.transactionSubtype,
      meta: transactions.meta,
    })
    .from(transactions)
    .where(and(eq(transactions.householdId, householdId), txMatch))
    .orderBy(desc(transactions.date));

  let categoryId = pickMostFrequentCategory(txRows);
  let label = pickLatestLabel(txRows);

  // Deducible: solo tiene sentido aprenderlo de gastos (no de transfers/ingresos).
  const deducible = pickMostFrequentBool(
    txRows.filter((r) => r.kind === 'expense').map((r) => r.deducible),
  );

  // Doméstico: datos del empleado de la tx domestic_service más reciente.
  let domesticService: CounterpartyHistory['domesticService'] = null;
  const domesticRow = txRows.find((r) => r.subtype === 'domestic_service');
  if (domesticRow?.meta && typeof domesticRow.meta === 'object') {
    const parsedMeta = domesticServiceMetaSchema
      .omit({ periodo: true })
      .safeParse(domesticRow.meta);
    if (parsedMeta.success) domesticService = parsedMeta.data;
  }

  // Tags: las de la tx matcheada más reciente que tenga alguna. Funciona también
  // cuando las matcheadas son transferencias (decisión Nico: en transfers el tag
  // es el clasificador, ya que no llevan categoría).
  let tagIds: string[] = [];
  if (txRows.length > 0) {
    const tagRows = await db
      .select({ transactionId: transactionTags.transactionId, tagId: transactionTags.tagId })
      .from(transactionTags)
      .where(inArray(transactionTags.transactionId, txRows.map((r) => r.id)));
    if (tagRows.length > 0) {
      const byTx = new Map<string, string[]>();
      for (const t of tagRows) {
        const list = byTx.get(t.transactionId) ?? [];
        list.push(t.tagId);
        byTx.set(t.transactionId, list);
      }
      // txRows viene date desc → la primera con tags es la más reciente.
      const recentWithTags = txRows.find((r) => byTx.has(r.id));
      if (recentWithTags) tagIds = byTx.get(recentWithTags.id)!;
    }
  }

  if (!categoryId || !label) {
    // ── 2) Import lines (fallback: datos aún no confirmados) ──────────
    const ilCpExpr = sql`${importLines.parsedData} -> 'counterparty'`;
    const ilMatch = buildCounterpartyMatch(ilCpExpr, cp);
    if (ilMatch) {
      const ilRows = await db
        .select({
          categoryId: importLines.proposedCategoryId,
          label: sql<string | null>`${ilCpExpr} ->> 'label'`,
          date: sql<string>`${importLines.parsedData} ->> 'date'`,
        })
        .from(importLines)
        .innerJoin(imports, eq(imports.id, importLines.importId))
        .where(and(eq(imports.householdId, householdId), ilMatch))
        .orderBy(desc(sql`${importLines.parsedData} ->> 'date'`));

      if (!categoryId) categoryId = pickMostFrequentCategory(ilRows);
      if (!label) label = pickLatestLabel(ilRows);
    }
  }

  return { categoryId, label, deducible, tagIds, domesticService };
}

/**
 * Aplica lo aprendido del historial a una línea SIN pisar lo que ya tiene
 * (no-destructivo: solo completa vacíos). Puro — lo comparten el parse inicial
 * y el pase "re-sugerir pendientes" de la review.
 *
 * Reglas:
 * - label/tags: también en transferencias (el tag es su clasificador).
 * - deducible/doméstico: solo gastos no-transfer; doméstico además excluye refunds.
 */
export function enrichLineWithHistory(
  line: ParsedTxLine,
  h: CounterpartyHistory,
): ParsedTxLine {
  let out = line;
  if (h.label && out.counterparty && !out.counterparty.label?.trim()) {
    out = { ...out, counterparty: { ...out.counterparty, label: h.label } };
  }
  if (h.tagIds.length > 0 && (out.tagIds === undefined || out.tagIds.length === 0)) {
    out = { ...out, tagIds: h.tagIds };
  }
  if (!out.isTransfer && out.kind === 'expense') {
    if (h.deducible === true && !out.deducibleGanancias) {
      out = { ...out, deducibleGanancias: true };
    }
    if (h.domesticService && !out.domesticService && !out.isRefund) {
      out = {
        ...out,
        domesticService: { ...h.domesticService, periodo: out.date.slice(0, 7) },
      };
    }
  }
  return out;
}
