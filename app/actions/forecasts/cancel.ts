'use server';

import { revalidatePath } from 'next/cache';
import { and, eq, exists } from 'drizzle-orm';
import { z } from 'zod';
import { getDb } from '@/lib/db/client';
import { forecasts, recurrences } from '@/db/schema';
import { requireHouseholdSession, SessionError } from '@/lib/auth/session';

export type CancelForecastResult =
  | { ok: true }
  | { ok: false; error: 'invalid_id' | 'not_found' | 'session' | 'unknown' };

const idSchema = z.string().uuid();

export async function cancelForecast(formData: FormData): Promise<CancelForecastResult> {
  const idParsed = idSchema.safeParse(formData.get('id'));
  if (!idParsed.success) return { ok: false, error: 'invalid_id' };
  const id = idParsed.data;

  let session;
  try {
    session = await requireHouseholdSession();
  } catch (err) {
    if (err instanceof SessionError) return { ok: false, error: 'session' };
    throw err;
  }

  const db = getDb();
  try {
    const result = await db
      .update(forecasts)
      .set({ status: 'cancelled' })
      .where(
        and(
          eq(forecasts.id, id),
          eq(forecasts.status, 'pending'),
          exists(
            db
              .select({ one: recurrences.id })
              .from(recurrences)
              .where(
                and(
                  eq(recurrences.id, forecasts.recurrenceId),
                  eq(recurrences.householdId, session.householdId),
                ),
              ),
          ),
        ),
      )
      .returning({ id: forecasts.id });

    if (result.length === 0) return { ok: false, error: 'not_found' };

    revalidatePath('/forecasts');
    return { ok: true };
  } catch (err) {
    console.error('[forecasts] cancel failed', { code: (err as { code?: string }).code });
    return { ok: false, error: 'unknown' };
  }
}
