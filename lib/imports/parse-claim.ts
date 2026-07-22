import { and, eq, inArray, ne, or, sql } from 'drizzle-orm';
import { imports } from '@/db/schema';
import type { DB } from '@/lib/db/client';
import { PARSE_STALE_AFTER_MS } from '@/lib/imports/parse-stale';

/**
 * Estados desde los que se puede (re)parsear un import.
 *
 * `'parsing'` está incluido a propósito: el import puede estar en ese estado
 * porque un parseo anterior se cortó (timeout de la función) o porque el propio
 * caller acaba de reclamarlo. Quién puede realmente arrancar el trabajo lo
 * decide `claimImportForParse`, no esta lista.
 */
export const REPARSEABLE_STATUSES = [
  'uploaded',
  'parsing',
  'error',
  'parsed',
  'reviewing',
] as const;

export function isReparseableStatus(status: string): boolean {
  return (REPARSEABLE_STATUSES as readonly string[]).includes(status);
}

/** Umbral (segundos) tras el cual un `parsing` se considera cortado y es reclamable. */
export const PARSE_CLAIM_STALE_SECONDS = Math.round(PARSE_STALE_AFTER_MS / 1000);

/**
 * Toma el import para parsearlo, de forma ATÓMICA.
 *
 * El `UPDATE ... WHERE` condicional es atómico en Postgres: entre N ejecutores
 * concurrentes sobre el mismo import, exactamente uno ve filas en el `RETURNING`
 * y los demás reciben cero. Sin esto, dos parseos simultáneos (doble click en
 * "Parsear pendientes", auto-parse al subir + click manual, cron + usuario)
 * corrían los dos completos e insertaban CADA UNO su tanda de `import_lines`,
 * duplicando exactamente 2× las líneas del extracto (incidente 2026-07-22).
 *
 * Condición de victoria:
 * - el estado está en `REPARSEABLE_STATUSES` (no se reparsea un `confirmed`), Y
 * - el import NO está siendo parseado ahora mismo: o bien su estado no es
 *   `'parsing'`, o bien lleva en `'parsing'` más que el umbral de staleness, en
 *   cuyo caso el ejecutor anterior murió y es legítimo reclamarlo. Ese escape es
 *   lo que evita que un import quede trabado en `'parsing'` para siempre.
 *
 * `coalesce(parsing_started_at, created_at)` cubre las filas viejas que quedaron
 * en `'parsing'` sin timestamp (mismo criterio que el cron reaper).
 */
export async function claimImportForParse(
  db: DB,
  importId: string,
  householdId: string,
): Promise<boolean> {
  const claimed = await db
    .update(imports)
    .set({ status: 'parsing', parsingStartedAt: sql`now()`, errorMessage: null })
    .where(parseClaimWhere(importId, householdId))
    .returning({ id: imports.id });

  return claimed.length > 0;
}

/** Condición del claim, separada para poder inspeccionar el SQL en tests. */
export function parseClaimWhere(importId: string, householdId: string) {
  return and(
    eq(imports.id, importId),
    eq(imports.householdId, householdId),
    inArray(imports.status, [...REPARSEABLE_STATUSES]),
    or(
      ne(imports.status, 'parsing'),
      sql`coalesce(${imports.parsingStartedAt}, ${imports.createdAt}) < now() - make_interval(secs => ${PARSE_CLAIM_STALE_SECONDS})`,
    ),
  );
}
