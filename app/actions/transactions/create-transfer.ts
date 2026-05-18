'use server';

import { revalidatePath } from 'next/cache';
import { getDb } from '@/lib/db/client';
import { transactions, transactionTags } from '@/db/schema';
import { parseTransferFormData } from '@/lib/schemas/transfer';
import { requireHouseholdSession, SessionError } from '@/lib/auth/session';
import { buildTransferFields } from './_build-transfer';
import { validateTagIds } from './_build';

export type CreateTransferResult =
  | { ok: true; pairId: string }
  | {
      ok: false;
      error: 'invalid_input' | 'invalid_refs' | 'fx_unavailable' | 'session' | 'unknown';
      fields?: Record<string, string>;
    };

export async function createTransfer(formData: FormData): Promise<CreateTransferResult> {
  let session;
  try {
    session = await requireHouseholdSession();
  } catch (err) {
    if (err instanceof SessionError) return { ok: false, error: 'session' };
    throw err;
  }

  const parsed = parseTransferFormData(formData);
  if (!parsed.success) {
    const fields: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const key = String(issue.path[0] ?? '_');
      fields[key] ??= issue.message;
    }
    return { ok: false, error: 'invalid_input', fields };
  }

  const built = await buildTransferFields(parsed.data, session.householdId);
  if (!built.ok) return { ok: false, error: built.error, fields: built.fields };

  const tagsCheck = await validateTagIds(parsed.data.tagIds, session.householdId);
  if (!tagsCheck.ok) return { ok: false, error: 'invalid_refs', fields: tagsCheck.fields };

  const db = getDb();
  try {
    await db.transaction(async (tx) => {
      const inserted = await tx
        .insert(transactions)
        .values([
          {
            householdId: session.householdId,
            ...built.fromLeg,
            transactionSubtype: 'standard',
            source: 'manual',
            createdBy: session.userId,
          },
          {
            householdId: session.householdId,
            ...built.toLeg,
            transactionSubtype: 'standard',
            source: 'manual',
            createdBy: session.userId,
          },
        ])
        .returning({ id: transactions.id });

      if (parsed.data.tagIds.length > 0 && inserted.length > 0) {
        // Cada tag se duplica para ambas patas — los reportes que filtren por
        // tag ven los dos lados de la transferencia consistentemente.
        const rows = inserted.flatMap((row) =>
          parsed.data.tagIds.map((tagId) => ({ transactionId: row.id, tagId })),
        );
        await tx.insert(transactionTags).values(rows);
      }
    });

    revalidatePath('/transactions');
    return { ok: true, pairId: built.pairId };
  } catch (err) {
    console.error('[transactions] create-transfer failed', {
      code: (err as { code?: string }).code,
    });
    return { ok: false, error: 'unknown' };
  }
}
