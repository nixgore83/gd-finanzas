import { randomUUID } from 'node:crypto';
import { and, eq, inArray } from 'drizzle-orm';
import Decimal from 'decimal.js';
import { getDb } from '@/lib/db/client';
import { accounts } from '@/db/schema';
import { toMoneyString } from '@/lib/schemas/money';
import { getFxRate, FxRateNotFoundError } from '@/lib/fx/get-fx-rate';
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
