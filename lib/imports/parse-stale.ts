/**
 * El parseo corre async (after()) acotado a la maxDuration de la ruta (300s).
 * Si un import quedó en `status='parsing'` más que este umbral, asumimos que el
 * job se cortó (timeout / función matada) y lo tratamos como "cortado" en la UI
 * para ofrecer reintentar, en vez de mostrar "en curso" para siempre.
 *
 * 6 min = 300s de maxDuration + buffer para cold start / latencia.
 */
export const PARSE_STALE_AFTER_MS = 6 * 60 * 1000;

/**
 * `true` si un import en estado `parsing` lleva más del umbral sin cerrar.
 * Puro (recibe `now`) para testear sin reloj. `null`/inválido → no stale.
 */
export function isParseStale(
  parsingStartedAt: Date | string | null | undefined,
  now: Date,
): boolean {
  if (!parsingStartedAt) return false;
  const started =
    parsingStartedAt instanceof Date ? parsingStartedAt : new Date(parsingStartedAt);
  if (Number.isNaN(started.getTime())) return false;
  return now.getTime() - started.getTime() > PARSE_STALE_AFTER_MS;
}
