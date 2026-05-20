'use server';

import { revalidatePath } from 'next/cache';
import { and, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import { getDb } from '@/lib/db/client';
import { categories, transactions } from '@/db/schema';
import { requireHouseholdSession, SessionError } from '@/lib/auth/session';

const inputSchema = z.object({
  ids: z.array(z.string().uuid()).min(1).max(500),
  categoryId: z.string().uuid(),
});

export type BulkSetCategoryResult =
  | { ok: true; updated: number; skipped: number }
  | {
      ok: false;
      error: 'session' | 'invalid_input' | 'not_found' | 'category_mismatch_all' | 'unknown';
    };

/**
 * Reasigna categoría en bloque. Filtra las transacciones cuyo `kind` no
 * matchea `categories.kind` y las skipea (igual patrón que el bulk de imports).
 * Transfers se ignoran porque no tienen categoría.
 */
export async function bulkSetTransactionCategory(input: {
  ids: string[];
  categoryId: string;
}): Promise<BulkSetCategoryResult> {
  let session;
  try {
    session = await requireHouseholdSession();
  } catch (err) {
    if (err instanceof SessionError) return { ok: false, error: 'session' };
    throw err;
  }

  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'invalid_input' };

  const db = getDb();

  const [cat] = await db
    .select({ id: categories.id, kind: categories.kind })
    .from(categories)
    .where(
      and(
        eq(categories.id, parsed.data.categoryId),
        eq(categories.householdId, session.householdId),
      ),
    )
    .limit(1);
  if (!cat) return { ok: false, error: 'not_found' };

  const rows = await db
    .select({ id: transactions.id, kind: transactions.kind })
    .from(transactions)
    .where(
      and(
        eq(transactions.householdId, session.householdId),
        inArray(transactions.id, parsed.data.ids),
      ),
    );

  const eligibleIds: string[] = [];
  let skipped = 0;
  for (const r of rows) {
    if (r.kind === cat.kind) eligibleIds.push(r.id);
    else skipped += 1;
  }

  if (eligibleIds.length === 0) {
    return { ok: false, error: 'category_mismatch_all' };
  }

  try {
    const updated = await db
      .update(transactions)
      .set({ categoryId: parsed.data.categoryId })
      .where(
        and(
          eq(transactions.householdId, session.householdId),
          inArray(transactions.id, eligibleIds),
        ),
      )
      .returning({ id: transactions.id });

    revalidatePath('/transactions');
    return { ok: true, updated: updated.length, skipped };
  } catch (err) {
    console.error('[transactions] bulk-set-category failed', {
      code: (err as { code?: string }).code,
    });
    return { ok: false, error: 'unknown' };
  }
}
