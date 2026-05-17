'use server';

import { revalidatePath } from 'next/cache';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { getDb } from '@/lib/db/client';
import { transactions } from '@/db/schema';
import { requireHouseholdSession, SessionError } from '@/lib/auth/session';

export type DeleteTransactionResult =
  | { ok: true }
  | { ok: false; error: 'invalid_id' | 'not_found' | 'session' | 'unknown' };

const idSchema = z.string().uuid();

/**
 * Hard delete. V1 no usa soft delete para transacciones; auditoría sale del
 * cron + backups del Hito 10.
 *
 * TODO 3.C: cuando entren transferencias, este action tiene que ampliarse
 * para borrar la pata pareja (`transfer_pair_id`) en la misma transacción.
 */
export async function deleteTransaction(formData: FormData): Promise<DeleteTransactionResult> {
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
      .delete(transactions)
      .where(and(eq(transactions.id, id), eq(transactions.householdId, session.householdId)))
      .returning({ id: transactions.id });

    if (result.length === 0) return { ok: false, error: 'not_found' };

    revalidatePath('/transactions');
    return { ok: true };
  } catch (err) {
    console.error('[transactions] delete failed', { code: (err as { code?: string }).code });
    return { ok: false, error: 'unknown' };
  }
}
