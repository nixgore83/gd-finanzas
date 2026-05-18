import { notFound, redirect } from 'next/navigation';
import { and, asc, eq, gte } from 'drizzle-orm';
import { z } from 'zod';
import { getDb } from '@/lib/db/client';
import { accounts, forecasts, recurrences } from '@/db/schema';
import { requireHouseholdSession, SessionError } from '@/lib/auth/session';
import { loadCategoryTree } from '@/lib/categories/tree';
import { updateRecurrence } from '@/app/actions/recurrences/update';
import { RecurrenceForm } from '../recurrence-form';
import { DeleteRecurrenceButton } from '../delete-button';

export const metadata = {
  title: 'Editar recurrencia · gd-finanzas',
};

const idSchema = z.string().uuid();

type RouteParams = Promise<{ id: string }>;

export default async function EditRecurrencePage({ params }: { params: RouteParams }) {
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
  const [rec] = await db
    .select()
    .from(recurrences)
    .where(and(eq(recurrences.id, id), eq(recurrences.householdId, session.householdId)))
    .limit(1);

  if (!rec) notFound();

  const accountRows = await db
    .select({ id: accounts.id, name: accounts.name, currencyDefault: accounts.currencyDefault })
    .from(accounts)
    .where(and(eq(accounts.householdId, session.householdId), eq(accounts.archived, false)))
    .orderBy(asc(accounts.name));

  const categoryRows = await loadCategoryTree(session.householdId);

  const today = new Date().toISOString().slice(0, 10);
  const pendingForecasts = await db
    .select({
      id: forecasts.id,
      expectedDate: forecasts.expectedDate,
      expectedAmount: forecasts.expectedAmount,
      currency: forecasts.currency,
    })
    .from(forecasts)
    .where(
      and(
        eq(forecasts.recurrenceId, rec.id),
        eq(forecasts.status, 'pending'),
        gte(forecasts.expectedDate, today),
      ),
    )
    .orderBy(asc(forecasts.expectedDate))
    .limit(12);

  return (
    <div className="mx-auto max-w-xl space-y-4">
      <RecurrenceForm
        accounts={accountRows}
        categories={categoryRows}
        action={updateRecurrence}
        submitLabel="Guardar cambios"
        title="Editar recurrencia"
        description={`Editando "${rec.name}". Las previsiones se regeneran al guardar.`}
        hiddenId={rec.id}
        initial={{
          name: rec.name,
          accountId: rec.accountId,
          categoryId: rec.categoryId ?? '',
          kind: rec.kind as 'income' | 'expense',
          amount: rec.amount,
          currency: rec.currency,
          frequency: rec.frequency as 'monthly' | 'bimonthly' | 'quarterly' | 'yearly',
          dayOfMonth: rec.dayOfMonth ?? 1,
          startDate: rec.startDate,
          endDate: rec.endDate,
          active: rec.active,
        }}
      />

      {pendingForecasts.length > 0 && (
        <div className="rounded-md border p-4">
          <h2 className="mb-2 text-sm font-medium">Previsiones pendientes (próximas)</h2>
          <ul className="space-y-1 text-sm text-muted-foreground">
            {pendingForecasts.map((f) => (
              <li key={f.id} className="flex justify-between">
                <span>{f.expectedDate}</span>
                <span className="tabular-nums">
                  {new Intl.NumberFormat('es-AR', {
                    style: 'currency',
                    currency: f.currency,
                  }).format(Number(f.expectedAmount))}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="rounded-md border border-destructive/40 bg-destructive/5 p-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-sm font-medium">Borrar recurrencia</p>
            <p className="text-xs text-muted-foreground">
              Hard delete. Previsiones futuras se borran; transacciones matched pierden el link.
            </p>
          </div>
          <DeleteRecurrenceButton id={rec.id} name={rec.name} variant="destructive" size="default" />
        </div>
      </div>
    </div>
  );
}
