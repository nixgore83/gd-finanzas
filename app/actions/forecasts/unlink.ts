'use server';

import { revalidatePath } from 'next/cache';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { getDb } from '@/lib/db/client';
import { forecasts, transactions } from '@/db/schema';
import { requireHouseholdSession, SessionError } from '@/lib/auth/session';

export type UnlinkForecastResult =
  | { ok: true }
  | { ok: false; error: 'invalid_input' | 'not_found' | 'session' | 'unknown' };

const inputSchema = z.object({ transactionId: z.string().uuid() });

export async function unlinkTransactionForecast(
  formData: FormData,
): Promise<UnlinkForecastResult> {
  const parsed = inputSchema.safeParse({ transactionId: formData.get('transactionId') });
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
      const [txRow] = await tx
        .select({ id: transactions.id, recurrenceId: transactions.recurrenceId })
        .from(transactions)
        .where(
          and(
            eq(transactions.id, parsed.data.transactionId),
            eq(transactions.householdId, session.householdId),
          ),
        )
        .limit(1);

      if (!txRow || !txRow.recurrenceId) return { kind: 'not_found' as const };

      await tx
        .update(forecasts)
        .set({ status: 'pending', matchedTransactionId: null })
        .where(and(eq(forecasts.matchedTransactionId, txRow.id), eq(forecasts.status, 'matched')));

      await tx
        .update(transactions)
        .set({ recurrenceId: null })
        .where(eq(transactions.id, txRow.id));

      return { kind: 'ok' as const };
    });

    if (result.kind === 'not_found') return { ok: false, error: 'not_found' };

    revalidatePath('/forecasts');
    revalidatePath(`/transactions/${parsed.data.transactionId}`);
    return { ok: true };
  } catch (err) {
    console.error('[forecasts] unlink failed', { code: (err as { code?: string }).code });
    return { ok: false, error: 'unknown' };
  }
}
