'use server';

import { randomUUID } from 'node:crypto';
import { revalidatePath } from 'next/cache';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import { getDb } from '@/lib/db/client';
import { transactions } from '@/db/schema';
import { requireHouseholdSession, SessionError } from '@/lib/auth/session';
import { resignAmount, transferDirection } from './_build-transfer';

const inputSchema = z
  .object({ aId: z.string().uuid(), bId: z.string().uuid() })
  .refine((d) => d.aId !== d.bId, { message: 'Tienen que ser distintas' });

export type LinkTransferResult =
  | { ok: true; pairId: string }
  | {
      ok: false;
      error:
        | 'session'
        | 'invalid_input'
        | 'not_found'
        | 'already_paired'
        | 'same_account'
        | 'same_direction'
        | 'forecast_linked'
        | 'unknown';
    };

/**
 * Linkea dos transacciones existentes como un par de transferencia. Caso de uso:
 * compra de USD (pata ARS de un extracto ↔ pata USD del otro) y cualquier
 * traspaso de doble lado que el confirm dejó sin parear. Convierte ambas a
 * `kind='transfer'` (sin categoría), re-signa montos (salida negativa, entrada
 * positiva) conservando cada moneda/monto (cross-currency OK), y comparte un
 * `transfer_pair_id`. No recalcula FX: cada pata mantiene su conversión original.
 */
export async function linkAsTransfer(input: {
  aId: string;
  bId: string;
}): Promise<LinkTransferResult> {
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
  const rows = await db
    .select({
      id: transactions.id,
      kind: transactions.kind,
      accountId: transactions.accountId,
      amountOriginal: transactions.amountOriginal,
      amountUsd: transactions.amountUsd,
      amountArs: transactions.amountArs,
      transferPairId: transactions.transferPairId,
      recurrenceId: transactions.recurrenceId,
    })
    .from(transactions)
    .where(
      and(
        eq(transactions.householdId, session.householdId),
        inArray(transactions.id, [parsed.data.aId, parsed.data.bId]),
      ),
    );

  const a = rows.find((r) => r.id === parsed.data.aId);
  const b = rows.find((r) => r.id === parsed.data.bId);
  if (!a || !b) return { ok: false, error: 'not_found' };
  if (a.accountId === b.accountId) return { ok: false, error: 'same_account' };
  if (a.transferPairId || b.transferPairId) return { ok: false, error: 'already_paired' };
  // Para no romper el matching de previsiones, no convertimos tx ya linkeadas a forecast.
  if (a.recurrenceId || b.recurrenceId) return { ok: false, error: 'forecast_linked' };

  const dirA = transferDirection(a.kind, a.amountOriginal);
  const dirB = transferDirection(b.kind, b.amountOriginal);
  if (dirA === dirB) return { ok: false, error: 'same_direction' };

  const pairId = randomUUID();
  try {
    await db.transaction(async (tx) => {
      for (const [row, dir] of [
        [a, dirA] as const,
        [b, dirB] as const,
      ]) {
        await tx
          .update(transactions)
          .set({
            kind: 'transfer',
            categoryId: null,
            transferPairId: pairId,
            amountOriginal: resignAmount(row.amountOriginal, dir),
            amountUsd: resignAmount(row.amountUsd, dir),
            amountArs: resignAmount(row.amountArs, dir),
            updatedAt: sql`now()`,
          })
          .where(
            and(eq(transactions.id, row.id), eq(transactions.householdId, session.householdId)),
          );
      }
    });
  } catch (err) {
    console.error('[transactions] link-transfer failed', {
      code: (err as { code?: string }).code,
    });
    return { ok: false, error: 'unknown' };
  }

  revalidatePath('/transactions');
  revalidatePath('/patrimonio');
  return { ok: true, pairId };
}
