'use server';

import { revalidatePath } from 'next/cache';
import { eq } from 'drizzle-orm';
import { getDb } from '@/lib/db/client';
import { licitacionesJobs } from '@/db/schema';
import { requireHouseholdSession, SessionError } from '@/lib/auth/session';
import {
  DEFAULT_LICITACIONES_MODEL,
  LICITACIONES_PDF_CONTENT_TYPE,
  MAX_LICITACIONES_FILE_BYTES,
  MAX_LICITACIONES_PDF_COUNT,
  MAX_LICITACIONES_TOTAL_BYTES,
  isPdfFilename,
  parseLunesOverride,
} from '@/lib/schemas/licitaciones';
import { buildInputPath, uploadLicitacionFile } from '@/lib/licitaciones/storage';
import { processLicitacionesJob } from './process';

export type CreateLicitacionResult =
  | { ok: true; jobId: string }
  | {
      ok: false;
      error:
        | 'session'
        | 'no_files'
        | 'too_many_files'
        | 'file_too_large'
        | 'total_too_large'
        | 'unsupported_format'
        | 'storage'
        | 'unknown';
    };

export async function createLicitacionJob(
  formData: FormData,
): Promise<CreateLicitacionResult> {
  let session;
  try {
    session = await requireHouseholdSession();
  } catch (err) {
    if (err instanceof SessionError) return { ok: false, error: 'session' };
    throw err;
  }

  const files = formData.getAll('files').filter((f): f is File => f instanceof File && f.size > 0);
  if (files.length === 0) return { ok: false, error: 'no_files' };
  if (files.length > MAX_LICITACIONES_PDF_COUNT) return { ok: false, error: 'too_many_files' };

  let total = 0;
  for (const f of files) {
    if (!isPdfFilename(f.name)) return { ok: false, error: 'unsupported_format' };
    if (f.size > MAX_LICITACIONES_FILE_BYTES) return { ok: false, error: 'file_too_large' };
    total += f.size;
  }
  if (total > MAX_LICITACIONES_TOTAL_BYTES) return { ok: false, error: 'total_too_large' };

  const lunesOverride = parseLunesOverride(formData.get('lunes'));

  const db = getDb();

  // 1. Insertar el job (sin paths todavía).
  let jobId: string;
  try {
    const [row] = await db
      .insert(licitacionesJobs)
      .values({
        householdId: session.householdId,
        status: 'uploaded',
        inputFilePaths: [],
        pdfCount: files.length,
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

  // 2. Subir los PDFs a Storage.
  const paths: string[] = [];
  try {
    for (let i = 0; i < files.length; i++) {
      const bytes = new Uint8Array(await files[i]!.arrayBuffer());
      const path = buildInputPath(session.householdId, jobId, i);
      await uploadLicitacionFile({ bytes, contentType: LICITACIONES_PDF_CONTENT_TYPE, path });
      paths.push(path);
    }
  } catch {
    console.error('[licitaciones] subida a Storage falló', { jobId });
    await db.delete(licitacionesJobs).where(eq(licitacionesJobs.id, jobId));
    return { ok: false, error: 'storage' };
  }

  await db
    .update(licitacionesJobs)
    .set({ inputFilePaths: paths })
    .where(eq(licitacionesJobs.id, jobId));

  // 3. Disparar el procesamiento async (hands-off). Best-effort: si falla el
  //    schedule, el job queda 'uploaded' y se reprocesa desde la UI.
  try {
    await processLicitacionesJob(jobId);
  } catch {
    console.error('[licitaciones] auto-proceso al crear falló al agendar', { jobId });
  }

  revalidatePath('/licitaciones');
  return { ok: true, jobId };
}
