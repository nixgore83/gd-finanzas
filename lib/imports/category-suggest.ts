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

// Postgres regexp_replace with properly escaped backslashes.
// JS template literal eats one layer, Postgres E-string eats another.
const PG_STRIP_CUOTA = String.raw`E'\\s+C\\.\\d+/\\d+'`;
const PG_STRIP_PARENS = String.raw`E'\\s+\\([\\d.,]+\\)'`;

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
  const db = getDb();

  // ── 1) Transactions ──────────────────────────────────────────────

  // 1a) Exact match
  const txExact = await db
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
  if (txExact[0]) return txExact[0].categoryId;

  // 1b) Normalized match
  if (normalized && normalized !== trimmed) {
    const txNorm = await db
      .select({
        categoryId: transactions.categoryId,
        cnt: sql<number>`count(*)::int`,
      })
      .from(transactions)
      .where(
        and(
          eq(transactions.householdId, householdId),
          isNotNull(transactions.categoryId),
          sql.raw(
            `lower(regexp_replace(regexp_replace(description, ${PG_STRIP_CUOTA}, '', 'gi'), ${PG_STRIP_PARENS}, '', 'g')) = lower('${normalized.replace(/'/g, "''")}')`,
          ),
        ),
      )
      .groupBy(transactions.categoryId)
      .orderBy(desc(sql`count(*)`))
      .limit(1);
    if (txNorm[0]) return txNorm[0].categoryId;
  }

  // ── 2) Import lines (fallback) ───────────────────────────────────

  // 2a) Exact match
  const ilExact = await db
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
  if (ilExact[0]) return ilExact[0].categoryId;

  // 2b) Normalized match
  if (normalized && normalized !== trimmed) {
    const ilNorm = await db
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
          sql.raw(
            `lower(regexp_replace(regexp_replace(parsed_data->>'description', ${PG_STRIP_CUOTA}, '', 'gi'), ${PG_STRIP_PARENS}, '', 'g')) = lower('${normalized.replace(/'/g, "''")}')`,
          ),
        ),
      )
      .groupBy(importLines.proposedCategoryId)
      .orderBy(desc(sql`count(*)`))
      .limit(1);
    if (ilNorm[0]) return ilNorm[0].categoryId;
  }

  return null;
}
