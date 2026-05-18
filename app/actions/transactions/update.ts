'use server';

import { revalidatePath } from 'next/cache';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { getDb } from '@/lib/db/client';
import { transactions, transactionTags } from '@/db/schema';
import { parseTransactionFormData } from '@/lib/schemas/transaction';
import { requireHouseholdSession, SessionError } from '@/lib/auth/session';
import { buildTransactionFields, validateTagIds } from './_build';

export type UpdateTransactionResult =
  | { ok: true; id: string }
  | {
      ok: false;
      error:
        | 'invalid_input'
        | 'invalid_id'
        | 'invalid_refs'
        | 'fx_unavailable'
        | 'not_found'
        | 'session'
        | 'unknown';
      fields?: Record<string, string>;
    };

const idSchema = z.string().uuid();

export async function updateTransaction(formData: FormData): Promise<UpdateTransactionResult> {
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

  const parsed = parseTransactionFormData(formData);
  if (!parsed.success) {
    const fields: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const key = String(issue.path[0] ?? '_');
      fields[key] ??= issue.message;
    }
    return { ok: false, error: 'invalid_input', fields };
  }

  const built = await buildTransactionFields(parsed.data, session.householdId);
  if (!built.ok) return { ok: false, error: built.error, fields: built.fields };

  const tagsCheck = await validateTagIds(parsed.data.tagIds, session.householdId);
  if (!tagsCheck.ok) return { ok: false, error: 'invalid_refs', fields: tagsCheck.fields };

  const db = getDb();
  try {
    const updatedId = await db.transaction(async (tx) => {
      const result = await tx
        .update(transactions)
        .set(built.fields)
        .where(and(eq(transactions.id, id), eq(transactions.householdId, session.householdId)))
        .returning({ id: transactions.id });

      if (result.length === 0) return null;

      // Replace tags: borra todo y reinserta. Más simple que diffing.
      await tx.delete(transactionTags).where(eq(transactionTags.transactionId, id));
      if (parsed.data.tagIds.length > 0) {
        await tx
          .insert(transactionTags)
          .values(parsed.data.tagIds.map((tagId) => ({ transactionId: id, tagId })));
      }

      return id;
    });

    if (!updatedId) return { ok: false, error: 'not_found' };

    revalidatePath('/transactions');
    revalidatePath(`/transactions/${id}`);
    return { ok: true, id };
  } catch (err) {
    console.error('[transactions] update failed', { code: (err as { code?: string }).code });
    return { ok: false, error: 'unknown' };
  }
}
