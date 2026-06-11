export type SortDir = 'asc' | 'desc';

export type SortCriterion<F extends string = string> = {
  field: F;
  dir: SortDir;
};

/**
 * Máximo de criterios acumulables. Con whitelists de 5-6 campos, más de 3
 * niveles no produce un orden discernible y mantiene URLs y superíndices cortos.
 */
export const MAX_SORT_CRITERIA = 3;

/**
 * Aplica un click de header al estado de sort. Semántica (decidida con Nico):
 * - Click normal (`append: false`) en columna NO activa → reemplaza todo: `[{field, asc}]`.
 * - Shift+click (`append: true`) en columna NO activa → la agrega al final como
 *   criterio de menor prioridad (no-op si ya hay MAX_SORT_CRITERIA).
 * - Click (con o sin shift) en columna ya activa → invierte su dirección sin
 *   cambiar su prioridad ni el resto de los criterios.
 *
 * Pura: nunca muta `criteria`.
 */
export function applySortClick<F extends string>(
  criteria: readonly SortCriterion<F>[],
  field: F,
  opts: { append: boolean },
): SortCriterion<F>[] {
  const idx = criteria.findIndex((c) => c.field === field);
  if (idx >= 0) {
    return criteria.map((c, i) =>
      i === idx ? { field: c.field, dir: c.dir === 'asc' ? 'desc' : 'asc' } : { ...c },
    );
  }
  if (!opts.append) return [{ field, dir: 'asc' }];
  if (criteria.length >= MAX_SORT_CRITERIA) return criteria.map((c) => ({ ...c }));
  return [...criteria.map((c) => ({ ...c })), { field, dir: 'asc' }];
}
