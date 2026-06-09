'use server';

import { after } from 'next/server';
import { and, eq, sql } from 'drizzle-orm';
import { getDb } from '@/lib/db/client';
import { imports } from '@/db/schema';
import { requireHouseholdSession, SessionError } from '@/lib/auth/session';
import { parseImportInternal } from '@/lib/imports/parse-internal';

export type ParseImportResult =
  | { ok: true; queued: true }
  | { ok: false; error: 'session' | 'not_found' };

/**
 * Dispara el parseo de un import de forma ASÍNCRONA: marca `status='parsing'` +
 * `parsing_started_at` de forma síncrona (para que la UI lo refleje al instante)
 * y agenda el trabajo pesado (descarga + LLM + persistencia) con `after()`, que
 * corre DESPUÉS de devolver la respuesta. Así la request del usuario no queda
 * colgada esperando al LLM.
 *
 * Sigue acotado a la `maxDuration` de la ruta (300s); si el parseo se pasa, el
 * import queda en `parsing` y la UI lo detecta como "cortado" vía el timestamp
 * (ver isParseStale) ofreciendo reintentar. `parseImportInternal` maneja su
 * propio estado final (parsed/error).
 */
export async function parseImport(
  importId: string,
  customPassword?: string,
  persistPassword?: boolean,
): Promise<ParseImportResult> {
  let session;
  try {
    session = await requireHouseholdSession();
  } catch (err) {
    if (err instanceof SessionError) return { ok: false, error: 'session' };
    throw err;
  }

  const db = getDb();
  const [imp] = await db
    .select({ id: imports.id })
    .from(imports)
    .where(and(eq(imports.id, importId), eq(imports.householdId, session.householdId)))
    .limit(1);
  if (!imp) return { ok: false, error: 'not_found' };

  await db
    .update(imports)
    .set({ status: 'parsing', parsingStartedAt: sql`now()`, errorMessage: null })
    .where(and(eq(imports.id, importId), eq(imports.householdId, session.householdId)));

  const householdId = session.householdId;
  after(async () => {
    try {
      await parseImportInternal(importId, householdId, customPassword, persistPassword);
    } catch {
      // parseImportInternal ya marca status='error' ante fallos esperados; este
      // catch es un backstop para excepciones no previstas en el job async.
      console.error('[imports] async parse job threw', { importId });
    }
  });

  return { ok: true, queued: true };
}

/**
 * Variante SÍNCRONA del parseo: marca `parsing` y AWAITa `parseImportInternal`
 * (que setea el estado final parsed/error). La usa el drenado en lote de la lista
 * para **acotar la concurrencia real**: cada `parseImportSync` ocupa el worker
 * hasta terminar el parse, así el pool del cliente limita cuántos parses corren
 * a la vez. (`parseImport` es fire-and-forget con `after()`: dispararía N parses
 * en paralelo y, encima, el `after()` hereda la maxDuration de la ruta que lo
 * invoca.)
 *
 * DEBE invocarse desde una ruta con maxDuration suficiente: la lista `/imports`
 * está en 300s.
 */
export async function parseImportSync(importId: string): Promise<{ ok: boolean }> {
  let session;
  try {
    session = await requireHouseholdSession();
  } catch (err) {
    if (err instanceof SessionError) return { ok: false };
    throw err;
  }

  const db = getDb();
  const [imp] = await db
    .select({ id: imports.id })
    .from(imports)
    .where(and(eq(imports.id, importId), eq(imports.householdId, session.householdId)))
    .limit(1);
  if (!imp) return { ok: false };

  await db
    .update(imports)
    .set({ status: 'parsing', parsingStartedAt: sql`now()`, errorMessage: null })
    .where(and(eq(imports.id, importId), eq(imports.householdId, session.householdId)));

  const result = await parseImportInternal(importId, session.householdId);
  return { ok: result.ok };
}
