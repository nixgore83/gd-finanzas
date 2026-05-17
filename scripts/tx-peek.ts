import postgres from 'postgres';
import { loadEnv } from './_env';

/**
 * Sanity peek de las últimas N transacciones (sin valores — solo metadata
 * útil para diagnóstico: fecha, kind, currency, fx_rate_source, descripción).
 *
 * Uso: npm run tx:peek
 */
async function main() {
  loadEnv();
  const directUrl = process.env.DIRECT_URL;
  if (!directUrl) throw new Error('DIRECT_URL must be set');

  const sql = postgres(directUrl, { max: 1 });
  try {
    const rows = await sql<
      {
        date: string;
        kind: string;
        currency_original: string;
        fx_rate_source: string;
        description: string;
      }[]
    >`
      select date::text, kind, currency_original, fx_rate_source, description
      from public.transactions
      order by created_at desc
      limit 10
    `;
    console.warn(`[tx:peek] últimas ${rows.length} transacciones:`);
    for (const r of rows) {
      console.warn(
        `  ${r.date}  ${r.kind.padEnd(7)}  ${r.currency_original}  fx=${r.fx_rate_source.padEnd(20)}  "${r.description}"`,
      );
    }
  } finally {
    await sql.end();
  }
}

main().catch((err: unknown) => {
  console.error('[tx:peek] failed:', err);
  process.exit(1);
});
