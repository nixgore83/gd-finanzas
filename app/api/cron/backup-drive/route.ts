import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db/client';
import { households } from '@/db/schema';
import { getServerEnv } from '@/lib/env';
import { runBackup } from '@/lib/backups/run';
import { DriveConfigError } from '@/lib/backups/drive';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(request: Request) {
  const env = getServerEnv();

  const auth = request.headers.get('authorization');
  if (auth !== `Bearer ${env.CRON_SECRET}`) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }

  const db = getDb();
  const rows = await db.select({ id: households.id }).from(households).limit(2);

  if (rows.length === 0) {
    console.warn('[cron/backup-drive] no households');
    return NextResponse.json({ ok: true, skipped: 'no_household' });
  }
  if (rows.length > 1) {
    // V1 asume 1 household. Si en V2 hay más, iterar.
    console.warn('[cron/backup-drive] múltiples households — iterando sería V2');
  }

  const householdId = rows[0]!.id;

  try {
    const result = await runBackup(householdId);
    console.warn('[cron/backup-drive] ok', {
      uploaded: result.uploaded.name,
      size: result.uploaded.sizeBytes,
      deleted: result.deleted.length,
      totalAfter: result.totalAfter,
    });
    return NextResponse.json({
      ok: true,
      uploaded: result.uploaded.name,
      sizeBytes: result.uploaded.sizeBytes,
      deleted: result.deleted.length,
      totalAfter: result.totalAfter,
    });
  } catch (err) {
    if (err instanceof DriveConfigError) {
      console.error('[cron/backup-drive] config error', { message: err.message });
      return NextResponse.json({ ok: false, error: 'drive_config' }, { status: 500 });
    }
    console.error('[cron/backup-drive] failed', {
      code: (err as { code?: string }).code,
      message: (err as Error).message?.slice(0, 200),
    });
    return NextResponse.json({ ok: false, error: 'backup_failed' }, { status: 500 });
  }
}
