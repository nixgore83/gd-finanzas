'use server';

import { and, eq } from 'drizzle-orm';
import { getDb } from '@/lib/db/client';
import { licitacionesJobs } from '@/db/schema';
import { requireHouseholdSession, SessionError } from '@/lib/auth/session';
import { generateSignedUrl } from '@/lib/licitaciones/storage';

export type DownloadUrlResult =
  | { ok: true; url: string }
  | { ok: false; error: 'session' | 'not_found' | 'not_ready' | 'storage' };

/**
 * Genera una signed URL (1h) para descargar el Excel resultante de un job.
 * Scope household + chequeo de estado: solo jobs 'done' con output.
 */
export async function getLicitacionDownloadUrl(jobId: string): Promise<DownloadUrlResult> {
  let session;
  try {
    session = await requireHouseholdSession();
  } catch (err) {
    if (err instanceof SessionError) return { ok: false, error: 'session' };
    throw err;
  }

  const db = getDb();
  const [job] = await db
    .select({
      status: licitacionesJobs.status,
      outputFilePath: licitacionesJobs.outputFilePath,
    })
    .from(licitacionesJobs)
    .where(
      and(eq(licitacionesJobs.id, jobId), eq(licitacionesJobs.householdId, session.householdId)),
    )
    .limit(1);

  if (!job) return { ok: false, error: 'not_found' };
  if (job.status !== 'done' || !job.outputFilePath) return { ok: false, error: 'not_ready' };

  const url = await generateSignedUrl(job.outputFilePath);
  if (!url) return { ok: false, error: 'storage' };
  return { ok: true, url };
}
