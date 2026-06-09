import { and, desc, eq, or, sql, type SQL } from 'drizzle-orm';
import { getDb } from '@/lib/db/client';
import { importLines, imports, transactions } from '@/db/schema';
import type { Counterparty } from '@/lib/imports/parsers/types';

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

/** Campos identificadores "fuertes" (match exacto). */
const STRONG_ID_FIELDS = ['cuil', 'cbu', 'accountRef', 'alias'] as const;

/** True si la contraparte tiene al menos un identificador usable para matchear. */
export function counterpartyHasIdentity(cp: Counterparty | null | undefined): boolean {
  if (!cp) return false;
  return Boolean(
    cp.cuil?.trim() ||
      cp.cbu?.trim() ||
      cp.accountRef?.trim() ||
      cp.alias?.trim() ||
      cp.name?.trim(),
  );
}

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

/**
 * Busca en el historial (transactions, fallback import_lines) por contrapartes que
 * matcheen `cp` y devuelve la categoría sugerida y la etiqueta a precargar.
 */
export async function lookupCounterpartyHistory(
  householdId: string,
  cp: Counterparty,
): Promise<{ categoryId: string | null; label: string | null }> {
  if (!counterpartyHasIdentity(cp)) return { categoryId: null, label: null };
  const db = getDb();

  // ── 1) Transactions confirmadas ──────────────────────────────────
  const txCpExpr = sql`${transactions.meta} -> 'counterparty'`;
  const txMatch = buildCounterpartyMatch(txCpExpr, cp);
  if (!txMatch) return { categoryId: null, label: null };

  const txRows = await db
    .select({
      categoryId: transactions.categoryId,
      label: sql<string | null>`${txCpExpr} ->> 'label'`,
      date: transactions.date,
    })
    .from(transactions)
    .where(and(eq(transactions.householdId, householdId), txMatch))
    .orderBy(desc(transactions.date));

  let categoryId = pickMostFrequentCategory(txRows);
  let label = pickLatestLabel(txRows);
  if (categoryId && label) return { categoryId, label };

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

  return { categoryId, label };
}
