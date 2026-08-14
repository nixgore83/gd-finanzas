/**
 * Resumen legible de por qué fallaron líneas al confirmar un import.
 *
 * Por qué existe: `confirmImport` ya sabía el motivo exacto de cada línea que no
 * pudo confirmar (`transfer sin cuenta contraparte`, `sin categoría asignada`,
 * `sin cotización FX`, …), pero sólo persistía el conteo — "51 confirmadas, 130
 * pendientes con error" — y los motivos morían en un `console.error` del cliente.
 * El cartel de la pantalla sugería además revisar el FX "si fue ese el problema",
 * que en el caso real que motivó esto (2026-08-14, caja de ahorro de Pau) era una
 * pista falsa: las 130 líneas fallaban por transferencias sin contracuenta y el
 * FX estaba perfecto. Sin el desglose no hay forma de saber qué corregir.
 *
 * Puro y sin dependencias: se testea con listas sintéticas.
 */

export type LineError = { lineId: string; reason: string };

/** Un motivo y cuántas líneas lo tienen, de mayor a menor. */
export type ReasonCount = { reason: string; count: number };

/**
 * Agrupa por motivo, de mayor a menor. Empata alfabéticamente para que el
 * resultado sea estable entre corridas (si no, el mensaje persistido cambiaría
 * solo y ensuciaría el historial del import).
 */
export function countByReason(errors: readonly LineError[]): ReasonCount[] {
  const counts = new Map<string, number>();
  for (const e of errors) counts.set(e.reason, (counts.get(e.reason) ?? 0) + 1);
  return [...counts.entries()]
    .map(([reason, count]) => ({ reason, count }))
    .sort((a, b) => b.count - a.count || a.reason.localeCompare(b.reason));
}

/**
 * Cuántos motivos distintos se enumeran antes de agrupar el resto en "otros".
 * El mensaje va a una columna de texto que se muestra en un cartel; con más de
 * tres se vuelve ilegible y deja de servir para decidir qué corregir primero.
 */
const MAX_REASONS_SHOWN = 3;

/**
 * Mensaje que se persiste en `imports.error_message` tras un confirm parcial.
 * Formato: "51 confirmadas, 130 pendientes con error — 118 transfer sin cuenta
 * contraparte, 12 sin categoría asignada".
 *
 * `confirmed` es cuántas se confirmaron en ESTA corrida; el confirm es
 * resumible, así que un reintento sólo procesa las que quedaron sin transacción.
 */
export function buildConfirmErrorMessage(
  confirmed: number,
  errors: readonly LineError[],
): string {
  const base =
    confirmed > 0
      ? `${confirmed} confirmadas, ${errors.length} pendientes con error`
      : `${errors.length} líneas con error`;
  if (errors.length === 0) return base;

  const ranked = countByReason(errors);
  const shown = ranked.slice(0, MAX_REASONS_SHOWN);
  const restCount = ranked.slice(MAX_REASONS_SHOWN).reduce((n, r) => n + r.count, 0);
  const parts = shown.map((r) => `${r.count} ${r.reason}`);
  if (restCount > 0) parts.push(`${restCount} otros`);
  return `${base} — ${parts.join(', ')}`;
}

/** ¿Alguna línea falló por falta de cotización? Decide si la pista del FX aplica. */
export function hasFxError(errors: readonly LineError[]): boolean {
  return errors.some((e) => e.reason.toLowerCase().includes('fx'));
}
