import Link from 'next/link';
import { redirect } from 'next/navigation';
import { and, asc, eq } from 'drizzle-orm';
import { getDb } from '@/lib/db/client';
import { accounts, forecasts, recurrences } from '@/db/schema';
import { requireHouseholdSession, SessionError } from '@/lib/auth/session';
import { RECURRENCE_KIND_LABELS, type RecurrenceKind } from '@/lib/schemas/recurrence';
import { Button } from '@/components/ui/button';
import { CancelForecastButton } from './cancel-button';

export const metadata = {
  title: 'Previsiones · gd-finanzas',
};

function formatAmount(amount: string, currency: 'ARS' | 'USD'): string {
  const n = Number.parseFloat(amount);
  return new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number.isFinite(n) ? n : 0);
}

function monthLabel(iso: string): string {
  // 'YYYY-MM-DD' → 'YYYY-MM'
  return iso.slice(0, 7);
}

export default async function ForecastsPage() {
  let session;
  try {
    session = await requireHouseholdSession();
  } catch (err) {
    if (err instanceof SessionError) redirect('/login');
    throw err;
  }

  const db = getDb();
  const rows = await db
    .select({
      id: forecasts.id,
      expectedDate: forecasts.expectedDate,
      expectedAmount: forecasts.expectedAmount,
      currency: forecasts.currency,
      recurrenceName: recurrences.name,
      recurrenceKind: recurrences.kind,
      accountName: accounts.name,
    })
    .from(forecasts)
    .innerJoin(recurrences, eq(recurrences.id, forecasts.recurrenceId))
    .leftJoin(accounts, eq(accounts.id, recurrences.accountId))
    .where(
      and(
        eq(recurrences.householdId, session.householdId),
        eq(forecasts.status, 'pending'),
      ),
    )
    .orderBy(asc(forecasts.expectedDate));

  // Agrupar por mes
  const byMonth = new Map<string, typeof rows>();
  for (const r of rows) {
    const key = monthLabel(r.expectedDate);
    const arr = byMonth.get(key) ?? [];
    arr.push(r);
    byMonth.set(key, arr);
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-2xl font-semibold">Previsiones</h1>
        <Button variant="outline" asChild>
          <Link href="/recurrences">Recurrencias</Link>
        </Button>
      </div>

      {rows.length === 0 ? (
        <div className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">
          Sin previsiones pendientes. Creá una recurrencia en{' '}
          <Link href="/recurrences" className="underline">
            /recurrences
          </Link>{' '}
          y las próximas 12 ocurrencias aparecen acá.
        </div>
      ) : (
        <div className="space-y-6">
          {[...byMonth.entries()].map(([month, items]) => (
            <div key={month} className="space-y-2">
              <h2 className="text-sm font-medium text-muted-foreground">{month}</h2>
              <div className="overflow-x-auto rounded-md border">
                <table className="w-full text-sm">
                  <thead className="bg-muted/40">
                    <tr className="text-left">
                      <th className="px-3 py-2 font-medium">Fecha</th>
                      <th className="px-3 py-2 font-medium">Recurrencia</th>
                      <th className="px-3 py-2 font-medium">Cuenta</th>
                      <th className="px-3 py-2 font-medium">Tipo</th>
                      <th className="px-3 py-2 text-right font-medium">Monto</th>
                      <th className="px-3 py-2 font-medium" />
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((row) => (
                      <tr key={row.id} className="border-t">
                        <td className="px-3 py-2 whitespace-nowrap text-muted-foreground">
                          {row.expectedDate}
                        </td>
                        <td className="px-3 py-2">{row.recurrenceName}</td>
                        <td className="px-3 py-2 text-muted-foreground">
                          {row.accountName ?? '—'}
                        </td>
                        <td className="px-3 py-2">
                          <span
                            className={
                              row.recurrenceKind === 'income'
                                ? 'rounded bg-emerald-50 px-1.5 py-0.5 text-xs text-emerald-700'
                                : 'rounded bg-rose-50 px-1.5 py-0.5 text-xs text-rose-700'
                            }
                          >
                            {RECURRENCE_KIND_LABELS[row.recurrenceKind as RecurrenceKind] ??
                              row.recurrenceKind}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums">
                          {formatAmount(row.expectedAmount, row.currency)}
                        </td>
                        <td className="px-3 py-2 text-right">
                          <CancelForecastButton
                            id={row.id}
                            recurrenceName={row.recurrenceName}
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
