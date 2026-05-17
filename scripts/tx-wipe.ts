import postgres from 'postgres';
import { loadEnv } from './_env';

/**
 * DEV ONLY: borra todas las transacciones de la DB. Útil mientras se itera en
 * Hito 3 y se cargan transacciones de prueba que después hay que limpiar.
 *
 * Uso: npm run tx:wipe
 */
async function main() {
  loadEnv();
  const directUrl = process.env.DIRECT_URL;
  if (!directUrl) throw new Error('DIRECT_URL must be set');

  const sql = postgres(directUrl, { max: 1 });
  try {
    const before = await sql<{ n: string }[]>`select count(*)::text as n from public.transactions`;
    await sql`delete from public.transaction_tags`;
    const deleted = await sql`delete from public.transactions returning id`;
    console.warn(
      `[tx:wipe] había ${before[0]?.n ?? '?'} transacciones — borradas ${deleted.length}`,
    );
  } finally {
    await sql.end();
  }
}

main().catch((err: unknown) => {
  console.error('[tx:wipe] failed:', err);
  process.exit(1);
});
