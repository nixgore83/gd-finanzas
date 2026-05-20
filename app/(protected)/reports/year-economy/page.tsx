import Link from 'next/link';
import { redirect } from 'next/navigation';
import { requireHouseholdSession, SessionError } from '@/lib/auth/session';
import { loadYearEconomyData } from '@/lib/reports/year-economy-data';
import type { YearEconomyCategoryRow } from '@/lib/reports/year-economy';
import { cn } from '@/lib/utils';
import { ReportsNav } from '../reports-nav';
import { MonthlyChart, SavingsChart } from './charts';

export const metadata = {
  title: 'Año económico · gd-finanzas',
};

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function parseYear(sp: Record<string, string | string[] | undefined>): number {
  const raw = sp.year;
  const now = new Date().getFullYear();
  if (typeof raw === 'string' && /^\d{4}$/.test(raw)) {
    const n = Number(raw);
    if (n >= 2020 && n <= 2100) return n;
  }
  return now;
}

function todayIso(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth() + 1;
  const d = now.getDate();
  return `${y}-${m < 10 ? `0${m}` : m}-${d < 10 ? `0${d}` : d}`;
}

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

function formatPct(pct: number | null): string {
  if (pct === null) return '—';
  return `${pct.toFixed(1)}%`;
}

const SEMAPHORE_LABEL: Record<'green' | 'yellow' | 'red' | 'neutral', string> = {
  green: 'En track',
  yellow: 'Alerta',
  red: 'Atrasado',
  neutral: 'Sin datos',
};
const SEMAPHORE_BG: Record<'green' | 'yellow' | 'red' | 'neutral', string> = {
  green: 'bg-emerald-100 text-emerald-900 border-emerald-300',
  yellow: 'bg-amber-100 text-amber-900 border-amber-300',
  red: 'bg-rose-100 text-rose-900 border-rose-300',
  neutral: 'bg-muted text-muted-foreground border-border',
};

export default async function YearEconomyPage({
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

  const sp = await searchParams;
  const year = parseYear(sp);
  const today = todayIso();
  const { report, targetSavingsMonthlyUsd } = await loadYearEconomyData(
    session.householdId,
    year,
    today,
  );

  const incomeRows = report.categoryRows.filter((r) => r.kind === 'income');
  const expenseRows = report.categoryRows.filter((r) => r.kind === 'expense');

  return (
    <div className="space-y-6">
      <ReportsNav active="year-economy" />

      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-semibold">Año económico · {year}</h1>
        <div className="flex items-center gap-3 text-sm">
          <Link
            href={`/reports/year-economy?year=${year - 1}`}
            className="text-muted-foreground hover:underline"
          >
            ◀ {year - 1}
          </Link>
          <Link
            href={`/reports/year-economy?year=${year + 1}`}
            className="text-muted-foreground hover:underline"
          >
            {year + 1} ▶
          </Link>
        </div>
      </div>

      <p className="text-sm text-muted-foreground">
        Cash-flow del año en USD + proyección a diciembre vía previsiones pending. Ahorro =
        neto + categorías marcadas como inversión.
      </p>

      <section className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <KpiCard label="Ingresos YTD" value={formatUsd(report.kpis.incomeYtdUsd)} />
        <KpiCard label="Gastos YTD" value={formatUsd(report.kpis.expenseYtdUsd)} />
        <KpiCard label="Neto YTD" value={formatUsd(report.kpis.netYtdUsd)} />
        <KpiCard
          label="Tasa de ahorro YTD"
          value={formatPct(report.kpis.savingsRateYtdPct)}
        />
      </section>

      <section className="rounded-md border bg-card p-4 space-y-2">
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="text-base font-semibold">Trayectoria a IF</h2>
          <span
            className={cn(
              'rounded-full border px-2 py-0.5 text-xs font-medium',
              SEMAPHORE_BG[report.trajectory.semaphore],
            )}
          >
            {SEMAPHORE_LABEL[report.trajectory.semaphore]}
            {report.trajectory.pct !== null && (
              <> · {(report.trajectory.pct * 100).toFixed(0)}%</>
            )}
          </span>
        </div>
        <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm md:grid-cols-4">
          <Stat label="Target/mes" value={formatUsd(report.trajectory.targetMonthlyUsd)} />
          <Stat label="Meses transcurridos" value={String(report.trajectory.monthsElapsed)} />
          <Stat label="Esperado YTD" value={formatUsd(report.trajectory.expectedAccumUsd)} />
          <Stat
            label="Ahorro real YTD"
            value={formatUsd(report.trajectory.actualAccumUsd)}
          />
        </div>
        <p
          className={cn(
            'text-sm',
            report.trajectory.deltaUsd >= 0 ? 'text-emerald-700' : 'text-rose-700',
          )}
        >
          Δ vs target: {formatUsd(report.trajectory.deltaUsd)} (incluye{' '}
          {formatUsd(report.kpis.investmentYtdUsd)} en categorías de inversión).
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="text-base font-semibold">Ahorro mensual</h2>
        <SavingsChart
          monthly={report.monthly}
          targetMonthly={report.trajectory.targetMonthlyUsd}
        />
        <p className="text-xs text-muted-foreground">
          Barras oscuras = meses reales · barras claras = proyección via forecasts.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="text-base font-semibold">Ingresos vs gastos por mes</h2>
        <MonthlyChart monthly={report.monthly} />
      </section>

      <section className="space-y-3">
        <h2 className="text-base font-semibold">Por categoría · año {year}</h2>
        <CategoryTable
          title="Ingresos"
          rows={incomeRows}
          year={year}
          emptyHint="Sin categorías de ingreso."
        />
        <CategoryTable
          title="Gastos"
          rows={expenseRows}
          year={year}
          emptyHint="Sin categorías de gasto."
        />
        <p className="text-xs text-muted-foreground">
          Target ahorro: {formatUsd(targetSavingsMonthlyUsd)}/mes. Editable en{' '}
          <Link href="/settings/metas" className="underline">
            /settings/metas
          </Link>
          .
        </p>
      </section>
    </div>
  );
}

function KpiCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border bg-card p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 text-xl font-semibold tabular-nums">{value}</div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-sm font-medium tabular-nums">{value}</span>
    </div>
  );
}

function CategoryTable({
  title,
  rows,
  year,
  emptyHint,
}: {
  title: string;
  rows: YearEconomyCategoryRow[];
  year: number;
  emptyHint: string;
}) {
  if (rows.length === 0) {
    return (
      <div className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
        {emptyHint}
      </div>
    );
  }
  return (
    <div className="overflow-x-auto rounded-md border">
      <table className="w-full text-sm">
        <thead className="bg-muted/40">
          <tr className="text-left">
            <th className="px-3 py-2 font-medium">{title}</th>
            <th className="px-3 py-2 text-right font-medium">Real YTD</th>
            <th className="px-3 py-2 text-right font-medium">Proyec. dic</th>
            <th className="px-3 py-2 text-right font-medium">Budget año</th>
            <th className="px-3 py-2 text-right font-medium">Δ vs budget</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const deltaN = Number.parseFloat(row.deltaUsd);
            const toneClass =
              row.kind === 'income'
                ? deltaN > 0
                  ? 'text-emerald-700'
                  : deltaN < 0
                    ? 'text-rose-700'
                    : 'text-muted-foreground'
                : deltaN < 0
                  ? 'text-emerald-700'
                  : deltaN > 0
                    ? 'text-rose-700'
                    : 'text-muted-foreground';
            const isParent = !row.isLeaf;
            const drillHref = `/transactions?categoryId=${row.id}&from=${year}-01-01&to=${year}-12-31`;
            return (
              <tr
                key={row.id}
                className={cn('border-t', isParent && 'bg-muted/10 font-medium')}
              >
                <td
                  className={cn(
                    'px-3 py-1.5',
                    row.depth === 1 && 'pl-8 text-muted-foreground',
                  )}
                >
                  {row.isLeaf ? (
                    <Link href={drillHref} className="hover:underline">
                      {row.depth === 1 ? '↳ ' : ''}
                      {row.name}
                    </Link>
                  ) : (
                    <>
                      {row.depth === 1 ? '↳ ' : ''}
                      {row.name}
                    </>
                  )}
                  {row.isInvestment && (
                    <span className="ml-2 inline-block rounded bg-indigo-100 px-1.5 py-0.5 text-[10px] font-medium text-indigo-800">
                      Inversión
                    </span>
                  )}
                </td>
                <td className="px-3 py-1.5 text-right tabular-nums">
                  {formatUsd(row.realYtdUsd)}
                </td>
                <td className="px-3 py-1.5 text-right tabular-nums">
                  {formatUsd(row.projectedDecUsd)}
                </td>
                <td className="px-3 py-1.5 text-right tabular-nums">
                  {formatUsd(row.budgetAnnualUsd)}
                </td>
                <td className={cn('px-3 py-1.5 text-right tabular-nums', toneClass)}>
                  {formatUsd(row.deltaUsd)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
