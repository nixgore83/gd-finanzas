'use server';

import { revalidatePath } from 'next/cache';
import { and, eq } from 'drizzle-orm';
import Decimal from 'decimal.js';
import { getDb } from '@/lib/db/client';
import { accounts, categories, transactions } from '@/db/schema';
import { parseTransactionFormData } from '@/lib/schemas/transaction';
import { toMoneyString } from '@/lib/schemas/money';
import { requireHouseholdSession, SessionError } from '@/lib/auth/session';
import { getFxRate, FxRateNotFoundError } from '@/lib/fx/get-fx-rate';

export type CreateTransactionResult =
  | { ok: true; id: string }
  | {
      ok: false;
      error: 'invalid_input' | 'invalid_refs' | 'fx_unavailable' | 'session' | 'unknown';
      fields?: Record<string, string>;
    };

export async function createTransaction(formData: FormData): Promise<CreateTransactionResult> {
  let session;
  try {
    session = await requireHouseholdSession();
  } catch (err) {
    if (err instanceof SessionError) return { ok: false, error: 'session' };
    throw err;
  }

  const parsed = parseTransactionFormData(formData);
  if (!parsed.success) {
    const fields: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const key = String(issue.path[0] ?? '_');
      fields[key] ??= issue.message;
    }
    return { ok: false, error: 'invalid_input', fields };
  }
  const input = parsed.data;

  const db = getDb();

  const [account] = await db
    .select({ id: accounts.id, archived: accounts.archived })
    .from(accounts)
    .where(and(eq(accounts.id, input.accountId), eq(accounts.householdId, session.householdId)))
    .limit(1);

  if (!account || account.archived) {
    return { ok: false, error: 'invalid_refs', fields: { accountId: 'Cuenta inválida' } };
  }

  const [category] = await db
    .select({ id: categories.id, kind: categories.kind, archived: categories.archived })
    .from(categories)
    .where(
      and(eq(categories.id, input.categoryId), eq(categories.householdId, session.householdId)),
    )
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

  let fx;
  try {
    fx = await getFxRate({ date: input.date });
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

  const original = new Decimal(input.amountOriginal);
  const amountUsd =
    input.currencyOriginal === 'USD' ? toMoneyString(original) : toMoneyString(original.div(fx.rate));
  const amountArs =
    input.currencyOriginal === 'ARS' ? toMoneyString(original) : toMoneyString(original.mul(fx.rate));
  const fxRateUsed = fx.rate.toFixed(6, Decimal.ROUND_HALF_UP);

  try {
    const [inserted] = await db
      .insert(transactions)
      .values({
        householdId: session.householdId,
        date: input.date,
        accountId: input.accountId,
        categoryId: input.categoryId,
        kind: input.kind,
        transactionSubtype: 'standard',
        amountOriginal: toMoneyString(original),
        currencyOriginal: input.currencyOriginal,
        amountUsd,
        amountArs,
        fxRateUsed,
        fxRateSource: fx.source,
        description: input.description,
        notes: input.notes,
        source: 'manual',
        createdBy: session.userId,
      })
      .returning({ id: transactions.id });

    if (!inserted) return { ok: false, error: 'unknown' };

    revalidatePath('/transactions');
    return { ok: true, id: inserted.id };
  } catch (err) {
    console.error('[transactions] create failed', { code: (err as { code?: string }).code });
    return { ok: false, error: 'unknown' };
  }
}
