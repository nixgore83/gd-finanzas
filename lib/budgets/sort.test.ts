import { describe, it, expect } from 'vitest';
import { sortBudgetCategories, type BudgetSortField } from './sort';
import type { SortCriterion } from '@/lib/sorting/criteria';

type Cat = { id: string; name: string; parentId: string | null };

const cat = (id: string, name: string, parentId: string | null = null): Cat => ({
  id,
  name,
  parentId,
});

const CATS: Cat[] = [
  cat('p1', 'Hogar'),
  cat('c1a', 'Luz', 'p1'),
  cat('c1b', 'Agua', 'p1'),
  cat('p2', 'Auto'),
  cat('c2a', 'Nafta', 'p2'),
];

const CHILDREN = new Map<string, Cat[]>([
  ['p1', [CATS[1]!, CATS[2]!]],
  ['p2', [CATS[4]!]],
]);

const TOTALS: Record<string, number> = { p1: 100, c1a: 60, c1b: 40, p2: 500, c2a: 500 };

const sortIds = (criteria: SortCriterion<BudgetSortField>[]) =>
  sortBudgetCategories(CATS, CHILDREN, criteria, (id) => TOTALS[id] ?? 0).map((c) => c.id);

describe('sortBudgetCategories', () => {
  it('criterios vacíos devuelve el orden original (copia)', () => {
    const out = sortBudgetCategories(CATS, CHILDREN, [], () => 0);
    expect(out.map((c) => c.id)).toEqual(['p1', 'c1a', 'c1b', 'p2', 'c2a']);
    expect(out).not.toBe(CATS);
  });

  it('ordena grupos por total desc con hijos siempre debajo de su padre', () => {
    expect(sortIds([{ field: 'total', dir: 'desc' }])).toEqual(['p2', 'c2a', 'p1', 'c1a', 'c1b']);
  });

  it('ordena hijos dentro del grupo con el mismo comparador', () => {
    expect(sortIds([{ field: 'name', dir: 'asc' }])).toEqual(['p2', 'c2a', 'p1', 'c1b', 'c1a']);
  });

  it('multi-criterio: total primario, name desempata', () => {
    const totals: Record<string, number> = { p1: 100, p2: 100, c1a: 0, c1b: 0, c2a: 0 };
    const out = sortBudgetCategories(
      CATS,
      CHILDREN,
      [
        { field: 'total', dir: 'desc' },
        { field: 'name', dir: 'asc' },
      ],
      (id) => totals[id] ?? 0,
    ).map((c) => c.id);
    // p1 y p2 empatan en total → desempata el nombre: Auto < Hogar
    expect(out).toEqual(['p2', 'c2a', 'p1', 'c1b', 'c1a']);
  });
});
