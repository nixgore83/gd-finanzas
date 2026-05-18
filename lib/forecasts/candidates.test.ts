import { describe, it, expect } from 'vitest';
import { rankCandidates, type ForecastCandidate, type TxLike } from './candidates';

const baseCandidate = (overrides: Partial<ForecastCandidate>): ForecastCandidate => ({
  id: 'f1',
  recurrenceId: 'r1',
  recurrenceName: 'Sueldo Nico',
  expectedDate: '2026-05-02',
  expectedAmount: '10000.00',
  expectedAmountUsd: '10000.00',
  currency: 'USD',
  ...overrides,
});

describe('rankCandidates', () => {
  it('incluye match exacto de fecha y monto', () => {
    const c = baseCandidate({});
    const tx: TxLike = { date: '2026-05-02', amountUsd: '10000.00' };
    expect(rankCandidates([c], tx)).toEqual([c]);
  });

  it('excluye candidates con diff de fecha > 5 días', () => {
    const c = baseCandidate({ expectedDate: '2026-05-02' });
    const tx: TxLike = { date: '2026-05-08', amountUsd: '10000.00' };
    expect(rankCandidates([c], tx)).toEqual([]);
  });

  it('incluye candidates con diff de fecha 5 días', () => {
    const c = baseCandidate({ expectedDate: '2026-05-02' });
    const tx: TxLike = { date: '2026-05-07', amountUsd: '10000.00' };
    expect(rankCandidates([c], tx)).toEqual([c]);
  });

  it('excluye monto fuera del ±10%', () => {
    const c = baseCandidate({ expectedAmountUsd: '10000' });
    const tx: TxLike = { date: '2026-05-02', amountUsd: '11500' }; // 15% más
    expect(rankCandidates([c], tx)).toEqual([]);
  });

  it('incluye monto justo en el 10%', () => {
    const c = baseCandidate({ expectedAmountUsd: '10000' });
    const tx: TxLike = { date: '2026-05-02', amountUsd: '11000' }; // 10% más
    expect(rankCandidates([c], tx)).toEqual([c]);
  });

  it('ordena por proximidad de fecha primero, después monto', () => {
    const c1 = baseCandidate({ id: 'f1', expectedDate: '2026-05-02', expectedAmountUsd: '10500' });
    const c2 = baseCandidate({ id: 'f2', expectedDate: '2026-05-05', expectedAmountUsd: '10000' });
    const c3 = baseCandidate({ id: 'f3', expectedDate: '2026-05-02', expectedAmountUsd: '10000' });
    const tx: TxLike = { date: '2026-05-02', amountUsd: '10000' };
    const sorted = rankCandidates([c1, c2, c3], tx);
    expect(sorted.map((c) => c.id)).toEqual(['f3', 'f1', 'f2']);
  });

  it('cross-currency: tx en ARS comparado contra forecast en USD via amountUsd', () => {
    const c = baseCandidate({
      id: 'f1',
      currency: 'USD',
      expectedAmount: '10000',
      expectedAmountUsd: '10000', // ya convertido por el caller
    });
    // tx en ARS de 14M, convertido a USD ≈ 10000 al rate del día
    const tx: TxLike = { date: '2026-05-02', amountUsd: '10000.00' };
    expect(rankCandidates([c], tx)).toEqual([c]);
  });

  it('array vacío → []', () => {
    const tx: TxLike = { date: '2026-05-02', amountUsd: '10000' };
    expect(rankCandidates([], tx)).toEqual([]);
  });

  it('tx con amountUsd = 0 → []', () => {
    const c = baseCandidate({});
    const tx: TxLike = { date: '2026-05-02', amountUsd: '0' };
    expect(rankCandidates([c], tx)).toEqual([]);
  });
});
