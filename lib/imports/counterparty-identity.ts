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

/**
 * Normaliza una ref bancaria (CBU/CUIT/nro de cuenta/alias) para comparación y
 * almacenamiento en `accounts.transfer_refs`. CUIT "20-30555106-7" y
 * "20305551067" deben matchear: si lo esencial son dígitos (≥6), se comparan
 * solo los dígitos; un alias queda lower+trim.
 */
export function normalizeBankRef(ref: string): string {
  const trimmed = ref.trim().toLowerCase();
  const digits = trimmed.replace(/[^0-9]/g, '');
  return digits.length >= 6 ? digits : trimmed;
}

/** Refs bancarias normalizadas presentes en una contraparte (sin el nombre). */
export function counterpartyBankRefs(cp: Counterparty | null | undefined): string[] {
  if (!cp) return [];
  const out: string[] = [];
  for (const field of STRONG_ID_FIELDS) {
    const v = cp[field]?.trim();
    if (v) out.push(normalizeBankRef(v));
  }
  return [...new Set(out)];
}

/**
 * Resuelve a qué cuenta PROPIA refiere una contraparte, comparando sus refs
 * (CBU/CUIT/alias/nro) contra `accounts.transfer_refs` aprendidas. Devuelve el
 * id solo si matchea EXACTAMENTE una cuenta (ambigüedad ⇒ null, queda manual).
 */
export function matchAccountByRefs(
  cp: Counterparty | null | undefined,
  accounts: ReadonlyArray<{ id: string; transferRefs: string[] | null }>,
): string | null {
  const cpRefs = new Set(counterpartyBankRefs(cp));
  if (cpRefs.size === 0) return null;
  const matches = accounts.filter((a) =>
    (a.transferRefs ?? []).some((r) => cpRefs.has(normalizeBankRef(r))),
  );
  return matches.length === 1 ? matches[0]!.id : null;
}
