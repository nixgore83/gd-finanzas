import type { SortCriterion, SortDir } from './criteria';

export type Comparator<T> = (a: T, b: T) => number;

/**
 * Fábrica de comparadores por campo: recibe la dirección y devuelve el
 * comparador ya orientado. Recibe `dir` (en vez de un flip externo) para
 * permitir reglas que NO se invierten con la dirección — ej. "sin categoría
 * siempre arriba" en el review de imports.
 */
export type ComparatorFactory<T> = (dir: SortDir) => Comparator<T>;

/** Invierte un comparador si `dir === 'desc'`. */
export function directed<T>(cmp: Comparator<T>, dir: SortDir): Comparator<T> {
  return dir === 'desc' ? (a, b) => -cmp(a, b) : cmp;
}

/** Fábrica estándar: el campo se invierte completo con la dirección. */
export function simple<T>(cmp: Comparator<T>): ComparatorFactory<T> {
  return (dir) => directed(cmp, dir);
}

/**
 * Comparador encadenado: aplica los criterios en orden de prioridad y corta
 * en el primer no-empate. Con criterios vacíos devuelve siempre 0 (sort
 * estable → preserva el orden de entrada).
 */
export function buildComparator<T, F extends string>(
  criteria: readonly SortCriterion<F>[],
  factories: Record<F, ComparatorFactory<T>>,
): Comparator<T> {
  const chain = criteria.map((c) => factories[c.field](c.dir));
  return (a, b) => {
    for (const cmp of chain) {
      const r = cmp(a, b);
      if (r !== 0) return r;
    }
    return 0;
  };
}
