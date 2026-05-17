import postgres from 'postgres';
import { loadEnv } from './_env';

/**
 * Sanity check de `fx_rates`: cuenta filas, muestra rango de fechas y
 * los 5 puntos más recientes (sin valores — solo fecha + source).
 *
 * Uso: npm run fx:count
 */
async function main() {
  loadEnv();
  const directUrl = process.env.DIRECT_URL;
  if (!directUrl) throw new Error('DIRECT_URL must be set');

  const sql = postgres(directUrl, { max: 1 });
  try {
    const [stats] = await sql<{ total: string; min_date: string; max_date: string }[]>`
      select count(*)::text as total,
             min(date)::text as min_date,
             max(date)::text as max_date
      from public.fx_rates
      where currency_pair = 'USD/ARS'
    `;
    console.warn(
      `[fx:count] USD/ARS — ${stats?.total} filas, rango ${stats?.min_date} .. ${stats?.max_date}`,
    );

    const latest = await sql<{ date: string; source: string; fetched_at: string }[]>`
      select date::text, source, fetched_at::text
      from public.fx_rates
      where currency_pair = 'USD/ARS'
      order by date desc
      limit 5
    `;
    console.warn('[fx:count] últimos 5:');
    for (const r of latest) console.warn(`  ${r.date}  source=${r.source}  fetched=${r.fetched_at}`);
  } finally {
    await sql.end();
  }
}

main().catch((err: unknown) => {
  console.error('[fx:count] failed:', err);
  process.exit(1);
});
