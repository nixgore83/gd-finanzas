'use server';

import { revalidatePath } from 'next/cache';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { getDb } from '@/lib/db/client';
import { accounts } from '@/db/schema';
import { requireHouseholdSession, SessionError } from '@/lib/auth/session';

export type SetArchivedResult =
  | { ok: true }
  | { ok: false; error: 'invalid_input' | 'not_found' | 'session' | 'unknown' };

const inputSchema = z.object({
  id: z.string().uuid(),
  archived: z.union([z.literal('true'), z.literal('false')]).transform((v) => v === 'true'),
});

export async function setAccountArchived(formData: FormData): Promise<SetArchivedResult> {
  const parsed = inputSchema.safeParse({
    id: formData.get('id'),
    archived: formData.get('archived'),
  });
  if (!parsed.success) return { ok: false, error: 'invalid_input' };

  let session;
  try {
    session = await requireHouseholdSession();
  } catch (err) {
    if (err instanceof SessionError) return { ok: false, error: 'session' };
    throw err;
  }

  const db = getDb();
  try {
    const result = await db
      .update(accounts)
      .set({ archived: parsed.data.archived })
      .where(and(eq(accounts.id, parsed.data.id), eq(accounts.householdId, session.householdId)))
      .returning({ id: accounts.id });

    if (result.length === 0) return { ok: false, error: 'not_found' };

    revalidatePath('/accounts');
    return { ok: true };
  } catch (err) {
    console.error('[accounts] archive failed', { code: (err as { code?: string }).code });
    return { ok: false, error: 'unknown' };
  }
}
