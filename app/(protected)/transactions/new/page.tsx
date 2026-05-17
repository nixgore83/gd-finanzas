import Link from 'next/link';
import { redirect } from 'next/navigation';
import { and, asc, eq } from 'drizzle-orm';
import { getDb } from '@/lib/db/client';
import { accounts, categories } from '@/db/schema';
import { requireHouseholdSession, SessionError } from '@/lib/auth/session';
import { createTransaction } from '@/app/actions/transactions/create';
import { Button } from '@/components/ui/button';
import { TransactionForm } from '../transaction-form';

export const metadata = {
  title: 'Nueva transacción · gd-finanzas',
};

export default async function NewTransactionPage() {
  let session;
  try {
    session = await requireHouseholdSession();
  } catch (err) {
    if (err instanceof SessionError) redirect('/login');
    throw err;
  }

  const db = getDb();

  const accountRows = await db
    .select({
      id: accounts.id,
      name: accounts.name,
      currencyDefault: accounts.currencyDefault,
    })
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

  if (accountRows.length === 0) {
    return (
      <EmptyState
        title="Necesitás una cuenta primero"
        body='Cargá al menos una cuenta antes de registrar transacciones.'
        cta={{ href: '/accounts/new', label: 'Crear cuenta' }}
      />
    );
  }

  if (categoryRows.length === 0) {
    return (
      <EmptyState
        title="No hay categorías cargadas"
        body='Corré `npm run db:seed:categories-placeholder` para crear las placeholder, o esperá a la sesión de taxonomía.'
        cta={{ href: '/transactions', label: 'Volver' }}
      />
    );
  }

  return (
    <div className="mx-auto max-w-xl">
      <TransactionForm
        accounts={accountRows}
        categories={categoryRows}
        action={createTransaction}
        submitLabel="Crear transacción"
        title="Nueva transacción"
        description="Registrá un ingreso o un gasto."
      />
    </div>
  );
}

function EmptyState({
  title,
  body,
  cta,
}: {
  title: string;
  body: string;
  cta: { href: string; label: string };
}) {
  return (
    <div className="mx-auto max-w-xl space-y-4 rounded-md border border-dashed p-8 text-center">
      <h2 className="text-lg font-medium">{title}</h2>
      <p className="text-sm text-muted-foreground">{body}</p>
      <Button asChild>
        <Link href={cta.href}>{cta.label}</Link>
      </Button>
    </div>
  );
}
