import Link from 'next/link';
import { redirect } from 'next/navigation';
import { and, asc, eq } from 'drizzle-orm';
import { getDb } from '@/lib/db/client';
import { accounts, forecasts, recurrences } from '@/db/schema';
import { requireHouseholdSession, SessionError } from '@/lib/auth/session';
import type { RecurrenceKind } from '@/lib/schemas/recurrence';
import { Button } from '@/components/ui/button';
import { Display, Label, Num, Hair, Body } from '@/components/ui/typography';
import { cn } from '@/lib/utils';
import { CancelForecastButton } from './cancel-button';

export const metadata = {
  title: 'Previsiones · gd-finanzas',
};

const MONTH_LABELS = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
];

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
  // 'YYYY-MM-DD' → human "Mayo 2026"
  const parts = iso.split('-');
  const y = parts[0];
  const m = parts[1];
  if (!y || !m) return iso.slice(0, 7);
  const idx = Number.parseInt(m, 10) - 1;
  return `${MONTH_LABELS[idx] ?? m} ${y}`;
}

function shortDate(iso: string): string {
  const parts = iso.split('-');
  const d = parts[2];
  const m = parts[1];
  if (!d || !m) return iso;
  const months = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
  const mi = Number.parseInt(m, 10) - 1;
  return `${d} ${months[mi] ?? ''}`;
}

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function parseSort(sp: Record<string, string | string[] | undefined>): { field: string; dir: 'asc' | 'desc' } {
  const field = typeof sp.sort === 'string' ? sp.sort : 'date';
  const dir = typeof sp.dir === 'string' && sp.dir === 'desc' ? 'desc' : 'asc';
  return { field, dir };
}

export default async function ForecastsPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
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

  const sp = await searchParams;
  const { field: sortField, dir: sortDir } = parseSort(sp);

  // Agrupar por mes
  const byMonth = new Map<string, typeof rows>();
  for (const r of rows) {
    const key = r.expectedDate.slice(0, 7);
    const arr = byMonth.get(key) ?? [];
    arr.push(r);
    byMonth.set(key, arr);
  }

  // Sort within each month
  for (const [, items] of byMonth) {
    items.sort((a, b) => {
      let cmp = 0;
      if (sortField === 'amount') {
        cmp = Number.parseFloat(a.expectedAmount) - Number.parseFloat(b.expectedAmount);
      } else if (sortField === 'name') {
        cmp = (a.recurrenceName ?? '').localeCompare(b.recurrenceName ?? '', 'es');
      } else {
        cmp = a.expectedDate.localeCompare(b.expectedDate);
      }
      return sortDir === 'desc' ? -cmp : cmp;
    });
  }

  return (
    <div className="space-y-8">
      <header className="flex flex-wrap items-end justify-between gap-6 pt-2">
        <div className="min-w-0">
          <Label>Planificar · Previsiones</Label>
          <Display size="lg" className="mt-2 block">
            Previsiones
          </Display>
          <Body className="mt-2 max-w-2xl">
            {rows.length === 0 ? (
              <>Sin previsiones pendientes. Creá una recurrencia para que aparezcan acá.</>
            ) : (
              <>
                <span className="text-foreground">{rows.length}</span> previsiones pendientes ·{' '}
                <span className="text-foreground">{byMonth.size}</span>{' '}
                {byMonth.size === 1 ? 'mes' : 'meses'}
              </>
            )}
          </Body>
        </div>
        <Button variant="outline" asChild>
          <Link href="/recurrences">Ir a recurrencias</Link>
        </Button>
      </header>

      {rows.length > 0 && (
        <div className="flex items-center gap-2 font-sans text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
          <span>Ordenar por:</span>
          {[
            { field: 'date', label: 'Fecha' },
            { field: 'name', label: 'Nombre' },
            { field: 'amount', label: 'Monto' },
          ].map((s) => {
            const isActive = sortField === s.field;
            const nextDir = isActive && sortDir === 'asc' ? 'desc' : 'asc';
            const href = `/forecasts?sort=${s.field}&dir=${isActive ? nextDir : 'asc'}`;
            return (
              <Link
                key={s.field}
                href={href}
                className={cn(
                  'inline-flex items-center gap-0.5 rounded px-2 py-1 transition-colors hover:text-foreground',
                  isActive && 'bg-primary/10 text-foreground',
                )}
              >
                {s.label}
                {isActive && (
                  <span className="text-xs">{sortDir === 'asc' ? '▲' : '▼'}</span>
                )}
              </Link>
            );
          })}
        </div>
      )}

      <Hair thick />

      {rows.length === 0 ? (
        <div className="border border-dashed border-border p-12 text-center">
          <Display size="sm">Nada en cola</Display>
          <Body className="mx-auto mt-3 max-w-md">
            Una previsión se genera automáticamente desde cada recurrencia activa. Si no
            tenés ninguna, andá a{' '}
            <Link href="/recurrences" className="link not-italic">
              /recurrences
            </Link>
            .
          </Body>
        </div>
      ) : (
        <div className="space-y-10">
          {[...byMonth.entries()].map(([monthKey, items]) => {
            const monthTotal = items.reduce((s, r) => {
              const n = Number.parseFloat(r.expectedAmount) || 0;
              return s + (r.recurrenceKind === 'income' ? n : -n);
            }, 0);
            return (
              <section key={monthKey}>
                <header className="flex items-baseline justify-between border-b border-border pb-2">
                  <div className="flex items-baseline gap-3">
                    <Display size="sm">{monthLabel(`${monthKey}-01`)}</Display>
                    <Label>
                      {items.length} {items.length === 1 ? 'previsión' : 'previsiones'}
                    </Label>
                  </div>
                  <div className="text-right">
                    <Label>Neto del mes</Label>
                    <Num
                      className={cn(
                        'mt-1 block text-base',
                        monthTotal >= 0
                          ? 'text-[color:var(--good)]'
                          : 'text-[color:var(--bad)]',
                      )}
                    >
                      {monthTotal >= 0 ? '+' : ''}
                      {/* Show in original-currency totals not feasible across mixed currency;
                          we display in the dominant currency or fall back to ARS */}
                      {new Intl.NumberFormat('es-AR', {
                        style: 'currency',
                        currency: items[0]?.currency ?? 'ARS',
                        minimumFractionDigits: 0,
                        maximumFractionDigits: 0,
                      }).format(monthTotal)}
                    </Num>
                  </div>
                </header>

                <ul>
                  {items.map((row) => (
                    <li
                      key={row.id}
                      className="group grid grid-cols-[80px_1fr_auto_auto] items-baseline gap-4 border-b border-border/40 py-3 transition-colors hover:bg-primary/[0.04]"
                    >
                      <Num className="text-[11px] uppercase tracking-[0.1em] text-primary">
                        {shortDate(row.expectedDate)}
                      </Num>
                      <div className="min-w-0">
                        <div className="flex items-baseline gap-3">
                          <span
                            aria-hidden
                            className="inline-block size-2 shrink-0 rounded-full"
                            style={{
                              background:
                                row.recurrenceKind === ('income' as RecurrenceKind)
                                  ? 'var(--good)'
                                  : 'var(--bad)',
                            }}
                          />
                          <span className="truncate font-display text-base font-semibold text-foreground">
                            {row.recurrenceName}
                          </span>
                        </div>
                        <Label className="mt-1 normal-case tracking-[0.1em]">
                          {row.accountName ?? '—'}
                        </Label>
                      </div>
                      <Num
                        className={cn(
                          'text-sm',
                          row.recurrenceKind === 'income'
                            ? 'text-[color:var(--good)]'
                            : 'text-foreground',
                        )}
                      >
                        {row.recurrenceKind === 'income' ? '+' : '−'}
                        {formatAmount(row.expectedAmount, row.currency).replace('−', '')}
                      </Num>
                      <div className="opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
                        <CancelForecastButton
                          id={row.id}
                          recurrenceName={row.recurrenceName}
                        />
                      </div>
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
