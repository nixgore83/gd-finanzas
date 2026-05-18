import { and, eq, gte } from 'drizzle-orm';
import { forecasts } from '@/db/schema';
import {
  computeForecastDates,
  FORECAST_HORIZON_MONTHS,
  type Frequency,
} from '@/lib/recurrences/forecasts';
import type { RecurrenceInput } from '@/lib/schemas/recurrence';
import type { getDb } from '@/lib/db/client';

type Tx = Parameters<Parameters<ReturnType<typeof getDb>['transaction']>[0]>[0];

/**
 * Sincroniza forecasts de una recurrence:
 *  1. Borra pending del futuro (expected_date >= today). No toca matched /
 *     cancelled / missed pasadas — esas son historia.
 *  2. Si la recurrence está active, calcula las próximas N (12 por default)
 *     ocurrencias e inserta una fila por cada una con status='pending'.
 *
 * Llamarlo dentro de `db.transaction` para que el commit sea atómico con el
 * INSERT/UPDATE de la recurrence misma.
 */
export async function syncForecasts(
  tx: Tx,
  recurrenceId: string,
  input: RecurrenceInput,
  todayIso: string,
): Promise<void> {
  // 1) Limpiar pending del futuro
  await tx
    .delete(forecasts)
    .where(
      and(
        eq(forecasts.recurrenceId, recurrenceId),
        eq(forecasts.status, 'pending'),
        gte(forecasts.expectedDate, todayIso),
      ),
    );

  // 2) Si está inactiva, no regenerar
  if (!input.active) return;

  const dates = computeForecastDates({
    frequency: input.frequency as Frequency,
    dayOfMonth: input.dayOfMonth,
    startDate: input.startDate,
    endDate: input.endDate,
    horizonFrom: todayIso,
    horizonMonths: FORECAST_HORIZON_MONTHS,
  });

  if (dates.length === 0) return;

  await tx.insert(forecasts).values(
    dates.map((d) => ({
      recurrenceId,
      expectedDate: d,
      expectedAmount: input.amount,
      currency: input.currency,
      status: 'pending' as const,
    })),
  );
}

export function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}
