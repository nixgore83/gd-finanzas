import { notFound, redirect } from 'next/navigation';
import { and, asc, eq } from 'drizzle-orm';
import Decimal from 'decimal.js';
import { z } from 'zod';
import { getDb } from '@/lib/db/client';
import { accounts, categories, tags, transactionTags, transactions } from '@/db/schema';
import { requireHouseholdSession, SessionError } from '@/lib/auth/session';
import { updateTransaction } from '@/app/actions/transactions/update';
import { updateTransfer } from '@/app/actions/transactions/update-transfer';
import { TransactionForm } from '../transaction-form';
import { TransferForm } from '../transfer-form';
import { DeleteTransactionButton } from '../delete-button';

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

  const accountRows = await db
    .select({ id: accounts.id, name: accounts.name, currencyDefault: accounts.currencyDefault })
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
    if (!tx.transferPairId) redirect('/transactions');

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
  const categoryRows = await db
    .select({ id: categories.id, name: categories.name, kind: categories.kind })
    .from(categories)
    .where(and(eq(categories.householdId, session.householdId), eq(categories.archived, false)))
    .orderBy(asc(categories.name));

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
        }}
        initialFxInfo={{ fxRateUsed: tx.fxRateUsed, fxRateSource: tx.fxRateSource }}
      />

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
