import Link from 'next/link';
import { redirect } from 'next/navigation';
import { requireHouseholdSession, SessionError } from '@/lib/auth/session';
import { loadCashflowData } from '@/lib/reports/cashflow-data';
import { deltaTone } from '@/lib/reports/cashflow';
import { Display, Label, Num, Hair, Body } from '@/components/ui/typography';
import { cn } from '@/lib/utils';
import { ReportsNav } from '../reports-nav';

export const metadata = {
  title: 'Cashflow del mes · gd-finanzas',
};

const MONTH_LABELS = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
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

function toneVar(tone: 'good' | 'bad' | 'neutral'): string {
  if (tone === 'good') return 'var(--good)';
  if (tone === 'bad') return 'var(--bad)';
  return 'var(--muted-foreground)';
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

  // Toplevel summary tones
  const netTone = deltaTone('income', report.totals.net.delta);

  return (
    <div className="space-y-8">
      <ReportsNav active="cashflow" />

      {/* HEADER */}
      <header className="flex flex-wrap items-end justify-between gap-6">
        <div className="min-w-0">
          <Label>Reportes · Cashflow del mes</Label>
          <Display size="lg" className="mt-2 block">
            {monthLabel}
          </Display>
          <Body className="mt-2 max-w-2xl">
            Real vs presupuesto en USD. Click en categoría hoja para ver las transacciones.
          </Body>
        </div>
        <nav className="flex items-baseline gap-5 font-display">
          <Link
            href={`/reports/cashflow?year=${prev.year}&month=${pad2(prev.month)}`}
            className="text-sm italic text-muted-foreground transition-colors hover:text-primary"
          >
            ◀ {MONTH_LABELS[prev.month - 1]}
          </Link>
          <Link
            href={`/reports/cashflow?year=${next.year}&month=${pad2(next.month)}`}
            className="text-sm italic text-muted-foreground transition-colors hover:text-primary"
          >
            {MONTH_LABELS[next.month - 1]} ▶
          </Link>
        </nav>
      </header>

      {/* TOPLINE KPI STRIP */}
      <section className="grid grid-cols-1 gap-px bg-border sm:grid-cols-3">
        <KpiBox
          label="Ingresos"
          real={report.totals.income.real}
          budget={report.totals.income.budget}
          deltaUsd={report.totals.income.delta}
          tone={deltaTone('income', report.totals.income.delta)}
          variant="good"
        />
        <KpiBox
          label="Gastos"
          real={report.totals.expense.real}
          budget={report.totals.expense.budget}
          deltaUsd={report.totals.expense.delta}
          tone={deltaTone('expense', report.totals.expense.delta)}
          variant="bad"
        />
        <KpiBox
          label="Neto"
          real={report.totals.net.real}
          budget={report.totals.net.budget}
          deltaUsd={report.totals.net.delta}
          tone={netTone}
          variant="primary"
        />
      </section>

      {/* DETAIL TABLE */}
      {report.rows.length === 0 ? (
        <div className="border border-dashed border-border p-12 text-center">
          <Body>
            Sin categorías cargadas. Corré{' '}
            <code className="font-mono text-foreground">npm run db:seed:categories</code>.
          </Body>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-y border-border">
                <th className="px-3 py-2.5 text-left font-sans text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                  Categoría
                </th>
                {['Budget', 'Real', 'Δ USD', 'Δ %'].map((h) => (
                  <th
                    key={h}
                    className="px-3 py-2.5 text-right font-sans text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground"
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {report.rows.map((row) => {
                const tone = deltaTone(row.category.kind, row.deltaUsd);
                const cVar = toneVar(tone);
                const isParent = !row.isLeaf;
                return (
                  <tr
                    key={row.category.id}
                    className={cn(
                      'border-t transition-colors',
                      isParent
                        ? 'border-border bg-card/30'
                        : 'border-border/40 hover:bg-primary/[0.04]',
                    )}
                  >
                    <td
                      className={cn(
                        'px-3 py-2.5',
                        row.category.depth === 1 && 'pl-10',
                      )}
                    >
                      {isParent ? (
                        <div className="flex items-center gap-2">
                          <span
                            aria-hidden
                            className="inline-block h-3 w-[3px]"
                            style={{
                              background:
                                row.category.kind === 'income'
                                  ? 'var(--good)'
                                  : 'var(--bad)',
                            }}
                          />
                          <span className="font-display text-base font-semibold text-foreground">
                            {row.category.name}
                          </span>
                        </div>
                      ) : (
                        <Link
                          href={drillHref(row.category.id)}
                          className="font-display text-base text-foreground transition-colors hover:text-primary hover:underline"
                        >
                          {row.category.name}
                        </Link>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-right">
                      <Num className="text-sm text-muted-foreground">{formatUsd(row.budget)}</Num>
                    </td>
                    <td className="px-3 py-2.5 text-right">
                      <Num className="text-sm text-foreground">{formatUsd(row.real)}</Num>
                    </td>
                    <td className="px-3 py-2.5 text-right">
                      <Num className="text-sm font-semibold" style={{ color: cVar }}>
                        {formatUsd(row.deltaUsd)}
                      </Num>
                    </td>
                    <td className="px-3 py-2.5 text-right">
                      <Num className="text-sm" style={{ color: cVar }}>
                        {formatPct(row.deltaPct)}
                      </Num>
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              {(['income', 'expense'] as const).map((k) => {
                const t = deltaTone(k, report.totals[k].delta);
                const cVar = toneVar(t);
                return (
                  <tr key={k} className="border-t border-border/60">
                    <td className="px-3 py-2.5">
                      <span
                        className={cn(
                          'font-display text-base font-semibold',
                          k === 'income' ? 'text-[color:var(--good)]' : 'text-[color:var(--bad)]',
                        )}
                      >
                        Total {k === 'income' ? 'Ingresos' : 'Gastos'}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-right">
                      <Num className="text-sm text-muted-foreground">
                        {formatUsd(report.totals[k].budget)}
                      </Num>
                    </td>
                    <td className="px-3 py-2.5 text-right">
                      <Num className="text-sm text-foreground">
                        {formatUsd(report.totals[k].real)}
                      </Num>
                    </td>
                    <td className="px-3 py-2.5 text-right">
                      <Num className="text-sm font-semibold" style={{ color: cVar }}>
                        {formatUsd(report.totals[k].delta)}
                      </Num>
                    </td>
                    <td className="px-3 py-2.5 text-right">
                      <Num className="text-sm text-muted-foreground">—</Num>
                    </td>
                  </tr>
                );
              })}
              <tr className="border-t-2 border-border bg-card/50">
                <td className="px-3 py-3">
                  <span className="font-display text-lg font-semibold text-foreground">
                    Neto
                  </span>
                </td>
                <td className="px-3 py-3 text-right">
                  <Num className="text-sm text-muted-foreground">
                    {formatUsd(report.totals.net.budget)}
                  </Num>
                </td>
                <td className="px-3 py-3 text-right">
                  <Num className="text-base font-semibold text-foreground">
                    {formatUsd(report.totals.net.real)}
                  </Num>
                </td>
                <td className="px-3 py-3 text-right">
                  <Num className="text-base font-semibold" style={{ color: toneVar(netTone) }}>
                    {formatUsd(report.totals.net.delta)}
                  </Num>
                </td>
                <td className="px-3 py-3 text-right">
                  <Num className="text-sm text-muted-foreground">—</Num>
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  );
}

function KpiBox({
  label,
  real,
  budget,
  deltaUsd,
  tone,
  variant,
}: {
  label: string;
  real: string;
  budget: string;
  deltaUsd: string;
  tone: 'good' | 'bad' | 'neutral';
  variant: 'good' | 'bad' | 'primary';
}) {
  const colorVar =
    variant === 'good'
      ? 'var(--good)'
      : variant === 'bad'
        ? 'var(--bad)'
        : 'var(--primary)';
  const toneColor = toneVar(tone);
  return (
    <div className="bg-card p-5">
      <Label>{label}</Label>
      <Display size="md" className="mt-3 block tabular-nums" style={{ color: colorVar }}>
        {formatUsd(real)}
      </Display>
      <Hair className="my-3 bg-border/60" />
      <div className="flex items-baseline justify-between gap-2">
        <Num className="text-xs text-muted-foreground">budget {formatUsd(budget)}</Num>
        <Num className="text-xs font-semibold" style={{ color: toneColor }}>
          {formatUsd(deltaUsd)}
        </Num>
      </div>
    </div>
  );
}
