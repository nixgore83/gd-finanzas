/**
 * Filtro por rango de fechas para la revisión de un import.
 *
 * Por qué existe: los resúmenes arrastran movimientos de períodos anteriores
 * (una caja de ahorro con 192 líneas de 2025 dentro del extracto cerrado en
 * enero-2026, consumos de fin de año en el resumen de tarjeta de enero). Si sólo
 * te interesa un ejercicio, hoy hay que buscarlos a ojo y rechazarlos de a uno.
 *
 * Con este filtro + "seleccionar todas las filtradas" + "rechazar seleccionadas"
 * el caso se resuelve en tres clicks: hasta = 2025-12-31, seleccionar, rechazar.
 *
 * Puro: compara strings `YYYY-MM-DD`, que ordenan lexicográficamente igual que
 * cronológicamente. Sin `Date`, sin zonas horarias — una fecha de movimiento es
 * un día calendario, no un instante, y convertirla a `Date` introduce el clásico
 * corrimiento de un día según el huso.
 */

/** Fecha `YYYY-MM-DD` bien formada. No valida que el día exista (30/02 pasa). */
export function isIsoDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

/**
 * ¿`date` cae dentro de [`from`, `to`], ambos inclusive? Un extremo vacío o mal
 * formado no acota ese lado — así el filtro sigue siendo usable mientras se
 * tipea la fecha, en vez de vaciar la lista con cada tecla.
 *
 * Una línea sin fecha legible NUNCA se filtra: no se puede afirmar que esté
 * fuera del rango, y esconderla la volvería invisible justo cuando es la que más
 * necesita revisión humana.
 */
export function matchesDateRange(
  date: string | null | undefined,
  from: string,
  to: string,
): boolean {
  const d = (date ?? '').trim();
  if (!isIsoDate(d)) return true;
  if (isIsoDate(from) && d < from) return false;
  if (isIsoDate(to) && d > to) return false;
  return true;
}

/** ¿Hay algún extremo activo? Para mostrar el chip de filtro aplicado. */
export function hasDateRange(from: string, to: string): boolean {
  return isIsoDate(from) || isIsoDate(to);
}

/** Rótulo del chip: "desde 2026-01-01", "hasta 2025-12-31", "2026-01-01 → 2026-06-30". */
export function describeDateRange(from: string, to: string): string {
  const f = isIsoDate(from) ? from : '';
  const t = isIsoDate(to) ? to : '';
  if (f && t) return `${f} → ${t}`;
  if (f) return `desde ${f}`;
  if (t) return `hasta ${t}`;
  return '';
}
