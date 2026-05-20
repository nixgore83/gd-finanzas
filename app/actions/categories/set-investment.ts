'use server';

import { revalidatePath } from 'next/cache';
import { and, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { getDb } from '@/lib/db/client';
import { categories } from '@/db/schema';
import { requireHouseholdSession, SessionError } from '@/lib/auth/session';

const inputSchema = z.object({
  categoryId: z.string().uuid(),
  isInvestment: z.boolean(),
});

export type SetCategoryInvestmentResult =
  | { ok: true }
  | { ok: false; error: 'invalid_input' | 'session' | 'not_found' | 'unknown' };

export async function setCategoryInvestment(input: {
  categoryId: string;
  isInvestment: boolean;
}): Promise<SetCategoryInvestmentResult> {
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
  try {
    const result = await db
      .update(categories)
      .set({ isInvestment: parsed.data.isInvestment, updatedAt: sql`now()` })
      .where(
        and(
          eq(categories.id, parsed.data.categoryId),
          eq(categories.householdId, session.householdId),
        ),
      )
      .returning({ id: categories.id });

    if (result.length === 0) return { ok: false, error: 'not_found' };

    revalidatePath('/settings/categorias');
    revalidatePath('/reports/year-economy');
    return { ok: true };
  } catch (err) {
    console.error('[categories] set-investment failed', {
      code: (err as { code?: string }).code,
    });
    return { ok: false, error: 'unknown' };
  }
}
