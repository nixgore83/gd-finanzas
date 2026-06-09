import Link from 'next/link';
import { redirect } from 'next/navigation';
import { requireHouseholdSession, SessionError } from '@/lib/auth/session';
import { loadBreakdownData } from '@/lib/reports/breakdown-data';
import type { BreakdownLevel } from '@/lib/reports/breakdown';
import { monthRange } from '@/lib/reports/cashflow-data';
import { Display, Label, Num, Body } from '@/components/ui/typography';
import { cn } from '@/lib/utils';
import { BreakdownDonut } from './donut';
import { ReportsNav } from '../reports-nav';

export const metadata = {
  title: 'Breakdown de gastos · gd-finanzas',
};

const MONTH_LABELS = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
];

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

function parseQuery(sp: Record<string, string | string[] | undefined>): {
  year: number;
  month: number;
  level: BreakdownLevel;
} {
  const yearRaw = sp.year;
  const monthRaw = sp.month;
  const levelRaw = sp.level;
  const now = new Date();
  const year =
    typeof yearRaw === 'string' &&
    /^\d{4}$/.test(yearRaw) &&
    Number(yearRaw) >= 2020 &&
    Number(yearRaw) <= 2100
      ? Number(yearRaw)
      : now.getFullYear();
  const month =
    typeof monthRaw === 'string' &&
    /^\d{1,2}$/.test(monthRaw) &&
    Number(monthRaw) >= 1 &&
    Number(monthRaw) <= 12
      ? Number(monthRaw)
      : now.getMonth() + 1;
  const level: BreakdownLevel = levelRaw === 'leaf' ? 'leaf' : 'parent';
  return { year, month, level };
}

function prevMonth(year: number, month: number): { year: number; month: number } {
  if (month === 1) return { year: year - 1, month: 12 };
  return { year, month: month - 1 };
}
function nextMonth(year: number, month: number): { year: number; month: number } {
  if (month === 12) return { year: year + 1, month: 1 };
  return { year, month: month + 1 };
}

function formatUsd(amount: string): string {
  const n = Number.parseFloat(amount);
  if (!Number.isFinite(n)) return '—';
  return new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(n);
}

/** Mismo arreglo de colores que donut.tsx — mantener sincronizado. */
const FALLBACK_PALETTE = [
  '#8fb89a', '#c9a96e', '#d97a4a', '#7fa3b5', '#a48bb5',
  '#d4b85a', '#769d83', '#b56b53', '#8a9bc4',
];

function colorForRow(row: { color: string | null }, i: number): string {
  return row.color ?? FALLBACK_PALETTE[i % FALLBACK_PALETTE.length] ?? '#7a7a6a';
}

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function BreakdownReportPage({
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
  const { year, month, level } = parseQuery(sp);
  const data = await loadBreakdownData(session.householdId, year, month, level);
  const range = monthRange(year, month);

  const prev = prevMonth(year, month);
  const next = nextMonth(year, month);
  const monthLabel = `${MONTH_LABELS[month - 1]} ${year}`;

  function drillHref(catId: string): string {
    const sp = new URLSearchParams();
    sp.set('categoryId', catId);
    sp.set('from', range.from);
    sp.set('to', range.to);
    return `/transactions?${sp.toString()}`;
  }

  function levelHref(next: BreakdownLevel): string {
    const sp = new URLSearchParams();
    sp.set('year', String(year));
    sp.set('month', pad2(month));
    sp.set('level', next);
    return `/reports/breakdown?${sp.toString()}`;
  }

  return (
    <div className="space-y-8">
      <ReportsNav active="breakdown" />

      <header className="flex flex-wrap items-end justify-between gap-6">
        <div className="min-w-0">
          <Label>Reportes · Breakdown</Label>
          <Display size="lg" className="mt-2 block">
            Gastos por categoría
          </Display>
          <Body className="mt-2 max-w-2xl">
            {monthLabel} · USD. Click en una hoja para ver las transacciones.
          </Body>
        </div>
        <nav className="flex items-baseline gap-5 font-display">
          <Link
            href={`/reports/breakdown?year=${prev.year}&month=${pad2(prev.month)}&level=${level}`}
            className="text-sm italic text-muted-foreground transition-colors hover:text-primary"
          >
            ◀ {MONTH_LABELS[prev.month - 1]}
          </Link>
          <Link
            href={`/reports/breakdown?year=${next.year}&month=${pad2(next.month)}&level=${level}`}
            className="text-sm italic text-muted-foreground transition-colors hover:text-primary"
          >
            {MONTH_LABELS[next.month - 1]} ▶
          </Link>
        </nav>
      </header>

      {/* LEVEL TOGGLE */}
      <div className="flex items-baseline gap-1">
        <FilterPill href={levelHref('parent')} active={level === 'parent'}>
          Categoría padre
        </FilterPill>
        <FilterPill href={levelHref('leaf')} active={level === 'leaf'}>
          Hoja
        </FilterPill>
      </div>

      {data.rows.length === 0 ? (
        <div className="border border-dashed border-border p-12 text-center">
          <Display size="sm">Sin gastos este mes</Display>
          <Body className="mt-3">No hay transacciones tipo gasto en {monthLabel}.</Body>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-8 md:grid-cols-2">
          <BreakdownDonut rows={data.rows} total={data.total} />

          {/* Detail list — same style as dashboard "Las cinco del mes" */}
          <div>
            <div className="flex items-baseline justify-between border-b border-border pb-2">
              <Display size="sm">Detalle</Display>
              <Label>
                {data.rows.length} {level === 'leaf' ? 'hojas' : 'padres'}
              </Label>
            </div>
            <ol className="divide-y divide-border/40">
              {data.rows.map((row, i) => {
                const swatch = colorForRow(row, i);
                return (
                  <li
                    key={row.id}
                    className="grid grid-cols-[18px_1fr_auto] items-center gap-3 py-3"
                  >
                    <span
                      aria-hidden
                      className="inline-block size-3"
                      style={{ background: swatch }}
                    />
                    <div className="min-w-0">
                      {row.isLeaf ? (
                        <Link
                          href={drillHref(row.id)}
                          className="font-display text-base text-foreground transition-colors hover:text-primary hover:underline"
                        >
                          {row.name}
                        </Link>
                      ) : (
                        <span className="font-display text-base font-semibold text-foreground">
                          {row.name}
                        </span>
                      )}
                      <div className="mt-1 h-[3px] w-full bg-muted/60">
                        <div
                          className="h-full"
                          style={{
                            width: `${Math.max(0, row.pct)}%`,
                            background: swatch,
                          }}
                          aria-hidden
                        />
                      </div>
                    </div>
                    <div className="text-right">
                      <Num className="block text-sm text-foreground">{formatUsd(row.amount)}</Num>
                      <Num className="block text-[10px] text-muted-foreground">
                        {row.pct.toFixed(1)}%
                      </Num>
                    </div>
                  </li>
                );
              })}
              <li className="grid grid-cols-[18px_1fr_auto] items-center gap-3 border-t-2 border-border pt-3">
                <span aria-hidden />
                <span className="font-display text-base font-semibold text-foreground">Total</span>
                <Num className="text-base font-semibold text-primary">{formatUsd(data.total)}</Num>
              </li>
            </ol>
          </div>
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
