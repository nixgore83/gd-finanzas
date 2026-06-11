import type { SortCriterion } from '@/lib/sorting/criteria';

export const IMPORTS_SORT_FIELDS = ['created', 'account', 'period', 'status', 'txns'] as const;

export type ImportsSortField = (typeof IMPORTS_SORT_FIELDS)[number];

export const IMPORTS_DEFAULT_SORT: readonly SortCriterion<ImportsSortField>[] = [
  { field: 'created', dir: 'desc' },
];
