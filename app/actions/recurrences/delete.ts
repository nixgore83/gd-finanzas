'use server';

import { revalidatePath } from 'next/cache';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { getDb } from '@/lib/db/client';
import { recurrences } from '@/db/schema';
import { requireHouseholdSession, SessionError } from '@/lib/auth/session';

export type DeleteRecurrenceResult =
  | { ok: true }
  | { ok: false; error: 'invalid_id' | 'not_found' | 'session' | 'unknown' };

const idSchema = z.string().uuid();

/**
 * Hard delete. `forecasts.recurrence_id` tiene ON DELETE CASCADE: las
 * forecasts asociadas (pending/matched/missed/cancelled) se borran. Si una
 * forecast estaba matched a una tx, la columna `matched_transaction_id` de
 * forecasts ya no existe — la tx queda intacta. La columna
 * `transactions.recurrence_id` es ON DELETE SET NULL, así que las txs que
 * habían sido matched a esta recurrence pierden el link pero no se borran.
 */
export async function deleteRecurrence(formData: FormData): Promise<DeleteRecurrenceResult> {
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
      .delete(recurrences)
      .where(and(eq(recurrences.id, id), eq(recurrences.householdId, session.householdId)))
      .returning({ id: recurrences.id });

    if (result.length === 0) return { ok: false, error: 'not_found' };

    revalidatePath('/recurrences');
    return { ok: true };
  } catch (err) {
    console.error('[recurrences] delete failed', { code: (err as { code?: string }).code });
    return { ok: false, error: 'unknown' };
  }
}
