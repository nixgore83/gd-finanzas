import type { Counterparty } from '@/lib/imports/parsers/types';

/**
 * Identidad canónica de contraparte. ÚNICO punto donde se define cómo se decide
 * que dos contrapartes son "la misma" (CUIL/CBU/cuenta/alias con match exacto;
 * fallback: nombre normalizado). Lo consumen la sugerencia inter-import
 * (`counterparty-suggest`), la propagación intra-import en la review y cualquier
 * feature futura de aprendizaje por contraparte — no reimplementar por feature.
 */

/** Campos identificadores "fuertes" (match exacto). */
export const STRONG_ID_FIELDS = ['cuil', 'cbu', 'accountRef', 'alias'] as const;

/** Nombre normalizado para comparación: lower + trim + espacios colapsados. */
export function normalizeCounterpartyName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, ' ');
}

/** True si la contraparte tiene al menos un identificador usable para matchear. */
export function counterpartyHasIdentity(cp: Counterparty | null | undefined): boolean {
  if (!cp) return false;
  return Boolean(
    cp.cuil?.trim() ||
      cp.cbu?.trim() ||
      cp.accountRef?.trim() ||
      cp.alias?.trim() ||
      cp.name?.trim(),
  );
}

/**
 * True si `a` y `b` refieren a la misma identidad: algún identificador fuerte
 * presente en AMBAS coincide (OR entre campos), o — último recurso — el nombre
 * normalizado coincide.
 */
export function sameCounterpartyIdentity(
  a: Counterparty | null | undefined,
  b: Counterparty | null | undefined,
): boolean {
  if (!a || !b) return false;
  for (const field of STRONG_ID_FIELDS) {
    const va = a[field]?.trim();
    const vb = b[field]?.trim();
    if (va && vb && va === vb) return true;
  }
  const na = a.name?.trim();
  const nb = b.name?.trim();
  if (na && nb && normalizeCounterpartyName(na) === normalizeCounterpartyName(nb)) return true;
  return false;
}
