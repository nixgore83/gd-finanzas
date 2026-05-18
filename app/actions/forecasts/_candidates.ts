import { and, eq, gte, isNull, lte } from 'drizzle-orm';
import Decimal from 'decimal.js';
import { getDb } from '@/lib/db/client';
import { forecasts, recurrences, transactions } from '@/db/schema';
import { getFxRate } from '@/lib/fx/get-fx-rate';
import {
  rankCandidates,
  MATCH_DATE_WINDOW_DAYS,
  type ForecastCandidate,
} from '@/lib/forecasts/candidates';

/**
 * Encuentra forecasts pending que podrían matchear con la transacción dada.
 * Pre-filtra en DB por household + account + kind + ventana de ±5 días, y
 * después calcula el USD equivalente de cada candidate via `getFxRate` para
 * pasar por el filtro de ±10% que vive en `rankCandidates`.
 *
 * Devuelve [] si la tx es transfer, no existe en el household, o ya está
 * matched (recurrence_id no null).
 */
export async function findMatchCandidates(
  transactionId: string,
  householdId: string,
): Promise<ForecastCandidate[]> {
  const db = getDb();

  const [tx] = await db
    .select({
      id: transactions.id,
      date: transactions.date,
      accountId: transactions.accountId,
      kind: transactions.kind,
      amountUsd: transactions.amountUsd,
      recurrenceId: transactions.recurrenceId,
    })
    .from(transactions)
    .where(
      and(eq(transactions.id, transactionId), eq(transactions.householdId, householdId)),
    )
    .limit(1);

  if (!tx) return [];
  if (tx.kind === 'transfer') return [];
  if (tx.recurrenceId) return [];

  // Ventana de fechas en ISO. Aceptamos +/- MATCH_DATE_WINDOW_DAYS.
  const txDateMs = Date.parse(`${tx.date}T00:00:00Z`);
  const lowerMs = txDateMs - MATCH_DATE_WINDOW_DAYS * 24 * 60 * 60 * 1000;
  const upperMs = txDateMs + MATCH_DATE_WINDOW_DAYS * 24 * 60 * 60 * 1000;
  const lower = new Date(lowerMs).toISOString().slice(0, 10);
  const upper = new Date(upperMs).toISOString().slice(0, 10);

  const rows = await db
    .select({
      id: forecasts.id,
      recurrenceId: recurrences.id,
      recurrenceName: recurrences.name,
      expectedDate: forecasts.expectedDate,
      expectedAmount: forecasts.expectedAmount,
      currency: forecasts.currency,
    })
    .from(forecasts)
    .innerJoin(recurrences, eq(recurrences.id, forecasts.recurrenceId))
    .where(
      and(
        eq(recurrences.householdId, householdId),
        eq(recurrences.accountId, tx.accountId),
        eq(recurrences.kind, tx.kind),
        eq(forecasts.status, 'pending'),
        isNull(forecasts.matchedTransactionId),
        gte(forecasts.expectedDate, lower),
        lte(forecasts.expectedDate, upper),
      ),
    );

  const enriched: ForecastCandidate[] = [];
  for (const r of rows) {
    let expectedAmountUsd: string;
    if (r.currency === 'USD') {
      expectedAmountUsd = r.expectedAmount;
    } else {
      const fx = await getFxRate({ date: r.expectedDate });
      const usd = new Decimal(r.expectedAmount).div(fx.rate);
      expectedAmountUsd = usd.toFixed(2, Decimal.ROUND_HALF_UP);
    }
    enriched.push({
      id: r.id,
      recurrenceId: r.recurrenceId,
      recurrenceName: r.recurrenceName,
      expectedDate: r.expectedDate,
      expectedAmount: r.expectedAmount,
      expectedAmountUsd,
      currency: r.currency,
    });
  }

  return rankCandidates(enriched, { date: tx.date, amountUsd: tx.amountUsd }).slice(0, 5);
}
