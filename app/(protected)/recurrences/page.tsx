import Link from 'next/link';
import { redirect } from 'next/navigation';
import { and, asc, eq, gte, min } from 'drizzle-orm';
import { getDb } from '@/lib/db/client';
import { accounts, categories, forecasts, recurrences } from '@/db/schema';
import { requireHouseholdSession, SessionError } from '@/lib/auth/session';
import {
  RECURRENCE_FREQUENCY_LABELS,
  RECURRENCE_KIND_LABELS,
  type RecurrenceFrequency,
  type RecurrenceKind,
} from '@/lib/schemas/recurrence';
import { Button } from '@/components/ui/button';
import { DeleteRecurrenceButton } from './delete-button';

export const metadata = {
  title: 'Recurrencias · gd-finanzas',
};

type SearchParams = Promise<{ archived?: string }>;

function formatAmount(amount: string, currency: 'ARS' | 'USD'): string {
  const n = Number.parseFloat(amount);
  return new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number.isFinite(n) ? n : 0);
}

async function toggleActive(formData: FormData): Promise<void> {
  'use server';
  const { setRecurrenceActive } = await import('@/app/actions/recurrences/set-active');
  await setRecurrenceActive(formData);
}

export default async function RecurrencesPage({ searchParams }: { searchParams: SearchParams }) {
  let session;
  try {
    session = await requireHouseholdSession();
  } catch (err) {
    if (err instanceof SessionError) redirect('/login');
    throw err;
  }

  const params = await searchParams;
  const showAll = params.archived === '1';
  const today = new Date().toISOString().slice(0, 10);

  const db = getDb();
  const rows = await db
    .select({
      id: recurrences.id,
      name: recurrences.name,
      kind: recurrences.kind,
      amount: recurrences.amount,
      currency: recurrences.currency,
      frequency: recurrences.frequency,
      active: recurrences.active,
      accountName: accounts.name,
      categoryName: categories.name,
      nextDate: min(forecasts.expectedDate).as('next_date'),
    })
    .from(recurrences)
    .leftJoin(accounts, eq(accounts.id, recurrences.accountId))
    .leftJoin(categories, eq(categories.id, recurrences.categoryId))
    .leftJoin(
      forecasts,
      and(
        eq(forecasts.recurrenceId, recurrences.id),
        eq(forecasts.status, 'pending'),
        gte(forecasts.expectedDate, today),
      ),
    )
    .where(
      showAll
        ? eq(recurrences.householdId, session.householdId)
        : and(eq(recurrences.householdId, session.householdId), eq(recurrences.active, true)),
    )
    .groupBy(
      recurrences.id,
      recurrences.name,
      recurrences.kind,
      recurrences.amount,
      recurrences.currency,
      recurrences.frequency,
      recurrences.active,
      accounts.name,
      categories.name,
    )
    .orderBy(asc(recurrences.name));

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-2xl font-semibold">Recurrencias</h1>
        <Button asChild>
          <Link href="/recurrences/new">+ Nueva recurrencia</Link>
        </Button>
      </div>

      <div className="flex items-center gap-3 text-sm text-muted-foreground">
        <Link
          href="/recurrences"
          className={!showAll ? 'font-medium text-foreground' : 'hover:underline'}
        >
          Activas
        </Link>
        <span>·</span>
        <Link
          href="/recurrences?archived=1"
          className={showAll ? 'font-medium text-foreground' : 'hover:underline'}
        >
          Todas (incluye pausadas)
        </Link>
      </div>

      {rows.length === 0 ? (
        <div className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">
          {showAll
            ? 'No hay recurrencias todavía.'
            : 'No hay recurrencias activas. Cargá la primera.'}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-md border">
          <table className="w-full text-sm">
            <thead className="bg-muted/40">
              <tr className="text-left">
                <th className="px-3 py-2 font-medium">Nombre</th>
                <th className="px-3 py-2 font-medium">Tipo</th>
                <th className="px-3 py-2 font-medium">Cuenta</th>
                <th className="px-3 py-2 font-medium">Categoría</th>
                <th className="px-3 py-2 text-right font-medium">Monto</th>
                <th className="px-3 py-2 font-medium">Frecuencia</th>
                <th className="px-3 py-2 font-medium">Próxima</th>
                <th className="px-3 py-2 font-medium" />
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className="border-t">
                  <td className="px-3 py-2">
                    <Link href={`/recurrences/${row.id}`} className="hover:underline">
                      {row.name}
                    </Link>
                    {!row.active && (
                      <span className="ml-2 rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
                        pausada
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <span
                      className={
                        row.kind === 'income'
                          ? 'rounded bg-emerald-50 px-1.5 py-0.5 text-xs text-emerald-700'
                          : 'rounded bg-rose-50 px-1.5 py-0.5 text-xs text-rose-700'
                      }
                    >
                      {RECURRENCE_KIND_LABELS[row.kind as RecurrenceKind] ?? row.kind}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">{row.accountName ?? '—'}</td>
                  <td className="px-3 py-2 text-muted-foreground">{row.categoryName ?? '—'}</td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {formatAmount(row.amount, row.currency)}
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">
                    {RECURRENCE_FREQUENCY_LABELS[row.frequency as RecurrenceFrequency] ??
                      row.frequency}
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap text-muted-foreground">
                    {row.nextDate ?? '—'}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <div className="flex justify-end gap-2">
                      <Button variant="outline" size="sm" asChild>
                        <Link href={`/recurrences/${row.id}`}>Editar</Link>
                      </Button>
                      <form action={toggleActive}>
                        <input type="hidden" name="id" value={row.id} />
                        <input
                          type="hidden"
                          name="active"
                          value={row.active ? 'false' : 'true'}
                        />
                        <Button variant="ghost" size="sm" type="submit">
                          {row.active ? 'Pausar' : 'Reactivar'}
                        </Button>
                      </form>
                      <DeleteRecurrenceButton id={row.id} name={row.name} />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

