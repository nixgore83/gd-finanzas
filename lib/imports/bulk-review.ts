import { counterpartyBankRefs, counterpartyHasIdentity, matchAccountByRefs } from './counterparty-identity';
import type { ParsedTxLine } from './parsers/types';

/**
 * Revisión asistida de un import, para la confirmación masiva por script.
 *
 * Decide, línea por línea y con reglas EXPLÍCITAS, lo mismo que una persona
 * hace en la pantalla de revisión: aceptar, corregir (contracuenta, categoría,
 * fecha de cuota), rechazar un duplicado o dejar pendiente. El criterio es
 * conservador a propósito: ante la duda la línea queda `pending`, porque un
 * gasto real confirmado como transferencia desaparece del reporte y un
 * duplicado confirmado infla el saldo — los dos salen caros de deshacer.
 *
 * Es lógica pura (sin DB) para poder testearla; el script arma el contexto.
 */

export type ReviewAccount = {
  id: string;
  institutionName: string | null;
  type: string;
  cardBrand: string | null;
  currency: 'ARS' | 'USD';
  ownerTag: string | null;
  transferRefs: string[] | null;
};

export type ReviewContext = {
  /** Cuenta del extracto. */
  account: ReviewAccount;
  /** Todas las cuentas del household (incluida la del extracto). */
  accounts: readonly ReviewAccount[];
  /** CUIT/CUIL (solo dígitos) de los miembros del household. */
  householdCuits: readonly string[];
  /** Categorías por nombre (minúsculas) → id. Solo se usan las de `KNOWN_CATEGORIES`. */
  categoryIdByName: ReadonlyMap<string, string>;
  /** Fecha de cierre del resumen (`imports.period_end`), para fechar cuotas. */
  periodEnd: string | null;
};

export type LineInput = {
  id: string;
  parsed: ParsedTxLine;
  proposedCategoryId: string | null;
  /** Categoría aprendida de movimientos previos a la MISMA contraparte (null si no hay). */
  historyCategoryId: string | null;
  /** Ya existe una transacción de esta cuenta con mismo monto y fecha ±1 día. */
  isDuplicate: boolean;
};

export type Decision =
  | { action: 'accept'; reason: string }
  | { action: 'edit'; reason: string; parsed: ParsedTxLine; proposedCategoryId: string | null }
  | { action: 'reject'; reason: string; parsed: ParsedTxLine }
  | { action: 'pending'; reason: string };

/** Nombres de categoría que las reglas de concepto necesitan resolver. */
export const KNOWN_CATEGORIES = ['intereses', 'promos bancarias'] as const;

/** Marca de cuota en la descripción: "C.03/06", "03/06", "5 de 6". */
const CUOTA_RE = /(\d{1,2})\s*(?:\/|de)\s*(\d{1,2})/;

/** Una cuota fechada más de esto antes del cierre está fechada al consumo original. */
const CUOTA_MAX_DAYS_BEFORE_CLOSE = 45;

const DUPLICATE_MARK = '[DUPLICADA] Ya existe como transacción en esta cuenta';

function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
}

function digits(s: string | null | undefined): string {
  return (s ?? '').replace(/\D/g, '');
}

function sameOwner(a: ReviewAccount, b: ReviewAccount): boolean {
  return (a.ownerTag ?? '') === (b.ownerTag ?? '');
}

/** Única cuenta que cumple el predicado, o null si hay 0 o más de una. */
function onlyOne(
  accounts: readonly ReviewAccount[],
  pred: (a: ReviewAccount) => boolean,
): string | null {
  const found = accounts.filter(pred);
  return found.length === 1 ? found[0]!.id : null;
}

type Concept =
  | { kind: 'transfer'; accountId: string | null; why: string }
  | { kind: 'category'; categoryId: string; why: string }
  | null;

/**
 * Conceptos bancarios cuyo significado no depende de la contraparte. Son los
 * mismos que el parser determinístico de Galicia aplica sobre los xlsx; acá
 * cubren los PDF (que pasan por el LLM y llegan sin resolver).
 */
function knownConcept(d: string, line: LineInput, ctx: ReviewContext): Concept {
  const { account, accounts } = ctx;
  const inst = (account.institutionName ?? '').toLowerCase();

  // Fondos comunes de Galicia: el otro lado es la cuenta de inversión del mismo dueño.
  if (/\bFIMA\b/.test(d) && inst === 'galicia') {
    const accountId = onlyOne(
      accounts,
      (a) => (a.institutionName ?? '').toLowerCase() === 'galicia' && a.type === 'broker' && sameOwner(a, account),
    );
    return { kind: 'transfer', accountId, why: 'FIMA → inversiones Galicia' };
  }

  // Pago de tarjeta: transferencia a la tarjeta de la misma institución y dueño.
  const pago = /PAGO\s+TARJETA\s+(VISA|MASTER|AMEX)/.exec(d);
  if (pago) {
    const brand = pago[1]!.toLowerCase();
    const accountId = onlyOne(
      accounts,
      (a) =>
        a.type === 'credit_card' &&
        (a.cardBrand ?? '') === brand &&
        (a.institutionName ?? '').toLowerCase() === inst &&
        sameOwner(a, account),
    );
    return { kind: 'transfer', accountId, why: `pago tarjeta ${brand}` };
  }

  if (/INTERES(ES)?\s+CAPITALIZADO|ACREDITACI[OÓ]N\s+DE\s+INTERESES/.test(d)) {
    const id = ctx.categoryIdByName.get('intereses');
    return id ? { kind: 'category', categoryId: id, why: 'intereses' } : null;
  }

  if (/REINTEGRO\s+PROMOCI[OÓ]N/.test(d)) {
    const id = ctx.categoryIdByName.get('promos bancarias');
    return id ? { kind: 'category', categoryId: id, why: 'promo bancaria' } : null;
  }

  // BIND: movimientos entre sub-cuentas propias del mismo resumen consolidado.
  if (/TRANSF\.?\s+ENTRE\s+CUENTAS/.test(d)) {
    return { kind: 'transfer', accountId: null, why: 'entre cuentas propias' };
  }
  if (/COMPRA\s+MONEDA\s+EXTRANJERA/.test(d)) {
    const accountId = onlyOne(
      accounts,
      (a) =>
        a.id !== account.id &&
        a.type === 'bank_savings' &&
        (a.institutionName ?? '') === (account.institutionName ?? '') &&
        a.currency !== account.currency &&
        sameOwner(a, account),
    );
    return { kind: 'transfer', accountId, why: 'compra de moneda entre cajas propias' };
  }

  // Sueldos pagados por transferencia: el parser los marca transfer, pero el
  // historial ya los categorizó (empleadas domésticas).
  if (/ACRED\.?\s*HABERES/.test(d) && line.proposedCategoryId) {
    return { kind: 'category', categoryId: line.proposedCategoryId, why: 'acreditación de haberes' };
  }

  return null;
}

function asTransfer(line: LineInput, accountId: string | null, reason: string): Decision {
  const { parsed } = line;
  const same =
    parsed.isTransfer === true && (parsed.transferAccountId ?? null) === accountId;
  if (same && line.proposedCategoryId === null) return { action: 'accept', reason };
  const next: ParsedTxLine = { ...parsed, isTransfer: true };
  if (accountId) next.transferAccountId = accountId;
  else delete next.transferAccountId;
  return { action: 'edit', reason, parsed: next, proposedCategoryId: null };
}

function asCategorized(line: LineInput, categoryId: string, reason: string): Decision {
  const { parsed } = line;
  if (!parsed.isTransfer && line.proposedCategoryId === categoryId) {
    return { action: 'accept', reason };
  }
  const next: ParsedTxLine = { ...parsed, isTransfer: false };
  delete next.transferAccountId;
  return { action: 'edit', reason, parsed: next, proposedCategoryId: categoryId };
}

/**
 * Identificador fuerte (CUIL/CBU/cuenta/alias). El nombre solo NO alcanza para
 * reusar historial: dos personas distintas pueden llamarse igual.
 */
export function counterpartyHasStrongId(cp: ParsedTxLine['counterparty']): boolean {
  if (!cp || !counterpartyHasIdentity(cp)) return false;
  return Boolean(cp.cuil?.trim() || cp.cbu?.trim() || cp.accountRef?.trim() || cp.alias?.trim());
}

/**
 * Fecha de cierre a la que hay que mover una cuota de TC que vino fechada al
 * consumo original (regla de negocio: en imports cada cuota va al cierre del
 * resumen). Null si la línea no es cuota o ya está dentro del período. Se usa
 * también para el chequeo de duplicados: con la fecha original, la cuota 3 de
 * una compra parece la cuota 1 ya cargada (mismo monto, misma fecha).
 */
export function cuotaDateAtClose(parsed: ParsedTxLine, ctx: ReviewContext): string | null {
  if (ctx.account.type !== 'credit_card' || !ctx.periodEnd) return null;
  if (!CUOTA_RE.test(parsed.description)) return null;
  return daysBetween(parsed.date, ctx.periodEnd) > CUOTA_MAX_DAYS_BEFORE_CLOSE ? ctx.periodEnd : null;
}

/** ¿La contraparte es uno de los dos miembros del household o una cuenta propia? */
export function counterpartyIsHousehold(line: LineInput, ctx: ReviewContext): boolean {
  const cp = line.parsed.counterparty;
  if (!cp) return false;
  const cuil = digits(cp.cuil);
  if (cuil && ctx.householdCuits.includes(cuil)) return true;
  const refs = new Set(counterpartyBankRefs(cp));
  return ctx.accounts.some((a) => (a.transferRefs ?? []).some((r) => refs.has(digits(r) || r)));
}

export function decideLine(ctx: ReviewContext, line: LineInput): Decision {
  const { parsed } = line;

  if (line.isDuplicate) {
    const notes = [DUPLICATE_MARK, parsed.notes].filter(Boolean).join(' · ').slice(0, 500);
    return { action: 'reject', reason: 'duplicada', parsed: { ...parsed, notes } };
  }

  const d = parsed.description.toUpperCase();

  // ── Tarjetas: todo es consumo; solo hace falta categoría y la fecha de cuota al cierre.
  if (ctx.account.type === 'credit_card') {
    if (!line.proposedCategoryId) return { action: 'pending', reason: 'sin categoría' };
    const closeDate = cuotaDateAtClose(parsed, ctx);
    if (closeDate) {
      return {
        action: 'edit',
        reason: 'cuota fechada al cierre',
        parsed: { ...parsed, date: closeDate },
        proposedCategoryId: line.proposedCategoryId,
      };
    }
    return { action: 'accept', reason: 'consumo con categoría' };
  }

  // ── Bancos: primero los conceptos inequívocos.
  const concept = knownConcept(d, line, ctx);
  if (concept?.kind === 'transfer') return asTransfer(line, concept.accountId, concept.why);
  if (concept?.kind === 'category') return asCategorized(line, concept.categoryId, concept.why);

  if (parsed.isTransfer) {
    if (parsed.transferAccountId) return { action: 'accept', reason: 'transferencia con contracuenta' };

    if (counterpartyIsHousehold(line, ctx)) {
      const others = ctx.accounts.filter((a) => a.id !== ctx.account.id);
      const accountId = matchAccountByRefs(parsed.counterparty, others);
      return asTransfer(line, accountId, 'transferencia entre cuentas propias');
    }

    if (counterpartyHasStrongId(parsed.counterparty)) {
      // Tercero identificado: si ya le pagamos/cobramos antes, se repite la
      // categoría; si no, nadie puede saber desde acá qué es.
      if (line.historyCategoryId) {
        return asCategorized(line, line.historyCategoryId, 'tercero con historial');
      }
      return { action: 'pending', reason: 'transferencia a/de tercero sin historial' };
    }

    return { action: 'pending', reason: 'transferencia sin contraparte identificable' };
  }

  if (line.proposedCategoryId) return { action: 'accept', reason: 'movimiento con categoría' };
  return { action: 'pending', reason: 'sin categoría' };
}
