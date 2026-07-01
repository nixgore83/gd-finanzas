import { z } from 'zod';

/**
 * Filtro de categoría compartido por la lista de movimientos (`/transactions`)
 * y el export contador (`/api/exports/transactions`). Acepta un uuid de
 * categoría o el literal `'unclassified'` (movimientos sin categoría →
 * `categoryId IS NULL`).
 *
 * Única fuente de verdad del valor de filtro, para que la página y el export no
 * diverjan (ver `formatAccount` para el mismo criterio de "único lugar").
 */
export const categoryFilterSchema = z.union([
  z.string().uuid(),
  z.literal('unclassified'),
]);

export type CategoryFilterValue = z.infer<typeof categoryFilterSchema>;
