import type { CategoryNode } from '@/lib/categories/tree';

/**
 * Una categoría es hoja si ninguna otra del árbol la tiene como parent.
 * En la taxonomía actual: "Vacaciones" / "Mario" / "Seguros" son
 * parents sin children → también hojas (presupuesto editable directamente).
 * "Vivienda" / "Sueldo" / etc. tienen children → no son hojas (subtotal
 * calculado, read-only).
 */
export function isLeafCategory(catId: string, tree: readonly CategoryNode[]): boolean {
  return !tree.some((c) => c.parentId === catId);
}

export function leafIdsOf(tree: readonly CategoryNode[]): Set<string> {
  const haveChildren = new Set(
    tree.filter((c) => c.parentId !== null).map((c) => c.parentId as string),
  );
  return new Set(tree.filter((c) => !haveChildren.has(c.id)).map((c) => c.id));
}
