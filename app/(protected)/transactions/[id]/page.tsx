import { notFound, redirect } from 'next/navigation';
import { and, asc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { getDb } from '@/lib/db/client';
import { accounts, categories, transactions } from '@/db/schema';
import { requireHouseholdSession, SessionError } from '@/lib/auth/session';
import { updateTransaction } from '@/app/actions/transactions/update';
import { TransactionForm } from '../transaction-form';
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
  if (tx.kind === 'transfer') {
    // 3.A/3.B no editan transfers. El form solo soporta income/expense.
    redirect('/transactions');
  }

  const accountRows = await db
    .select({ id: accounts.id, name: accounts.name, currencyDefault: accounts.currencyDefault })
    .from(accounts)
    .where(and(eq(accounts.householdId, session.householdId), eq(accounts.archived, false)))
    .orderBy(asc(accounts.name));

  const categoryRows = await db
    .select({ id: categories.id, name: categories.name, kind: categories.kind })
    .from(categories)
    .where(
      and(eq(categories.householdId, session.householdId), eq(categories.archived, false)),
    )
    .orderBy(asc(categories.name));

  return (
    <div className="mx-auto max-w-xl space-y-4">
      <TransactionForm
        accounts={accountRows}
        categories={categoryRows}
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
