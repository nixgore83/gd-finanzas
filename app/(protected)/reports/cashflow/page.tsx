import Link from 'next/link';
import { redirect } from 'next/navigation';
import { requireHouseholdSession, SessionError } from '@/lib/auth/session';
import { loadCashflowData } from '@/lib/reports/cashflow-data';
import { deltaTone } from '@/lib/reports/cashflow';
import { cn } from '@/lib/utils';
import { ReportsNav } from '../reports-nav';

export const metadata = {
  title: 'Cashflow del mes · gd-finanzas',
};

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

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

function parseYearMonth(sp: Record<string, string | string[] | undefined>): {
  year: number;
  month: number;
} {
  const yearRaw = sp.year;
  const monthRaw = sp.month;
  const now = new Date();
  const year =
    typeof yearRaw === 'string' && /^\d{4}$/.test(yearRaw) && Number(yearRaw) >= 2020 && Number(yearRaw) <= 2100
      ? Number(yearRaw)
      : now.getFullYear();
  const month =
    typeof monthRaw === 'string' && /^\d{1,2}$/.test(monthRaw) && Number(monthRaw) >= 1 && Number(monthRaw) <= 12
      ? Number(monthRaw)
      : now.getMonth() + 1;
  return { year, month };
}

function prevMonth(year: number, month: number): { year: number; month: number } {
  if (month === 1) return { year: year - 1, month: 12 };
  return { year, month: month - 1 };
}
function nextMonth(year: number, month: number): { year: number; month: number } {
  if (month === 12) return { year: year + 1, month: 1 };
  return { year, month: month + 1 };
}

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

function formatPct(pct: number | null): string {
  if (pct === null) return '—';
  const sign = pct > 0 ? '+' : '';
  return `${sign}${pct.toFixed(1)}%`;
}

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function CashflowReportPage({
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
  const { year, month } = parseYearMonth(sp);
  const { report, range } = await loadCashflowData(session.householdId, year, month);

  const prev = prevMonth(year, month);
  const next = nextMonth(year, month);
  const monthLabel = `${MONTH_LABELS[month - 1]} ${year}`;

  function drillHref(categoryId: string): string {
    const params = new URLSearchParams();
    params.set('categoryId', categoryId);
    params.set('from', range.from);
    params.set('to', range.to);
    return `/transactions?${params.toString()}`;
  }

  return (
    <div className="space-y-4">
      <ReportsNav active="cashflow" />
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-2xl font-semibold">Cashflow · {monthLabel}</h1>
        <div className="flex items-center gap-3 text-sm">
          <Link
            href={`/reports/cashflow?year=${prev.year}&month=${pad2(prev.month)}`}
            className="text-muted-foreground hover:underline"
          >
            ◀ {MONTH_LABELS[prev.month - 1]} {prev.year}
          </Link>
          <Link
            href={`/reports/cashflow?year=${next.year}&month=${pad2(next.month)}`}
            className="text-muted-foreground hover:underline"
          >
            {MONTH_LABELS[next.month - 1]} {next.year} ▶
          </Link>
        </div>
      </div>

      <p className="text-sm text-muted-foreground">
        Budgets y montos reales en USD. Clic en categoría hoja para ver las transacciones del mes.
      </p>

      {report.rows.length === 0 ? (
        <div className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">
          No hay categorías cargadas. Corré <code>npm run db:seed:categories</code>.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-md border">
          <table className="w-full text-sm">
            <thead className="bg-muted/40">
              <tr className="text-left">
                <th className="px-3 py-2 font-medium">Categoría</th>
                <th className="px-3 py-2 text-right font-medium">Budget</th>
                <th className="px-3 py-2 text-right font-medium">Real</th>
                <th className="px-3 py-2 text-right font-medium">Δ USD</th>
                <th className="px-3 py-2 text-right font-medium">Δ %</th>
              </tr>
            </thead>
            <tbody>
              {report.rows.map((row) => {
                const tone = deltaTone(row.category.kind, row.deltaUsd);
                const toneClass =
                  tone === 'good'
                    ? 'text-emerald-700'
                    : tone === 'bad'
                      ? 'text-rose-700'
                      : 'text-muted-foreground';
                const isParent = !row.isLeaf;
                return (
                  <tr
                    key={row.category.id}
                    className={cn('border-t', isParent && 'bg-muted/10 font-medium')}
                  >
                    <td
                      className={cn(
                        'px-3 py-1.5',
                        row.category.depth === 1 && 'pl-8 text-muted-foreground',
                      )}
                    >
                      {row.isLeaf ? (
                        <Link
                          href={drillHref(row.category.id)}
                          className="hover:underline"
                        >
                          {row.category.depth === 1 ? '↳ ' : ''}
                          {row.category.name}
                        </Link>
                      ) : (
                        <>
                          {row.category.depth === 1 ? '↳ ' : ''}
                          {row.category.name}
                        </>
                      )}
                    </td>
                    <td className="px-3 py-1.5 text-right tabular-nums">
                      {formatUsd(row.budget)}
                    </td>
                    <td className="px-3 py-1.5 text-right tabular-nums">
                      {formatUsd(row.real)}
                    </td>
                    <td className={cn('px-3 py-1.5 text-right tabular-nums', toneClass)}>
                      {formatUsd(row.deltaUsd)}
                    </td>
                    <td className={cn('px-3 py-1.5 text-right tabular-nums', toneClass)}>
                      {formatPct(row.deltaPct)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot className="bg-muted/30 text-sm">
              <tr className="border-t">
                <td className="px-3 py-2 font-medium">Total Ingresos</td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {formatUsd(report.totals.income.budget)}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {formatUsd(report.totals.income.real)}
                </td>
                <td
                  className={cn(
                    'px-3 py-2 text-right tabular-nums',
                    deltaTone('income', report.totals.income.delta) === 'good'
                      ? 'text-emerald-700'
                      : deltaTone('income', report.totals.income.delta) === 'bad'
                        ? 'text-rose-700'
                        : 'text-muted-foreground',
                  )}
                >
                  {formatUsd(report.totals.income.delta)}
                </td>
                <td className="px-3 py-2 text-right text-muted-foreground">—</td>
              </tr>
              <tr className="border-t">
                <td className="px-3 py-2 font-medium">Total Gastos</td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {formatUsd(report.totals.expense.budget)}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {formatUsd(report.totals.expense.real)}
                </td>
                <td
                  className={cn(
                    'px-3 py-2 text-right tabular-nums',
                    deltaTone('expense', report.totals.expense.delta) === 'good'
                      ? 'text-emerald-700'
                      : deltaTone('expense', report.totals.expense.delta) === 'bad'
                        ? 'text-rose-700'
                        : 'text-muted-foreground',
                  )}
                >
                  {formatUsd(report.totals.expense.delta)}
                </td>
                <td className="px-3 py-2 text-right text-muted-foreground">—</td>
              </tr>
              <tr className="border-t bg-muted/50">
                <td className="px-3 py-2 font-semibold">Neto</td>
                <td className="px-3 py-2 text-right tabular-nums font-medium">
                  {formatUsd(report.totals.net.budget)}
                </td>
                <td className="px-3 py-2 text-right tabular-nums font-medium">
                  {formatUsd(report.totals.net.real)}
                </td>
                <td
                  className={cn(
                    'px-3 py-2 text-right tabular-nums font-medium',
                    deltaTone('income', report.totals.net.delta) === 'good'
                      ? 'text-emerald-700'
                      : deltaTone('income', report.totals.net.delta) === 'bad'
                        ? 'text-rose-700'
                        : 'text-muted-foreground',
                  )}
                >
                  {formatUsd(report.totals.net.delta)}
                </td>
                <td className="px-3 py-2 text-right text-muted-foreground">—</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  );
}
