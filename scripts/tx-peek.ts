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
        amount_original: string;
        transfer_pair_id: string | null;
      }[]
    >`
      select date::text, kind, currency_original, fx_rate_source, description,
             amount_original::text, transfer_pair_id::text
      from public.transactions
      order by created_at desc
      limit 10
    `;
    console.warn(`[tx:peek] últimas ${rows.length} transacciones:`);
    for (const r of rows) {
      const pair = r.transfer_pair_id ? ` pair=${r.transfer_pair_id.slice(0, 8)}…` : '';
      console.warn(
        `  ${r.date}  ${r.kind.padEnd(8)}  ${r.currency_original}  ${r.amount_original.padStart(12)}  fx=${r.fx_rate_source.padEnd(20)}${pair}  "${r.description}"`,
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
