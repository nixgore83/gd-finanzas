import { and, desc, eq, isNotNull, sql } from 'drizzle-orm';
import { getDb } from '@/lib/db/client';
import { importLines, imports, transactions } from '@/db/schema';

/**
 * Normaliza una descripción de resumen bancario para matching:
 * - Quita sufijos de cuota: " C.05/09", " C.17/18"
 * - Quita montos entre paréntesis: " (147398,64)", " (12.345,00)"
 * - Quita espacios trailing
 */
export function normalizeDescription(raw: string): string {
  return raw
    .replace(/\s+C\.\d+\/\d+/gi, '')
    .replace(/\s+\([\d.,]+\)/g, '')
    .trim();
}

/**
 * Busca categoría en una tabla dada, primero exacto y luego normalizado.
 * Devuelve categoryId o null.
 */
async function searchInTable(
  table: 'transactions' | 'import_lines',
  householdId: string,
  trimmed: string,
  normalized: string,
): Promise<string | null> {
  const db = getDb();

  if (table === 'transactions') {
    // Exact match
    const exact = await db
      .select({
        categoryId: transactions.categoryId,
        cnt: sql<number>`count(*)::int`,
      })
      .from(transactions)
      .where(
        and(
          eq(transactions.householdId, householdId),
          isNotNull(transactions.categoryId),
          sql`lower(${transactions.description}) = lower(${trimmed})`,
        ),
      )
      .groupBy(transactions.categoryId)
      .orderBy(desc(sql`count(*)`))
      .limit(1);
    if (exact[0]) return exact[0].categoryId;

    // Normalized match
    if (normalized !== trimmed && normalized) {
      const fuzzy = await db
        .select({
          categoryId: transactions.categoryId,
          cnt: sql<number>`count(*)::int`,
        })
        .from(transactions)
        .where(
          and(
            eq(transactions.householdId, householdId),
            isNotNull(transactions.categoryId),
            sql`lower(regexp_replace(regexp_replace(${transactions.description}, E'\\s+C\\.\\d+/\\d+', '', 'gi'), E'\\s+\\([\\d.,]+\\)', '', 'g')) = lower(${normalized})`,
          ),
        )
        .groupBy(transactions.categoryId)
        .orderBy(desc(sql`count(*)`))
        .limit(1);
      if (fuzzy[0]) return fuzzy[0].categoryId;
    }
  } else {
    // import_lines: busca en parsed_data->>'description', filtrado por
    // household via JOIN imports. Solo líneas con categoría asignada.
    const exact = await db
      .select({
        categoryId: importLines.proposedCategoryId,
        cnt: sql<number>`count(*)::int`,
      })
      .from(importLines)
      .innerJoin(imports, eq(imports.id, importLines.importId))
      .where(
        and(
          eq(imports.householdId, householdId),
          isNotNull(importLines.proposedCategoryId),
          sql`lower(${importLines.parsedData}->>'description') = lower(${trimmed})`,
        ),
      )
      .groupBy(importLines.proposedCategoryId)
      .orderBy(desc(sql`count(*)`))
      .limit(1);
    if (exact[0]) return exact[0].categoryId;

    // Normalized match
    if (normalized !== trimmed && normalized) {
      const fuzzy = await db
        .select({
          categoryId: importLines.proposedCategoryId,
          cnt: sql<number>`count(*)::int`,
        })
        .from(importLines)
        .innerJoin(imports, eq(imports.id, importLines.importId))
        .where(
          and(
            eq(imports.householdId, householdId),
            isNotNull(importLines.proposedCategoryId),
            sql`lower(regexp_replace(regexp_replace(${importLines.parsedData}->>'description', E'\\s+C\\.\\d+/\\d+', '', 'gi'), E'\\s+\\([\\d.,]+\\)', '', 'g')) = lower(${normalized})`,
          ),
        )
        .groupBy(importLines.proposedCategoryId)
        .orderBy(desc(sql`count(*)`))
        .limit(1);
      if (fuzzy[0]) return fuzzy[0].categoryId;
    }
  }

  return null;
}

/**
 * Sugiere `category_id` para una descripción dada. Busca en:
 * 1) Transacciones confirmadas (exacto, luego normalizado)
 * 2) Import lines previas con categoría asignada (exacto, luego normalizado)
 *
 * En ambos casos, si hay múltiples categorías históricas devuelve la más
 * frecuente. Si no hay match, null.
 */
export async function suggestCategoryForDescription(
  householdId: string,
  description: string,
): Promise<string | null> {
  const trimmed = description.trim();
  if (!trimmed) return null;
  const normalized = normalizeDescription(trimmed);

  // Transactions first (higher confidence — user confirmed these)
  const fromTx = await searchInTable('transactions', householdId, trimmed, normalized);
  if (fromTx) return fromTx;

  // Fallback: import_lines (user assigned category but tx may not exist yet)
  return searchInTable('import_lines', householdId, trimmed, normalized);
}
