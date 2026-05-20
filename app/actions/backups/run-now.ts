'use server';

import { revalidatePath } from 'next/cache';
import { requireHouseholdSession, SessionError } from '@/lib/auth/session';
import { runBackup } from '@/lib/backups/run';
import { DriveConfigError } from '@/lib/backups/drive';

export type RunBackupNowResult =
  | { ok: true; filename: string; sizeBytes: number; deleted: number }
  | {
      ok: false;
      error: 'session' | 'drive_config' | 'unknown';
      message?: string;
    };

export async function runBackupNow(): Promise<RunBackupNowResult> {
  let session;
  try {
    session = await requireHouseholdSession();
  } catch (err) {
    if (err instanceof SessionError) return { ok: false, error: 'session' };
    throw err;
  }

  try {
    const result = await runBackup(session.householdId);
    revalidatePath('/settings/backups');
    return {
      ok: true,
      filename: result.uploaded.name,
      sizeBytes: result.uploaded.sizeBytes,
      deleted: result.deleted.length,
    };
  } catch (err) {
    if (err instanceof DriveConfigError) {
      return { ok: false, error: 'drive_config', message: err.message };
    }
    console.error('[backups] runBackupNow failed', {
      message: (err as Error).message?.slice(0, 200),
    });
    return { ok: false, error: 'unknown' };
  }
}
