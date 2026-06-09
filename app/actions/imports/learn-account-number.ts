'use server';

import { revalidatePath } from 'next/cache';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import { getDb } from '@/lib/db/client';
import { accounts } from '@/db/schema';
import { requireHouseholdSession, SessionError } from '@/lib/auth/session';

const inputSchema = z.object({
  accountId: z.string().uuid(),
  accountNumber: z.string().min(1).max(100),
  importId: z.string().uuid().optional(),
});

export type LearnAccountNumberResult =
  | { ok: true; updated: boolean }
  | { ok: false; error: 'session' | 'invalid_input' | 'not_found' | 'unknown' };

/**
 * "Aprende" el nº de cuenta de un extracto: lo guarda en `accounts.account_number`
 * para que imports futuros de esa cuenta se auto-sugieran. Solo escribe si la
 * cuenta NO tiene número aún (no pisa uno cargado, para evitar mapeos erróneos).
 */
export async function learnAccountNumber(input: {
  accountId: string;
  accountNumber: string;
  importId?: string;
}): Promise<LearnAccountNumberResult> {
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

  const [acc] = await db
    .select({ id: accounts.id })
    .from(accounts)
    .where(and(eq(accounts.id, parsed.data.accountId), eq(accounts.householdId, session.householdId)))
    .limit(1);
  if (!acc) return { ok: false, error: 'not_found' };

  try {
    const updated = await db
      .update(accounts)
      .set({ accountNumber: parsed.data.accountNumber, updatedAt: sql`now()` })
      .where(
        and(
          eq(accounts.id, parsed.data.accountId),
          eq(accounts.householdId, session.householdId),
          isNull(accounts.accountNumber),
        ),
      )
      .returning({ id: accounts.id });
    if (parsed.data.importId) revalidatePath(`/imports/${parsed.data.importId}`);
    revalidatePath('/accounts');
    return { ok: true, updated: updated.length > 0 };
  } catch (err) {
    console.error('[imports] learn-account-number failed', {
      code: (err as { code?: string }).code,
    });
    return { ok: false, error: 'unknown' };
  }
}
