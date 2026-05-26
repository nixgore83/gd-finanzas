'use server';

import { revalidatePath } from 'next/cache';
import { getDb } from '@/lib/db/client';
import { transactions, transactionTags } from '@/db/schema';
import { parseTransactionFormData } from '@/lib/schemas/transaction';
import { requireHouseholdSession, SessionError } from '@/lib/auth/session';
import { buildTransactionFields, validateTagIds } from './_build';
import { getAutoMatchEnabled, tryAutoMatch, type AutoMatchResult } from '@/lib/forecasts/auto-match';

export type CreateTransactionResult =
  | { ok: true; id: string; autoMatch?: AutoMatchResult }
  | {
      ok: false;
      error: 'invalid_input' | 'invalid_refs' | 'fx_unavailable' | 'session' | 'unknown';
      fields?: Record<string, string>;
    };

export async function createTransaction(formData: FormData): Promise<CreateTransactionResult> {
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

  const autoMatchEnabled = await getAutoMatchEnabled(session.householdId);

  const db = getDb();
  try {
    let autoMatch: AutoMatchResult = { matched: false };

    const id = await db.transaction(async (tx) => {
      const [inserted] = await tx
        .insert(transactions)
        .values({
          householdId: session.householdId,
          ...built.fields,
          source: 'manual',
          createdBy: session.userId,
        })
        .returning({ id: transactions.id });

      if (!inserted) throw new Error('insert returned no row');

      if (parsed.data.tagIds.length > 0) {
        await tx
          .insert(transactionTags)
          .values(parsed.data.tagIds.map((tagId) => ({ transactionId: inserted.id, tagId })));
      }

      if (autoMatchEnabled) {
        try {
          autoMatch = await tryAutoMatch(tx, inserted.id, session.householdId);
        } catch (err) {
          console.error('[transactions] auto-match failed (non-fatal)', err);
        }
      }

      return inserted.id;
    });

    revalidatePath('/transactions');
    if (autoMatch.matched) {
      revalidatePath('/forecasts');
    }
    return { ok: true, id, autoMatch };
  } catch (err) {
    console.error('[transactions] create failed', { code: (err as { code?: string }).code });
    return { ok: false, error: 'unknown' };
  }
}
