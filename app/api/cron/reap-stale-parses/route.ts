import { NextResponse } from 'next/server';
import { and, eq, sql } from 'drizzle-orm';
import { imports } from '@/db/schema';
import { getDb } from '@/lib/db/client';
import { getCronSecret } from '@/lib/env';
import { PARSE_STALE_AFTER_MS } from '@/lib/imports/parse-stale';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Reaper de parseos cortados: el parseo corre async (`after()`) acotado a la
 * maxDuration de la ruta; si un import quedó en `status='parsing'` más que el
 * umbral (`PARSE_STALE_AFTER_MS`), el job se cortó (timeout / función matada) y
 * el import queda colgado en `parsing` para siempre. Este cron lo marca `error`
 * para que salga de la vista "Para revisar" y quede reintentable, sin tener que
 * resetearlo a mano por SQL.
 *
 * Cubre también los `parsing` sin `parsing_started_at` (leftovers previos a la
 * migración async) usando `created_at` como fallback.
 */
export async function GET(request: Request) {
  const auth = request.headers.get('authorization');
  if (auth !== `Bearer ${getCronSecret()}`) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }

  const thresholdSeconds = Math.round(PARSE_STALE_AFTER_MS / 1000);
  const db = getDb();

  const reaped = await db
    .update(imports)
    .set({
      status: 'error',
      errorMessage: 'Parseo cortado por timeout (auto-marcado). Reintentá el parseo.',
      parsingStartedAt: null,
    })
    .where(
      and(
        eq(imports.status, 'parsing'),
        sql`coalesce(${imports.parsingStartedAt}, ${imports.createdAt}) < now() - make_interval(secs => ${thresholdSeconds})`,
      ),
    )
    .returning({ id: imports.id });

  console.warn(`[cron/reap-stale-parses] reaped ${reaped.length} parseos colgados`);
  return NextResponse.json({ ok: true, reaped: reaped.length });
}
