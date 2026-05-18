import Decimal from 'decimal.js';

/**
 * Lógica pura de match tx ↔ forecast. Sin DB.
 *
 * Regla del PRD §5.3: mismo monto ±10%, misma cuenta, ±5 días, mismo kind.
 * Account y kind se filtran en la query DB previa; acá solo aplicamos
 * amount + date.
 *
 * Cross-currency: el caller convierte ambos a USD antes de pasar. Acá
 * comparamos `amountUsd` numéricamente.
 */

export type ForecastCandidate = {
  id: string;
  recurrenceId: string;
  recurrenceName: string;
  expectedDate: string;
  expectedAmount: string;
  expectedAmountUsd: string;
  currency: 'ARS' | 'USD';
};

export type TxLike = {
  date: string;
  amountUsd: string;
};

export const MATCH_DATE_WINDOW_DAYS = 5;
export const MATCH_AMOUNT_TOLERANCE = 0.1;

function daysBetween(a: string, b: string): number {
  // ISO YYYY-MM-DD → ms; ambos a UTC midnight evita drift.
  const da = Date.parse(`${a}T00:00:00Z`);
  const db = Date.parse(`${b}T00:00:00Z`);
  return Math.round(Math.abs(da - db) / (24 * 60 * 60 * 1000));
}

export function rankCandidates(
  candidates: readonly ForecastCandidate[],
  tx: TxLike,
): ForecastCandidate[] {
  const txUsd = new Decimal(tx.amountUsd).abs();
  if (txUsd.isZero()) return [];

  const scored: Array<{
    c: ForecastCandidate;
    dateDiff: number;
    amountDiffPct: number;
  }> = [];

  for (const c of candidates) {
    const dateDiff = daysBetween(c.expectedDate, tx.date);
    if (dateDiff > MATCH_DATE_WINDOW_DAYS) continue;
    const fcUsd = new Decimal(c.expectedAmountUsd).abs();
    const diff = fcUsd.minus(txUsd).abs();
    const pct = diff.div(txUsd).toNumber();
    if (pct > MATCH_AMOUNT_TOLERANCE) continue;
    scored.push({ c, dateDiff, amountDiffPct: pct });
  }

  scored.sort((a, b) => {
    if (a.dateDiff !== b.dateDiff) return a.dateDiff - b.dateDiff;
    return a.amountDiffPct - b.amountDiffPct;
  });

  return scored.map((s) => s.c);
}
