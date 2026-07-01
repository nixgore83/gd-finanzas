/**
 * Resumen de estados de las líneas de un import y la regla de confirmación.
 * Extraído de la UI de review para poder testear la regla en aislamiento; es la
 * MISMA regla que valida el server en `confirmImport`: una línea `pending`
 * bloquea la confirmación (hay que aceptarla o rechazarla antes).
 */

export type ReviewLineStatus = 'pending' | 'accepted' | 'rejected' | 'edited';

export type LineSummary = Record<ReviewLineStatus, number>;

export function summarizeLineStatuses(
  statuses: readonly ReviewLineStatus[],
): LineSummary {
  const summary: LineSummary = { pending: 0, accepted: 0, rejected: 0, edited: 0 };
  for (const status of statuses) summary[status] += 1;
  return summary;
}

/**
 * Motivo por el que un import NO se puede confirmar, o `null` si se puede:
 *  - `'unresolved_lines'`: quedan líneas `pending` (aceptarlas o rechazarlas).
 *  - `'no_accepted'`: no hay líneas aceptadas/editadas para crear transacciones.
 *
 * `unresolved_lines` tiene prioridad (mismo orden de chequeo que el server y la
 * UI). No cubre el chequeo de cuenta destino, que depende de estado de runtime.
 */
export function importConfirmError(
  summary: LineSummary,
): 'unresolved_lines' | 'no_accepted' | null {
  if (summary.pending > 0) return 'unresolved_lines';
  if (summary.accepted + summary.edited === 0) return 'no_accepted';
  return null;
}
