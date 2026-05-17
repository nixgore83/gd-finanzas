import Decimal from 'decimal.js';

/**
 * Lógica pura de selección de cotización. Sin DB. Si no hay match exacto para
 * la fecha pedida, cae al día anterior más cercano y marca el flag de fallback.
 * Si no hay ninguna row <= targetDate, devuelve null y deja que el caller
 * decida si tirar error.
 */

export type FxRateRow = {
  date: string;
  currencyPair: string;
  mid: string;
  source: string;
};

export type ResolvedFxRate = {
  rate: Decimal;
  source: string;
  effectiveDate: string;
};

export const FALLBACK_SOURCE = 'BCRA_last_available';

export function resolveFxRate(
  rows: readonly FxRateRow[],
  targetDate: string,
  currencyPair: string,
): ResolvedFxRate | null {
  let best: FxRateRow | null = null;
  for (const r of rows) {
    if (r.currencyPair !== currencyPair) continue;
    if (r.date > targetDate) continue;
    if (best === null || r.date > best.date) best = r;
  }
  if (best === null) return null;

  const isFallback = best.date !== targetDate;
  return {
    rate: new Decimal(best.mid),
    source: isFallback ? FALLBACK_SOURCE : best.source,
    effectiveDate: best.date,
  };
}
