import postgres from 'postgres';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEnv } from './_env';

async function main() {
  loadEnv();

  const directUrl = process.env.DIRECT_URL;
  if (!directUrl) throw new Error('DIRECT_URL must be set');

  const dir = './db/policies';
  const files = readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  if (files.length === 0) {
    console.warn('[policies] no .sql files in db/policies');
    return;
  }

  const sql = postgres(directUrl, { max: 1 });

  for (const file of files) {
    const path = join(dir, file);
    const content = readFileSync(path, 'utf8');
    console.warn(`[policies] applying ${file}`);
    await sql.unsafe(content);
  }

  console.warn('[policies] done');
  await sql.end();
}

main().catch((err: unknown) => {
  console.error('[policies] failed:', err);
  process.exit(1);
});
