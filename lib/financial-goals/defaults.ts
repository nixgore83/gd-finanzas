/**
 * Defaults del plan financiero validado con Pau el 2026-05-05.
 *
 * Viven en código (no en DB seed) para que un household nuevo no requiera
 * SQL manual: la primera vez que se entra a `/settings/metas`, el form se
 * prellena con estos valores; al guardar, persisten en `financial_goals`.
 *
 * Si Pau cambia el plan, se edita en `/settings/metas`. Cualquier valor
 * acá es solo para "primer guardado".
 */
export const FINANCIAL_GOALS_DEFAULTS = {
  targetAhorroMensualUsd: '5700',
  edadTargetIfNico: 58,
  edadTargetIfPau: 60,
  numeroRetiroUsd: '2230000',
  numeroEducacionUsd: '150000',
  bufferUsd: '72000',
  notas: null as string | null,
} as const;
