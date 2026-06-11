'use server';

import { randomUUID } from 'node:crypto';
import { revalidatePath } from 'next/cache';
import { and, eq, gte, inArray, isNotNull, isNull, lte, sql } from 'drizzle-orm';
import { getDb } from '@/lib/db/client';
import { accounts, forecasts, imports, importLines, recurrences, tags, transactions, transactionTags } from '@/db/schema';
import { requireHouseholdSession, SessionError } from '@/lib/auth/session';
import { parsedTxLineSchema } from '@/lib/imports/parsers/types';
import { buildTransactionFields } from '@/app/actions/transactions/_build';
import {
  buildTransferFields,
  buildSingleTransferLeg,
  selectSameCurrencyTransferMatch,
} from '@/app/actions/transactions/_build-transfer';
import { MATCH_DATE_WINDOW_DAYS } from '@/lib/forecasts/candidates';
import { getAutoMatchEnabled, tryAutoMatch } from '@/lib/forecasts/auto-match';
import { counterpartyBankRefs } from '@/lib/imports/counterparty-identity';

/** Suma `days` (puede ser negativo) a una fecha ISO 'YYYY-MM-DD'. */
function shiftIsoDate(iso: string, days: number): string {
  const ms = Date.parse(`${iso}T00:00:00Z`) + days * 86_400_000;
  return new Date(ms).toISOString().slice(0, 10);
}

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

  // Tags válidos del household, una sola vez: los tagIds de cada línea se
  // filtran contra este set (defensa ante ids ajenos/borrados).
  const householdTagRows = await db
    .select({ id: tags.id })
    .from(tags)
    .where(eq(tags.householdId, session.householdId));
  const householdTagIds = new Set(householdTagRows.map((r) => r.id));

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

        // Tags capturados en la review (válidos del household). Se aplican también
        // a transferencias: ahí el tag es el clasificador (no llevan categoría).
        const lineTagIds = (parsed.data.tagIds ?? []).filter((id) => householdTagIds.has(id));
        const insertLineTags = async (transactionId: string) => {
          if (lineTagIds.length === 0) return;
          await tx
            .insert(transactionTags)
            .values(lineTagIds.map((tagId) => ({ transactionId, tagId })))
            .onConflictDoNothing();
        };

        // ===== TRANSFER BRANCH =====
        // Estrategia "match-or-create": el otro extracto puede estar importado
        // (el otro lado ya existe como transacción). Para no duplicar, intentamos
        // PAREAR la pata propia con una pata-transfer sin parear de la contraparte
        // en vez de crear las dos patas siempre.
        //  - 1 candidato same-currency (monto+fecha) → parear (no crear sintética).
        //  - same-currency sin candidato → crear ambas patas (FCI, pago TC, cash:
        //    el otro lado no se importa). Comportamiento histórico.
        //  - cross-currency o ambiguo → crear SOLO la pata propia sin parear;
        //    se linkea a mano (no se puede matchear cross-ccy por monto).
        if (parsed.data.isTransfer) {
          const transferAccountId = parsed.data.transferAccountId;
          if (!transferAccountId) {
            lineErrors.push({ lineId: line.id, reason: 'transfer sin cuenta contraparte' });
            continue;
          }

          const isOutgoing = parsed.data.kind === 'expense';
          const ownDirection: 'out' | 'in' = isOutgoing ? 'out' : 'in';

          // Inserta la pata propia (cuenta del import) con el pairId dado (o null
          // si queda sin parear), la linkea a la import_line y devuelve su id.
          const insertOwnLeg = async (transferPairId: string | null): Promise<string | null> => {
            const own = await buildSingleTransferLeg(
              {
                date: parsed.data.date,
                accountId: input.accountId,
                amount: parsed.data.amountOriginal,
                direction: ownDirection,
                description: parsed.data.description,
                notes: parsed.data.notes ?? null,
                fxRateOverride: null,
                transferPairId,
              },
              session.householdId,
            );
            if (!own.ok) {
              lineErrors.push({
                lineId: line.id,
                reason: own.error === 'fx_unavailable' ? 'sin cotización FX' : 'cuenta inválida',
              });
              return null;
            }
            const [ownRow] = await tx
              .insert(transactions)
              .values({
                ...own.leg,
                householdId: session.householdId,
                source: 'import',
                importBatchId: input.importId,
                transactionSubtype: 'standard',
                deducibleGanancias: false,
                meta: cpMeta,
                createdBy: session.userId,
              })
              .returning({ id: transactions.id });
            if (!ownRow) {
              lineErrors.push({ lineId: line.id, reason: 'insert transfer sin row' });
              return null;
            }
            await tx
              .update(importLines)
              .set({ transactionId: ownRow.id })
              .where(and(eq(importLines.id, line.id), eq(importLines.importId, input.importId)));
            await insertLineTags(ownRow.id);
            return ownRow.id;
          };

          // Moneda de la cuenta contraparte (same-ccy vs cross-ccy) + sus refs.
          const [cpAcc] = await tx
            .select({ currency: accounts.currencyDefault, transferRefs: accounts.transferRefs })
            .from(accounts)
            .where(
              and(eq(accounts.householdId, session.householdId), eq(accounts.id, transferAccountId)),
            )
            .limit(1);
          if (!cpAcc) {
            lineErrors.push({ lineId: line.id, reason: 'cuenta contraparte inválida' });
            continue;
          }
          const sameCurrency = cpAcc.currency === parsed.data.currencyOriginal;

          // APRENDER: la contraparte (CBU/CUIT/alias) de esta línea refiere a la
          // cuenta destino elegida → guardar sus refs para auto-resolver la cuenta
          // en futuros imports (item 8 del backlog).
          const newRefs = counterpartyBankRefs(parsed.data.counterparty);
          if (newRefs.length > 0) {
            const merged = [...new Set([...(cpAcc.transferRefs ?? []), ...newRefs])];
            if (merged.length !== (cpAcc.transferRefs ?? []).length) {
              await tx
                .update(accounts)
                .set({ transferRefs: merged })
                .where(eq(accounts.id, transferAccountId));
            }
          }

          // Buscar candidato a parear en la contraparte (solo same-currency).
          // La query trae patas-transfer sin parear de la contraparte en la ventana
          // de fechas; el filtro de dirección/monto y la decisión (1 solo match) es
          // lógica pura testeable (`selectSameCurrencyTransferMatch`).
          let matchedCandidateId: string | null = null;
          if (sameCurrency) {
            const candidates = await tx
              .select({ id: transactions.id, amountOriginal: transactions.amountOriginal })
              .from(transactions)
              .where(
                and(
                  eq(transactions.householdId, session.householdId),
                  eq(transactions.accountId, transferAccountId),
                  eq(transactions.kind, 'transfer'),
                  isNull(transactions.transferPairId),
                  gte(transactions.date, shiftIsoDate(parsed.data.date, -MATCH_DATE_WINDOW_DAYS)),
                  lte(transactions.date, shiftIsoDate(parsed.data.date, MATCH_DATE_WINDOW_DAYS)),
                ),
              );
            matchedCandidateId = selectSameCurrencyTransferMatch(
              candidates,
              parsed.data.amountOriginal,
              isOutgoing,
            );
          }

          if (matchedCandidateId) {
            // PAREAR: solo pata propia + setear el pair id compartido en el candidato.
            const pairId = randomUUID();
            const ownId = await insertOwnLeg(pairId);
            if (!ownId) continue;
            await tx
              .update(transactions)
              .set({ transferPairId: pairId })
              .where(
                and(
                  eq(transactions.id, matchedCandidateId),
                  eq(transactions.householdId, session.householdId),
                ),
              );
            createdCount += 1;
            continue;
          }

          if (sameCurrency) {
            // Sin match y misma moneda → crear ambas patas (el otro lado no se importa).
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
            const mainTxId = isOutgoing ? fromRow.id : toRow.id;
            await tx
              .update(importLines)
              .set({ transactionId: mainTxId })
              .where(and(eq(importLines.id, line.id), eq(importLines.importId, input.importId)));
            await insertLineTags(mainTxId);
            createdCount += 1;
            continue;
          }

          // Cross-currency sin match → solo pata propia, sin parear (linkeo manual).
          const ownId = await insertOwnLeg(null);
          if (!ownId) continue;
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
            // Reembolso/devolución: gasto con monto NEGATIVO en la misma categoría
            // (regla de negocio §4.3). El parsed_data guarda el monto positivo + el
            // flag; acá se niega al crear la transacción (mismo modelo que el form manual).
            amountOriginal:
              parsed.data.isRefund && parsed.data.kind === 'expense'
                ? `-${parsed.data.amountOriginal}`
                : parsed.data.amountOriginal,
            currencyOriginal: parsed.data.currencyOriginal,
            description: parsed.data.description,
            notes: parsed.data.notes ?? null,
            fxRateOverride: null,
            // Captura fiscal de la review (antes hardcodeado a []/standard/false —
            // el export contador salía vacío de lo que importa).
            tagIds: lineTagIds,
            transactionSubtype:
              parsed.data.domesticService && parsed.data.kind === 'expense' && !parsed.data.isRefund
                ? 'domestic_service'
                : 'standard',
            deducibleGanancias: parsed.data.deducibleGanancias ?? false,
            meta:
              parsed.data.domesticService && parsed.data.kind === 'expense' && !parsed.data.isRefund
                ? parsed.data.domesticService
                : null,
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
        await insertLineTags(txRow.id);
        createdCount += 1;

        // Previsión elegida a mano en la review: linkear (forecast→matched +
        // tx.recurrence_id), solo si sigue pending — si otra tx la matcheó en el
        // medio, se ignora sin error. Independiente del toggle de auto-match.
        let manuallyLinked = false;
        if (parsed.data.forecastId) {
          const [fcRow] = await tx
            .select({ id: forecasts.id, recurrenceId: recurrences.id, status: forecasts.status })
            .from(forecasts)
            .innerJoin(recurrences, eq(recurrences.id, forecasts.recurrenceId))
            .where(
              and(
                eq(forecasts.id, parsed.data.forecastId),
                eq(recurrences.householdId, session.householdId),
              ),
            )
            .limit(1);
          if (fcRow && fcRow.status === 'pending') {
            await tx
              .update(forecasts)
              .set({ status: 'matched', matchedTransactionId: txRow.id })
              .where(eq(forecasts.id, fcRow.id));
            await tx
              .update(transactions)
              .set({ recurrenceId: fcRow.recurrenceId })
              .where(eq(transactions.id, txRow.id));
            autoMatchCount += 1;
            manuallyLinked = true;
          }
        }

        if (autoMatchEnabled && !manuallyLinked) {
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
