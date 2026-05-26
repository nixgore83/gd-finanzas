import { and, eq, gte, isNull, lte } from 'drizzle-orm';
import Decimal from 'decimal.js';
import type { ExtractTablesWithRelations } from 'drizzle-orm';
import type { PgTransaction, PgQueryResultHKT } from 'drizzle-orm/pg-core';
import { getDb } from '@/lib/db/client';
import { forecasts, householdSettings, recurrences, transactions } from '@/db/schema';
import { getFxRate } from '@/lib/fx/get-fx-rate';
import { rankCandidates, MATCH_DATE_WINDOW_DAYS } from '@/lib/forecasts/candidates';
import type * as schema from '@/db/schema';

type Tx = PgTransaction<PgQueryResultHKT, typeof schema, ExtractTablesWithRelations<typeof schema>>;

export type AutoMatchResult =
  | { matched: true; forecastId: string; recurrenceName: string }
  | { matched: false };

/**
 * Consulta `household_settings` para ver si el auto-match está habilitado.
 * Si no hay fila → default OFF.
 */
export async function getAutoMatchEnabled(householdId: string): Promise<boolean> {
  const db = getDb();
  const [row] = await db
    .select({ autoMatchForecasts: householdSettings.autoMatchForecasts })
    .from(householdSettings)
    .where(eq(householdSettings.householdId, householdId))
    .limit(1);
  return row?.autoMatchForecasts ?? false;
}

/**
 * Intenta auto-matchear una transacción recién creada con un forecast pending.
 *
 * Reglas:
 * - Solo matchea si hay exactamente 1 candidato dentro de la tolerancia.
 *   Si hay 2+ candidatos con scores similares, no matchea (ambiguo → manual).
 * - Corre dentro de la DB transaction del caller para atomicidad.
 * - Transfers y transacciones ya linkeadas se skipean.
 */
export async function tryAutoMatch(
  tx: Tx,
  transactionId: string,
  householdId: string,
): Promise<AutoMatchResult> {
  const [txRow] = await tx
    .select({
      id: transactions.id,
      date: transactions.date,
      accountId: transactions.accountId,
      kind: transactions.kind,
      amountUsd: transactions.amountUsd,
      recurrenceId: transactions.recurrenceId,
    })
    .from(transactions)
    .where(and(eq(transactions.id, transactionId), eq(transactions.householdId, householdId)))
    .limit(1);

  if (!txRow) return { matched: false };
  if (txRow.kind === 'transfer') return { matched: false };
  if (txRow.recurrenceId) return { matched: false };

  const txDateMs = Date.parse(`${txRow.date}T00:00:00Z`);
  const lowerMs = txDateMs - MATCH_DATE_WINDOW_DAYS * 24 * 60 * 60 * 1000;
  const upperMs = txDateMs + MATCH_DATE_WINDOW_DAYS * 24 * 60 * 60 * 1000;
  const lower = new Date(lowerMs).toISOString().slice(0, 10);
  const upper = new Date(upperMs).toISOString().slice(0, 10);

  const rows = await tx
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
        eq(recurrences.accountId, txRow.accountId),
        eq(recurrences.kind, txRow.kind),
        eq(forecasts.status, 'pending'),
        isNull(forecasts.matchedTransactionId),
        gte(forecasts.expectedDate, lower),
        lte(forecasts.expectedDate, upper),
      ),
    );

  if (rows.length === 0) return { matched: false };

  // Enriquecer con USD equivalente
  const enriched = [];
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

  const ranked = rankCandidates(enriched, { date: txRow.date, amountUsd: txRow.amountUsd });
  if (ranked.length === 0) return { matched: false };

  // Solo auto-matchear si hay 1 candidato claro.
  // Si hay 2+ y el #2 tiene score similar al #1, es ambiguo → no matchear.
  if (ranked.length >= 2) {
    return { matched: false };
  }

  const best = ranked[0]!;

  // Linkear: forecast → matched, transaction → recurrenceId
  await tx
    .update(forecasts)
    .set({ status: 'matched', matchedTransactionId: transactionId })
    .where(eq(forecasts.id, best.id));

  await tx
    .update(transactions)
    .set({ recurrenceId: best.recurrenceId })
    .where(eq(transactions.id, transactionId));

  return { matched: true, forecastId: best.id, recurrenceName: best.recurrenceName };
}
