import Link from 'next/link';
import { redirect } from 'next/navigation';
import { requireHouseholdSession, SessionError } from '@/lib/auth/session';
import { loadDashboardData } from '@/lib/reports/dashboard-data';
import { ALL_KIND_LABELS } from '@/lib/schemas/transaction';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { SparklineKpiCard } from '@/components/dashboard/sparkline-kpi-card';
import { cn } from '@/lib/utils';

export const metadata = { title: 'Dashboard · gd-finanzas' };

const MONTH_LABELS = [
  'Enero',
  'Febrero',
  'Marzo',
  'Abril',
  'Mayo',
  'Junio',
  'Julio',
  'Agosto',
  'Septiembre',
  'Octubre',
  'Noviembre',
  'Diciembre',
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
  return {
    text: `${sign}${formatUsd(d)}`,
    tone: d >= 0 ? 'good' : 'bad',
  };
}

function deltaTextExpense(d: number): { text: string; tone: 'good' | 'bad' | 'neutral' } {
  if (Math.abs(d) < 0.005) return { text: '—', tone: 'neutral' };
  const sign = d > 0 ? '+' : '';
  return {
    text: `${sign}${formatUsd(d)}`,
    tone: d <= 0 ? 'good' : 'bad',
  };
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

  const data = await loadDashboardData(session.householdId, year, month);

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

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Dashboard</h1>
          <p className="text-sm text-muted-foreground">{monthLabel}</p>
        </div>
        <Link
          href="/reports/cashflow"
          className="text-sm text-muted-foreground hover:text-foreground hover:underline"
        >
          Ver cashflow del mes →
        </Link>
      </div>

      <section className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <SparklineKpiCard
          label="Ingresos del mes"
          value={formatUsd(data.totals.income.real)}
          delta={prev ? deltaText(incomeDelta) : null}
          data={data.monthly.map((m) => m.income)}
          color="emerald"
        />
        <SparklineKpiCard
          label="Gastos del mes"
          value={formatUsd(data.totals.expense.real)}
          delta={prev ? deltaTextExpense(expenseDelta) : null}
          data={data.monthly.map((m) => m.expense)}
          color="rose"
        />
        <SparklineKpiCard
          label="Neto del mes"
          value={formatUsd(data.totals.net.real)}
          delta={prev ? deltaText(netDelta) : null}
          data={data.monthly.map((m) => m.net)}
          color="violet"
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
          color="sky"
        />
      </section>

      <section className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Top 5 gastos del mes</CardTitle>
          </CardHeader>
          <CardContent>
            {data.topExpenseCategories.length === 0 ? (
              <p className="text-sm text-muted-foreground">Sin gastos este mes.</p>
            ) : (
              <ul className="space-y-2 text-sm">
                {data.topExpenseCategories.map((c) => {
                  const n = Number.parseFloat(c.total) || 0;
                  const pct = topMax > 0 ? (n / topMax) * 100 : 0;
                  return (
                    <li key={c.id}>
                      <div className="flex items-center justify-between gap-3">
                        <span className="truncate">{c.name}</span>
                        <span className="shrink-0 tabular-nums text-muted-foreground">
                          {formatUsd(c.total)}
                        </span>
                      </div>
                      <div
                        className="mt-1 h-1 overflow-hidden rounded-full bg-muted"
                        aria-hidden
                      >
                        <div
                          className="h-full rounded-full bg-rose-500/70"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Próximos 14 días</CardTitle>
          </CardHeader>
          <CardContent>
            {data.upcomingForecasts.length === 0 ? (
              <p className="text-sm text-muted-foreground">Sin previsiones próximas.</p>
            ) : (
              <ul className="divide-y divide-border text-sm">
                {data.upcomingForecasts.slice(0, 8).map((f) => (
                  <li key={f.id} className="flex items-center justify-between gap-3 py-1.5">
                    <span className="flex min-w-0 flex-col">
                      <span className="truncate font-medium">{f.recurrenceName}</span>
                      <span className="text-xs text-muted-foreground">{f.expectedDate}</span>
                    </span>
                    <span className="shrink-0 tabular-nums text-muted-foreground">
                      {formatAmount(f.expectedAmount, f.currency)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            <Link
              href="/forecasts"
              className="mt-3 inline-block text-xs text-muted-foreground hover:text-foreground hover:underline"
            >
              Ver todas las previsiones →
            </Link>
          </CardContent>
        </Card>
      </section>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-base">Últimas transacciones</CardTitle>
            <Link
              href="/transactions"
              className="text-xs text-muted-foreground hover:text-foreground hover:underline"
            >
              Ver todas →
            </Link>
          </div>
        </CardHeader>
        <CardContent>
          {data.recentTransactions.length === 0 ? (
            <p className="text-sm text-muted-foreground">Sin transacciones todavía.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-muted-foreground">
                  <tr>
                    <th className="py-1.5 font-normal">Fecha</th>
                    <th className="py-1.5 font-normal">Tipo</th>
                    <th className="py-1.5 font-normal">Descripción</th>
                    <th className="py-1.5 font-normal">Cuenta</th>
                    <th className="py-1.5 text-right font-normal">Monto</th>
                  </tr>
                </thead>
                <tbody>
                  {data.recentTransactions.map((tx) => (
                    <tr key={tx.id} className="border-t">
                      <td className="py-1.5 whitespace-nowrap text-muted-foreground">{tx.date}</td>
                      <td className="py-1.5">
                        <span
                          className={cn(
                            'rounded px-1.5 py-0.5 text-xs',
                            tx.kind === 'income' &&
                              'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300',
                            tx.kind === 'expense' &&
                              'bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-300',
                            tx.kind === 'transfer' &&
                              'bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-300',
                          )}
                        >
                          {ALL_KIND_LABELS[tx.kind]}
                        </span>
                      </td>
                      <td className="py-1.5">{tx.description}</td>
                      <td className="py-1.5 text-muted-foreground">{tx.accountName ?? '—'}</td>
                      <td className="py-1.5 text-right tabular-nums">
                        {formatAmount(tx.amountOriginal, tx.currencyOriginal)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
