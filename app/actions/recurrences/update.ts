'use server';

import { revalidatePath } from 'next/cache';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { getDb } from '@/lib/db/client';
import { accounts, categories, recurrences } from '@/db/schema';
import { parseRecurrenceFormData } from '@/lib/schemas/recurrence';
import { requireHouseholdSession, SessionError } from '@/lib/auth/session';
import { syncForecasts, todayIso } from './_sync';

export type UpdateRecurrenceResult =
  | { ok: true; id: string }
  | {
      ok: false;
      error: 'invalid_input' | 'invalid_id' | 'invalid_refs' | 'not_found' | 'session' | 'unknown';
      fields?: Record<string, string>;
    };

const idSchema = z.string().uuid();

export async function updateRecurrence(formData: FormData): Promise<UpdateRecurrenceResult> {
  const idParsed = idSchema.safeParse(formData.get('id'));
  if (!idParsed.success) return { ok: false, error: 'invalid_id' };
  const id = idParsed.data;

  let session;
  try {
    session = await requireHouseholdSession();
  } catch (err) {
    if (err instanceof SessionError) return { ok: false, error: 'session' };
    throw err;
  }

  const parsed = parseRecurrenceFormData(formData);
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
    .where(and(eq(categories.id, input.categoryId), eq(categories.householdId, session.householdId)))
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

  const now = todayIso();
  try {
    const updatedId = await db.transaction(async (tx) => {
      const result = await tx
        .update(recurrences)
        .set({
          name: input.name,
          accountId: input.accountId,
          categoryId: input.categoryId,
          kind: input.kind,
          amount: input.amount,
          currency: input.currency,
          frequency: input.frequency,
          dayOfMonth: input.dayOfMonth,
          startDate: input.startDate,
          endDate: input.endDate,
          active: input.active,
        })
        .where(and(eq(recurrences.id, id), eq(recurrences.householdId, session.householdId)))
        .returning({ id: recurrences.id });

      if (result.length === 0) return null;
      await syncForecasts(tx, id, input, now);
      return id;
    });

    if (!updatedId) return { ok: false, error: 'not_found' };

    revalidatePath('/recurrences');
    revalidatePath(`/recurrences/${id}`);
    return { ok: true, id };
  } catch (err) {
    console.error('[recurrences] update failed', { code: (err as { code?: string }).code });
    return { ok: false, error: 'unknown' };
  }
}
