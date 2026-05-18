'use server';

import { revalidatePath } from 'next/cache';
import { and, eq } from 'drizzle-orm';
import { getDb } from '@/lib/db/client';
import { budgets } from '@/db/schema';
import { parseClearBudgetFormData } from '@/lib/schemas/budget';
import { requireHouseholdSession, SessionError } from '@/lib/auth/session';

export type ClearBudgetResult =
  | { ok: true }
  | { ok: false; error: 'invalid_input' | 'session' | 'unknown' };

export async function clearBudget(formData: FormData): Promise<ClearBudgetResult> {
  let session;
  try {
    session = await requireHouseholdSession();
  } catch (err) {
    if (err instanceof SessionError) return { ok: false, error: 'session' };
    throw err;
  }

  const parsed = parseClearBudgetFormData(formData);
  if (!parsed.success) return { ok: false, error: 'invalid_input' };
  const input = parsed.data;

  const db = getDb();
  try {
    await db
      .delete(budgets)
      .where(
        and(
          eq(budgets.householdId, session.householdId),
          eq(budgets.year, input.year),
          eq(budgets.month, input.month),
          eq(budgets.categoryId, input.categoryId),
        ),
      );
    revalidatePath(`/budget/${input.year}`);
    return { ok: true };
  } catch (err) {
    console.error('[budgets] clear failed', { code: (err as { code?: string }).code });
    return { ok: false, error: 'unknown' };
  }
}
