import Link from 'next/link';
import { redirect } from 'next/navigation';
import { requireHouseholdSession, SessionError } from '@/lib/auth/session';
import { loadYearEconomyData } from '@/lib/reports/year-economy-data';
import type { YearEconomyCategoryRow } from '@/lib/reports/year-economy';
import { Display, Label, Num, Hair, Body } from '@/components/ui/typography';
import { cn } from '@/lib/utils';
import { ReportsNav } from '../reports-nav';
import { MonthlyChart, SavingsChart } from './charts';

export const metadata = {
  title: 'Año económico · gd-finanzas',
};

type SearchParams = Promise<Record<string, string | string[] | undefined>>;
type Semaphore = 'green' | 'yellow' | 'red' | 'neutral';

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

const SEMAPHORE_LABEL: Record<Semaphore, string> = {
  green: 'En track',
  yellow: 'Alerta',
  red: 'Atrasado',
  neutral: 'Sin datos',
};

/** Token CSS para tintar pills, dots y números según el semáforo. */
const SEMAPHORE_VAR: Record<Semaphore, string> = {
  green: 'var(--good)',
  yellow: 'var(--attn)',
  red: 'var(--bad)',
  neutral: 'var(--muted-foreground)',
};

/** Editorial-ish lead based on semaphore + delta magnitude. */
function leadCopy(semaphore: Semaphore, pct: number | null, year: number): string {
  if (semaphore === 'neutral') {
    return `Pocos meses para sacar conclusiones todavía — el año ${year} recién arranca.`;
  }
  const pctText = pct !== null ? `${Math.abs((pct - 1) * 100).toFixed(0)}%` : '—';
  if (semaphore === 'green') {
    return pct !== null && pct >= 1
      ? `En marcha hacia la libertad financiera — la trayectoria YTD va ${pctText} por encima del objetivo.`
      : `En marcha hacia la libertad financiera.`;
  }
  if (semaphore === 'yellow') {
    return `Hay margen, pero el ritmo aprieta — la trayectoria YTD va ${pctText} por debajo del objetivo.`;
  }
  // red
  return `El año va ${pctText} por debajo del objetivo de ahorro. Conviene revisar el plan operativo antes de la próxima revisión.`;
}

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

  const semaphore: Semaphore = report.trajectory.semaphore;
  const semaphoreVar = SEMAPHORE_VAR[semaphore];

  // trajectory.*Usd are already numbers (see lib/reports/year-economy.ts).
  const deltaN = report.trajectory.deltaUsd;
  const deltaIsGood = Number.isFinite(deltaN) ? deltaN >= 0 : null;

  // Progress fraction for the trajectory bar (actual vs expected).
  const expected = report.trajectory.expectedAccumUsd;
  const actual = report.trajectory.actualAccumUsd;
  const max = Math.max(expected, actual, 1);
  const actualPct = (actual / max) * 100;
  const expectedPct = (expected / max) * 100;

  return (
    <div className="space-y-10">
      <ReportsNav active="year-economy" />

      {/* ============ HERO ============ */}
      <header className="pt-2">
        <div className="flex flex-wrap items-end justify-between gap-6">
          <div className="min-w-0">
            <Label>Reportes · Año económico</Label>
            <div className="mt-3 flex items-baseline gap-5">
              <Display size="xl" className="tabular-nums">
                {year}
              </Display>
              <span
                className="inline-flex items-center gap-2 border-l border-border pl-5 font-sans text-[11px] font-semibold uppercase tracking-[0.18em]"
                style={{ color: semaphoreVar }}
              >
                <span
                  className="inline-block size-2 rounded-full"
                  style={{ background: semaphoreVar }}
                  aria-hidden
                />
                {SEMAPHORE_LABEL[semaphore]}
                {report.trajectory.pct !== null && (
                  <span className="font-mono">
                    · {(report.trajectory.pct * 100).toFixed(0)}%
                  </span>
                )}
              </span>
            </div>
            <Body className="mt-2 max-w-3xl">
              {leadCopy(semaphore, report.trajectory.pct, year)}
            </Body>
          </div>

          {/* Year navigation */}
          <nav className="flex items-baseline gap-5 font-display">
            <Link
              href={`/reports/year-economy?year=${year - 1}`}
              className="text-base italic text-muted-foreground transition-colors hover:text-primary"
            >
              ◀ {year - 1}
            </Link>
            <Link
              href={`/reports/year-economy?year=${year + 1}`}
              className="text-base italic text-muted-foreground transition-colors hover:text-primary"
            >
              {year + 1} ▶
            </Link>
          </nav>
        </div>
      </header>

      <Hair thick />

      {/* ============ TRAJECTORY HERO BLOCK ============ */}
      <section className="relative overflow-hidden border border-border bg-card/40 px-7 py-7">
        {/* Subtle ambient tint from the semaphore */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-[0.08]"
          style={{
            background: `radial-gradient(ellipse 60% 80% at 0% 0%, ${semaphoreVar}, transparent 70%)`,
          }}
        />

        <div className="relative grid grid-cols-1 gap-6 md:grid-cols-[1.4fr_1fr_1fr_1fr]">
          {/* Accumulated YTD — the headliner */}
          <div>
            <Label>Acumulado YTD</Label>
            <Display
              size="xl"
              className="mt-3 block tabular-nums"
              style={{ color: semaphoreVar }}
            >
              {formatUsd(report.trajectory.actualAccumUsd)}
            </Display>
            <div className="mt-2 font-display text-base italic text-muted-foreground">
              de <Num className="not-italic text-foreground">{formatUsd(report.trajectory.expectedAccumUsd)}</Num>{' '}
              esperado al mes <Num className="not-italic">{report.trajectory.monthsElapsed}</Num>
            </div>
          </div>

          {/* Target/mes */}
          <div className="border-l border-border pl-6">
            <Label>Meta de ahorro mensual</Label>
            <Display size="lg" className="mt-3 block tabular-nums text-primary">
              {formatUsd(report.trajectory.targetMonthlyUsd)}
            </Display>
            <div className="mt-2 font-sans text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
              editable en{' '}
              <Link href="/settings/metas" className="link normal-case tracking-normal">
                /settings/metas
              </Link>
            </div>
          </div>

          {/* Investment YTD — the often-forgotten piece */}
          <div className="border-l border-border pl-6">
            <Label>Inversión YTD</Label>
            <Display size="lg" className="mt-3 block tabular-nums text-[color:var(--attn)]">
              {formatUsd(report.kpis.investmentYtdUsd)}
            </Display>
            <div className="mt-2 font-display text-sm italic text-muted-foreground">
              incluida en el ahorro
            </div>
          </div>

          {/* Δ vs target — the call to action */}
          <div className="border-l border-border pl-6">
            <Label>Δ vs objetivo</Label>
            <Display
              size="lg"
              className="mt-3 block tabular-nums"
              style={{
                color:
                  deltaIsGood === null
                    ? 'var(--muted-foreground)'
                    : deltaIsGood
                      ? 'var(--good)'
                      : 'var(--bad)',
              }}
            >
              {deltaIsGood && Number.isFinite(deltaN) && deltaN > 0 ? '+' : ''}
              {formatUsd(report.trajectory.deltaUsd)}
            </Display>
            <div className="mt-2 font-sans text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
              vs <Num className="normal-case tracking-normal text-muted-foreground">{formatUsd(report.trajectory.expectedAccumUsd)}</Num>{' '}
              esperado
            </div>
          </div>
        </div>

        {/* Progress track: actual vs expected */}
        <div className="relative mt-7">
          <div className="h-1.5 w-full bg-muted/60">
            <div
              className="h-full transition-all"
              style={{
                width: `${Math.min(100, actualPct)}%`,
                background: semaphoreVar,
              }}
            />
          </div>
          {/* expected marker */}
          <div
            className="absolute top-[-3px] h-[14px] w-px bg-foreground"
            style={{ left: `${Math.min(100, expectedPct)}%` }}
            aria-hidden
          />
          <div className="mt-2 flex items-center justify-between font-sans text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
            <span>Ene</span>
            <span>esperado al día de hoy ▲</span>
            <span>Dic</span>
          </div>
        </div>
      </section>

      {/* ============ KPI STRIP ============ */}
      <section>
        <Label>Resumen YTD</Label>
        <div className="mt-3 grid grid-cols-1 gap-px bg-border sm:grid-cols-2 lg:grid-cols-4">
          <KpiCard label="Ingresos YTD" value={formatUsd(report.kpis.incomeYtdUsd)} variant="good" />
          <KpiCard label="Gastos YTD" value={formatUsd(report.kpis.expenseYtdUsd)} variant="bad" />
          <KpiCard label="Neto YTD" value={formatUsd(report.kpis.netYtdUsd)} variant="primary" />
          <KpiCard
            label="Tasa de ahorro YTD"
            value={formatPct(report.kpis.savingsRateYtdPct)}
            variant="attn"
          />
        </div>
      </section>

      {/* ============ CHARTS ============ */}
      <section>
        <div className="flex items-baseline justify-between">
          <Display size="md">Ahorro mensual</Display>
          <Label>real · proyectado · vs meta</Label>
        </div>
        <Hair className="mt-3 mb-4" />
        <SavingsChart monthly={report.monthly} targetMonthly={report.trajectory.targetMonthlyUsd} />
        <Body className="mt-3">
          Barras sólidas = meses reales. Barras con trama = proyección vía previsiones pendientes.
        </Body>
      </section>

      <section>
        <div className="flex items-baseline justify-between">
          <Display size="md">Ingresos vs gastos por mes</Display>
          <Label>línea = neto</Label>
        </div>
        <Hair className="mt-3 mb-4" />
        <MonthlyChart monthly={report.monthly} />
      </section>

      {/* ============ CATEGORY TABLES ============ */}
      <section className="space-y-8">
        <div className="flex items-baseline justify-between">
          <Display size="md">Por categoría — año {year}</Display>
          <Label>real · proyectado · budget · Δ</Label>
        </div>

        <CategoryTable
          title="Ingresos"
          rows={incomeRows}
          year={year}
          emptyHint="Sin categorías de ingreso este año."
        />
        <CategoryTable
          title="Gastos"
          rows={expenseRows}
          year={year}
          emptyHint="Sin categorías de gasto este año."
        />

        <Body className="text-xs">
          Target ahorro mensual: <Num className="not-italic text-foreground">{formatUsd(targetSavingsMonthlyUsd)}</Num>. Editable en{' '}
          <Link href="/settings/metas" className="link not-italic">
            /settings/metas
          </Link>
          .
        </Body>
      </section>
    </div>
  );
}

function KpiCard({
  label,
  value,
  variant = 'primary',
}: {
  label: string;
  value: string;
  variant?: 'primary' | 'good' | 'bad' | 'attn';
}) {
  const colorVar =
    variant === 'good'
      ? 'var(--good)'
      : variant === 'bad'
        ? 'var(--bad)'
        : variant === 'attn'
          ? 'var(--attn)'
          : 'var(--primary)';
  return (
    <div className="bg-card p-5">
      <Label>{label}</Label>
      <Display size="md" className="mt-3 block tabular-nums" style={{ color: colorVar }}>
        {value}
      </Display>
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
      <div>
        <div className="flex items-baseline gap-3 pb-2">
          <Display size="sm">{title}</Display>
        </div>
        <Hair />
        <Body className="mt-4">{emptyHint}</Body>
      </div>
    );
  }
  const kindVar = title.toLowerCase().startsWith('ingreso') ? 'var(--good)' : 'var(--bad)';
  return (
    <div>
      <div className="flex items-baseline gap-3 pb-2">
        <span className="inline-block h-4 w-[3px]" style={{ background: kindVar }} aria-hidden />
        <Display size="sm" style={{ color: kindVar }}>
          {title}
        </Display>
        <Num className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
          {rows.filter((r) => r.isLeaf).length} hojas · {rows.filter((r) => !r.isLeaf).length} parents
        </Num>
      </div>

      <div className="overflow-x-auto border-y border-border">
        <table className="w-full">
          <thead>
            <tr className="border-b border-border/60 bg-card/30">
              <th className="px-3 py-2.5 text-left font-sans text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                Categoría
              </th>
              {['Real YTD', 'Proyec. dic', 'Budget año', 'Δ vs budget'].map((h) => (
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
            {rows.map((row) => {
              const deltaN = Number.parseFloat(row.deltaUsd);
              const toneVar =
                row.kind === 'income'
                  ? deltaN > 0
                    ? 'var(--good)'
                    : deltaN < 0
                      ? 'var(--bad)'
                      : 'var(--muted-foreground)'
                  : deltaN < 0
                    ? 'var(--good)'
                    : deltaN > 0
                      ? 'var(--bad)'
                      : 'var(--muted-foreground)';
              const isParent = !row.isLeaf;
              const drillHref = `/transactions?categoryId=${row.id}&from=${year}-01-01&to=${year}-12-31`;
              return (
                <tr
                  key={row.id}
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
                      row.depth === 1 && 'pl-10',
                    )}
                  >
                    {isParent ? (
                      <span className="font-display text-base text-foreground">{row.name}</span>
                    ) : row.isLeaf ? (
                      <Link
                        href={drillHref}
                        className="font-display text-base text-foreground hover:text-primary hover:underline"
                      >
                        {row.name}
                      </Link>
                    ) : (
                      <span className="font-display text-base text-foreground">{row.name}</span>
                    )}
                    {row.isInvestment && (
                      <span
                        className="ml-2 inline-block rounded-full px-2 py-0.5 align-middle font-sans text-[9px] font-semibold uppercase tracking-[0.14em]"
                        style={{
                          background: 'color-mix(in oklab, var(--attn) 18%, transparent)',
                          color: 'var(--attn)',
                        }}
                      >
                        Inversión
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2.5 text-right">
                    <Num className="text-sm text-foreground">{formatUsd(row.realYtdUsd)}</Num>
                  </td>
                  <td className="px-3 py-2.5 text-right">
                    <Num className="text-sm text-muted-foreground">
                      {formatUsd(row.projectedDecUsd)}
                    </Num>
                  </td>
                  <td className="px-3 py-2.5 text-right">
                    <Num className="text-sm text-muted-foreground">
                      {formatUsd(row.budgetAnnualUsd)}
                    </Num>
                  </td>
                  <td className="px-3 py-2.5 text-right">
                    <Num className="text-sm font-semibold" style={{ color: toneVar }}>
                      {formatUsd(row.deltaUsd)}
                    </Num>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
