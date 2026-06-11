import { describe, it, expect } from 'vitest';
import { makeReviewComparator, type ReviewSortableLine } from './review-sort';
import type { SortCriterion } from '@/lib/sorting/criteria';
import type { ReviewSortField } from './review-sort';

const CATS = new Map([
  ['c1', 'Casa'],
  ['c2', 'Auto'],
]);

const line = (
  id: string,
  data: { date?: string; description?: string; amount?: string; status?: string; catId?: string | null },
): ReviewSortableLine & { id: string } => ({
  id,
  status: data.status ?? 'pending',
  proposedCategoryId: data.catId ?? null,
  parsedData: {
    date: data.date,
    description: data.description,
    amountOriginal: data.amount,
  },
});

const sortIds = (
  rows: Array<ReviewSortableLine & { id: string }>,
  criteria: SortCriterion<ReviewSortField>[],
) => [...rows].sort(makeReviewComparator(criteria, CATS)).map((r) => r.id);

describe('makeReviewComparator', () => {
  it('multi-criterio: estado primario, monto secundario', () => {
    const rows = [
      line('a', { status: 'pending', amount: '50.00' }),
      line('b', { status: 'edited', amount: '10.00' }),
      line('c', { status: 'pending', amount: '5.00' }),
    ];
    expect(
      sortIds(rows, [
        { field: 'status', dir: 'asc' },
        { field: 'amount', dir: 'desc' },
      ]),
    ).toEqual(['b', 'a', 'c']);
  });

  it('sin categoría queda arriba en asc Y en desc', () => {
    const rows = [
      line('cat1', { catId: 'c1' }),
      line('uncat', { catId: null }),
      line('cat2', { catId: 'c2' }),
    ];
    expect(sortIds(rows, [{ field: 'category', dir: 'asc' }])[0]).toBe('uncat');
    expect(sortIds(rows, [{ field: 'category', dir: 'desc' }])[0]).toBe('uncat');
    // y el resto sí se invierte: Auto<Casa en asc, Casa<Auto en desc
    expect(sortIds(rows, [{ field: 'category', dir: 'asc' }])).toEqual(['uncat', 'cat2', 'cat1']);
    expect(sortIds(rows, [{ field: 'category', dir: 'desc' }])).toEqual(['uncat', 'cat1', 'cat2']);
  });

  it('empates preservan orden de entrada (sort estable)', () => {
    const rows = [
      line('x', { date: '2026-01-01' }),
      line('y', { date: '2026-01-01' }),
    ];
    expect(sortIds(rows, [{ field: 'date', dir: 'asc' }])).toEqual(['x', 'y']);
  });

  it('monto compara numéricamente, no como string', () => {
    const rows = [line('big', { amount: '900.00' }), line('small', { amount: '1000.00' })];
    expect(sortIds(rows, [{ field: 'amount', dir: 'asc' }])).toEqual(['big', 'small']);
  });
});
