'use server';

import { revalidatePath } from 'next/cache';
import { sql } from 'drizzle-orm';
import { getDb } from '@/lib/db/client';
import { budgets } from '@/db/schema';
import { parseSetBudgetFormData } from '@/lib/schemas/budget';
import { requireHouseholdSession, SessionError } from '@/lib/auth/session';
import { loadCategoryTree } from '@/lib/categories/tree';
import { leafIdsOf } from '@/lib/budgets/leaves';

export type SetBudgetResult =
  | { ok: true }
  | {
      ok: false;
      error: 'invalid_input' | 'invalid_refs' | 'session' | 'unknown';
      fields?: Record<string, string>;
    };

export async function setBudget(formData: FormData): Promise<SetBudgetResult> {
  let session;
  try {
    session = await requireHouseholdSession();
  } catch (err) {
    if (err instanceof SessionError) return { ok: false, error: 'session' };
    throw err;
  }

  const parsed = parseSetBudgetFormData(formData);
  if (!parsed.success) {
    const fields: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const key = String(issue.path[0] ?? '_');
      fields[key] ??= issue.message;
    }
    return { ok: false, error: 'invalid_input', fields };
  }
  const input = parsed.data;

  const tree = await loadCategoryTree(session.householdId);
  const exists = tree.some((c) => c.id === input.categoryId);
  if (!exists) {
    return { ok: false, error: 'invalid_refs', fields: { categoryId: 'Categoría inválida' } };
  }
  const leaves = leafIdsOf(tree);
  if (!leaves.has(input.categoryId)) {
    return {
      ok: false,
      error: 'invalid_refs',
      fields: { categoryId: 'Solo se presupuestan categorías hoja' },
    };
  }

  const db = getDb();
  try {
    await db
      .insert(budgets)
      .values({
        householdId: session.householdId,
        year: input.year,
        month: input.month,
        categoryId: input.categoryId,
        amountUsd: input.amountUsd,
      })
      .onConflictDoUpdate({
        target: [budgets.householdId, budgets.year, budgets.month, budgets.categoryId],
        set: { amountUsd: input.amountUsd, revisionAt: sql`now()` },
      });

    revalidatePath(`/budget/${input.year}`);
    return { ok: true };
  } catch (err) {
    console.error('[budgets] set failed', { code: (err as { code?: string }).code });
    return { ok: false, error: 'unknown' };
  }
}
