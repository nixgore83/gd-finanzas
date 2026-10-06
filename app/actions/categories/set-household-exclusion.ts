'use server';

import { revalidatePath } from 'next/cache';
import { and, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { getDb } from '@/lib/db/client';
import { categories } from '@/db/schema';
import { requireHouseholdSession, SessionError } from '@/lib/auth/session';

const inputSchema = z.object({
  categoryId: z.string().uuid(),
  excluded: z.boolean(),
});

export type SetHouseholdExclusionResult =
  | { ok: true }
  | { ok: false; error: 'invalid_input' | 'session' | 'not_found' | 'unknown' };

/**
 * Marca una categoría como "fuera del gasto de la casa" (Mario, Rabbit Hole,
 * Tijeritas): su gasto no cuenta para el runway, el techo mensual ni los
 * reportes de cashflow / top del dashboard.
 */
export async function setCategoryHouseholdExclusion(input: {
  categoryId: string;
  excluded: boolean;
}): Promise<SetHouseholdExclusionResult> {
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
      .set({ excludedFromHousehold: parsed.data.excluded, updatedAt: sql`now()` })
      .where(
        and(
          eq(categories.id, parsed.data.categoryId),
          eq(categories.householdId, session.householdId),
        ),
      )
      .returning({ id: categories.id });

    if (result.length === 0) return { ok: false, error: 'not_found' };

    revalidatePath('/settings/categorias');
    revalidatePath('/runway');
    revalidatePath('/dashboard');
    revalidatePath('/reports');
    return { ok: true };
  } catch (err) {
    console.error('[categories] set-household-exclusion failed', {
      code: (err as { code?: string }).code,
    });
    return { ok: false, error: 'unknown' };
  }
}
