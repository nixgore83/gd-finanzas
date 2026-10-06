import { eq } from 'drizzle-orm';
import { categories } from '@/db/schema';
import { getDb } from '@/lib/db/client';

/**
 * Categorías "fuera del gasto de la casa": las marcadas y sus hijas (marcar
 * "Mario" saca todo lo que cuelgue de Mario). Pura, para testearla.
 */
export function householdExcludedIds(
  nodes: readonly { id: string; parentId: string | null; excludedFromHousehold: boolean }[],
): Set<string> {
  const marked = new Set(nodes.filter((n) => n.excludedFromHousehold).map((n) => n.id));
  return new Set(
    nodes
      .filter((n) => marked.has(n.id) || (n.parentId !== null && marked.has(n.parentId)))
      .map((n) => n.id),
  );
}

export async function loadHouseholdExcludedIds(householdId: string): Promise<Set<string>> {
  const rows = await getDb()
    .select({
      id: categories.id,
      parentId: categories.parentId,
      excludedFromHousehold: categories.excludedFromHousehold,
    })
    .from(categories)
    .where(eq(categories.householdId, householdId));
  return householdExcludedIds(rows);
}
