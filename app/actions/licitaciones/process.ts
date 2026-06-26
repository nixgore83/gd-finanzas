'use server';

import { after } from 'next/server';
import { revalidatePath } from 'next/cache';
import { and, eq, sql } from 'drizzle-orm';
import { getDb } from '@/lib/db/client';
import { licitacionesJobs } from '@/db/schema';
import { requireHouseholdSession, SessionError } from '@/lib/auth/session';
import { processLicitacionesJobInternal } from '@/lib/licitaciones/process-internal';

export type ProcessLicitacionResult =
  | { ok: true; queued: true }
  | { ok: false; error: 'session' | 'not_found' };

/**
 * Dispara el procesamiento de un job de forma ASÍNCRONA: marca
 * `status='processing'` + `processing_started_at` síncronamente (para que la UI
 * lo refleje al instante) y agenda el trabajo pesado (descarga + microservicio +
 * subida del Excel) con `after()`, que corre después de devolver la respuesta.
 *
 * Sirve también para reintentar desde 'error' o 'uploaded'. Acotado a la
 * maxDuration de la ruta (300s); si se pasa, el job queda en 'processing' y el
 * reaper lo marca 'error' (ver isLicitacionStale). `processLicitacionesJobInternal`
 * maneja su propio estado final.
 */
export async function processLicitacionesJob(
  jobId: string,
): Promise<ProcessLicitacionResult> {
  let session;
  try {
    session = await requireHouseholdSession();
  } catch (err) {
    if (err instanceof SessionError) return { ok: false, error: 'session' };
    throw err;
  }

  const db = getDb();
  const [job] = await db
    .select({ id: licitacionesJobs.id })
    .from(licitacionesJobs)
    .where(
      and(eq(licitacionesJobs.id, jobId), eq(licitacionesJobs.householdId, session.householdId)),
    )
    .limit(1);
  if (!job) return { ok: false, error: 'not_found' };

  await db
    .update(licitacionesJobs)
    .set({
      status: 'processing',
      processingStartedAt: sql`now()`,
      errorMessage: null,
    })
    .where(
      and(eq(licitacionesJobs.id, jobId), eq(licitacionesJobs.householdId, session.householdId)),
    );

  const householdId = session.householdId;
  after(async () => {
    try {
      await processLicitacionesJobInternal(jobId, householdId);
    } catch {
      console.error('[licitaciones] job async tiró excepción', { jobId });
    }
  });

  revalidatePath('/licitaciones');
  revalidatePath(`/licitaciones/${jobId}`);
  return { ok: true, queued: true };
}
