import { describe, it, expect } from 'vitest';
import { applySortClick, MAX_SORT_CRITERIA, type SortCriterion } from './criteria';

type F = 'date' | 'amount' | 'account' | 'kind';
const c = (field: F, dir: 'asc' | 'desc' = 'asc'): SortCriterion<F> => ({ field, dir });

describe('applySortClick', () => {
  it('click normal en campo nuevo reemplaza todos los criterios', () => {
    const prev = [c('date', 'desc'), c('amount')];
    expect(applySortClick(prev, 'account', { append: false })).toEqual([c('account', 'asc')]);
  });

  it('click normal sobre el único criterio activo invierte su dirección', () => {
    expect(applySortClick([c('date', 'asc')], 'date', { append: false })).toEqual([
      c('date', 'desc'),
    ]);
    expect(applySortClick([c('date', 'desc')], 'date', { append: false })).toEqual([
      c('date', 'asc'),
    ]);
  });

  it('click sobre campo activo en multi-sort invierte su dir conservando prioridades', () => {
    const prev = [c('account'), c('date', 'desc'), c('amount')];
    const next = applySortClick(prev, 'date', { append: false });
    expect(next).toEqual([c('account'), c('date', 'asc'), c('amount')]);
  });

  it('shift+click en campo nuevo lo agrega al final', () => {
    const prev = [c('account', 'desc')];
    expect(applySortClick(prev, 'date', { append: true })).toEqual([
      c('account', 'desc'),
      c('date', 'asc'),
    ]);
  });

  it('shift+click sobre campo activo invierte sin mover su prioridad', () => {
    const prev = [c('account'), c('date')];
    expect(applySortClick(prev, 'account', { append: true })).toEqual([
      c('account', 'desc'),
      c('date'),
    ]);
  });

  it(`append con ${MAX_SORT_CRITERIA} criterios es no-op`, () => {
    const prev = [c('account'), c('date'), c('amount')];
    expect(applySortClick(prev, 'kind', { append: true })).toEqual(prev);
  });

  it('no muta el array de entrada', () => {
    const prev = [c('date', 'asc')];
    const frozen = Object.freeze(prev.map((x) => Object.freeze({ ...x })));
    const next = applySortClick(frozen as readonly SortCriterion<F>[], 'date', { append: false });
    expect(prev).toEqual([c('date', 'asc')]);
    expect(next).not.toBe(prev);
  });
});
