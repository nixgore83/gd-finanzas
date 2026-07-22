import { UNREADABLE_DATE_MARKER } from '@/lib/imports/parsers/tc-date-rules';

/**
 * Detección de "colapso de fechas" en un resumen de tarjeta parseado por LLM.
 *
 * Bug real (2026-07): en varios resúmenes (Galicia Amex, BNA Visa, ICBC Visa) el
 * modelo devolvió TODAS las líneas con la fecha de cierre en vez de la fecha de
 * cada consumo. El dato se perdía en silencio y los reportes mensuales quedaban
 * distorsionados (junio vacío, ~68 consumos apilados el 02/07).
 *
 * Regla de la casa: un dato fabricado en silencio es peor que un error visible.
 * Esto NO intenta adivinar la fecha correcta — solo detecta el patrón para marcar
 * el import y cada línea como sospechosos, y que la revisión humana lo vea.
 *
 * Falsos positivos: las CUOTAS sí llevan legítimamente la fecha de cierre (regla
 * de negocio), así que se excluyen del chequeo, igual que las líneas que el LLM
 * marcó con `FECHA_NO_LEGIBLE`. Y se exige un mínimo de líneas "fechables" para
 * no marcar un resumen chico donde todos los consumos sí ocurrieron el mismo día.
 */

/** Marcador de cuota en la descripción: "C.03/06", "C 3/6", "CUOTA 3/6", "CUOTA 3 DE 6". */
const CUOTA_RE = /(\bc\s*\.?\s*\d{1,2}\s*\/\s*\d{1,2}\b)|(\bcuotas?\s*\d{1,2}\s*(\/|de)\s*\d{1,2}\b)/i;

/**
 * Mínimo de líneas fechables (no-cuota, con fecha legible) que deben compartir la
 * MISMA fecha para considerarlo colapso. Con menos, un resumen legítimo de pocos
 * consumos hechos el mismo día daría falso positivo.
 */
export const MIN_COLLAPSE_LINES = 5;

/** Marcador que se agrega a `parsed_data.notes` de cada línea sospechosa. */
export const DATE_COLLAPSE_LINE_MARKER = '[FECHA SOSPECHOSA]';

export type DateCollapseCandidate = {
  date: string;
  description: string;
  notes?: string;
};

export type DateCollapseResult =
  | { collapsed: false }
  | { collapsed: true; date: string; lineCount: number };

export function isCuotaLine(description: string): boolean {
  return CUOTA_RE.test(description);
}

/**
 * Devuelve `collapsed: true` si todas las líneas fechables del resumen comparten
 * una única fecha (y son al menos `MIN_COLLAPSE_LINES`).
 */
export function detectDateCollapse(
  lines: readonly DateCollapseCandidate[],
  minLines: number = MIN_COLLAPSE_LINES,
): DateCollapseResult {
  const datable = lines.filter(
    (l) =>
      typeof l.date === 'string' &&
      l.date !== '' &&
      !isCuotaLine(l.description ?? '') &&
      !(l.notes ?? '').includes(UNREADABLE_DATE_MARKER),
  );
  if (datable.length < minLines) return { collapsed: false };

  const unique = new Set(datable.map((l) => l.date));
  if (unique.size !== 1) return { collapsed: false };

  const [date] = [...unique];
  if (date === undefined) return { collapsed: false };

  return { collapsed: true, date, lineCount: datable.length };
}

/**
 * Texto del banner de error del import cuando se detectó colapso. Va a
 * `imports.error_message` (bajo RLS, nunca a logs).
 */
export function dateCollapseMessage(result: Extract<DateCollapseResult, { collapsed: true }>): string {
  return (
    `⚠ Fechas sospechosas: ${result.lineCount} líneas de consumo quedaron todas con la misma fecha (${result.date}), ` +
    'que suele ser la fecha de cierre. El parser no pudo extraer la fecha real de cada consumo. ' +
    'NO confirmes el import así: re-parsealo y, si vuelve a pasar, corregí las fechas a mano línea por línea antes de confirmar.'
  );
}
