'use server';

import { fetchQuotes, type QuoteResult } from '@/lib/prices/fetch-quotes';
import { requireHouseholdSession, SessionError } from '@/lib/auth/session';

export type FetchPricesResult =
  | { ok: true; quotes: Record<string, QuoteResult> }
  | { ok: false; error: 'session' | 'unknown' };

export async function fetchPrices(tickers: string[]): Promise<FetchPricesResult> {
  try {
    await requireHouseholdSession();
  } catch (err) {
    if (err instanceof SessionError) return { ok: false, error: 'session' };
    throw err;
  }

  try {
    const quotes = await fetchQuotes(tickers);
    return { ok: true, quotes };
  } catch (err) {
    console.error('[patrimonio] fetch-prices failed', err);
    return { ok: false, error: 'unknown' };
  }
}
