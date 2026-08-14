'use server';

import { revalidatePath } from 'next/cache';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import { getDb } from '@/lib/db/client';
import { accounts, imports, importLines } from '@/db/schema';
import { requireHouseholdSession, SessionError } from '@/lib/auth/session';
import {
  transferAccountPatch,
  type TransferAccountBulkAction,
} from '@/lib/imports/bulk-transfer-account';

const inputSchema = z.object({
  importId: z.string().uuid(),
  lineIds: z.array(z.string().uuid()).min(1).max(500),
  /** UUID de la cuenta contraparte, o `null` para quitarla. */
  transferAccountId: z.string().uuid().nullable(),
});

export type BulkSetTransferAccountResult =
  | { ok: true; updated: number }
  | {
      ok: false;
      error: 'session' | 'invalid_input' | 'not_found' | 'same_account' | 'unknown';
    };

/**
 * Asigna (o quita) en bloque la CUENTA CONTRAPARTE de una transferencia
 * (`parsed_data.transferAccountId`) para un conjunto de import_lines. Hasta acá
 * solo se podía línea por línea, y `bulkSetTransfer` marca `isTransfer` pero
 * nunca setea la contraparte. Cada línea queda con `status='edited'`.
 *
 * Reglas (ver `lib/imports/bulk-transfer-account.ts` para la semántica del patch):
 * - Asignar contraparte implica `isTransfer: true` y limpia la categoría
 *   propuesta (las transferencias no llevan categoría), igual que `bulkSetTransfer(true)`.
 * - Quitar borra la clave del jsonb sin tocar `isTransfer`.
 * - La contraparte no puede ser la cuenta propia del import (`imports.account_id`).
 *
 * **La selección PUEDE mezclar ingresos y gastos.** A diferencia del bulk de
 * categoría, acá no hay filtro por `kind`: la contraparte es "la otra cuenta" y
 * la dirección la da el `kind` de cada línea. Ver la doc del módulo puro.
 */
export async function bulkSetTransferAccount(input: {
  importId: string;
  lineIds: string[];
  transferAccountId: string | null;
}): Promise<BulkSetTransferAccountResult> {
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

  const [imp] = await db
    .select({ id: imports.id, accountId: imports.accountId })
    .from(imports)
    .where(
      and(eq(imports.id, parsed.data.importId), eq(imports.householdId, session.householdId)),
    )
    .limit(1);
  if (!imp) return { ok: false, error: 'not_found' };

  const target = parsed.data.transferAccountId;
  if (target !== null) {
    // Una transferencia a la misma cuenta del extracto no existe.
    if (imp.accountId !== null && imp.accountId === target) {
      return { ok: false, error: 'same_account' };
    }
    const [acc] = await db
      .select({ id: accounts.id })
      .from(accounts)
      .where(and(eq(accounts.id, target), eq(accounts.householdId, session.householdId)))
      .limit(1);
    if (!acc) return { ok: false, error: 'not_found' };
  }

  const action: TransferAccountBulkAction =
    target === null ? { op: 'clear' } : { op: 'set', transferAccountId: target };
  const patch = transferAccountPatch(action);

  // `||` mergea las claves del patch sobre el jsonb existente; `- 'clave'` la
  // borra. Equivalente a los `jsonb_set` de las demás bulk actions, pero en una
  // sola pasada para un patch de varias claves.
  const merged =
    Object.keys(patch.merge).length > 0
      ? sql`${importLines.parsedData} || ${JSON.stringify(patch.merge)}::jsonb`
      : sql`${importLines.parsedData}`;
  const newParsed = patch.remove.includes('transferAccountId')
    ? sql`${merged} - 'transferAccountId'`
    : merged;

  try {
    const updated = await db
      .update(importLines)
      .set({
        parsedData: newParsed,
        // Asignar contraparte = es transferencia ⇒ sin categoría. Quitarla no
        // toca la categoría (la línea puede seguir siendo transfer).
        ...(target !== null ? { proposedCategoryId: null } : {}),
        status: 'edited',
      })
      // Sin filtro por `kind`: la mezcla income+expense es válida a propósito.
      .where(
        and(
          eq(importLines.importId, parsed.data.importId),
          inArray(importLines.id, parsed.data.lineIds),
        ),
      )
      .returning({ id: importLines.id });
    revalidatePath(`/imports/${parsed.data.importId}`);
    return { ok: true, updated: updated.length };
  } catch (err) {
    console.error('[imports] bulk-set-transfer-account failed', {
      code: (err as { code?: string }).code,
    });
    return { ok: false, error: 'unknown' };
  }
}
