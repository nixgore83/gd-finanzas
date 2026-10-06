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
  /**
   * Nombres completos de los miembros tal como los imprimen los bancos
   * ("NICOLAS MARIO GORE", "DALMASSO PAULA CECILIA"). Para extractos que no
   * traen CUIT de contraparte (billetera MP: "Transferencia enviada Nicolas
   * Mario Gore") es la única forma de saber que el otro lado es propio.
   */
  householdNames: readonly string[];
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
export const KNOWN_CATEGORIES = ['intereses', 'promos bancarias', 'gastos bancarios'] as const;

/** Tokens de un nombre: mayúsculas, sin acentos, sin puntuación. */
function nameTokens(s: string): string[] {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .split(/[^A-Z]+/)
    .filter((t) => t.length > 1);
}

/**
 * ¿El texto nombra a un miembro del household? Exige TODOS los tokens de un
 * nombre completo (en cualquier orden): "Gore" solo no alcanza, porque los
 * hijos también se apellidan Gore y una transferencia a un hijo es un gasto.
 */
export function mentionsHouseholdMember(text: string | null | undefined, ctx: ReviewContext): boolean {
  if (!text) return false;
  const have = new Set(nameTokens(text));
  return ctx.householdNames.some((n) => {
    const need = nameTokens(n);
    return need.length >= 2 && need.every((t) => have.has(t));
  });
}

/**
 * Marca de cuota en la descripción: "C.03/06", "03/06", "5 de 6". Los dígitos
 * no pueden venir pegados a otros: "ALLIANZ 0210/18" es un número de póliza
 * que se cobra todos los meses, y leído como "10/18" aparecía como una cuota
 * con 8 meses por delante.
 */
const CUOTA_RE = /(?<!\d)(\d{1,2})\s*(?:\/|de)\s*(\d{1,2})(?!\d)/;

const DUPLICATE_MARK = '[DUPLICADA] Ya existe como transacción en esta cuenta';

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

  // Comisiones y mantenimiento de cuenta: gasto bancario, nunca transferencia.
  if (/\bCOMISI[OÓ]N\b|\bCOM\.?\s*MANT/.test(d) && line.parsed.kind === 'expense') {
    const id = ctx.categoryIdByName.get('gastos bancarios');
    return id ? { kind: 'category', categoryId: id, why: 'comisión bancaria' } : null;
  }

  // Operaciones bursátiles / FCI desde la caja: el otro lado es la cuenta de
  // inversión de la misma institución y dueño.
  if (/\b(COMPRA|VENTA)\s+BURS[AÁ]TIL\b|\b(SUSCRIPCI[OÓ]N|RESCATE)\s+FCI\b/.test(d)) {
    const accountId = onlyOne(
      accounts,
      (a) =>
        a.type === 'broker' &&
        (a.institutionName ?? '').toLowerCase() === inst &&
        sameOwner(a, account),
    );
    return { kind: 'transfer', accountId, why: 'operación bursátil → inversiones' };
  }

  // Billetera de Mercado Pago.
  if (account.type === 'ewallet') {
    if (/PAGO\s+(AUTOM[AÁ]TICO\s+)?(DE\s+)?TARJETA\s+DE\s+CR[EÉ]DITO/.test(d)) {
      const accountId = onlyOne(
        accounts,
        (a) =>
          a.type === 'credit_card' &&
          (a.institutionName ?? '').toLowerCase() === inst &&
          sameOwner(a, account),
      );
      return { kind: 'transfer', accountId, why: 'pago tarjeta MP' };
    }
    // Fondeo desde un banco propio: el extracto no dice cuál.
    if (/^INGRESO\s+DE\s+DINERO\b/.test(d)) {
      return { kind: 'transfer', accountId: null, why: 'ingreso de dinero (fondeo propio)' };
    }
    if (/^TRANSFERENCIA\s+(ENVIADA|RECIBIDA)\b/.test(d) && mentionsHouseholdMember(d, ctx)) {
      return { kind: 'transfer', accountId: null, why: 'transferencia a/de cuenta propia' };
    }
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
 * consumo original. Regla de negocio (CLAUDE.md): en imports cada resumen
 * aporta únicamente la cuota de ese mes, fechada al cierre — TODA línea con
 * marca de cuota, no solo las viejas. Null si la línea no es cuota o ya está
 * fechada al cierre.
 *
 * Se usa también para el chequeo de duplicados, y por eso no puede haber
 * umbral de días: la cuota 2/3 de una compra del 12/08 llega en el resumen de
 * sep con fecha 12/08, igual que la cuota 1/3 del resumen de ago — mismo monto,
 * misma fecha — y se rechazaba como duplicada siendo otra cuota.
 */
export function cuotaDateAtClose(parsed: ParsedTxLine, ctx: ReviewContext): string | null {
  if (ctx.account.type !== 'credit_card' || !ctx.periodEnd) return null;
  if (!CUOTA_RE.test(parsed.description)) return null;
  return parsed.date === ctx.periodEnd ? null : ctx.periodEnd;
}

/** ¿La contraparte es uno de los dos miembros del household o una cuenta propia? */
export function counterpartyIsHousehold(line: LineInput, ctx: ReviewContext): boolean {
  const cp = line.parsed.counterparty;
  if (!cp) return false;
  const cuil = digits(cp.cuil);
  if (cuil && ctx.householdCuits.includes(cuil)) return true;
  if (mentionsHouseholdMember(cp.name, ctx)) return true;
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
