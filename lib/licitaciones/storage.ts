import { createClient } from '@supabase/supabase-js';
import { getServerEnv } from '@/lib/env';
import { LICITACIONES_BUCKET_NAME } from '@/lib/schemas/licitaciones';

const BUCKET_NAME = LICITACIONES_BUCKET_NAME;

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

/**
 * Crea una signed upload URL (token de un solo uso) para que el CLIENTE suba el
 * PDF directo a Storage, sin pasar los bytes por la Server Action (esquiva el
 * límite de body de Next/Vercel). El token autoriza la subida a ese path puntual.
 */
export async function createSignedUpload(path: string): Promise<{ path: string; token: string }> {
  const client = adminClient();
  const { data, error } = await client.storage.from(BUCKET_NAME).createSignedUploadUrl(path);
  if (error || !data?.token) throw error ?? new Error('no signed upload url');
  return { path: data.path, token: data.token };
}

/** Cuenta los PDFs de entrada ya subidos a la carpeta del job (verificación). */
export async function countJobInputs(householdId: string, jobId: string): Promise<number> {
  const client = adminClient();
  const { data, error } = await client.storage
    .from(BUCKET_NAME)
    .list(`${householdId}/${jobId}`);
  if (error) throw error;
  return (data ?? []).filter((o) => o.name.startsWith('input_')).length;
}

/** Borra todos los objetos de la carpeta del job (cleanup ante subida fallida). */
export async function deleteJobFolder(householdId: string, jobId: string): Promise<void> {
  const client = adminClient();
  const prefix = `${householdId}/${jobId}`;
  const { data, error } = await client.storage.from(BUCKET_NAME).list(prefix);
  if (error) throw error;
  if (data && data.length > 0) {
    await client.storage.from(BUCKET_NAME).remove(data.map((o) => `${prefix}/${o.name}`));
  }
}

/** Path de un PDF de entrada: `${householdId}/${jobId}/input_${n}.pdf`. */
export function buildInputPath(householdId: string, jobId: string, index: number): string {
  return `${householdId}/${jobId}/input_${index}.pdf`;
}

/** Path del Excel de salida: `${householdId}/${jobId}/output.xlsx`. */
export function buildOutputPath(householdId: string, jobId: string): string {
  return `${householdId}/${jobId}/output.xlsx`;
}
