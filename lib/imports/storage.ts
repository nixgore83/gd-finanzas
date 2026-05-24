import { createClient } from '@supabase/supabase-js';
import { getServerEnv } from '@/lib/env';

const BUCKET_NAME = 'imports';

let cached: ReturnType<typeof createClient> | null = null;

function adminClient() {
  if (cached) return cached;
  const env = getServerEnv();
  cached = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SECRET_KEY, {
    auth: { persistSession: false },
  });
  return cached;
}

export type UploadInput = {
  bytes: ArrayBuffer | Uint8Array;
  contentType: string;
  path: string;
};

export async function uploadImportFile(input: UploadInput): Promise<void> {
  const client = adminClient();
  const body =
    input.bytes instanceof Uint8Array ? input.bytes : new Uint8Array(input.bytes);
  const { error } = await client.storage.from(BUCKET_NAME).upload(input.path, body, {
    contentType: input.contentType,
    upsert: false,
  });
  if (error) throw error;
}

export async function downloadImportFile(path: string): Promise<Uint8Array> {
  const client = adminClient();
  const { data, error } = await client.storage.from(BUCKET_NAME).download(path);
  if (error) throw error;
  if (!data) throw new Error('empty download');
  const buf = await data.arrayBuffer();
  return new Uint8Array(buf);
}

/**
 * Generates a time-limited signed URL for viewing/downloading an import file.
 * Returns null if URL generation fails.
 */
export async function generateSignedUrl(path: string, expiresIn = 3600): Promise<string | null> {
  const client = adminClient();
  const { data, error } = await client.storage
    .from(BUCKET_NAME)
    .createSignedUrl(path, expiresIn);
  if (error || !data?.signedUrl) return null;
  return data.signedUrl;
}

export function buildImportPath(householdId: string, importId: string, ext: string): string {
  const safeExt = ext.replace(/[^a-z0-9]/gi, '').toLowerCase();
  return `${householdId}/${importId}.${safeExt}`;
}

export async function hashBytes(bytes: ArrayBuffer | Uint8Array): Promise<string> {
  const source = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  // Copy to ensure we hand subtle.digest a clean ArrayBuffer (not Shared, not a view).
  const copy = new Uint8Array(source);
  const digest = await crypto.subtle.digest('SHA-256', copy.buffer);
  const hex = Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  return hex;
}
