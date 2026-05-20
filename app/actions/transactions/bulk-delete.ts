'use server';

import { revalidatePath } from 'next/cache';
import { and, eq, inArray, isNotNull, or } from 'drizzle-orm';
import { z } from 'zod';
import { getDb } from '@/lib/db/client';
import { transactions } from '@/db/schema';
import { requireHouseholdSession, SessionError } from '@/lib/auth/session';

const inputSchema = z.object({
  ids: z.array(z.string().uuid()).min(1).max(500),
});

export type BulkDeleteResult =
  | { ok: true; deleted: number }
  | { ok: false; error: 'session' | 'invalid_input' | 'unknown' };

/**
 * Borra varias transacciones en bloque. Para transfers, borra también la pata
 * pareja (matching transfer_pair_id), siguiendo la misma lógica que el delete
 * individual de Hito 3.C.
 */
export async function bulkDeleteTransactions(input: { ids: string[] }): Promise<BulkDeleteResult> {
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
    // Buscar los pair_ids de transfers seleccionados.
    const targets = await db
      .select({
        id: transactions.id,
        transferPairId: transactions.transferPairId,
      })
      .from(transactions)
      .where(
        and(
          eq(transactions.householdId, session.householdId),
          inArray(transactions.id, parsed.data.ids),
        ),
      );

    const pairIds = targets
      .map((t) => t.transferPairId)
      .filter((p): p is string => p !== null);
    const directIds = targets.map((t) => t.id);

    const orClauses = [inArray(transactions.id, directIds)];
    if (pairIds.length > 0) orClauses.push(inArray(transactions.transferPairId, pairIds));

    const cond =
      orClauses.length === 1
        ? orClauses[0]!
        : or(...orClauses);

    const deleted = await db
      .delete(transactions)
      .where(
        and(
          eq(transactions.householdId, session.householdId),
          cond,
          isNotNull(transactions.id),
        ),
      )
      .returning({ id: transactions.id });

    revalidatePath('/transactions');
    return { ok: true, deleted: deleted.length };
  } catch (err) {
    console.error('[transactions] bulk-delete failed', {
      code: (err as { code?: string }).code,
    });
    return { ok: false, error: 'unknown' };
  }
}
