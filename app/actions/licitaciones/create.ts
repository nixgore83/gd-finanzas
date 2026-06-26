'use server';

import { revalidatePath } from 'next/cache';
import { and, eq } from 'drizzle-orm';
import { getDb } from '@/lib/db/client';
import { licitacionesJobs } from '@/db/schema';
import { requireHouseholdSession, SessionError } from '@/lib/auth/session';
import {
  DEFAULT_LICITACIONES_MODEL,
  LICITACIONES_BUCKET_NAME,
  MAX_LICITACIONES_PDF_COUNT,
  lunesOverrideSchema,
} from '@/lib/schemas/licitaciones';
import {
  buildInputPath,
  countJobInputs,
  createSignedUpload,
  deleteJobFolder,
} from '@/lib/licitaciones/storage';
import { processLicitacionesJob } from './process';

/**
 * Flujo de subida en DOS pasos para esquivar el límite de body de las Server
 * Actions (1MB) y de las funciones de Vercel: el cliente sube los PDFs DIRECTO a
 * Storage con signed upload URLs, y las actions solo manejan metadata.
 *
 *   1. createLicitacionUploadSlots → crea el job + devuelve un token de subida por PDF.
 *   2. (cliente sube cada PDF a su slot).
 *   3. startLicitacionJob → verifica que estén todos y dispara el procesamiento.
 *   (cancelLicitacionJob limpia si la subida falla a mitad.)
 */

export type UploadSlot = { index: number; path: string; token: string };

export type CreateSlotsResult =
  | { ok: true; jobId: string; bucket: string; slots: UploadSlot[] }
  | { ok: false; error: 'session' | 'invalid' | 'unknown' };

export async function createLicitacionUploadSlots(input: {
  pdfCount: number;
  lunes?: string | null;
}): Promise<CreateSlotsResult> {
  let session;
  try {
    session = await requireHouseholdSession();
  } catch (err) {
    if (err instanceof SessionError) return { ok: false, error: 'session' };
    throw err;
  }

  const { pdfCount } = input;
  if (!Number.isInteger(pdfCount) || pdfCount < 1 || pdfCount > MAX_LICITACIONES_PDF_COUNT) {
    return { ok: false, error: 'invalid' };
  }

  let lunesOverride: string | null = null;
  if (input.lunes) {
    const parsed = lunesOverrideSchema.safeParse(input.lunes);
    if (!parsed.success) return { ok: false, error: 'invalid' };
    lunesOverride = parsed.data;
  }

  const db = getDb();

  let jobId: string;
  try {
    const [row] = await db
      .insert(licitacionesJobs)
      .values({
        householdId: session.householdId,
        status: 'uploaded',
        inputFilePaths: [],
        pdfCount,
        modelo: DEFAULT_LICITACIONES_MODEL,
        lunesOverride,
        createdBy: session.userId,
      })
      .returning({ id: licitacionesJobs.id });
    if (!row) throw new Error('insert returned no row');
    jobId = row.id;
  } catch (err) {
    console.error('[licitaciones] insert falló', { code: (err as { code?: string }).code });
    return { ok: false, error: 'unknown' };
  }

  try {
    const slots: UploadSlot[] = [];
    for (let i = 0; i < pdfCount; i++) {
      const { path, token } = await createSignedUpload(buildInputPath(session.householdId, jobId, i));
      slots.push({ index: i, path, token });
    }
    revalidatePath('/licitaciones');
    return { ok: true, jobId, bucket: LICITACIONES_BUCKET_NAME, slots };
  } catch (err) {
    console.error('[licitaciones] createSignedUpload falló', {
      jobId,
      code: (err as { code?: string }).code,
    });
    await db.delete(licitacionesJobs).where(eq(licitacionesJobs.id, jobId));
    return { ok: false, error: 'unknown' };
  }
}

export type StartLicitacionResult =
  | { ok: true }
  | { ok: false; error: 'session' | 'not_found' | 'invalid_state' | 'incomplete_upload' };

/**
 * Cierra la subida directa: verifica que estén los N PDFs en Storage, fija los
 * paths en el job y dispara el procesamiento async.
 */
export async function startLicitacionJob(jobId: string): Promise<StartLicitacionResult> {
  let session;
  try {
    session = await requireHouseholdSession();
  } catch (err) {
    if (err instanceof SessionError) return { ok: false, error: 'session' };
    throw err;
  }

  const db = getDb();
  const [job] = await db
    .select({ status: licitacionesJobs.status, pdfCount: licitacionesJobs.pdfCount })
    .from(licitacionesJobs)
    .where(and(eq(licitacionesJobs.id, jobId), eq(licitacionesJobs.householdId, session.householdId)))
    .limit(1);

  if (!job) return { ok: false, error: 'not_found' };
  if (job.status !== 'uploaded') return { ok: false, error: 'invalid_state' };

  const uploaded = await countJobInputs(session.householdId, jobId);
  if (uploaded < job.pdfCount) return { ok: false, error: 'incomplete_upload' };

  const paths = Array.from({ length: job.pdfCount }, (_, i) =>
    buildInputPath(session.householdId, jobId, i),
  );
  await db
    .update(licitacionesJobs)
    .set({ inputFilePaths: paths })
    .where(and(eq(licitacionesJobs.id, jobId), eq(licitacionesJobs.householdId, session.householdId)));

  try {
    await processLicitacionesJob(jobId);
  } catch {
    console.error('[licitaciones] start: schedule de proceso falló', { jobId });
  }

  revalidatePath('/licitaciones');
  return { ok: true };
}

/** Limpia un job que quedó a medio subir (borra storage + fila). Solo si sigue 'uploaded'. */
export async function cancelLicitacionJob(jobId: string): Promise<{ ok: boolean }> {
  let session;
  try {
    session = await requireHouseholdSession();
  } catch (err) {
    if (err instanceof SessionError) return { ok: false };
    throw err;
  }

  const db = getDb();
  const [job] = await db
    .select({ status: licitacionesJobs.status })
    .from(licitacionesJobs)
    .where(and(eq(licitacionesJobs.id, jobId), eq(licitacionesJobs.householdId, session.householdId)))
    .limit(1);
  if (!job || job.status !== 'uploaded') return { ok: false };

  try {
    await deleteJobFolder(session.householdId, jobId);
  } catch {
    console.error('[licitaciones] cancel: cleanup de storage falló', { jobId });
  }
  await db
    .delete(licitacionesJobs)
    .where(and(eq(licitacionesJobs.id, jobId), eq(licitacionesJobs.householdId, session.householdId)));

  revalidatePath('/licitaciones');
  return { ok: true };
}
