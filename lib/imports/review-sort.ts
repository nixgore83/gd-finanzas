import { buildComparator, simple, type Comparator, type ComparatorFactory } from '@/lib/sorting/compare';
import type { SortCriterion } from '@/lib/sorting/criteria';

export const REVIEW_SORT_FIELDS = ['date', 'description', 'amount', 'status', 'category'] as const;

export type ReviewSortField = (typeof REVIEW_SORT_FIELDS)[number];

/**
 * Forma estructural mínima de una línea de review para poder ordenarla.
 * (El componente usa su `LineRow`, que la satisface.)
 */
export type ReviewSortableLine = {
  status: string;
  proposedCategoryId: string | null;
  parsedData: {
    date?: string;
    description?: string;
    amountOriginal?: string;
  };
};

/**
 * Comparador multi-criterio para las líneas del review de import. Replica los
 * comparadores históricos de `sortLines`: fecha/descripción/estado por
 * localeCompare, monto numérico, y categoría con la regla "sin categoría
 * siempre arriba" SIN importar la dirección (para que lo pendiente de
 * categorizar no se esconda al final al invertir el orden).
 */
export function makeReviewComparator<T extends ReviewSortableLine>(
  criteria: readonly SortCriterion<ReviewSortField>[],
  catNameById: ReadonlyMap<string, string>,
): Comparator<T> {
  const factories: Record<ReviewSortField, ComparatorFactory<T>> = {
    date: simple((a, b) => (a.parsedData.date ?? '').localeCompare(b.parsedData.date ?? '')),
    description: simple((a, b) =>
      (a.parsedData.description ?? '').localeCompare(b.parsedData.description ?? '', 'es'),
    ),
    amount: simple(
      (a, b) =>
        parseFloat(a.parsedData.amountOriginal ?? '0') -
        parseFloat(b.parsedData.amountOriginal ?? '0'),
    ),
    status: simple((a, b) => (a.status ?? '').localeCompare(b.status ?? '')),
    category: (dir) => (a, b) => {
      const aCat = a.proposedCategoryId ? (catNameById.get(a.proposedCategoryId) ?? '') : '';
      const bCat = b.proposedCategoryId ? (catNameById.get(b.proposedCategoryId) ?? '') : '';
      // Sin categoría siempre arriba, en asc y en desc
      if (!aCat && bCat) return -1;
      if (aCat && !bCat) return 1;
      const cmp = aCat.localeCompare(bCat, 'es');
      return dir === 'desc' ? -cmp : cmp;
    },
  };
  return buildComparator(criteria, factories);
}
