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

export type LegAmounts = {
  amountOriginal: string;
  amountUsd: string;
  amountArs: string;
};

/**
 * Conversión pura de UNA pata de transferencia. La moneda que manda es la **del
 * movimiento**, no la `currency_default` de la cuenta: las TC argentinas son
 * bimonetarias (un mismo resumen tiene sección ARS y sección USD) y cualquier
 * cuenta puede recibir un movimiento denominado en la otra moneda. La moneda de
 * la cuenta solo se usa como fallback cuando el caller no sabe la del movimiento.
 * `sign` = -1 si la pata sale de la cuenta, 1 si entra.
 */
export function computeLegAmounts(
  amount: Decimal,
  currency: 'ARS' | 'USD',
  rate: Decimal,
  sign: 1 | -1,
): LegAmounts {
  const abs = amount.abs();
  const usdRaw = currency === 'USD' ? abs : abs.div(rate);
  const arsRaw = currency === 'ARS' ? abs : abs.mul(rate);
  return {
    amountOriginal: signed(abs, sign),
    amountUsd: signed(usdRaw, sign),
    amountArs: signed(arsRaw, sign),
  };
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

/**
 * ¿El confirm debe INVENTAR la pata de la contraparte cuando no encontró
 * ninguna para parear? Solo si la contraparte opera nativamente en la moneda de
 * la línea (su `currency_default` coincide).
 *
 * Es deliberadamente conservador, y en particular NO se abre para tarjetas de
 * crédito aunque sean bimonetarias. Inventar la pata de una TC que después se
 * importa produce el duplicado exacto que el match-al-confirmar vino a evitar:
 * la pata sintética queda pareada, así que cuando llega el `SU PAGO` del resumen
 * no encuentra candidato libre y crea el par de nuevo. Que la pata propia quede
 * sin parear hasta que llegue el otro extracto es el estado correcto: ahí se
 * parea sola (la búsqueda de candidato sí filtra por la moneda del movimiento,
 * no por el default de la cuenta).
 */
export function shouldSynthesizeCounterpartyLeg(
  counterpartyCurrencyDefault: 'ARS' | 'USD',
  lineCurrency: 'ARS' | 'USD',
): boolean {
  return counterpartyCurrencyDefault === lineCurrency;
}

/**
 * Nro de operación bancaria embebido en el concepto, si lo hay. ICBC imprime la
 * MISMA referencia en las dos patas de un traspaso entre cuentas propias
 * ("TR.7772754  A 0905/11102104/13" en la de pesos y "TR.7772754 DE
 * 0926/01109094/30" en la de dólares). Devuelve solo los dígitos.
 */
export function extractOperationRef(description: string): string | null {
  const m = /\bTR\.\s*(\d{6,})\b/i.exec(description);
  return m ? m[1]! : null;
}

/**
 * Lógica pura de selección de candidato a parear por NÚMERO DE OPERACIÓN. A
 * diferencia del match por monto, sirve cross-currency (una compra de USD tiene
 * montos distintos en cada pata) porque la referencia es un identificador fuerte
 * emitido por el banco. Exige dirección opuesta y EXACTAMENTE un candidato; ante
 * cualquier ambigüedad devuelve null y el pareo queda manual.
 * `isOutgoing` = la línea sale de la cuenta del import (la contraparte recibe).
 */
export function selectOperationRefTransferMatch(
  candidates: ReadonlyArray<{ id: string; description: string; amountOriginal: string }>,
  opRef: string,
  isOutgoing: boolean,
): string | null {
  const wantDirection: 'out' | 'in' = isOutgoing ? 'in' : 'out';
  const hits = candidates.filter(
    (c) =>
      extractOperationRef(c.description) === opRef &&
      transferDirection('transfer', c.amountOriginal) === wantDirection,
  );
  return hits.length === 1 ? hits[0]!.id : null;
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

  // Moneda explícita de cada pata (la del movimiento) con fallback a la de la
  // cuenta. Ver `computeLegAmounts`: la cuenta define un default, no una regla.
  const currencyFrom = input.currencyFrom ?? fromAcc.currencyDefault;
  const currencyTo = input.currencyTo ?? toAcc.currencyDefault;

  // Cada pata convierte su propio monto a USD/ARS con la misma `rate` BCRA.
  const fromAmounts = computeLegAmounts(new Decimal(input.amountFrom), currencyFrom, rate, -1);
  const toAmounts = computeLegAmounts(new Decimal(input.amountTo), currencyTo, rate, 1);

  const pairId = existingPairId ?? randomUUID();

  const fromLeg: BuiltLegFields = {
    date: input.date,
    accountId: fromAcc.id,
    categoryId: null,
    kind: 'transfer',
    ...fromAmounts,
    currencyOriginal: currencyFrom,
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
    ...toAmounts,
    currencyOriginal: currencyTo,
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
  /**
   * Moneda DEL MOVIMIENTO. Si se omite cae a la `currency_default` de la cuenta,
   * pero el caller que la conoce (ej. una línea de import) debe pasarla: una TC
   * "ARS" recibe pagos y consumos en USD y la pata tiene que quedar en USD.
   */
  currency?: 'ARS' | 'USD';
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
  const currency = input.currency ?? acc.currencyDefault;
  const sign: 1 | -1 = input.direction === 'out' ? -1 : 1;
  const amounts = computeLegAmounts(new Decimal(input.amount), currency, rate, sign);

  return {
    ok: true,
    currency,
    leg: {
      date: input.date,
      accountId: acc.id,
      categoryId: null,
      kind: 'transfer',
      ...amounts,
      currencyOriginal: currency,
      fxRateUsed,
      fxRateSource,
      description: input.description,
      notes: input.notes,
      transferPairId: input.transferPairId,
    },
  };
}
