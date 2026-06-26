import { createClient } from '@supabase/supabase-js';
import { getServerEnv } from '@/lib/env';

const BUCKET_NAME = 'licitaciones';

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

export async function uploadLicitacionFile(input: UploadInput): Promise<void> {
  const client = adminClient();
  const body =
    input.bytes instanceof Uint8Array ? input.bytes : new Uint8Array(input.bytes);
  const { error } = await client.storage.from(BUCKET_NAME).upload(input.path, body, {
    contentType: input.contentType,
    upsert: false,
  });
  if (error) throw error;
}

export async function downloadLicitacionFile(path: string): Promise<Uint8Array> {
  const client = adminClient();
  const { data, error } = await client.storage.from(BUCKET_NAME).download(path);
  if (error) throw error;
  if (!data) throw new Error('empty download');
  const buf = await data.arrayBuffer();
  return new Uint8Array(buf);
}

/**
 * Genera una signed URL time-limited para descargar el Excel resultante.
 * Devuelve null si falla la generación.
 */
export async function generateSignedUrl(path: string, expiresIn = 3600): Promise<string | null> {
  const client = adminClient();
  const { data, error } = await client.storage
    .from(BUCKET_NAME)
    .createSignedUrl(path, expiresIn);
  if (error || !data?.signedUrl) return null;
  return data.signedUrl;
}

/** Path de un PDF de entrada: `${householdId}/${jobId}/input_${n}.pdf`. */
export function buildInputPath(householdId: string, jobId: string, index: number): string {
  return `${householdId}/${jobId}/input_${index}.pdf`;
}

/** Path del Excel de salida: `${householdId}/${jobId}/output.xlsx`. */
export function buildOutputPath(householdId: string, jobId: string): string {
  return `${householdId}/${jobId}/output.xlsx`;
}
