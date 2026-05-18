import Link from 'next/link';
import { redirect } from 'next/navigation';
import { and, asc, eq } from 'drizzle-orm';
import { getDb } from '@/lib/db/client';
import { accounts, tags } from '@/db/schema';
import { requireHouseholdSession, SessionError } from '@/lib/auth/session';
import { createTransfer } from '@/app/actions/transactions/create-transfer';
import { Button } from '@/components/ui/button';
import { TransferForm } from '../transfer-form';

export const metadata = {
  title: 'Nueva transferencia · gd-finanzas',
};

export default async function NewTransferPage() {
  let session;
  try {
    session = await requireHouseholdSession();
  } catch (err) {
    if (err instanceof SessionError) redirect('/login');
    throw err;
  }

  const db = getDb();
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

  if (accountRows.length < 2) {
    return (
      <div className="mx-auto max-w-xl space-y-4 rounded-md border border-dashed p-8 text-center">
        <h2 className="text-lg font-medium">Necesitás al menos 2 cuentas</h2>
        <p className="text-sm text-muted-foreground">
          Las transferencias mueven plata entre cuentas; necesitás 2 o más.
        </p>
        <Button asChild>
          <Link href="/accounts/new">Crear cuenta</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-xl">
      <TransferForm
        accounts={accountRows}
        availableTags={tagRows}
        action={createTransfer}
        submitLabel="Crear transferencia"
        title="Nueva transferencia"
        description="Mover plata entre dos cuentas del household. No impacta ingreso/gasto."
      />
    </div>
  );
}
