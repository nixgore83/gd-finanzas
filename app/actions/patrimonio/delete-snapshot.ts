'use server';

import { revalidatePath } from 'next/cache';
import { and, eq } from 'drizzle-orm';
import { getDb } from '@/lib/db/client';
import { netWorthSnapshots } from '@/db/schema';
import { requireHouseholdSession, SessionError } from '@/lib/auth/session';

export type DeleteSnapshotResult =
  | { ok: true }
  | { ok: false; error: 'session' | 'not_found' | 'unknown' };

export async function deleteSnapshot(snapshotId: string): Promise<DeleteSnapshotResult> {
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
      .delete(netWorthSnapshots)
      .where(
        and(
          eq(netWorthSnapshots.id, snapshotId),
          eq(netWorthSnapshots.householdId, session.householdId),
        ),
      )
      .returning({ id: netWorthSnapshots.id });

    if (result.length === 0) return { ok: false, error: 'not_found' };

    revalidatePath('/patrimonio');
    return { ok: true };
  } catch (err) {
    console.error('[patrimonio] delete-snapshot failed', {
      code: (err as { code?: string }).code,
    });
    return { ok: false, error: 'unknown' };
  }
}
