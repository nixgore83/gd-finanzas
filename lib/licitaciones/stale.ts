/**
 * El procesamiento corre async (after()) acotado a la maxDuration de la ruta
 * (300s). Si un job quedó en `status='processing'` más que este umbral, asumimos
 * que se cortó (timeout / función matada) y lo tratamos como "cortado" para
 * ofrecer reintentar, en vez de mostrar "en curso" para siempre.
 *
 * 10 min: alineado con el reaper del PRD (300s de maxDuration + buffer amplio
 * para cold start / latencia del microservicio).
 */
export const LICITACIONES_STALE_AFTER_MS = 10 * 60 * 1000;

/**
 * `true` si un job en estado `processing` lleva más del umbral sin cerrar.
 * Puro (recibe `now`) para testear sin reloj. `null`/inválido → no stale.
 */
export function isLicitacionStale(
  processingStartedAt: Date | string | null | undefined,
  now: Date,
): boolean {
  if (!processingStartedAt) return false;
  const started =
    processingStartedAt instanceof Date ? processingStartedAt : new Date(processingStartedAt);
  if (Number.isNaN(started.getTime())) return false;
  return now.getTime() - started.getTime() > LICITACIONES_STALE_AFTER_MS;
}
