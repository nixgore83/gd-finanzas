'use server';

import { revalidatePath } from 'next/cache';
import { and, eq, gte } from 'drizzle-orm';
import { z } from 'zod';
import { getDb } from '@/lib/db/client';
import { forecasts, recurrences } from '@/db/schema';
import { requireHouseholdSession, SessionError } from '@/lib/auth/session';
import { syncForecasts, todayIso } from './_sync';
import type { RecurrenceInput } from '@/lib/schemas/recurrence';

export type SetActiveResult =
  | { ok: true }
  | { ok: false; error: 'invalid_input' | 'not_found' | 'session' | 'unknown' };

const inputSchema = z.object({
  id: z.string().uuid(),
  active: z.union([z.literal('true'), z.literal('false')]).transform((v) => v === 'true'),
});

/**
 * Pausa o reactiva. Al pausar borra forecasts pending futuras (no
 * queremos que aparezcan en el cashflow proyectado). Al reactivar
 * regenera el rolling 12m completo.
 */
export async function setRecurrenceActive(formData: FormData): Promise<SetActiveResult> {
  const parsed = inputSchema.safeParse({
    id: formData.get('id'),
    active: formData.get('active'),
  });
  if (!parsed.success) return { ok: false, error: 'invalid_input' };

  let session;
  try {
    session = await requireHouseholdSession();
  } catch (err) {
    if (err instanceof SessionError) return { ok: false, error: 'session' };
    throw err;
  }

  const db = getDb();
  const now = todayIso();

  try {
    const updatedId = await db.transaction(async (tx) => {
      const updated = await tx
        .update(recurrences)
        .set({ active: parsed.data.active })
        .where(
          and(eq(recurrences.id, parsed.data.id), eq(recurrences.householdId, session.householdId)),
        )
        .returning({
          id: recurrences.id,
          name: recurrences.name,
          accountId: recurrences.accountId,
          categoryId: recurrences.categoryId,
          kind: recurrences.kind,
          amount: recurrences.amount,
          currency: recurrences.currency,
          frequency: recurrences.frequency,
          dayOfMonth: recurrences.dayOfMonth,
          startDate: recurrences.startDate,
          endDate: recurrences.endDate,
          active: recurrences.active,
        });

      const row = updated[0];
      if (!row) return null;

      if (parsed.data.active) {
        // Reactivar: regenerar el rolling 12m
        const input: RecurrenceInput = {
          name: row.name,
          accountId: row.accountId,
          categoryId: row.categoryId ?? '',
          kind: row.kind as 'income' | 'expense',
          amount: row.amount,
          currency: row.currency,
          frequency: row.frequency as 'monthly' | 'bimonthly' | 'quarterly' | 'yearly',
          dayOfMonth: row.dayOfMonth ?? 1,
          startDate: row.startDate,
          endDate: row.endDate,
          active: true,
        };
        await syncForecasts(tx, row.id, input, now);
      } else {
        // Pausar: borrar pending del futuro
        await tx
          .delete(forecasts)
          .where(
            and(
              eq(forecasts.recurrenceId, row.id),
              eq(forecasts.status, 'pending'),
              gte(forecasts.expectedDate, now),
            ),
          );
      }
      return row.id;
    });

    if (!updatedId) return { ok: false, error: 'not_found' };

    revalidatePath('/recurrences');
    return { ok: true };
  } catch (err) {
    console.error('[recurrences] setActive failed', {
      code: (err as { code?: string }).code,
    });
    return { ok: false, error: 'unknown' };
  }
}
