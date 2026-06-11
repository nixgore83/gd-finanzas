import { describe, it, expect } from 'vitest';
import { buildComparator, simple, type ComparatorFactory } from './compare';
import type { SortCriterion } from './criteria';

type Row = { name: string; amount: number; category: string | null };
type F = 'name' | 'amount' | 'category';

const FACTORIES: Record<F, ComparatorFactory<Row>> = {
  name: simple((a, b) => a.name.localeCompare(b.name, 'es')),
  amount: simple((a, b) => a.amount - b.amount),
  // Regla "sin categoría siempre arriba", independiente de la dirección:
  category: (dir) => (a, b) => {
    if (a.category === null && b.category === null) return 0;
    if (a.category === null) return -1;
    if (b.category === null) return 1;
    const r = a.category.localeCompare(b.category, 'es');
    return dir === 'desc' ? -r : r;
  },
};

const rows: Row[] = [
  { name: 'beta', amount: 10, category: 'Casa' },
  { name: 'alfa', amount: 10, category: null },
  { name: 'alfa', amount: 5, category: 'Auto' },
];

const sort = (criteria: SortCriterion<F>[]) =>
  [...rows].sort(buildComparator(criteria, FACTORIES));

describe('buildComparator', () => {
  it('empate en el primario se resuelve por el secundario', () => {
    const out = sort([
      { field: 'name', dir: 'asc' },
      { field: 'amount', dir: 'desc' },
    ]);
    expect(out.map((r) => [r.name, r.amount])).toEqual([
      ['alfa', 10],
      ['alfa', 5],
      ['beta', 10],
    ]);
  });

  it('cada criterio respeta su propia dirección', () => {
    const out = sort([
      { field: 'amount', dir: 'desc' },
      { field: 'name', dir: 'asc' },
    ]);
    expect(out.map((r) => [r.amount, r.name])).toEqual([
      [10, 'alfa'],
      [10, 'beta'],
      [5, 'alfa'],
    ]);
  });

  it('criterios vacíos → comparador neutro (preserva orden de entrada)', () => {
    expect(sort([])).toEqual(rows);
  });

  it('factory custom pinea null arriba en asc Y en desc', () => {
    for (const dir of ['asc', 'desc'] as const) {
      const out = sort([{ field: 'category', dir }]);
      expect(out[0]!.category).toBeNull();
    }
  });
});
