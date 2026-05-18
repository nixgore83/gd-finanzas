import Link from 'next/link';
import { redirect } from 'next/navigation';
import { requireHouseholdSession, SessionError } from '@/lib/auth/session';
import { loadDashboardData } from '@/lib/reports/dashboard-data';
import { deltaTone } from '@/lib/reports/cashflow';
import { ALL_KIND_LABELS } from '@/lib/schemas/transaction';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
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

function formatUsd(amount: string, withDecimals = false): string {
  const n = Number.parseFloat(amount);
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

function toneClass(tone: 'good' | 'bad' | 'neutral'): string {
  if (tone === 'good') return 'text-emerald-700';
  if (tone === 'bad') return 'text-rose-700';
  return 'text-muted-foreground';
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

  const incomeTone = deltaTone('income', data.totals.income.delta);
  const expenseTone = deltaTone('expense', data.totals.expense.delta);
  const netTone = deltaTone('income', data.totals.net.delta);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
        <p className="text-sm text-muted-foreground">{monthLabel}</p>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <KpiCard
          title="Ingresos del mes"
          real={data.totals.income.real}
          budget={data.totals.income.budget}
          delta={data.totals.income.delta}
          tone={incomeTone}
        />
        <KpiCard
          title="Gastos del mes"
          real={data.totals.expense.real}
          budget={data.totals.expense.budget}
          delta={data.totals.expense.delta}
          tone={expenseTone}
        />
        <KpiCard
          title="Neto del mes"
          real={data.totals.net.real}
          budget={data.totals.net.budget}
          delta={data.totals.net.delta}
          tone={netTone}
        />
      </div>

      {/* Top 5 + Próximas 14 días */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Top 5 gastos del mes</CardTitle>
          </CardHeader>
          <CardContent>
            {data.topExpenseCategories.length === 0 ? (
              <p className="text-sm text-muted-foreground">Sin gastos este mes.</p>
            ) : (
              <ul className="space-y-1.5 text-sm">
                {data.topExpenseCategories.map((c) => (
                  <li key={c.id} className="flex items-center justify-between gap-3">
                    <span>{c.name}</span>
                    <span className="tabular-nums text-muted-foreground">{formatUsd(c.total)}</span>
                  </li>
                ))}
              </ul>
            )}
            <Link
              href="/reports/cashflow"
              className="mt-3 inline-block text-xs text-muted-foreground hover:underline"
            >
              Ver cashflow del mes →
            </Link>
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
              <ul className="space-y-1.5 text-sm">
                {data.upcomingForecasts.map((f) => (
                  <li key={f.id} className="flex items-center justify-between gap-3">
                    <span>
                      <span className="text-muted-foreground">{f.expectedDate}</span>{' '}
                      <span>{f.recurrenceName}</span>
                    </span>
                    <span className="tabular-nums text-muted-foreground">
                      {formatAmount(f.expectedAmount, f.currency)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            <Link
              href="/forecasts"
              className="mt-3 inline-block text-xs text-muted-foreground hover:underline"
            >
              Ver todas las previsiones →
            </Link>
          </CardContent>
        </Card>
      </div>

      {/* Últimas 10 transacciones */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Últimas transacciones</CardTitle>
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
                            tx.kind === 'income' && 'bg-emerald-50 text-emerald-700',
                            tx.kind === 'expense' && 'bg-rose-50 text-rose-700',
                            tx.kind === 'transfer' && 'bg-sky-50 text-sky-700',
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
          <Link
            href="/transactions"
            className="mt-3 inline-block text-xs text-muted-foreground hover:underline"
          >
            Ver todas las transacciones →
          </Link>
        </CardContent>
      </Card>
    </div>
  );
}

function KpiCard({
  title,
  real,
  budget,
  delta,
  tone,
}: {
  title: string;
  real: string;
  budget: string;
  delta: string;
  tone: 'good' | 'bad' | 'neutral';
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xs font-medium text-muted-foreground">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-2xl font-semibold tabular-nums">{formatUsd(real)}</p>
        <p className="mt-1 text-xs text-muted-foreground">
          Budget <span className="tabular-nums">{formatUsd(budget)}</span> ·{' '}
          <span className={cn('tabular-nums', toneClass(tone))}>Δ {formatUsd(delta)}</span>
        </p>
      </CardContent>
    </Card>
  );
}
