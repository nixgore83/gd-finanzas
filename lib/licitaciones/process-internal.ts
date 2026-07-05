import { and, eq, sql } from 'drizzle-orm';
import { getDb } from '@/lib/db/client';
import { licitacionesJobs } from '@/db/schema';
import { LICITACIONES_XLSX_CONTENT_TYPE } from '@/lib/schemas/licitaciones';
import { procesarLicitaciones } from './client';
import { buildOutputPath, generateSignedUrl, uploadLicitacionFile } from './storage';

/**
 * TTL de las signed URLs de los PDFs de entrada. El micro las baja al arrancar
 * el request; con el timeout del cliente (280s) alcanza de sobra, damos margen.
 */
const INPUT_URL_TTL_SECONDS = 600;

/**
 * Trabajo pesado del job, corre async (dentro de `after()`). Descarga los PDFs
 * de Storage, los manda al microservicio, sube el Excel resultante y cierra el
 * estado del job (done/error). Idempotente respecto del estado final: setea
 * 'done' o 'error', nunca deja el job en 'processing'.
 *
 * El caller (`processLicitacionesJob`) ya marcó status='processing' +
 * processing_started_at de forma síncrona, para que la UI lo refleje al instante.
 */
export async function processLicitacionesJobInternal(
  jobId: string,
  householdId: string,
): Promise<void> {
  const db = getDb();

  const [job] = await db
    .select({
      id: licitacionesJobs.id,
      inputFilePaths: licitacionesJobs.inputFilePaths,
      lunesOverride: licitacionesJobs.lunesOverride,
    })
    .from(licitacionesJobs)
    .where(and(eq(licitacionesJobs.id, jobId), eq(licitacionesJobs.householdId, householdId)))
    .limit(1);

  if (!job) {
    console.error('[licitaciones] job no encontrado en process-internal', { jobId });
    return;
  }

  async function fail(message: string): Promise<void> {
    await db
      .update(licitacionesJobs)
      .set({ status: 'error', errorMessage: message, processingStartedAt: null })
      .where(eq(licitacionesJobs.id, jobId));
  }

  // 1. Firmar una URL de descarga por cada PDF de entrada. Mandamos URLs (no
  //    bytes) al micro para que el body del request quede en KB y no choque con
  //    el límite de ~4.5 MB de Vercel; el micro baja los PDFs desde estas URLs.
  let pdfUrls: string[];
  try {
    pdfUrls = await Promise.all(
      job.inputFilePaths.map(async (path) => {
        const signed = await generateSignedUrl(path, INPUT_URL_TTL_SECONDS);
        if (!signed) throw new Error('no signed url');
        return signed;
      }),
    );
  } catch {
    console.error('[licitaciones] fallo al firmar URLs de los PDFs', { jobId });
    await fail('No se pudieron preparar los PDFs subidos. Reintentá.');
    return;
  }

  // 2. Llamar al microservicio.
  const result = await procesarLicitaciones({ pdfUrls, lunes: job.lunesOverride });
  if (!result.ok) {
    await fail(result.error);
    return;
  }

  // 3. Subir el Excel resultante a Storage.
  const outputPath = buildOutputPath(householdId, jobId);
  try {
    await uploadLicitacionFile({
      bytes: result.xlsx,
      contentType: LICITACIONES_XLSX_CONTENT_TYPE,
      path: outputPath,
    });
  } catch {
    console.error('[licitaciones] fallo al subir el Excel a Storage', { jobId });
    await fail('El Excel se generó pero no se pudo guardar. Reintentá.');
    return;
  }

  // 4. Cerrar el job como completado.
  await db
    .update(licitacionesJobs)
    .set({
      status: 'done',
      outputFilePath: outputPath,
      modelo: result.model,
      completedAt: sql`now()`,
      processingStartedAt: null,
      errorMessage: null,
    })
    .where(eq(licitacionesJobs.id, jobId));
}
