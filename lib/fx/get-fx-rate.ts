import { and, desc, eq, gte, lte } from 'drizzle-orm';
import { fxRates } from '@/db/schema';
import { getDb } from '@/lib/db/client';
import { resolveFxRate, type ResolvedFxRate } from './resolve';

export const USD_ARS_PAIR = 'USD/ARS';

export class FxRateNotFoundError extends Error {
  constructor(
    readonly targetDate: string,
    readonly currencyPair: string,
  ) {
    super(`No hay cotización ${currencyPair} para ${targetDate} ni en los últimos 30 días`);
    this.name = 'FxRateNotFoundError';
  }
}

/**
 * Devuelve la cotización BCRA minorista USD/ARS para una fecha (con fallback al
 * día previo si la fecha pedida no tiene cotización publicada). El caller usa
 * el rate para convertir en ambas direcciones (USD→ARS multiplicando, ARS→USD
 * dividiendo). No parametrizamos por moneda porque toda conversión en V1 pasa
 * por el par USD/ARS.
 */
export async function getFxRate(args: { date: string }): Promise<ResolvedFxRate> {
  const db = getDb();
  
  // Calcular ventana de 30 días hacia atrás respecto a la fecha target
  const targetDate = new Date(args.date);
  const thirtyDaysAgoDate = new Date(targetDate.getTime() - 30 * 24 * 60 * 60 * 1000);
  const thirtyDaysAgo = thirtyDaysAgoDate.toISOString().slice(0, 10);

  const rows = await db
    .select({
      date: fxRates.date,
      currencyPair: fxRates.currencyPair,
      mid: fxRates.mid,
      source: fxRates.source,
    })
    .from(fxRates)
    .where(
      and(
        eq(fxRates.currencyPair, USD_ARS_PAIR),
        lte(fxRates.date, args.date),
        gte(fxRates.date, thirtyDaysAgo),
      ),
    )
    .orderBy(desc(fxRates.date))
    .limit(1);

  const resolved = resolveFxRate(rows, args.date, USD_ARS_PAIR);
  if (!resolved) throw new FxRateNotFoundError(args.date, USD_ARS_PAIR);
  return resolved;
}
