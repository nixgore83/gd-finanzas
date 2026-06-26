import { NextResponse } from 'next/server';
import { and, eq, sql } from 'drizzle-orm';
import { licitacionesJobs } from '@/db/schema';
import { getDb } from '@/lib/db/client';
import { getCronSecret } from '@/lib/env';
import { LICITACIONES_STALE_AFTER_MS } from '@/lib/licitaciones/stale';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Reaper de jobs de licitaciones cortados: el procesamiento corre async
 * (`after()`) acotado a la maxDuration de la ruta; si un job quedó en
 * `status='processing'` más que el umbral, el job se cortó (timeout / función
 * matada). Este cron lo marca `error` para que quede reintentable, sin tener que
 * resetearlo a mano por SQL.
 */
export async function GET(request: Request) {
  const auth = request.headers.get('authorization');
  if (auth !== `Bearer ${getCronSecret()}`) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }

  const thresholdSeconds = Math.round(LICITACIONES_STALE_AFTER_MS / 1000);
  const db = getDb();

  const reaped = await db
    .update(licitacionesJobs)
    .set({
      status: 'error',
      errorMessage: 'Procesamiento cortado por timeout (auto-marcado). Reintentá.',
      processingStartedAt: null,
    })
    .where(
      and(
        eq(licitacionesJobs.status, 'processing'),
        sql`coalesce(${licitacionesJobs.processingStartedAt}, ${licitacionesJobs.createdAt}) < now() - make_interval(secs => ${thresholdSeconds})`,
      ),
    )
    .returning({ id: licitacionesJobs.id });

  console.warn(`[cron/reap-stale-licitaciones] reaped ${reaped.length} jobs colgados`);
  return NextResponse.json({ ok: true, reaped: reaped.length });
}
