'use server';

import { revalidatePath } from 'next/cache';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { getDb } from '@/lib/db/client';
import { accounts } from '@/db/schema';
import { requireHouseholdSession, SessionError } from '@/lib/auth/session';

const inputSchema = z.object({
  accountId: z.string().uuid(),
  gmailLabelId: z.string().max(100).nullable(),
});

export type SaveLabelMappingResult =
  | { ok: true }
  | { ok: false; error: 'session' | 'invalid_input' | 'not_found' | 'unknown' };

export async function saveLabelMapping(input: {
  accountId: string;
  gmailLabelId: string | null;
}): Promise<SaveLabelMappingResult> {
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
      .update(accounts)
      .set({ gmailLabelId: parsed.data.gmailLabelId })
      .where(
        and(
          eq(accounts.id, parsed.data.accountId),
          eq(accounts.householdId, session.householdId),
        ),
      )
      .returning({ id: accounts.id });

    if (result.length === 0) return { ok: false, error: 'not_found' };

    revalidatePath('/settings/gmail');
    return { ok: true };
  } catch (err) {
    console.error('[gmail] save-label-mapping failed', {
      code: (err as { code?: string }).code,
    });
    return { ok: false, error: 'unknown' };
  }
}
