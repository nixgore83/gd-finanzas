import Link from 'next/link';
import { redirect } from 'next/navigation';
import { and, asc, eq, gte, min } from 'drizzle-orm';
import { getDb } from '@/lib/db/client';
import { accounts, categories, forecasts, recurrences } from '@/db/schema';
import { requireHouseholdSession, SessionError } from '@/lib/auth/session';
import {
  RECURRENCE_FREQUENCY_LABELS,
  type RecurrenceFrequency,
  type RecurrenceKind,
} from '@/lib/schemas/recurrence';
import { Button } from '@/components/ui/button';
import { Display, Label, Num, Hair, Body } from '@/components/ui/typography';
import { cn } from '@/lib/utils';
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

function shortDate(iso: string | null): string {
  if (!iso) return '—';
  const parts = iso.split('-');
  if (parts.length !== 3) return iso;
  const d = parts[2];
  const m = parts[1];
  if (!d || !m) return iso;
  const months = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
  const mi = Number.parseInt(m, 10) - 1;
  return `${d} ${months[mi] ?? ''}`;
}

function daysUntil(iso: string | null): number | null {
  if (!iso) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(`${iso}T00:00:00`);
  const diff = Math.round((target.getTime() - today.getTime()) / 86_400_000);
  return Number.isFinite(diff) ? diff : null;
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

  const active = rows.filter((r) => r.active);
  const paused = rows.filter((r) => !r.active);

  return (
    <div className="space-y-8">
      {/* HEADER */}
      <header className="flex flex-wrap items-end justify-between gap-6 pt-2">
        <div className="min-w-0">
          <Label>Planificar · Recurrencias</Label>
          <Display size="lg" className="mt-2 block">
            Recurrencias
          </Display>
          <Body className="mt-2 max-w-2xl">
            {rows.length === 0 ? (
              <>Sin recurrencias todavía. Cargá la primera para empezar a generar previsiones.</>
            ) : (
              <>
                <span className="text-foreground">{active.length}</span>{' '}
                {active.length === 1 ? 'activa' : 'activas'}
                {showAll && paused.length > 0 && (
                  <>
                    {' '}·{' '}
                    <span className="text-foreground">{paused.length}</span>{' '}
                    pausada{paused.length === 1 ? '' : 's'}
                  </>
                )}
              </>
            )}
          </Body>
        </div>
        <Button asChild size="lg">
          <Link href="/recurrences/new">+ Nueva recurrencia</Link>
        </Button>
      </header>

      <Hair thick />

      {/* FILTER PILLS */}
      <nav className="flex items-baseline gap-1" aria-label="Filtros">
        <FilterPill href="/recurrences" active={!showAll}>
          Activas
        </FilterPill>
        <FilterPill href="/recurrences?archived=1" active={showAll}>
          Incluir pausadas
        </FilterPill>
      </nav>

      {rows.length === 0 ? (
        <div className="border border-dashed border-border p-12 text-center">
          <Display size="sm">Sin recurrencias</Display>
          <Body className="mx-auto mt-3 max-w-md">
            Una recurrencia genera previsiones automáticas en el futuro — pago de alquiler,
            sueldo, suscripciones. Cargá la primera y aparecerán en{' '}
            <Link href="/forecasts" className="link not-italic">
              /forecasts
            </Link>
            .
          </Body>
          <Button asChild className="mt-6" size="lg">
            <Link href="/recurrences/new">+ Crear la primera</Link>
          </Button>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-y border-border">
                {['Nombre', 'Frecuencia', 'Cuenta · Categoría'].map((h) => (
                  <th
                    key={h}
                    className="px-3 py-2.5 text-left font-sans text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground"
                  >
                    {h}
                  </th>
                ))}
                {['Monto', 'Próxima'].map((h) => (
                  <th
                    key={h}
                    className="px-3 py-2.5 text-right font-sans text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground"
                  >
                    {h}
                  </th>
                ))}
                <th className="px-3 py-2.5" />
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const dt = daysUntil(row.nextDate);
                const urgent = dt !== null && dt >= 0 && dt <= 7;
                return (
                  <tr
                    key={row.id}
                    className={cn(
                      'group border-t border-border/40 transition-colors hover:bg-primary/[0.04]',
                      !row.active && 'opacity-60',
                    )}
                  >
                    {/* Name + kind badge */}
                    <td className="px-3 py-3">
                      <div className="flex items-baseline gap-3">
                        <span
                          aria-hidden
                          className="inline-block size-2 rounded-full"
                          style={{
                            background:
                              row.kind === ('income' as RecurrenceKind)
                                ? 'var(--good)'
                                : 'var(--bad)',
                          }}
                        />
                        <Link
                          href={`/recurrences/${row.id}`}
                          className="font-display text-base font-semibold text-foreground hover:text-primary"
                        >
                          {row.name}
                        </Link>
                        {!row.active && (
                          <span className="rounded-full bg-muted px-2 py-[1px] font-sans text-[9px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                            pausada
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-3 py-3">
                      <span
                        className="inline-block rounded-full border px-2.5 py-[3px] font-sans text-[10px] font-semibold uppercase tracking-[0.14em]"
                        style={{
                          borderColor: 'color-mix(in oklab, var(--primary) 40%, transparent)',
                          color: 'var(--primary)',
                        }}
                      >
                        {RECURRENCE_FREQUENCY_LABELS[row.frequency as RecurrenceFrequency] ??
                          row.frequency}
                      </span>
                    </td>
                    <td className="px-3 py-3 font-sans text-xs text-muted-foreground">
                      {row.accountName ?? '—'}
                      {row.categoryName && (
                        <>
                          {' · '}
                          <span className="text-foreground/70">{row.categoryName}</span>
                        </>
                      )}
                    </td>
                    <td className="px-3 py-3 text-right">
                      <Num className="text-sm text-foreground">
                        {formatAmount(row.amount, row.currency)}
                      </Num>
                    </td>
                    <td className="px-3 py-3 text-right">
                      {row.nextDate ? (
                        <>
                          <Num
                            className={cn(
                              'text-sm',
                              urgent ? 'text-[color:var(--attn)]' : 'text-foreground',
                            )}
                          >
                            {shortDate(row.nextDate)}
                          </Num>
                          {dt !== null && (
                            <div>
                              <Label
                                className={cn(
                                  'normal-case tracking-[0.1em]',
                                  urgent && 'text-[color:var(--attn)]',
                                )}
                              >
                                {dt === 0
                                  ? 'hoy'
                                  : dt === 1
                                    ? 'mañana'
                                    : dt > 0
                                      ? `en ${dt} días`
                                      : `hace ${-dt} días`}
                              </Label>
                            </div>
                          )}
                        </>
                      ) : (
                        <Num className="text-sm text-muted-foreground">—</Num>
                      )}
                    </td>
                    <td className="px-3 py-3 text-right">
                      <div className="flex justify-end gap-1.5 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
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
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function FilterPill({
  href,
  active,
  children,
}: {
  href: string;
  active: boolean;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className={cn(
        'inline-block px-3 py-1.5 font-sans text-[10px] font-semibold uppercase tracking-[0.18em] transition-colors',
        active
          ? 'border-b-2 border-primary text-primary'
          : 'border-b-2 border-transparent text-muted-foreground hover:text-foreground',
      )}
    >
      {children}
    </Link>
  );
}
