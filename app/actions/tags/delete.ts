'use server';

import { revalidatePath } from 'next/cache';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { getDb } from '@/lib/db/client';
import { tags } from '@/db/schema';
import { requireHouseholdSession, SessionError } from '@/lib/auth/session';

export type DeleteTagResult =
  | { ok: true }
  | { ok: false; error: 'invalid_id' | 'not_found' | 'session' | 'unknown' };

const idSchema = z.string().uuid();

/**
 * Hard delete. La FK en `transaction_tags` tiene ON DELETE CASCADE, así que
 * los links a transacciones se limpian automáticamente.
 */
export async function deleteTag(formData: FormData): Promise<DeleteTagResult> {
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

  const db = getDb();
  try {
    const result = await db
      .delete(tags)
      .where(and(eq(tags.id, id), eq(tags.householdId, session.householdId)))
      .returning({ id: tags.id });

    if (result.length === 0) return { ok: false, error: 'not_found' };

    revalidatePath('/tags');
    revalidatePath('/transactions');
    return { ok: true };
  } catch (err) {
    console.error('[tags] delete failed', { code: (err as { code?: string }).code });
    return { ok: false, error: 'unknown' };
  }
}
