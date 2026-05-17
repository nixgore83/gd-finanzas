import { and, desc, eq, lte } from 'drizzle-orm';
import Decimal from 'decimal.js';
import { fxRates } from '@/db/schema';
import { getDb } from '@/lib/db/client';
import { resolveFxRate, type ResolvedFxRate } from './resolve';

export const USD_ARS_PAIR = 'USD/ARS';
export const IDENTITY_SOURCE = 'identity';

export class FxRateNotFoundError extends Error {
  constructor(
    readonly targetDate: string,
    readonly currencyPair: string,
  ) {
    super(`No hay cotización ${currencyPair} para ${targetDate} ni en los últimos 30 días`);
    this.name = 'FxRateNotFoundError';
  }
}

export async function getFxRate(args: {
  date: string;
  currency: 'ARS' | 'USD';
}): Promise<ResolvedFxRate> {
  if (args.currency === 'ARS') {
    return { rate: new Decimal(1), source: IDENTITY_SOURCE, effectiveDate: args.date };
  }

  const db = getDb();
  const rows = await db
    .select({
      date: fxRates.date,
      currencyPair: fxRates.currencyPair,
      mid: fxRates.mid,
      source: fxRates.source,
    })
    .from(fxRates)
    .where(and(eq(fxRates.currencyPair, USD_ARS_PAIR), lte(fxRates.date, args.date)))
    .orderBy(desc(fxRates.date))
    .limit(30);

  const resolved = resolveFxRate(rows, args.date, USD_ARS_PAIR);
  if (!resolved) throw new FxRateNotFoundError(args.date, USD_ARS_PAIR);
  return resolved;
}
