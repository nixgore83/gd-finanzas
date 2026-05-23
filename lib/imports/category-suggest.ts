import { and, desc, eq, isNotNull, sql } from 'drizzle-orm';
import { getDb } from '@/lib/db/client';
import { transactions } from '@/db/schema';

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
 * Sugiere `category_id` para una descripción dada. Primero intenta match
 * exacto (case-insensitive), luego match normalizado (sin sufijos de cuota
 * ni montos entre paréntesis). Si hay múltiples categorías históricas,
 * devuelve la más frecuente. Si no hay match, null.
 */
export async function suggestCategoryForDescription(
  householdId: string,
  description: string,
): Promise<string | null> {
  const trimmed = description.trim();
  if (!trimmed) return null;
  const db = getDb();

  // 1) Match exacto
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

  // 2) Match normalizado — quita cuotas y montos entre paréntesis
  const normalized = normalizeDescription(trimmed);
  if (normalized === trimmed || !normalized) return null;

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
        sql`lower(regexp_replace(regexp_replace(${transactions.description}, '\s+C\.\d+/\d+', '', 'gi'), '\s+\([\d.,]+\)', '', 'g')) = lower(${normalized})`,
      ),
    )
    .groupBy(transactions.categoryId)
    .orderBy(desc(sql`count(*)`))
    .limit(1);

  return fuzzy[0]?.categoryId ?? null;
}
