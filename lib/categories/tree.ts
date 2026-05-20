import { and, asc, eq } from 'drizzle-orm';
import { categories } from '@/db/schema';
import { getDb } from '@/lib/db/client';

export type CategoryNode = {
  id: string;
  name: string;
  kind: 'income' | 'expense';
  depth: 0 | 1;
  parentId: string | null;
  isInvestment: boolean;
};

/**
 * Carga las categorías de un household ordenadas en árbol (parent seguido de
 * sus children). Útil para renderear Selects que respeten la jerarquía
 * visualmente — el caller usa `depth` para indentar.
 *
 * Excluye archivadas. Ordena por kind (income antes que expense) y dentro de
 * cada kind, parents alfabéticamente con sus children alfabéticos debajo.
 */
export async function loadCategoryTree(householdId: string): Promise<CategoryNode[]> {
  const db = getDb();
  const all = await db
    .select({
      id: categories.id,
      name: categories.name,
      kind: categories.kind,
      parentId: categories.parentId,
      isInvestment: categories.isInvestment,
    })
    .from(categories)
    .where(and(eq(categories.householdId, householdId), eq(categories.archived, false)))
    .orderBy(asc(categories.name));

  const parents = all.filter((c) => c.parentId === null);
  const childrenByParent = new Map<string, typeof all>();
  for (const c of all) {
    if (c.parentId === null) continue;
    const arr = childrenByParent.get(c.parentId) ?? [];
    arr.push(c);
    childrenByParent.set(c.parentId, arr);
  }

  const sortedParents = [...parents].sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === 'income' ? -1 : 1;
    return a.name.localeCompare(b.name, 'es');
  });

  const result: CategoryNode[] = [];
  for (const p of sortedParents) {
    result.push({
      id: p.id,
      name: p.name,
      kind: p.kind,
      depth: 0,
      parentId: null,
      isInvestment: p.isInvestment,
    });
    const children = (childrenByParent.get(p.id) ?? []).sort((a, b) =>
      a.name.localeCompare(b.name, 'es'),
    );
    for (const c of children) {
      result.push({
        id: c.id,
        name: c.name,
        kind: c.kind,
        depth: 1,
        parentId: p.id,
        isInvestment: c.isInvestment,
      });
    }
  }
  return result;
}
