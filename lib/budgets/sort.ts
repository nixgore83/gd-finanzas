import { buildComparator, simple, type ComparatorFactory } from '@/lib/sorting/compare';
import type { SortCriterion } from '@/lib/sorting/criteria';

export const BUDGET_SORT_FIELDS = ['name', 'total'] as const;

export type BudgetSortField = (typeof BUDGET_SORT_FIELDS)[number];

type BudgetCategory = { id: string; name: string; parentId: string | null };

/**
 * Ordena las categorías del budget manteniendo la jerarquía: los grupos
 * (padre + sus hijos) se ordenan entre sí y los hijos dentro de cada grupo,
 * con el mismo comparador multi-criterio. Criterios vacíos = orden original
 * (reemplaza el viejo sentinel `'default'`).
 *
 * `getTotal` inyecta el total anual por categoría (estado del componente).
 */
export function sortBudgetCategories<C extends BudgetCategory>(
  categories: readonly C[],
  childrenByParent: ReadonlyMap<string, C[]>,
  criteria: readonly SortCriterion<BudgetSortField>[],
  getTotal: (catId: string) => number,
): C[] {
  if (criteria.length === 0) return [...categories];

  const factories: Record<BudgetSortField, ComparatorFactory<C>> = {
    name: simple((a, b) => a.name.localeCompare(b.name, 'es')),
    total: simple((a, b) => getTotal(a.id) - getTotal(b.id)),
  };
  const cmp = buildComparator(criteria, factories);

  const groups = categories
    .filter((c) => c.parentId === null)
    .map((p) => ({ parent: p, children: [...(childrenByParent.get(p.id) ?? [])] }));

  groups.sort((a, b) => cmp(a.parent, b.parent));

  const result: C[] = [];
  for (const g of groups) {
    result.push(g.parent);
    g.children.sort(cmp);
    result.push(...g.children);
  }
  return result;
}
