import { describe, it, expect } from 'vitest';
import { serializeSort, parseSortParam } from './url';
import type { SortCriterion } from './criteria';

type F = 'date' | 'amount' | 'account';
const ALLOWED = ['date', 'amount', 'account'] as const;
const FALLBACK: readonly SortCriterion<F>[] = [{ field: 'date', dir: 'desc' }];
const OPTS = { allowed: ALLOWED, fallback: FALLBACK, legacyDefaultDir: 'desc' as const };

describe('serializeSort', () => {
  it('serializa con dirección explícita separado por comas', () => {
    expect(
      serializeSort([
        { field: 'date', dir: 'desc' },
        { field: 'amount', dir: 'asc' },
      ]),
    ).toBe('date:desc,amount:asc');
  });
});

describe('parseSortParam', () => {
  it('roundtrip serialize → parse', () => {
    const criteria: SortCriterion<F>[] = [
      { field: 'amount', dir: 'asc' },
      { field: 'account', dir: 'desc' },
    ];
    expect(parseSortParam(serializeSort(criteria), undefined, OPTS)).toEqual(criteria);
  });

  it('sin param devuelve el fallback (copia, no la misma referencia)', () => {
    const out = parseSortParam(undefined, undefined, OPTS);
    expect(out).toEqual(FALLBACK);
    expect(out[0]).not.toBe(FALLBACK[0]);
  });

  it('formato legacy: sort=date&dir=asc', () => {
    expect(parseSortParam('date', 'asc', OPTS)).toEqual([{ field: 'date', dir: 'asc' }]);
  });

  it('formato legacy sin dir usa legacyDefaultDir (desc, como las páginas actuales)', () => {
    expect(parseSortParam('amount', undefined, OPTS)).toEqual([{ field: 'amount', dir: 'desc' }]);
  });

  it('campo fuera de whitelist se descarta conservando los válidos', () => {
    expect(parseSortParam('hack:asc,amount:desc', undefined, OPTS)).toEqual([
      { field: 'amount', dir: 'desc' },
    ]);
  });

  it('duplicados: gana la primera aparición', () => {
    expect(parseSortParam('date:asc,date:desc,amount:asc', undefined, OPTS)).toEqual([
      { field: 'date', dir: 'asc' },
      { field: 'amount', dir: 'asc' },
    ]);
  });

  it('trunca a 3 criterios', () => {
    const out = parseSortParam('date:asc,amount:asc,account:asc,date:desc', undefined, OPTS);
    expect(out).toHaveLength(3);
  });

  it('dirección inválida descarta el token', () => {
    expect(parseSortParam('date:up,amount:asc', undefined, OPTS)).toEqual([
      { field: 'amount', dir: 'asc' },
    ]);
  });

  it('multi-token sin dirección no se tolera (solo legacy de 1 token)', () => {
    expect(parseSortParam('date,amount', undefined, OPTS)).toEqual(FALLBACK);
  });

  it('basura → fallback', () => {
    expect(parseSortParam(';;;', undefined, OPTS)).toEqual(FALLBACK);
    expect(parseSortParam(':::,,', undefined, OPTS)).toEqual(FALLBACK);
  });
});
