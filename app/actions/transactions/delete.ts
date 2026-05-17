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
 * Si la fila tiene `transfer_pair_id`, borra ambas patas del par en un solo
 * statement (WHERE transfer_pair_id = X + householdId).
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
    const [row] = await db
      .select({ transferPairId: transactions.transferPairId })
      .from(transactions)
      .where(and(eq(transactions.id, id), eq(transactions.householdId, session.householdId)))
      .limit(1);

    if (!row) return { ok: false, error: 'not_found' };

    if (row.transferPairId) {
      await db
        .delete(transactions)
        .where(
          and(
            eq(transactions.householdId, session.householdId),
            eq(transactions.transferPairId, row.transferPairId),
          ),
        );
    } else {
      await db
        .delete(transactions)
        .where(and(eq(transactions.id, id), eq(transactions.householdId, session.householdId)));
    }

    revalidatePath('/transactions');
    return { ok: true };
  } catch (err) {
    console.error('[transactions] delete failed', { code: (err as { code?: string }).code });
    return { ok: false, error: 'unknown' };
  }
}
