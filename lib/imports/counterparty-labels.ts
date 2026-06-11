/**
 * Helpers puros para las etiquetas de contraparte (sin imports de DB: los
 * consume el client component de la review además del server).
 */

/**
 * Mergea fuentes de etiquetas (historial, import actual) en una lista para el
 * combobox: trim, descarta vacíos, dedupe case-insensitive (gana la primera
 * aparición — pasar el historial primero para que su casing sea el canónico)
 * y ordena alfabéticamente en español.
 */
export function mergeCounterpartyLabels(
  ...sources: ReadonlyArray<ReadonlyArray<string | null | undefined>>
): string[] {
  const byKey = new Map<string, string>();
  for (const source of sources) {
    for (const raw of source) {
      const label = raw?.trim();
      if (!label) continue;
      const key = label.toLowerCase();
      if (!byKey.has(key)) byKey.set(key, label);
    }
  }
  return [...byKey.values()].sort((a, b) => a.localeCompare(b, 'es'));
}
