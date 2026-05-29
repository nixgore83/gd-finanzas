import Link from 'next/link';
import { redirect } from 'next/navigation';
import { requireHouseholdSession, SessionError } from '@/lib/auth/session';
import { loadDashboardData } from '@/lib/reports/dashboard-data';
import { loadPendingActions } from '@/lib/reports/pending-actions';
import { ALL_KIND_LABELS } from '@/lib/schemas/transaction';
import { SparklineKpiCard } from '@/components/dashboard/sparkline-kpi-card';
import { PendingActionsSummary } from '@/components/dashboard/pending-actions-summary';
import { Display, Label, Num, Hair, Body } from '@/components/ui/typography';
import { cn } from '@/lib/utils';

export const metadata = { title: 'Dashboard · gd-finanzas' };

const MONTH_LABELS = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
];

function formatUsd(amount: string | number, withDecimals = false): string {
  const n = typeof amount === 'number' ? amount : Number.parseFloat(amount);
  if (!Number.isFinite(n)) return '—';
  return new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: withDecimals ? 2 : 0,
    maximumFractionDigits: withDecimals ? 2 : 0,
  }).format(n);
}

function formatAmount(amount: string, currency: 'ARS' | 'USD'): string {
  const n = Number.parseFloat(amount);
  if (!Number.isFinite(n)) return '—';
  return new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n);
}

function formatPct(pct: number | null): string {
  if (pct === null) return '—';
  return `${pct.toFixed(1)}%`;
}

function deltaText(d: number): { text: string; tone: 'good' | 'bad' | 'neutral' } {
  if (Math.abs(d) < 0.005) return { text: '—', tone: 'neutral' };
  const sign = d > 0 ? '+' : '';
  return { text: `${sign}${formatUsd(d)}`, tone: d >= 0 ? 'good' : 'bad' };
}

function deltaTextExpense(d: number): { text: string; tone: 'good' | 'bad' | 'neutral' } {
  if (Math.abs(d) < 0.005) return { text: '—', tone: 'neutral' };
  const sign = d > 0 ? '+' : '';
  return { text: `${sign}${formatUsd(d)}`, tone: d <= 0 ? 'good' : 'bad' };
}

function shortDate(iso: string): string {
  // Expects YYYY-MM-DD; renders "dd MMM" en mayúsculas chiquitas.
  const parts = iso.split('-');
  const m = parts[1];
  const d = parts[2];
  if (!m || !d) return iso;
  const months = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
  const mi = Number.parseInt(m, 10) - 1;
  return `${d} ${months[mi] ?? ''}`;
}

export default async function DashboardPage() {
  let session;
  try {
    session = await requireHouseholdSession();
  } catch (err) {
    if (err instanceof SessionError) redirect('/login');
    throw err;
  }

  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1;
  const monthLabel = `${MONTH_LABELS[month - 1]} ${year}`;

  const [data, pending] = await Promise.all([
    loadDashboardData(session.householdId, year, month),
    loadPendingActions(session.householdId),
  ]);

  const last = data.monthly[data.monthly.length - 1];
  const prev = data.monthly[data.monthly.length - 2];
  const incomeDelta = last && prev ? last.income - prev.income : 0;
  const expenseDelta = last && prev ? last.expense - prev.expense : 0;
  const netDelta = last && prev ? last.net - prev.net : 0;

  const savingsPct =
    last && last.income > 0 ? ((last.income - last.expense) / last.income) * 100 : null;
  const prevSavingsPct =
    prev && prev.income > 0 ? ((prev.income - prev.expense) / prev.income) * 100 : null;
  const savingsDelta =
    savingsPct !== null && prevSavingsPct !== null ? savingsPct - prevSavingsPct : null;

  const topMax = data.topExpenseCategories.reduce(
    (acc, c) => Math.max(acc, Number.parseFloat(c.total) || 0),
    0,
  );

  const netReal = Number.parseFloat(data.totals.net.real);
  const netPositive = Number.isFinite(netReal) && netReal >= 0;

  return (
    <div className="space-y-10">
      {/* ============ PENDING ACTIONS ============ */}
      <PendingActionsSummary data={pending} />

      {/* ============ HERO ============ */}
      <section className="flex flex-wrap items-end justify-between gap-8 pt-2">
        <div className="min-w-0 flex-1">
          <Label>Casa Garaglio · Dasso — {monthLabel}</Label>
          <Display size="xl" className="mt-3 block tabular-nums">
            {netPositive ? '+' : ''}
            {formatUsd(data.totals.net.real)}
          </Display>
          <Body className="mt-2 max-w-xl">
            Neto del mes — la diferencia entre lo que entró y lo que salió.{' '}
            {prev && (
              <span className="not-italic text-foreground">
                <Num className={cn(netDelta >= 0 ? 'text-[color:var(--good)]' : 'text-[color:var(--bad)]')}>
                  {netDelta >= 0 ? '+' : ''}
                  {formatUsd(netDelta)}
                </Num>{' '}
                vs el mes anterior.
              </span>
            )}
          </Body>
        </div>

        {/* Right: tasa de ahorro */}
        <div className="border-l border-border pl-8">
          <Label>Tasa de ahorro</Label>
          <div className="mt-3 flex items-baseline gap-1">
            <Display size="lg" className="tabular-nums text-primary">
              {savingsPct !== null ? savingsPct.toFixed(1) : '—'}
            </Display>
            {savingsPct !== null && (
              <span className="font-display text-2xl font-light text-primary/70">%</span>
            )}
          </div>
          {savingsDelta !== null && (
            <div className="mt-1">
              <Num
                className={cn(
                  'text-[11px] font-semibold uppercase tracking-[0.14em]',
                  savingsDelta >= 0 ? 'text-[color:var(--good)]' : 'text-[color:var(--bad)]',
                )}
              >
                {savingsDelta > 0 ? '+' : ''}
                {savingsDelta.toFixed(1)} pp
              </Num>{' '}
              <span className="font-sans text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                vs mes ant.
              </span>
            </div>
          )}
          <Link
            href="/reports/cashflow"
            className="link mt-4 inline-block font-display text-sm italic text-muted-foreground"
          >
            Ver cashflow del mes →
          </Link>
        </div>
      </section>

      <Hair thick />

      {/* ============ KPI STRIP ============ */}
      <section className="grid grid-cols-1 gap-px bg-border sm:grid-cols-2 lg:grid-cols-4">
        <SparklineKpiCard
          label="Ingresos del mes"
          value={formatUsd(data.totals.income.real)}
          delta={prev ? deltaText(incomeDelta) : null}
          data={data.monthly.map((m) => m.income)}
          variant="good"
        />
        <SparklineKpiCard
          label="Gastos del mes"
          value={formatUsd(data.totals.expense.real)}
          delta={prev ? deltaTextExpense(expenseDelta) : null}
          data={data.monthly.map((m) => m.expense)}
          variant="bad"
        />
        <SparklineKpiCard
          label="Neto del mes"
          value={formatUsd(data.totals.net.real)}
          delta={prev ? deltaText(netDelta) : null}
          data={data.monthly.map((m) => m.net)}
          variant="primary"
        />
        <SparklineKpiCard
          label="Tasa de ahorro"
          value={formatPct(savingsPct)}
          delta={
            savingsDelta !== null
              ? {
                  text: `${savingsDelta > 0 ? '+' : ''}${savingsDelta.toFixed(1)}pp`,
                  tone: savingsDelta >= 0 ? 'good' : 'bad',
                }
              : null
          }
          data={data.monthly.map((m) =>
            m.income > 0 ? ((m.income - m.expense) / m.income) * 100 : 0,
          )}
          variant="attn"
        />
      </section>

      {/* ============ BODY GRID: top expenses + upcoming ============ */}
      <section className="grid grid-cols-1 gap-10 lg:grid-cols-2">
        {/* Top expenses */}
        <div>
          <div className="flex items-baseline justify-between">
            <Display size="md">Las cinco del mes</Display>
            <Label>por categoría</Label>
          </div>
          <Hair className="mt-3 mb-1" />
          {data.topExpenseCategories.length === 0 ? (
            <Body className="mt-3">Sin gastos registrados este mes.</Body>
          ) : (
            <ol className="divide-y divide-border/60">
              {data.topExpenseCategories.map((c, i) => {
                const n = Number.parseFloat(c.total) || 0;
                const pct = topMax > 0 ? (n / topMax) * 100 : 0;
                return (
                  <li
                    key={c.id}
                    className="grid grid-cols-[20px_1fr_auto] items-center gap-3 py-3"
                  >
                    <Num className="text-[10px] text-muted-foreground">
                      {String(i + 1).padStart(2, '0')}
                    </Num>
                    <div className="min-w-0">
                      <div className="font-display text-base text-foreground">{c.name}</div>
                      <div className="mt-1 h-[3px] w-full bg-muted">
                        <div
                          className="h-full bg-[color:var(--bad)]/80"
                          style={{ width: `${pct}%` }}
                          aria-hidden
                        />
                      </div>
                    </div>
                    <Num className="text-sm text-foreground">{formatUsd(c.total)}</Num>
                  </li>
                );
              })}
            </ol>
          )}
        </div>

        {/* Upcoming forecasts */}
        <div>
          <div className="flex items-baseline justify-between">
            <Display size="md">Lo que viene</Display>
            <Label>previsiones · 14 d</Label>
          </div>
          <Hair className="mt-3 mb-1" />
          {data.upcomingForecasts.length === 0 ? (
            <Body className="mt-3">Nada en los próximos 14 días.</Body>
          ) : (
            <ul className="divide-y divide-border/60">
              {data.upcomingForecasts.slice(0, 8).map((f) => (
                <li
                  key={f.id}
                  className="grid grid-cols-[56px_1fr_auto] items-baseline gap-3 py-3"
                >
                  <Num className="text-[11px] uppercase tracking-[0.1em] text-primary">
                    {shortDate(f.expectedDate)}
                  </Num>
                  <div className="min-w-0">
                    <div className="truncate font-display text-base text-foreground">
                      {f.recurrenceName}
                    </div>
                  </div>
                  <Num className="text-sm text-foreground">
                    {formatAmount(f.expectedAmount, f.currency)}
                  </Num>
                </li>
              ))}
            </ul>
          )}
          <Link
            href="/forecasts"
            className="link mt-4 inline-block font-display text-sm italic text-muted-foreground"
          >
            Ver todas las previsiones →
          </Link>
        </div>
      </section>

      {/* ============ RECENT TRANSACTIONS ============ */}
      <section>
        <div className="flex items-baseline justify-between">
          <Display size="md">Últimos movimientos</Display>
          <Link
            href="/transactions"
            className="link font-display text-sm italic text-muted-foreground"
          >
            Ver todos →
          </Link>
        </div>
        <Hair className="mt-3 mb-1" />

        {data.recentTransactions.length === 0 ? (
          <Body className="mt-3">Sin transacciones todavía.</Body>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-border">
                  {['Fecha', 'Tipo', 'Concepto', 'Cuenta', 'Monto'].map((h, i) => (
                    <th
                      key={h}
                      className={cn(
                        'py-2 font-sans text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground',
                        i === 4 ? 'text-right' : 'text-left',
                      )}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.recentTransactions.map((tx) => (
                  <tr
                    key={tx.id}
                    className="border-b border-border/40 transition-colors hover:bg-primary/[0.04]"
                  >
                    <td className="py-3 whitespace-nowrap">
                      <Num className="text-[11px] uppercase tracking-[0.1em] text-muted-foreground">
                        {shortDate(tx.date)}
                      </Num>
                    </td>
                    <td className="py-3 pr-3">
                      <span
                        className={cn(
                          'inline-block rounded-sm px-2 py-[3px] font-sans text-[9px] font-semibold uppercase tracking-[0.14em]',
                          tx.kind === 'income' &&
                            'bg-[color:var(--good)]/15 text-[color:var(--good)]',
                          tx.kind === 'expense' &&
                            'bg-[color:var(--bad)]/15 text-[color:var(--bad)]',
                          tx.kind === 'transfer' &&
                            'bg-[color:var(--attn)]/15 text-[color:var(--attn)]',
                        )}
                      >
                        {ALL_KIND_LABELS[tx.kind]}
                      </span>
                    </td>
                    <td className="py-3 pr-3 font-display text-base text-foreground">
                      {tx.description}
                    </td>
                    <td className="py-3 pr-3 font-sans text-xs text-muted-foreground">
                      {tx.accountName ?? '—'}
                    </td>
                    <td className="py-3 text-right">
                      <Num
                        className={cn(
                          'text-sm',
                          tx.kind === 'income' && 'text-[color:var(--good)]',
                          tx.kind === 'expense' && 'text-foreground',
                          tx.kind === 'transfer' && 'text-[color:var(--attn)]',
                        )}
                      >
                        {formatAmount(tx.amountOriginal, tx.currencyOriginal)}
                      </Num>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
