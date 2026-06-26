import { NextResponse } from 'next/server';
import { and, eq, lt } from 'drizzle-orm';
import { forecasts } from '@/db/schema';
import { getDb } from '@/lib/db/client';
import { getCronSecret } from '@/lib/env';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const GRACE_DAYS = 7;

export async function GET(request: Request) {
  const auth = request.headers.get('authorization');
  if (auth !== `Bearer ${getCronSecret()}`) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }

  const db = getDb();

  // threshold = today - 7 days, en ISO. Lo computamos en server JS para evitar
  // depender de la zona horaria de Postgres.
  const todayMs = Date.parse(`${new Date().toISOString().slice(0, 10)}T00:00:00Z`);
  const thresholdMs = todayMs - GRACE_DAYS * 24 * 60 * 60 * 1000;
  const threshold = new Date(thresholdMs).toISOString().slice(0, 10);

  try {
    const result = await db
      .update(forecasts)
      .set({ status: 'missed' })
      .where(and(eq(forecasts.status, 'pending'), lt(forecasts.expectedDate, threshold)))
      .returning({ id: forecasts.id });

    console.warn(`[cron/forecasts-missed] marked ${result.length} as missed (threshold ${threshold})`);
    return NextResponse.json({ ok: true, marked: result.length, threshold });
  } catch (err) {
    console.error('[cron/forecasts-missed] failed', {
      code: (err as { code?: string }).code,
    });
    return NextResponse.json({ ok: false, error: 'db_error' }, { status: 500 });
  }
}

