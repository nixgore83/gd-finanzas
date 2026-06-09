'use server';

import { revalidatePath } from 'next/cache';
import { and, eq, inArray, isNotNull, isNull, sql } from 'drizzle-orm';
import { getDb } from '@/lib/db/client';
import { accounts, imports, importLines, transactions } from '@/db/schema';
import { requireHouseholdSession, SessionError } from '@/lib/auth/session';
import { parsedTxLineSchema } from '@/lib/imports/parsers/types';
import { buildTransactionFields } from '@/app/actions/transactions/_build';
import { buildTransferFields } from '@/app/actions/transactions/_build-transfer';
import { getAutoMatchEnabled, tryAutoMatch } from '@/lib/forecasts/auto-match';

export type ConfirmImportResult =
  | {
      ok: true;
      createdCount: number;
      rejectedCount: number;
      remaining: number;
      autoMatchCount: number;
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
    .select({
      id: imports.id,
      status: imports.status,
      statementAccountRef: imports.statementAccountRef,
    })
    .from(imports)
    .where(and(eq(imports.id, input.importId), eq(imports.householdId, session.householdId)))
    .limit(1);

  if (!imp) return { ok: false, error: 'not_found' };
  if (imp.status !== 'parsed' && imp.status !== 'reviewing' && imp.status !== 'confirmed') {
    return { ok: false, error: 'invalid_state' };
  }

  // "Aprender" el nº de cuenta del extracto en la cuenta destino, si la cuenta
  // todavía no lo tiene (red de seguridad por si no se aprendió en la revisión).
  if (imp.statementAccountRef && input.accountId) {
    await db
      .update(accounts)
      .set({ accountNumber: imp.statementAccountRef })
      .where(
        and(
          eq(accounts.id, input.accountId),
          eq(accounts.householdId, session.householdId),
          isNull(accounts.accountNumber),
        ),
      );
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
    // Check if all lines are already resolved (confirmed + rejected, 0 pending).
    // If so, close the import.
    const unresolved = await db
      .select({ id: importLines.id })
      .from(importLines)
      .where(
        and(
          eq(importLines.importId, input.importId),
          inArray(importLines.status, ['pending']),
        ),
      )
      .limit(1);

    if (unresolved.length === 0) {
      const linked = await db
        .select({ id: importLines.id })
        .from(importLines)
        .where(
          and(
            eq(importLines.importId, input.importId),
            isNotNull(importLines.transactionId),
          ),
        );

      await db
        .update(imports)
        .set({
          status: 'confirmed',
          confirmedAt: sql`now()`,
          transactionCount: linked.length,
          errorMessage: null,
          ...(input.accountId ? { accountId: input.accountId } : {}),
        })
        .where(and(eq(imports.id, input.importId), eq(imports.householdId, session.householdId)));

      revalidatePath(`/imports/${input.importId}`);
      revalidatePath('/imports');
      return { ok: true, createdCount: 0, rejectedCount: 0, remaining: 0, autoMatchCount: 0, lineErrors: [] };
    }

    return { ok: false, error: 'invalid_state', message: 'No hay líneas pendientes de confirmar' };
  }

  const lineErrors: Array<{ lineId: string; reason: string }> = [];
  let createdCount = 0;
  let autoMatchCount = 0;
  const autoMatchEnabled = await getAutoMatchEnabled(session.householdId);

  try {
    await db.transaction(async (tx) => {
      for (const line of linesToProcess) {
        const parsed = parsedTxLineSchema.safeParse(line.parsedData);
        if (!parsed.success) {
          lineErrors.push({ lineId: line.id, reason: 'parsed_data inválida' });
          continue;
        }

        // Identificadores de contraparte (ordenante/beneficiario) extraídos por
        // el parser → se persisten en transactions.meta.counterparty. Decisión
        // documentada en CLAUDE.md (excepción a la regla de no almacenar sensibles).
        const cpMeta: Record<string, unknown> = parsed.data.counterparty
          ? { counterparty: parsed.data.counterparty }
          : {};

        // ===== TRANSFER BRANCH =====
        if (parsed.data.isTransfer) {
          const transferAccountId = parsed.data.transferAccountId;
          if (!transferAccountId) {
            lineErrors.push({ lineId: line.id, reason: 'transfer sin cuenta contraparte' });
            continue;
          }

          // Determine from/to based on kind (from the perspective of the import account)
          const isOutgoing = parsed.data.kind === 'expense';
          const accountFromId = isOutgoing ? input.accountId : transferAccountId;
          const accountToId = isOutgoing ? transferAccountId : input.accountId;

          const transferResult = await buildTransferFields(
            {
              date: parsed.data.date,
              accountFromId,
              accountToId,
              amountFrom: parsed.data.amountOriginal,
              amountTo: parsed.data.amountOriginal,
              description: parsed.data.description,
              notes: parsed.data.notes ?? null,
              fxRateOverride: null,
              tagIds: [],
            },
            session.householdId,
          );

          if (!transferResult.ok) {
            lineErrors.push({
              lineId: line.id,
              reason: Object.values(transferResult.fields).join('; '),
            });
            continue;
          }

          // Insert both legs
          const [fromRow] = await tx
            .insert(transactions)
            .values({
              ...transferResult.fromLeg,
              householdId: session.householdId,
              source: 'import',
              importBatchId: input.importId,
              transactionSubtype: 'standard',
              deducibleGanancias: false,
              meta: cpMeta,
              createdBy: session.userId,
            })
            .returning({ id: transactions.id });

          const [toRow] = await tx
            .insert(transactions)
            .values({
              ...transferResult.toLeg,
              householdId: session.householdId,
              source: 'import',
              importBatchId: input.importId,
              transactionSubtype: 'standard',
              deducibleGanancias: false,
              meta: cpMeta,
              createdBy: session.userId,
            })
            .returning({ id: transactions.id });

          if (!fromRow || !toRow) {
            lineErrors.push({ lineId: line.id, reason: 'insert transfer sin row' });
            continue;
          }

          // Link the import line to the "main" leg (the one matching the import account)
          const mainTxId = isOutgoing ? fromRow.id : toRow.id;
          await tx
            .update(importLines)
            .set({ transactionId: mainTxId })
            .where(
              and(
                eq(importLines.id, line.id),
                eq(importLines.importId, input.importId),
              ),
            );
          createdCount += 1;
          continue;
        }

        // ===== REGULAR INCOME/EXPENSE BRANCH =====
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
            meta: { ...built.fields.meta, ...cpMeta },
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

        if (autoMatchEnabled) {
          try {
            const match = await tryAutoMatch(tx, txRow.id, session.householdId);
            if (match.matched) autoMatchCount += 1;
          } catch (err) {
            console.error('[imports] auto-match failed (non-fatal)', err);
          }
        }
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
            ...(input.accountId ? { accountId: input.accountId } : {}),
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
            ...(input.accountId ? { accountId: input.accountId } : {}),
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
            ...(input.accountId ? { accountId: input.accountId } : {}),
          })
          .where(and(eq(imports.id, input.importId), eq(imports.householdId, session.householdId)));
      }
    });
  } catch (err) {
    const e = err as { code?: string; message?: string };
    console.error('[imports] confirm failed', { code: e.code, message: e.message });
    return { ok: false, error: 'unknown', message: e.message };
  }

  revalidatePath(`/imports/${input.importId}`);
  revalidatePath('/imports');
  revalidatePath('/transactions');
  if (autoMatchCount > 0) {
    revalidatePath('/forecasts');
  }

  return {
    ok: true,
    createdCount,
    rejectedCount: lineErrors.length,
    remaining: lineErrors.length,
    autoMatchCount,
    lineErrors,
  };
}
