'use server';

import { revalidatePath } from 'next/cache';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { getDb } from '@/lib/db/client';
import { imports, importLines, transactions } from '@/db/schema';
import { requireHouseholdSession, SessionError } from '@/lib/auth/session';
import { parsedTxLineSchema } from '@/lib/imports/parsers/types';
import { buildTransactionFields } from '@/app/actions/transactions/_build';

export type ConfirmImportResult =
  | {
      ok: true;
      createdCount: number;
      rejectedCount: number;
      remaining: number;
      lineErrors: Array<{ lineId: string; reason: string }>;
    }
  | {
      ok: false;
      error: 'session' | 'not_found' | 'invalid_state' | 'no_account' | 'unknown';
      message?: string;
      lineErrors?: Array<{ lineId: string; reason: string }>;
    };

/**
 * Confirma un import: para cada `import_line` con status `accepted` o `edited`,
 * arma una transaction usando `buildTransactionFields` (mismo flujo que la
 * carga manual) y la inserta. Linkea `import_lines.transaction_id` y marca
 * el import como `confirmed`.
 *
 * `accountId` se pasa una sola vez por todo el import (Galicia Amex = 1
 * account). Cada línea se inserta con el mismo account.
 */
export async function confirmImport(input: {
  importId: string;
  accountId: string;
}): Promise<ConfirmImportResult> {
  let session;
  try {
    session = await requireHouseholdSession();
  } catch (err) {
    if (err instanceof SessionError) return { ok: false, error: 'session' };
    throw err;
  }

  const db = getDb();

  const [imp] = await db
    .select({ id: imports.id, status: imports.status })
    .from(imports)
    .where(and(eq(imports.id, input.importId), eq(imports.householdId, session.householdId)))
    .limit(1);

  if (!imp) return { ok: false, error: 'not_found' };
  if (imp.status !== 'parsed' && imp.status !== 'reviewing' && imp.status !== 'confirmed') {
    return { ok: false, error: 'invalid_state' };
  }

  // Líneas a procesar: solo accepted/edited y SIN transaction_id aún (idempotente
  // — re-ejecutar el confirm no duplica las que ya se crearon).
  const linesToProcess = await db
    .select({
      id: importLines.id,
      parsedData: importLines.parsedData,
      proposedCategoryId: importLines.proposedCategoryId,
      status: importLines.status,
    })
    .from(importLines)
    .where(
      and(
        eq(importLines.importId, input.importId),
        inArray(importLines.status, ['accepted', 'edited']),
        isNull(importLines.transactionId),
      ),
    );

  if (linesToProcess.length === 0) {
    return { ok: false, error: 'invalid_state', message: 'No hay líneas pendientes de confirmar' };
  }

  const lineErrors: Array<{ lineId: string; reason: string }> = [];
  let createdCount = 0;

  try {
    await db.transaction(async (tx) => {
      for (const line of linesToProcess) {
        const parsed = parsedTxLineSchema.safeParse(line.parsedData);
        if (!parsed.success) {
          lineErrors.push({ lineId: line.id, reason: 'parsed_data inválida' });
          continue;
        }
        if (!line.proposedCategoryId) {
          lineErrors.push({ lineId: line.id, reason: 'sin categoría asignada' });
          continue;
        }

        const built = await buildTransactionFields(
          {
            date: parsed.data.date,
            accountId: input.accountId,
            categoryId: line.proposedCategoryId,
            kind: parsed.data.kind,
            amountOriginal: parsed.data.amountOriginal,
            currencyOriginal: parsed.data.currencyOriginal,
            description: parsed.data.description,
            notes: parsed.data.notes ?? null,
            fxRateOverride: null,
            tagIds: [],
            transactionSubtype: 'standard',
            deducibleGanancias: false,
            meta: null,
          },
          session.householdId,
        );

        if (!built.ok) {
          lineErrors.push({
            lineId: line.id,
            reason: Object.values(built.fields).join('; '),
          });
          continue;
        }

        const [txRow] = await tx
          .insert(transactions)
          .values({
            ...built.fields,
            householdId: session.householdId,
            source: 'import',
            importBatchId: input.importId,
            createdBy: session.userId,
          })
          .returning({ id: transactions.id });

        if (!txRow) {
          lineErrors.push({ lineId: line.id, reason: 'insert sin row' });
          continue;
        }

        await tx
          .update(importLines)
          .set({ transactionId: txRow.id })
          .where(
            and(
              eq(importLines.id, line.id),
              eq(importLines.importId, input.importId),
            ),
          );
        createdCount += 1;
      }

      // Después de procesar, contar cuántas líneas aceptadas siguen sin transaction_id.
      // Si quedan sin confirmar, el import permanece en 'reviewing' para que el user pueda
      // arreglar y reintentar (no se "cierra" con éxitos parciales).
      const remaining = await tx
        .select({ id: importLines.id })
        .from(importLines)
        .where(
          and(
            eq(importLines.importId, input.importId),
            inArray(importLines.status, ['accepted', 'edited']),
            isNull(importLines.transactionId),
          ),
        );
      const totalLinked = await tx
        .select({ id: importLines.id })
        .from(importLines)
        .where(
          and(
            eq(importLines.importId, input.importId),
            inArray(importLines.status, ['accepted', 'edited']),
          ),
        );
      const linkedCount = totalLinked.length - remaining.length;
      if (linkedCount > 0 && remaining.length === 0) {
        // Todo OK → cerramos como confirmed.
        await tx
          .update(imports)
          .set({
            status: 'confirmed',
            confirmedAt: sql`now()`,
            transactionCount: linkedCount,
            errorMessage: null,
          })
          .where(and(eq(imports.id, input.importId), eq(imports.householdId, session.householdId)));
      } else if (linkedCount > 0) {
        // Éxito parcial → status='reviewing' para seguir editando.
        await tx
          .update(imports)
          .set({
            status: 'reviewing',
            transactionCount: linkedCount,
            errorMessage: `${linkedCount} confirmadas, ${remaining.length} pendientes con error`,
          })
          .where(and(eq(imports.id, input.importId), eq(imports.householdId, session.householdId)));
      } else {
        // 0 confirmadas en esta corrida → quedar en reviewing si veníamos de parsed,
        // o no tocar si ya estaba reviewing.
        await tx
          .update(imports)
          .set({
            status: 'reviewing',
            errorMessage: `${remaining.length} líneas con error`,
          })
          .where(and(eq(imports.id, input.importId), eq(imports.householdId, session.householdId)));
      }
    });
  } catch (err) {
    console.error('[imports] confirm failed', { code: (err as { code?: string }).code });
    return { ok: false, error: 'unknown' };
  }

  revalidatePath(`/imports/${input.importId}`);
  revalidatePath('/imports');
  revalidatePath('/transactions');

  return {
    ok: true,
    createdCount,
    rejectedCount: lineErrors.length,
    remaining: lineErrors.length,
    lineErrors,
  };
}
