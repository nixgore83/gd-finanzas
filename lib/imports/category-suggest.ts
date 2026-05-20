import { and, desc, eq, isNotNull, sql } from 'drizzle-orm';
import { getDb } from '@/lib/db/client';
import { transactions } from '@/db/schema';

/**
 * Sugiere `category_id` para una descripción dada haciendo match exacto
 * (case-insensitive) contra `description` de transacciones previas del
 * household. Si hay múltiples categorías históricas, devuelve la más
 * frecuente. Si no hay match, null.
 *
 * V1 solo match exacto. Match parcial (substring tokens) → V1.2.
 */
export async function suggestCategoryForDescription(
  householdId: string,
  description: string,
): Promise<string | null> {
  const trimmed = description.trim();
  if (!trimmed) return null;
  const db = getDb();
  const rows = await db
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
  return rows[0]?.categoryId ?? null;
}
