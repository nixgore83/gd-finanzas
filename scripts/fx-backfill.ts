import postgres from 'postgres';
import Decimal from 'decimal.js';
import { loadEnv } from './_env';
import { fetchBcraSeries } from '../lib/fx/bcra';

/**
 * Backfill manual de `fx_rates` desde la API BCRA.
 *
 * Uso:
 *   npm run fx:backfill -- --variable 4 --from 2026-04-15 --to 2026-05-15
 *
 * Flags:
 *   --variable <id>  idVariable BCRA (descubrir con `npm run fx:list-vars`)
 *   --from <date>    YYYY-MM-DD (default: hace 30 días)
 *   --to <date>      YYYY-MM-DD (default: hoy)
 *   --pair <pair>    currency_pair (default: USD/ARS)
 *   --source <src>   fx_rates.source (default: BCRA_minorista)
 */

type Args = {
  variable: number;
  from: string;
  to: string;
  pair: string;
  source: string;
};

function parseArgs(): Args {
  const argv = process.argv.slice(2);
  const get = (flag: string): string | undefined => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : undefined;
  };

  const variableRaw = get('--variable');
  if (!variableRaw) {
    throw new Error('Falta --variable <id>. Descubrirlo con `npm run fx:list-vars`.');
  }
  const variable = Number.parseInt(variableRaw, 10);
  if (!Number.isFinite(variable)) {
    throw new Error(`--variable inválido: ${variableRaw}`);
  }

  const today = new Date();
  const todayStr = today.toISOString().slice(0, 10);
  const thirtyAgo = new Date(today.getTime() - 30 * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);

  return {
    variable,
    from: get('--from') ?? thirtyAgo,
    to: get('--to') ?? todayStr,
    pair: get('--pair') ?? 'USD/ARS',
    source: get('--source') ?? 'BCRA_minorista',
  };
}

async function main() {
  loadEnv();

  const args = parseArgs();
  console.warn(
    `[fx:backfill] variable=${args.variable} pair=${args.pair} source=${args.source} ${args.from}..${args.to}`,
  );

  const points = await fetchBcraSeries({
    idVariable: args.variable,
    desde: args.from,
    hasta: args.to,
  });
  console.warn(`[fx:backfill] BCRA devolvió ${points.length} puntos`);
  if (points.length === 0) {
    console.warn('[fx:backfill] sin datos, nada para upsertar');
    return;
  }

  const directUrl = process.env.DIRECT_URL;
  if (!directUrl) throw new Error('DIRECT_URL must be set');

  const sql = postgres(directUrl, { max: 1 });
  try {
    let written = 0;
    for (const p of points) {
      const mid = new Decimal(p.valor).toFixed(6, Decimal.ROUND_HALF_UP);
      await sql`
        insert into public.fx_rates (date, currency_pair, source, mid, fetched_at)
        values (${p.fecha}, ${args.pair}, ${args.source}, ${mid}, now())
        on conflict (date, currency_pair) do update
          set mid = excluded.mid,
              source = excluded.source,
              fetched_at = now()
      `;
      written++;
    }
    console.warn(`[fx:backfill] ${written} filas escritas (insert+update via UPSERT)`);
  } finally {
    await sql.end();
  }
}

main().catch((err: unknown) => {
  console.error('[fx:backfill] failed:', err);
  process.exit(1);
});
