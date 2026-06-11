import type { SortCriterion } from '@/lib/sorting/criteria';

export const TX_SORT_FIELDS = [
  'date',
  'description',
  'amount',
  'account',
  'category',
  'kind',
] as const;

export type TxSortField = (typeof TX_SORT_FIELDS)[number];

export const TX_DEFAULT_SORT: readonly SortCriterion<TxSortField>[] = [
  { field: 'date', dir: 'desc' },
];
