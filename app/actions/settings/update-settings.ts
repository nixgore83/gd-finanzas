'use server';

import { revalidatePath } from 'next/cache';
import { sql } from 'drizzle-orm';
import { getDb } from '@/lib/db/client';
import { householdSettings } from '@/db/schema';
import { requireHouseholdSession, SessionError } from '@/lib/auth/session';

export type UpdateSettingsResult =
  | { ok: true }
  | { ok: false; error: 'session' | 'unknown' };

export async function updateAutoMatchSetting(
  enabled: boolean,
): Promise<UpdateSettingsResult> {
  let session;
  try {
    session = await requireHouseholdSession();
  } catch (err) {
    if (err instanceof SessionError) return { ok: false, error: 'session' };
    throw err;
  }

  const db = getDb();

  try {
    await db
      .insert(householdSettings)
      .values({
        householdId: session.householdId,
        autoMatchForecasts: enabled,
        updatedBy: session.userId,
        updatedAt: sql`now()`,
      })
      .onConflictDoUpdate({
        target: householdSettings.householdId,
        set: {
          autoMatchForecasts: enabled,
          updatedBy: session.userId,
          updatedAt: sql`now()`,
        },
      });

    revalidatePath('/settings/general');
    return { ok: true };
  } catch (err) {
    console.error('[settings] update failed', err);
    return { ok: false, error: 'unknown' };
  }
}
