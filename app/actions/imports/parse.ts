'use server';

import { after } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { getDb } from '@/lib/db/client';
import { imports } from '@/db/schema';
import { requireHouseholdSession, SessionError } from '@/lib/auth/session';
import { parseImportInternal } from '@/lib/imports/parse-internal';
import { claimImportForParse, isReparseableStatus } from '@/lib/imports/parse-claim';

export type ParseImportResult =
  | { ok: true; queued: true }
  | { ok: false; error: 'session' | 'not_found' | 'invalid_state' | 'already_parsing' };

/**
 * Dispara el parseo de un import de forma ASÍNCRONA: **reclama** el import
 * (`status='parsing'` + `parsing_started_at`, con UPDATE condicional atómico) de
 * forma síncrona —para que la UI lo refleje al instante y para que un doble click
 * no arranque dos parseos— y agenda el trabajo pesado (descarga + LLM +
 * persistencia) con `after()`, que corre DESPUÉS de devolver la respuesta. Así la
 * request del usuario no queda colgada esperando al LLM.
 *
 * Como el claim ya lo ganó acá, se le pasa `alreadyClaimed` a
 * `parseImportInternal` para que no lo intente de nuevo (perdería contra sí mismo).
 * Si otro ejecutor lo tiene tomado, devolvemos `already_parsing` sin tocar nada.
 *
 * Sigue acotado a la `maxDuration` de la ruta (300s); si el parseo se pasa, el
 * import queda en `parsing` y la UI lo detecta como "cortado" vía el timestamp
 * (ver isParseStale) ofreciendo reintentar — el claim vuelve a concederse una vez
 * pasado ese umbral. `parseImportInternal` maneja su propio estado final
 * (parsed/error).
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
    .select({ id: imports.id, status: imports.status })
    .from(imports)
    .where(and(eq(imports.id, importId), eq(imports.householdId, session.householdId)))
    .limit(1);
  if (!imp) return { ok: false, error: 'not_found' };
  // Distinguimos "no se reparsea desde este estado" (ej. `confirmed`) de "otro
  // ejecutor lo tiene tomado": el claim devuelve 0 filas en ambos casos, pero al
  // usuario le decimos cosas distintas.
  if (!isReparseableStatus(imp.status)) return { ok: false, error: 'invalid_state' };

  const householdId = session.householdId;
  const claimed = await claimImportForParse(db, importId, householdId);
  if (!claimed) return { ok: false, error: 'already_parsing' };

  after(async () => {
    try {
      await parseImportInternal(importId, householdId, {
        customPassword,
        persistPassword,
        alreadyClaimed: true,
      });
    } catch {
      // parseImportInternal ya marca status='error' ante fallos esperados; este
      // catch es un backstop para excepciones no previstas en el job async.
      console.error('[imports] async parse job threw', { importId });
    }
  });

  return { ok: true, queued: true };
}

/**
 * Drena en SEGUNDO PLANO todos los imports en estado 'uploaded' del household:
 * agenda con `after()` un único job que los parsea **secuencialmente** (uno a la
 * vez, sin saturar la API ni reventar la concurrencia). La request del cliente
 * devuelve al instante (no espera al LLM), así no se cuelga ni tira "This page
 * couldn't load". El job sobrevive a que el usuario navegue (es la razón de `after()`).
 *
 * Corre dentro de la maxDuration de la ruta que lo invoca (la lista `/imports`
 * está en 300s). Si no alcanza para todos: los que queden siguen en 'uploaded'
 * (re-clickear), y el que estaba en curso queda 'parsing' (lo barre el reaper /
 * se reintenta). `parseImportInternal` setea el estado final de cada uno.
 *
 * Concurrencia: la lista de ids se lee ANTES del `after()`, así que dos drenados
 * casi simultáneos (doble click) ven los mismos ids en 'uploaded'. No hace falta
 * deduplicarlos acá: `parseImportInternal` reclama cada import con un UPDATE
 * condicional atómico y el segundo ejecutor se retira con `already_parsing`.
 * (Antes esto duplicaba exactamente 2× las líneas — incidente 2026-07-22.)
 */
export async function drainUploadedImports(): Promise<{ ok: boolean; queued: number }> {
  let session;
  try {
    session = await requireHouseholdSession();
  } catch (err) {
    if (err instanceof SessionError) return { ok: false, queued: 0 };
    throw err;
  }

  const db = getDb();
  const rows = await db
    .select({ id: imports.id })
    .from(imports)
    .where(and(eq(imports.householdId, session.householdId), eq(imports.status, 'uploaded')));
  const ids = rows.map((r) => r.id);
  const householdId = session.householdId;

  if (ids.length > 0) {
    after(async () => {
      for (const id of ids) {
        try {
          await parseImportInternal(id, householdId);
        } catch {
          console.error('[imports] drain parse job threw', { id });
        }
      }
    });
  }

  return { ok: true, queued: ids.length };
}
