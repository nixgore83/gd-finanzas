'use server';

import { and, eq, gte, isNull, lte } from 'drizzle-orm';
import Decimal from 'decimal.js';
import { z } from 'zod';
import { getDb } from '@/lib/db/client';
import { forecasts, recurrences } from '@/db/schema';
import { requireHouseholdSession, SessionError } from '@/lib/auth/session';
import { getFxRate } from '@/lib/fx/get-fx-rate';
import {
  rankCandidates,
  MATCH_DATE_WINDOW_DAYS,
  type ForecastCandidate,
} from '@/lib/forecasts/candidates';

const inputSchema = z.object({
  accountId: z.string().uuid(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  kind: z.enum(['income', 'expense']),
  amount: z.string().regex(/^-?\d+(\.\d+)?$/),
  currency: z.enum(['ARS', 'USD']),
});

export type LineForecastCandidate = {
  id: string;
  recurrenceName: string;
  expectedDate: string;
  expectedAmount: string;
  currency: 'ARS' | 'USD';
};

export type LineForecastCandidatesResult =
  | { ok: true; candidates: LineForecastCandidate[] }
  | { ok: false; error: 'session' | 'invalid_input' | 'unknown' };

/**
 * Candidatos de previsión para una LÍNEA de import (todavía no es transacción):
 * misma regla del PRD §5.3 que el match manual de /transactions (cuenta + kind +
 * fecha ±5 días + monto ±10% en USD). Siempre disponible en la review,
 * independiente del toggle global de auto-match (decisión Nico 2026-06-11: el
 * toggle solo controla el match automático al confirmar).
 */
export async function findLineForecastCandidates(input: {
  accountId: string;
  date: string;
  kind: 'income' | 'expense';
  amount: string;
  currency: 'ARS' | 'USD';
}): Promise<LineForecastCandidatesResult> {
  let session;
  try {
    session = await requireHouseholdSession();
  } catch (err) {
    if (err instanceof SessionError) return { ok: false, error: 'session' };
    throw err;
  }

  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'invalid_input' };

  const db = getDb();

  try {
    // USD equivalente del monto de la línea (la línea aún no tiene amount_usd).
    let amountUsd: string;
    if (parsed.data.currency === 'USD') {
      amountUsd = parsed.data.amount;
    } else {
      const fx = await getFxRate({ date: parsed.data.date });
      amountUsd = new Decimal(parsed.data.amount).div(fx.rate).toFixed(2, Decimal.ROUND_HALF_UP);
    }

    const txDateMs = Date.parse(`${parsed.data.date}T00:00:00Z`);
    const lower = new Date(txDateMs - MATCH_DATE_WINDOW_DAYS * 86_400_000).toISOString().slice(0, 10);
    const upper = new Date(txDateMs + MATCH_DATE_WINDOW_DAYS * 86_400_000).toISOString().slice(0, 10);

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
          eq(recurrences.householdId, session.householdId),
          eq(recurrences.accountId, parsed.data.accountId),
          eq(recurrences.kind, parsed.data.kind),
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
        expectedAmountUsd = new Decimal(r.expectedAmount)
          .div(fx.rate)
          .toFixed(2, Decimal.ROUND_HALF_UP);
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

    const ranked = rankCandidates(enriched, { date: parsed.data.date, amountUsd }).slice(0, 5);
    return {
      ok: true,
      candidates: ranked.map((c) => ({
        id: c.id,
        recurrenceName: c.recurrenceName,
        expectedDate: c.expectedDate,
        expectedAmount: c.expectedAmount,
        currency: c.currency,
      })),
    };
  } catch (err) {
    console.error('[imports] line-forecast-candidates failed', {
      code: (err as { code?: string }).code,
    });
    return { ok: false, error: 'unknown' };
  }
}
