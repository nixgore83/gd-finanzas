import { and, eq, inArray } from 'drizzle-orm';
import Decimal from 'decimal.js';
import { getDb } from '@/lib/db/client';
import { accounts, categories, tags } from '@/db/schema';
import { toMoneyString } from '@/lib/schemas/money';
import { getFxRate, FxRateNotFoundError } from '@/lib/fx/get-fx-rate';
import type { TransactionInput } from '@/lib/schemas/transaction';

/**
 * Valida que todos los `tagIds` pertenezcan al household. Devuelve `ok: false`
 * si alguno no existe o pertenece a otro household. Útil tanto para
 * transacciones como para transferencias.
 */
export async function validateTagIds(
  tagIds: string[],
  householdId: string,
): Promise<{ ok: true } | { ok: false; fields: Record<string, string> }> {
  if (tagIds.length === 0) return { ok: true };
  const db = getDb();
  const rows = await db
    .select({ id: tags.id })
    .from(tags)
    .where(and(inArray(tags.id, tagIds), eq(tags.householdId, householdId)));
  if (rows.length !== tagIds.length) {
    return { ok: false, fields: { tagIds: 'Una o más etiquetas son inválidas' } };
  }
  return { ok: true };
}

export type BuiltTransactionFields = {
  date: string;
  accountId: string;
  categoryId: string;
  kind: 'income' | 'expense';
  amountOriginal: string;
  currencyOriginal: 'ARS' | 'USD';
  amountUsd: string;
  amountArs: string;
  fxRateUsed: string;
  fxRateSource: string;
  description: string;
  notes: string | null;
  transactionSubtype: 'standard' | 'domestic_service';
  deducibleGanancias: boolean;
  meta: Record<string, unknown>;
};

export type BuildResult =
  | { ok: true; fields: BuiltTransactionFields }
  | { ok: false; error: 'invalid_refs' | 'fx_unavailable'; fields: Record<string, string> };

/**
 * Centraliza la lógica común de create y update:
 *  - Valida que account y category pertenezcan al household y no estén archived.
 *  - Valida `category.kind === input.kind`.
 *  - Resuelve el FX: override manual si el caller lo pasó, BCRA si no.
 *  - Calcula `amount_usd` y `amount_ars` con Decimal.
 */
export async function buildTransactionFields(
  input: TransactionInput,
  householdId: string,
): Promise<BuildResult> {
  const db = getDb();

  const [account] = await db
    .select({ id: accounts.id, archived: accounts.archived })
    .from(accounts)
    .where(and(eq(accounts.id, input.accountId), eq(accounts.householdId, householdId)))
    .limit(1);

  if (!account || account.archived) {
    return { ok: false, error: 'invalid_refs', fields: { accountId: 'Cuenta inválida' } };
  }

  const [category] = await db
    .select({ id: categories.id, kind: categories.kind, archived: categories.archived })
    .from(categories)
    .where(and(eq(categories.id, input.categoryId), eq(categories.householdId, householdId)))
    .limit(1);

  if (!category || category.archived) {
    return { ok: false, error: 'invalid_refs', fields: { categoryId: 'Categoría inválida' } };
  }
  if (category.kind !== input.kind) {
    return {
      ok: false,
      error: 'invalid_refs',
      fields: { categoryId: 'La categoría no coincide con el tipo (ingreso/gasto)' },
    };
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
  const original = new Decimal(input.amountOriginal);
  const amountUsd =
    input.currencyOriginal === 'USD' ? toMoneyString(original) : toMoneyString(original.div(rate));
  const amountArs =
    input.currencyOriginal === 'ARS' ? toMoneyString(original) : toMoneyString(original.mul(rate));

  return {
    ok: true,
    fields: {
      date: input.date,
      accountId: input.accountId,
      categoryId: input.categoryId,
      kind: input.kind,
      amountOriginal: toMoneyString(original),
      currencyOriginal: input.currencyOriginal,
      amountUsd,
      amountArs,
      fxRateUsed,
      fxRateSource,
      description: input.description,
      notes: input.notes,
      transactionSubtype: input.transactionSubtype,
      deducibleGanancias: input.deducibleGanancias,
      meta: input.meta ?? {},
    },
  };
}
