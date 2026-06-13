'use server';

import { revalidatePath } from 'next/cache';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { getDb } from '@/lib/db/client';
import { accounts, accountSkippedMonths } from '@/db/schema';
import { requireHouseholdSession, SessionError } from '@/lib/auth/session';

const inputSchema = z.object({
  accountId: z.string().uuid(),
  yearMonth: z.string().regex(/^\d{4}-\d{2}$/, 'formato YYYY-MM'),
});

export type SkipMonthResult =
  | { ok: true }
  | { ok: false; error: 'session' | 'invalid_input' | 'not_found' | 'unknown' };

async function resolveAccount(accountId: string, householdId: string) {
  const db = getDb();
  const [acc] = await db
    .select({ id: accounts.id })
    .from(accounts)
    .where(and(eq(accounts.id, accountId), eq(accounts.householdId, householdId)))
    .limit(1);
  return acc;
}

/**
 * Marca un mes como "sin movimientos" para una cuenta → desaparece de los
 * "resúmenes faltantes" (`detectImportGaps`). Permite cuentas con actividad
 * esporádica sin que el sistema las marque como pendientes falsas.
 */
export async function markMonthNoMovements(input: {
  accountId: string;
  yearMonth: string;
}): Promise<SkipMonthResult> {
  let session;
  try {
    session = await requireHouseholdSession();
  } catch (err) {
    if (err instanceof SessionError) return { ok: false, error: 'session' };
    throw err;
  }

  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'invalid_input' };

  const acc = await resolveAccount(parsed.data.accountId, session.householdId);
  if (!acc) return { ok: false, error: 'not_found' };

  try {
    await getDb()
      .insert(accountSkippedMonths)
      .values({
        householdId: session.householdId,
        accountId: parsed.data.accountId,
        yearMonth: parsed.data.yearMonth,
        createdBy: session.userId,
      })
      .onConflictDoNothing();
    revalidatePath('/imports');
    revalidatePath('/pendientes');
    return { ok: true };
  } catch (err) {
    console.error('[imports] mark-month-no-movements failed', {
      code: (err as { code?: string }).code,
    });
    return { ok: false, error: 'unknown' };
  }
}

/** Revierte el marcado de un mes como "sin movimientos". */
export async function unmarkMonthNoMovements(input: {
  accountId: string;
  yearMonth: string;
}): Promise<SkipMonthResult> {
  let session;
  try {
    session = await requireHouseholdSession();
  } catch (err) {
    if (err instanceof SessionError) return { ok: false, error: 'session' };
    throw err;
  }

  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'invalid_input' };

  try {
    await getDb()
      .delete(accountSkippedMonths)
      .where(
        and(
          eq(accountSkippedMonths.householdId, session.householdId),
          eq(accountSkippedMonths.accountId, parsed.data.accountId),
          eq(accountSkippedMonths.yearMonth, parsed.data.yearMonth),
        ),
      );
    revalidatePath('/imports');
    revalidatePath('/pendientes');
    return { ok: true };
  } catch (err) {
    console.error('[imports] unmark-month-no-movements failed', {
      code: (err as { code?: string }).code,
    });
    return { ok: false, error: 'unknown' };
  }
}
