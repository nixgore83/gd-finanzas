import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import { loadEnv } from './_env';

async function main() {
  loadEnv();

  const directUrl = process.env.DIRECT_URL;
  if (!directUrl) throw new Error('DIRECT_URL must be set');

  const sql = postgres(directUrl, { max: 1 });
  const db = drizzle(sql);

  console.warn('[migrate] applying migrations from db/migrations');
  await migrate(db, { migrationsFolder: './db/migrations' });
  console.warn('[migrate] done');

  await sql.end();
}

main().catch((err: unknown) => {
  console.error('[migrate] failed:', err);
  process.exit(1);
});
