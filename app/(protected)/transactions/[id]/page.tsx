import { notFound, redirect } from 'next/navigation';
import { and, asc, eq } from 'drizzle-orm';
import Decimal from 'decimal.js';
import { z } from 'zod';
import { getDb } from '@/lib/db/client';
import { accounts, tags, transactionTags, transactions } from '@/db/schema';
import { requireHouseholdSession, SessionError } from '@/lib/auth/session';
import { loadCategoryTree } from '@/lib/categories/tree';
import { counterpartyFromMeta } from '@/lib/imports/parsers/types';
import { CounterpartyTag } from '@/components/transactions/counterparty-tag';
import { updateTransaction } from '@/app/actions/transactions/update';
import { updateTransfer } from '@/app/actions/transactions/update-transfer';
import { findMatchCandidates } from '@/app/actions/forecasts/_candidates';
import { findTransferLinkCandidates } from '@/app/actions/transactions/_transfer-candidates';
import { forecasts as forecastsTable, recurrences } from '@/db/schema';
import { TransactionForm } from '../transaction-form';
import { TransferForm } from '../transfer-form';
import { DeleteTransactionButton } from '../delete-button';
import { ForecastMatcher } from '../forecast-matcher';
import { TransferLinker } from '../transfer-linker';

export const metadata = {
  title: 'Editar transacción · gd-finanzas',
};

const idSchema = z.string().uuid();

type RouteParams = Promise<{ id: string }>;

export default async function EditTransactionPage({ params }: { params: RouteParams }) {
  const { id: idRaw } = await params;
  if (!idSchema.safeParse(idRaw).success) notFound();
  const id = idRaw;

  let session;
  try {
    session = await requireHouseholdSession();
  } catch (err) {
    if (err instanceof SessionError) redirect('/login');
    throw err;
  }

  const db = getDb();
  const [tx] = await db
    .select()
    .from(transactions)
    .where(and(eq(transactions.id, id), eq(transactions.householdId, session.householdId)))
    .limit(1);

  if (!tx) notFound();

  const counterparty = counterpartyFromMeta(tx.meta);

  const accountRows = await db
    .select({
      id: accounts.id,
      name: accounts.name,
      currencyDefault: accounts.currencyDefault,
      ownerTag: accounts.ownerTag,
    })
    .from(accounts)
    .where(and(eq(accounts.householdId, session.householdId), eq(accounts.archived, false)))
    .orderBy(asc(accounts.name));

  const tagRows = await db
    .select({ id: tags.id, name: tags.name, color: tags.color })
    .from(tags)
    .where(eq(tags.householdId, session.householdId))
    .orderBy(asc(tags.name));

  const currentTagIds = (
    await db
      .select({ tagId: transactionTags.tagId })
      .from(transactionTags)
      .where(eq(transactionTags.transactionId, tx.id))
  ).map((r) => r.tagId);

  if (tx.kind === 'transfer') {
    // Pata sin parear (la dejó el confirm en casos cross-currency / ambiguos):
    // en vez de redirigir, ofrecemos linkearla con su contraparte.
    if (!tx.transferPairId) {
      const candidates = await findTransferLinkCandidates(tx.id, session.householdId);
      const ownAccount = accountRows.find((a) => a.id === tx.accountId);
      const fmt = new Intl.NumberFormat('es-AR', {
        style: 'currency',
        currency: tx.currencyOriginal,
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      });
      return (
        <div className="mx-auto max-w-xl space-y-4">
          <div className="rounded-md border border-amber-300 bg-amber-50 p-4 dark:border-amber-700 dark:bg-amber-950/30">
            <h1 className="text-base font-semibold text-amber-900 dark:text-amber-200">
              Transferencia sin parear
            </h1>
            <p className="mt-1 text-sm text-amber-900/90 dark:text-amber-200/90">
              &ldquo;{tx.description}&rdquo; · {tx.date} ·{' '}
              {fmt.format(Number.parseFloat(tx.amountOriginal) || 0)}
              {ownAccount ? ` · ${ownAccount.name}` : ''}
            </p>
            <p className="mt-1 text-xs text-amber-800/80 dark:text-amber-200/70">
              Esta pata espera su contraparte (ej. el lado en USD de una compra de dólares).
              Linkeala con el movimiento del otro extracto para que no cuente doble.
            </p>
          </div>

          <TransferLinker
            transactionId={tx.id}
            candidates={candidates.map((c) => ({
              id: c.id,
              date: c.date,
              accountName: c.accountName,
              amountOriginal: c.amountOriginal,
              currencyOriginal: c.currencyOriginal,
              description: c.description,
            }))}
          />

          <div className="rounded-md border border-destructive/40 bg-destructive/5 p-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-medium">Borrar pata</p>
                <p className="text-xs text-muted-foreground">
                  Borra solo esta pata (no tiene par). Hard delete.
                </p>
              </div>
              <DeleteTransactionButton id={tx.id} variant="destructive" size="default" />
            </div>
          </div>
        </div>
      );
    }

    const legs = await db
      .select({ id: transactions.id, accountId: transactions.accountId, amountOriginal: transactions.amountOriginal })
      .from(transactions)
      .where(
        and(
          eq(transactions.householdId, session.householdId),
          eq(transactions.transferPairId, tx.transferPairId),
        ),
      );

    if (legs.length !== 2) redirect('/transactions');
    const fromLeg = legs.find((l) => l.amountOriginal.startsWith('-'));
    const toLeg = legs.find((l) => !l.amountOriginal.startsWith('-'));
    if (!fromLeg || !toLeg) redirect('/transactions');

    // amountFrom / amountTo se muestran como POSITIVOS en el form.
    // Buscamos los amount_original de cada pata para obtener su valor abs.
    const [fromRow] = await db
      .select({ amountOriginal: transactions.amountOriginal })
      .from(transactions)
      .where(and(eq(transactions.id, fromLeg.id), eq(transactions.householdId, session.householdId)))
      .limit(1);
    const [toRow] = await db
      .select({ amountOriginal: transactions.amountOriginal })
      .from(transactions)
      .where(and(eq(transactions.id, toLeg.id), eq(transactions.householdId, session.householdId)))
      .limit(1);
    if (!fromRow || !toRow) redirect('/transactions');

    const amountFromAbs = new Decimal(fromRow.amountOriginal).abs().toFixed(2);
    const amountToAbs = new Decimal(toRow.amountOriginal).abs().toFixed(2);

    return (
      <div className="mx-auto max-w-xl space-y-4">
        <TransferForm
          accounts={accountRows}
          availableTags={tagRows}
          action={updateTransfer}
          submitLabel="Guardar cambios"
          title="Editar transferencia"
          description={`Editando "${tx.description}". Las cuentas no se pueden cambiar (borrá y recreá si hace falta).`}
          hiddenId={tx.id}
          disableAccounts
          initial={{
            date: tx.date,
            accountFromId: fromLeg.accountId,
            accountToId: toLeg.accountId,
            amountFrom: amountFromAbs,
            amountTo: amountToAbs,
            description: tx.description,
            notes: tx.notes,
            tagIds: currentTagIds,
          }}
          initialFxInfo={{ fxRateUsed: tx.fxRateUsed, fxRateSource: tx.fxRateSource }}
        />

        <div className="rounded-md border border-destructive/40 bg-destructive/5 p-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-sm font-medium">Borrar transferencia</p>
              <p className="text-xs text-muted-foreground">
                Borra ambas patas del par. Hard delete, no se puede deshacer.
              </p>
            </div>
            <DeleteTransactionButton id={tx.id} variant="destructive" size="default" />
          </div>
        </div>
      </div>
    );
  }

  // income / expense
  const categoryRows = await loadCategoryTree(session.householdId);

  // Forecast linkage: si la tx está matched, mostrar bloque "Linkeada".
  // Si no, calcular candidatas y mostrar bloque "Previsiones candidatas".
  let linkedInfo: { recurrenceName: string; expectedDate: string } | null = null;
  let candidates: Awaited<ReturnType<typeof findMatchCandidates>> = [];

  if (tx.recurrenceId) {
    const [linked] = await db
      .select({
        recurrenceName: recurrences.name,
        expectedDate: forecastsTable.expectedDate,
      })
      .from(recurrences)
      .leftJoin(
        forecastsTable,
        and(
          eq(forecastsTable.recurrenceId, recurrences.id),
          eq(forecastsTable.matchedTransactionId, tx.id),
        ),
      )
      .where(eq(recurrences.id, tx.recurrenceId))
      .limit(1);
    if (linked) {
      linkedInfo = {
        recurrenceName: linked.recurrenceName,
        expectedDate: linked.expectedDate ?? tx.date,
      };
    }
  } else {
    candidates = await findMatchCandidates(tx.id, session.householdId);
  }

  return (
    <div className="mx-auto max-w-xl space-y-4">
      <TransactionForm
        accounts={accountRows}
        categories={categoryRows}
        availableTags={tagRows}
        action={updateTransaction}
        submitLabel="Guardar cambios"
        title="Editar transacción"
        description={`Editando "${tx.description}".`}
        hiddenId={tx.id}
        initial={{
          date: tx.date,
          accountId: tx.accountId,
          categoryId: tx.categoryId ?? '',
          kind: tx.kind as 'income' | 'expense',
          amountOriginal: tx.amountOriginal,
          currencyOriginal: tx.currencyOriginal,
          description: tx.description,
          notes: tx.notes,
          tagIds: currentTagIds,
          transactionSubtype: tx.transactionSubtype as 'standard' | 'domestic_service',
          deducibleGanancias: tx.deducibleGanancias,
          meta:
            tx.transactionSubtype === 'domestic_service' &&
            tx.meta &&
            typeof tx.meta === 'object'
              ? (tx.meta as {
                  empleado_nombre: string;
                  empleado_cuil: string;
                  concepto: 'sueldo' | 'aporte' | 'aguinaldo';
                  periodo: string;
                })
              : null,
        }}
        initialFxInfo={{ fxRateUsed: tx.fxRateUsed, fxRateSource: tx.fxRateSource }}
      />

      {counterparty && (
        <div className="rounded-md border border-border bg-card/40 p-4">
          <p className="mb-1.5 font-sans text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
            Contraparte
          </p>
          <CounterpartyTag counterparty={counterparty} className="text-xs" />
        </div>
      )}

      {linkedInfo ? (
        <ForecastMatcher
          mode="linked"
          transactionId={tx.id}
          recurrenceName={linkedInfo.recurrenceName}
          expectedDate={linkedInfo.expectedDate}
        />
      ) : candidates.length > 0 ? (
        <ForecastMatcher
          mode="candidates"
          transactionId={tx.id}
          candidates={candidates.map((c) => ({
            id: c.id,
            recurrenceName: c.recurrenceName,
            expectedDate: c.expectedDate,
            expectedAmount: c.expectedAmount,
            currency: c.currency,
          }))}
        />
      ) : null}

      <div className="rounded-md border border-destructive/40 bg-destructive/5 p-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-sm font-medium">Borrar transacción</p>
            <p className="text-xs text-muted-foreground">
              Hard delete. No se puede deshacer.
            </p>
          </div>
          <DeleteTransactionButton id={tx.id} variant="destructive" size="default" />
        </div>
      </div>
    </div>
  );
}
