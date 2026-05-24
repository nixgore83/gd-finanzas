import YahooFinance from 'yahoo-finance2';

export interface QuoteResult {
  price: number;
  currency: string;
}

const yf = new YahooFinance();

/**
 * Fetches current market prices for a list of tickers using Yahoo Finance.
 *
 * US stocks/ETFs: use ticker directly (e.g., "AAPL", "VOO")
 * CEDEARs: append ".BA" (e.g., "AAPL.BA", "MELI.BA")
 * AR bonds: append ".BA" (e.g., "AL30.BA", "GD30.BA")
 *
 * Returns a map of ticker -> { price, currency }. Tickers that fail
 * to resolve are silently omitted from the result.
 */
export async function fetchQuotes(tickers: string[]): Promise<Record<string, QuoteResult>> {
  if (tickers.length === 0) return {};

  const results: Record<string, QuoteResult> = {};

  for (const ticker of tickers) {
    try {
      const q = await yf.quote(ticker);
      if (q.symbol && q.regularMarketPrice != null && q.currency) {
        results[q.symbol] = {
          price: q.regularMarketPrice,
          currency: q.currency,
        };
      }
    } catch {
      // Skip tickers that can't be resolved
    }
  }

  return results;
}
