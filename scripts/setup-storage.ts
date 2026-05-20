/**
 * Crea (idempotente) el bucket privado `imports` en Supabase Storage.
 *
 * El bucket es privado y sin policies; sólo el service-role lo puede tocar.
 * La app interactúa con él server-side via `lib/imports/storage.ts`.
 *
 * Uso: `npm run storage:setup`
 */
import { createClient } from '@supabase/supabase-js';
import { loadEnv } from './_env';

const BUCKET_NAME = 'imports';

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

  if (existing?.some((b) => b.name === BUCKET_NAME)) {
    console.warn(`[storage] bucket "${BUCKET_NAME}" ya existe`);
    return;
  }

  const { error } = await admin.storage.createBucket(BUCKET_NAME, {
    public: false,
    fileSizeLimit: 20 * 1024 * 1024,
    allowedMimeTypes: ['application/pdf', 'text/csv', 'application/vnd.ms-excel'],
  });
  if (error) throw error;

  console.warn(`[storage] bucket "${BUCKET_NAME}" creado (privado)`);
}

main().catch((err: unknown) => {
  console.error('[storage] failed:', err);
  process.exit(1);
});
