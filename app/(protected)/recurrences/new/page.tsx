import Link from 'next/link';
import { redirect } from 'next/navigation';
import { and, asc, eq } from 'drizzle-orm';
import { getDb } from '@/lib/db/client';
import { accounts } from '@/db/schema';
import { requireHouseholdSession, SessionError } from '@/lib/auth/session';
import { loadCategoryTree } from '@/lib/categories/tree';
import { createRecurrence } from '@/app/actions/recurrences/create';
import { Button } from '@/components/ui/button';
import { RecurrenceForm } from '../recurrence-form';

export const metadata = {
  title: 'Nueva recurrencia · gd-finanzas',
};

export default async function NewRecurrencePage() {
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
      ownerTag: accounts.ownerTag,
    })
    .from(accounts)
    .where(and(eq(accounts.householdId, session.householdId), eq(accounts.archived, false)))
    .orderBy(asc(accounts.name));

  const categoryRows = await loadCategoryTree(session.householdId);

  if (accountRows.length === 0) {
    return (
      <div className="mx-auto max-w-xl space-y-4 rounded-md border border-dashed p-8 text-center">
        <h2 className="text-lg font-medium">Necesitás una cuenta primero</h2>
        <p className="text-sm text-muted-foreground">
          Cargá al menos una cuenta antes de armar recurrencias.
        </p>
        <Button asChild>
          <Link href="/accounts/new">Crear cuenta</Link>
        </Button>
      </div>
    );
  }

  if (categoryRows.length === 0) {
    return (
      <div className="mx-auto max-w-xl space-y-4 rounded-md border border-dashed p-8 text-center">
        <h2 className="text-lg font-medium">No hay categorías cargadas</h2>
        <p className="text-sm text-muted-foreground">
          Corré <code>npm run db:seed:categories</code> primero.
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-xl">
      <RecurrenceForm
        accounts={accountRows}
        categories={categoryRows}
        action={createRecurrence}
        submitLabel="Crear recurrencia"
        title="Nueva recurrencia"
        description="Genera previsiones automáticas (rolling 12 meses)."
      />
    </div>
  );
}
