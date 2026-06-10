import { randomUUID } from 'node:crypto';
import { and, eq, inArray } from 'drizzle-orm';
import Decimal from 'decimal.js';
import { getDb } from '@/lib/db/client';
import { accounts } from '@/db/schema';
import { toMoneyString } from '@/lib/schemas/money';
import { getFxRate, FxRateNotFoundError } from '@/lib/fx/get-fx-rate';
import { MATCH_AMOUNT_TOLERANCE } from '@/lib/forecasts/candidates';
import type { TransferInput } from '@/lib/schemas/transfer';

export type BuiltLegFields = {
  date: string;
  accountId: string;
  categoryId: null;
  kind: 'transfer';
  amountOriginal: string;
  currencyOriginal: 'ARS' | 'USD';
  amountUsd: string;
  amountArs: string;
  fxRateUsed: string;
  fxRateSource: string;
  description: string;
  notes: string | null;
  transferPairId: string;
};

export type BuildTransferResult =
  | { ok: true; pairId: string; fromLeg: BuiltLegFields; toLeg: BuiltLegFields }
  | { ok: false; error: 'invalid_refs' | 'fx_unavailable'; fields: Record<string, string> };

function signed(value: Decimal, sign: 1 | -1): string {
  return toMoneyString(sign === -1 ? value.negated() : value);
}

/**
 * Dirección de un movimiento respecto de su cuenta: 'out' = sale, 'in' = entra.
 * income/expense usan magnitud positiva + kind; transfer usa el signo del monto.
 */
export function transferDirection(
  kind: 'income' | 'expense' | 'transfer',
  amountOriginal: string,
): 'out' | 'in' {
  if (kind === 'income') return 'in';
  if (kind === 'expense') return 'out';
  return amountOriginal.trim().startsWith('-') ? 'out' : 'in';
}

/** Re-signa un monto a la magnitud con el signo de la dirección (out = negativo). */
export function resignAmount(value: string, dir: 'out' | 'in'): string {
  const abs = new Decimal(value).abs();
  return toMoneyString(dir === 'out' ? abs.negated() : abs);
}

/**
 * Lógica pura de selección de candidato a parear (same-currency) en el confirm:
 * de las patas-transfer sin parear de la contraparte (ya filtradas por cuenta,
 * kind y ventana de fechas en la query), devuelve el id si hay EXACTAMENTE uno
 * con dirección opuesta y |monto| dentro de tolerancia; si no, null.
 * `isOutgoing` = la línea sale de la cuenta del import (la contraparte recibe → +).
 */
export function selectSameCurrencyTransferMatch(
  candidates: ReadonlyArray<{ id: string; amountOriginal: string }>,
  lineAmount: string,
  isOutgoing: boolean,
  tolerance: number = MATCH_AMOUNT_TOLERANCE,
): string | null {
  const amount = new Decimal(lineAmount).abs();
  const tol = amount.mul(tolerance);
  const within = candidates.filter((c) => {
    const amt = new Decimal(c.amountOriginal);
    const oppositeSign = isOutgoing ? amt.greaterThan(0) : amt.lessThan(0);
    return oppositeSign && amt.abs().minus(amount).abs().lessThanOrEqualTo(tol);
  });
  return within.length === 1 ? within[0]!.id : null;
}

export async function buildTransferFields(
  input: TransferInput,
  householdId: string,
  existingPairId?: string,
): Promise<BuildTransferResult> {
  const db = getDb();

  const accs = await db
    .select({
      id: accounts.id,
      currencyDefault: accounts.currencyDefault,
      archived: accounts.archived,
    })
    .from(accounts)
    .where(
      and(
        eq(accounts.householdId, householdId),
        inArray(accounts.id, [input.accountFromId, input.accountToId]),
      ),
    );

  const fromAcc = accs.find((a) => a.id === input.accountFromId);
  const toAcc = accs.find((a) => a.id === input.accountToId);

  if (!fromAcc || fromAcc.archived) {
    return { ok: false, error: 'invalid_refs', fields: { accountFromId: 'Cuenta origen inválida' } };
  }
  if (!toAcc || toAcc.archived) {
    return { ok: false, error: 'invalid_refs', fields: { accountToId: 'Cuenta destino inválida' } };
  }

  let fxRateUsed: string;
  let fxRateSource: string;

  if (input.fxRateOverride !== null) {
    fxRateUsed = input.fxRateOverride;
    fxRateSource = 'manual_override';
  } else {
    try {
      const fx = await getFxRate({ date: input.date });
      fxRateUsed = fx.rate.toFixed(6, Decimal.ROUND_HALF_UP);
      fxRateSource = fx.source;
    } catch (err) {
      if (err instanceof FxRateNotFoundError) {
        return {
          ok: false,
          error: 'fx_unavailable',
          fields: { date: 'No hay cotización para esa fecha' },
        };
      }
      throw err;
    }
  }

  const rate = new Decimal(fxRateUsed);
  const amountFrom = new Decimal(input.amountFrom);
  const amountTo = new Decimal(input.amountTo);

  // Cada pata convierte su propio monto a USD/ARS con la misma `rate` BCRA.
  const fromUsdRaw =
    fromAcc.currencyDefault === 'USD' ? amountFrom : amountFrom.div(rate);
  const fromArsRaw =
    fromAcc.currencyDefault === 'ARS' ? amountFrom : amountFrom.mul(rate);
  const toUsdRaw = toAcc.currencyDefault === 'USD' ? amountTo : amountTo.div(rate);
  const toArsRaw = toAcc.currencyDefault === 'ARS' ? amountTo : amountTo.mul(rate);

  const pairId = existingPairId ?? randomUUID();

  const fromLeg: BuiltLegFields = {
    date: input.date,
    accountId: fromAcc.id,
    categoryId: null,
    kind: 'transfer',
    amountOriginal: signed(amountFrom, -1),
    currencyOriginal: fromAcc.currencyDefault,
    amountUsd: signed(fromUsdRaw, -1),
    amountArs: signed(fromArsRaw, -1),
    fxRateUsed,
    fxRateSource,
    description: input.description,
    notes: input.notes,
    transferPairId: pairId,
  };

  const toLeg: BuiltLegFields = {
    date: input.date,
    accountId: toAcc.id,
    categoryId: null,
    kind: 'transfer',
    amountOriginal: signed(amountTo, 1),
    currencyOriginal: toAcc.currencyDefault,
    amountUsd: signed(toUsdRaw, 1),
    amountArs: signed(toArsRaw, 1),
    fxRateUsed,
    fxRateSource,
    description: input.description,
    notes: input.notes,
    transferPairId: pairId,
  };

  return { ok: true, pairId, fromLeg, toLeg };
}

export type BuiltSingleLeg = Omit<BuiltLegFields, 'transferPairId'> & {
  transferPairId: string | null;
};

export type SingleTransferLegInput = {
  date: string;
  accountId: string;
  /** Magnitud positiva (el monto de la línea, sin signo). */
  amount: string;
  /** 'out' = sale de la cuenta (negativo), 'in' = entra (positivo). */
  direction: 'out' | 'in';
  description: string;
  notes: string | null;
  fxRateOverride: string | null;
  /** null = pata sin parear (se linkea después); o el pair id compartido. */
  transferPairId: string | null;
};

export type BuildSingleLegResult =
  | { ok: true; leg: BuiltSingleLeg; currency: 'ARS' | 'USD' }
  | { ok: false; error: 'invalid_refs' | 'fx_unavailable' };

/**
 * Construye UNA sola pata de transferencia para la cuenta dada (con su FX y
 * conversión a USD/ARS según la moneda de la cuenta). Se usa en el confirm de
 * imports cuando el otro lado ya existe (se parea) o cuando es cross-currency
 * (la pata propia queda sin parear y se linkea a mano). No inserta nada.
 */
export async function buildSingleTransferLeg(
  input: SingleTransferLegInput,
  householdId: string,
): Promise<BuildSingleLegResult> {
  const db = getDb();

  const [acc] = await db
    .select({ id: accounts.id, currencyDefault: accounts.currencyDefault, archived: accounts.archived })
    .from(accounts)
    .where(and(eq(accounts.householdId, householdId), eq(accounts.id, input.accountId)))
    .limit(1);

  if (!acc || acc.archived) {
    return { ok: false, error: 'invalid_refs' };
  }

  let fxRateUsed: string;
  let fxRateSource: string;
  if (input.fxRateOverride !== null) {
    fxRateUsed = input.fxRateOverride;
    fxRateSource = 'manual_override';
  } else {
    try {
      const fx = await getFxRate({ date: input.date });
      fxRateUsed = fx.rate.toFixed(6, Decimal.ROUND_HALF_UP);
      fxRateSource = fx.source;
    } catch (err) {
      if (err instanceof FxRateNotFoundError) return { ok: false, error: 'fx_unavailable' };
      throw err;
    }
  }

  const rate = new Decimal(fxRateUsed);
  const amount = new Decimal(input.amount).abs();
  const usdRaw = acc.currencyDefault === 'USD' ? amount : amount.div(rate);
  const arsRaw = acc.currencyDefault === 'ARS' ? amount : amount.mul(rate);
  const sign: 1 | -1 = input.direction === 'out' ? -1 : 1;

  return {
    ok: true,
    currency: acc.currencyDefault,
    leg: {
      date: input.date,
      accountId: acc.id,
      categoryId: null,
      kind: 'transfer',
      amountOriginal: signed(amount, sign),
      currencyOriginal: acc.currencyDefault,
      amountUsd: signed(usdRaw, sign),
      amountArs: signed(arsRaw, sign),
      fxRateUsed,
      fxRateSource,
      description: input.description,
      notes: input.notes,
      transferPairId: input.transferPairId,
    },
  };
}
