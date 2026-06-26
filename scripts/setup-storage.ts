/**
 * Crea (idempotente) los buckets privados de Storage:
 *   - `imports`      — extractos de banco/TC/broker (PDF/CSV/XLSX).
 *   - `licitaciones` — PDFs de avisos + Excel del calendario (módulo de Pau).
 *
 * Los buckets son privados y sin policies; sólo el service-role los toca.
 * La app interactúa server-side via `lib/imports/storage.ts` y
 * `lib/licitaciones/storage.ts`.
 *
 * Uso: `npm run storage:setup`
 */
import { createClient } from '@supabase/supabase-js';
import { loadEnv } from './_env';

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

const BUCKETS = [
  {
    name: 'imports',
    fileSizeLimit: 20 * 1024 * 1024,
    allowedMimeTypes: ['application/pdf', 'text/csv', 'application/vnd.ms-excel'],
  },
  {
    name: 'licitaciones',
    fileSizeLimit: 20 * 1024 * 1024,
    allowedMimeTypes: ['application/pdf', XLSX_MIME],
  },
] as const;

async function main() {
  loadEnv();

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const secret = process.env.SUPABASE_SECRET_KEY;
  if (!url || !secret) {
    throw new Error('NEXT_PUBLIC_SUPABASE_URL y SUPABASE_SECRET_KEY son requeridas');
  }

  const admin = createClient(url, secret, {
    auth: { persistSession: false },
  });

  const { data: existing, error: listErr } = await admin.storage.listBuckets();
  if (listErr) throw listErr;

  for (const bucket of BUCKETS) {
    if (existing?.some((b) => b.name === bucket.name)) {
      console.warn(`[storage] bucket "${bucket.name}" ya existe`);
      continue;
    }

    const { error } = await admin.storage.createBucket(bucket.name, {
      public: false,
      fileSizeLimit: bucket.fileSizeLimit,
      allowedMimeTypes: [...bucket.allowedMimeTypes],
    });
    if (error) throw error;

    console.warn(`[storage] bucket "${bucket.name}" creado (privado)`);
  }
}

main().catch((err: unknown) => {
  console.error('[storage] failed:', err);
  process.exit(1);
});
