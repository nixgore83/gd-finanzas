import { NextResponse } from 'next/server';
import { sql } from 'drizzle-orm';
import Decimal from 'decimal.js';
import { fxRates } from '@/db/schema';
import { getDb } from '@/lib/db/client';
import { getServerEnv } from '@/lib/env';
import { fetchBcraSeries, BcraApiError } from '@/lib/fx/bcra';
import { USD_ARS_PAIR } from '@/lib/fx/get-fx-rate';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const LOOKBACK_DAYS = 7;
const SOURCE = 'BCRA_minorista';

function toIsoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export async function GET(request: Request) {
  const env = getServerEnv();

  const auth = request.headers.get('authorization');
  if (auth !== `Bearer ${env.CRON_SECRET}`) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }

  const today = new Date();
  const lookbackStart = new Date(today.getTime() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000);
  const desde = toIsoDate(lookbackStart);
  const hasta = toIsoDate(today);

  let points;
  try {
    points = await fetchBcraSeries({
      idVariable: env.BCRA_FX_MINORISTA_VARIABLE_ID,
      desde,
      hasta,
    });
  } catch (err) {
    const status = err instanceof BcraApiError ? (err.status ?? 502) : 502;
    console.error('[cron/fx] BCRA fetch failed', {
      status: err instanceof BcraApiError ? err.status : null,
      code: err instanceof Error ? err.name : 'unknown',
    });
    return NextResponse.json({ ok: false, error: 'bcra_fetch_failed' }, { status });
  }

  if (points.length === 0) {
    console.warn(`[cron/fx] BCRA devolvió 0 puntos para ${desde}..${hasta}`);
    return NextResponse.json({ ok: true, points: 0, desde, hasta });
  }

  const rows = points.map((p) => ({
    date: p.fecha,
    currencyPair: USD_ARS_PAIR,
    source: SOURCE,
    mid: new Decimal(p.valor).toFixed(6, Decimal.ROUND_HALF_UP),
  }));

  const db = getDb();
  await db
    .insert(fxRates)
    .values(rows)
    .onConflictDoUpdate({
      target: [fxRates.date, fxRates.currencyPair],
      set: {
        mid: sql`excluded.mid`,
        source: sql`excluded.source`,
        fetchedAt: sql`now()`,
      },
    });

  console.warn(`[cron/fx] upserted ${rows.length} puntos para ${desde}..${hasta}`);
  return NextResponse.json({ ok: true, points: rows.length, desde, hasta });
}
