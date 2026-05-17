'use server';

import { revalidatePath } from 'next/cache';
import { and, eq, isNotNull } from 'drizzle-orm';
import { z } from 'zod';
import { getDb } from '@/lib/db/client';
import { transactions } from '@/db/schema';
import { parseTransferFormData } from '@/lib/schemas/transfer';
import { requireHouseholdSession, SessionError } from '@/lib/auth/session';
import { buildTransferFields } from './_build-transfer';

export type UpdateTransferResult =
  | { ok: true; pairId: string }
  | {
      ok: false;
      error:
        | 'invalid_input'
        | 'invalid_id'
        | 'invalid_refs'
        | 'fx_unavailable'
        | 'not_found'
        | 'mismatched_accounts'
        | 'session'
        | 'unknown';
      fields?: Record<string, string>;
    };

const idSchema = z.string().uuid();

export async function updateTransfer(formData: FormData): Promise<UpdateTransferResult> {
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
  const [existing] = await db
    .select({
      transferPairId: transactions.transferPairId,
      kind: transactions.kind,
      amountOriginal: transactions.amountOriginal,
      accountId: transactions.accountId,
    })
    .from(transactions)
    .where(and(eq(transactions.id, id), eq(transactions.householdId, session.householdId)))
    .limit(1);

  if (!existing || existing.kind !== 'transfer' || !existing.transferPairId) {
    return { ok: false, error: 'not_found' };
  }
  const pairId = existing.transferPairId;

  // Cargar ambas patas para validar que las cuentas no se intenten cambiar
  // por DevTools. En 3.C las accounts son read-only en edit.
  const legs = await db
    .select({
      id: transactions.id,
      accountId: transactions.accountId,
      amountOriginal: transactions.amountOriginal,
    })
    .from(transactions)
    .where(
      and(
        eq(transactions.householdId, session.householdId),
        eq(transactions.transferPairId, pairId),
      ),
    );

  if (legs.length !== 2) return { ok: false, error: 'not_found' };

  // amountOriginal viene como string desde numeric; "-50000.00" empieza con '-'.
  const fromLegOriginal = legs.find((l) => l.amountOriginal.startsWith('-'));
  const toLegOriginal = legs.find((l) => !l.amountOriginal.startsWith('-'));
  if (!fromLegOriginal || !toLegOriginal) return { ok: false, error: 'not_found' };

  const parsed = parseTransferFormData(formData);
  if (!parsed.success) {
    const fields: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const key = String(issue.path[0] ?? '_');
      fields[key] ??= issue.message;
    }
    return { ok: false, error: 'invalid_input', fields };
  }

  if (
    parsed.data.accountFromId !== fromLegOriginal.accountId ||
    parsed.data.accountToId !== toLegOriginal.accountId
  ) {
    return { ok: false, error: 'mismatched_accounts' };
  }

  const built = await buildTransferFields(parsed.data, session.householdId, pairId);
  if (!built.ok) return { ok: false, error: built.error, fields: built.fields };

  try {
    await db.transaction(async (tx) => {
      await tx
        .delete(transactions)
        .where(
          and(
            eq(transactions.householdId, session.householdId),
            eq(transactions.transferPairId, pairId),
            isNotNull(transactions.transferPairId),
          ),
        );
      await tx.insert(transactions).values([
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
      ]);
    });

    revalidatePath('/transactions');
    revalidatePath(`/transactions/${id}`);
    return { ok: true, pairId };
  } catch (err) {
    console.error('[transactions] update-transfer failed', {
      code: (err as { code?: string }).code,
    });
    return { ok: false, error: 'unknown' };
  }
}
