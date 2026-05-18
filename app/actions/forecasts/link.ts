'use server';

import { revalidatePath } from 'next/cache';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { getDb } from '@/lib/db/client';
import { forecasts, recurrences, transactions } from '@/db/schema';
import { requireHouseholdSession, SessionError } from '@/lib/auth/session';

export type LinkForecastResult =
  | { ok: true; recurrenceId: string }
  | {
      ok: false;
      error: 'invalid_input' | 'not_found' | 'already_linked' | 'session' | 'unknown';
    };

const inputSchema = z.object({
  transactionId: z.string().uuid(),
  forecastId: z.string().uuid(),
});

export async function linkTransactionForecast(
  formData: FormData,
): Promise<LinkForecastResult> {
  const parsed = inputSchema.safeParse({
    transactionId: formData.get('transactionId'),
    forecastId: formData.get('forecastId'),
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

  try {
    const result = await db.transaction(async (tx) => {
      const [forecastRow] = await tx
        .select({
          id: forecasts.id,
          recurrenceId: recurrences.id,
          status: forecasts.status,
        })
        .from(forecasts)
        .innerJoin(recurrences, eq(recurrences.id, forecasts.recurrenceId))
        .where(
          and(
            eq(forecasts.id, parsed.data.forecastId),
            eq(recurrences.householdId, session.householdId),
          ),
        )
        .limit(1);

      if (!forecastRow) return { kind: 'not_found' as const };
      if (forecastRow.status !== 'pending') return { kind: 'not_found' as const };

      const [txRow] = await tx
        .select({
          id: transactions.id,
          kind: transactions.kind,
          recurrenceId: transactions.recurrenceId,
        })
        .from(transactions)
        .where(
          and(
            eq(transactions.id, parsed.data.transactionId),
            eq(transactions.householdId, session.householdId),
          ),
        )
        .limit(1);

      if (!txRow) return { kind: 'not_found' as const };
      if (txRow.kind === 'transfer') return { kind: 'not_found' as const };
      if (txRow.recurrenceId !== null) return { kind: 'already_linked' as const };

      await tx
        .update(forecasts)
        .set({ status: 'matched', matchedTransactionId: txRow.id })
        .where(eq(forecasts.id, forecastRow.id));

      await tx
        .update(transactions)
        .set({ recurrenceId: forecastRow.recurrenceId })
        .where(eq(transactions.id, txRow.id));

      return { kind: 'ok' as const, recurrenceId: forecastRow.recurrenceId };
    });

    if (result.kind === 'not_found') return { ok: false, error: 'not_found' };
    if (result.kind === 'already_linked') return { ok: false, error: 'already_linked' };

    revalidatePath('/forecasts');
    revalidatePath(`/transactions/${parsed.data.transactionId}`);
    return { ok: true, recurrenceId: result.recurrenceId };
  } catch (err) {
    console.error('[forecasts] link failed', { code: (err as { code?: string }).code });
    return { ok: false, error: 'unknown' };
  }
}
