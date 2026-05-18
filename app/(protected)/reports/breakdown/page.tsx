import Link from 'next/link';
import { redirect } from 'next/navigation';
import { requireHouseholdSession, SessionError } from '@/lib/auth/session';
import { loadBreakdownData } from '@/lib/reports/breakdown-data';
import type { BreakdownLevel } from '@/lib/reports/breakdown';
import { monthRange } from '@/lib/reports/cashflow-data';
import { BreakdownDonut } from './donut';
import { ReportsNav } from '../reports-nav';

export const metadata = {
  title: 'Breakdown de gastos · gd-finanzas',
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
    <div className="space-y-4">
      <ReportsNav active="breakdown" />

      <div className="flex items-center justify-between gap-2">
        <h1 className="text-2xl font-semibold">Breakdown · {monthLabel}</h1>
        <div className="flex items-center gap-3 text-sm">
          <Link
            href={`/reports/breakdown?year=${prev.year}&month=${pad2(prev.month)}&level=${level}`}
            className="text-muted-foreground hover:underline"
          >
            ◀ {MONTH_LABELS[prev.month - 1]} {prev.year}
          </Link>
          <Link
            href={`/reports/breakdown?year=${next.year}&month=${pad2(next.month)}&level=${level}`}
            className="text-muted-foreground hover:underline"
          >
            {MONTH_LABELS[next.month - 1]} {next.year} ▶
          </Link>
        </div>
      </div>

      <div className="flex items-center gap-3 text-sm">
        <span className="text-muted-foreground">Nivel:</span>
        <Link
          href={levelHref('parent')}
          className={
            level === 'parent'
              ? 'rounded bg-foreground px-2 py-0.5 text-background'
              : 'rounded px-2 py-0.5 text-muted-foreground hover:underline'
          }
        >
          Categoría padre
        </Link>
        <Link
          href={levelHref('leaf')}
          className={
            level === 'leaf'
              ? 'rounded bg-foreground px-2 py-0.5 text-background'
              : 'rounded px-2 py-0.5 text-muted-foreground hover:underline'
          }
        >
          Hoja
        </Link>
      </div>

      {data.rows.length === 0 ? (
        <div className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">
          Sin gastos en este mes.
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <BreakdownDonut rows={data.rows} total={data.total} />

          <div className="overflow-x-auto rounded-md border">
            <table className="w-full text-sm">
              <thead className="bg-muted/40">
                <tr className="text-left">
                  <th className="px-3 py-2 font-medium">Categoría</th>
                  <th className="px-3 py-2 text-right font-medium">Monto</th>
                  <th className="px-3 py-2 text-right font-medium">% del total</th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map((row) => (
                  <tr key={row.id} className="border-t">
                    <td className="px-3 py-1.5">
                      <span className="inline-flex items-center gap-2">
                        <span
                          className="inline-block h-3 w-3 rounded-sm"
                          style={{ backgroundColor: row.color ?? '#94a3b8' }}
                        />
                        {row.isLeaf ? (
                          <Link href={drillHref(row.id)} className="hover:underline">
                            {row.name}
                          </Link>
                        ) : (
                          <span>{row.name}</span>
                        )}
                      </span>
                    </td>
                    <td className="px-3 py-1.5 text-right tabular-nums">
                      {formatUsd(row.amount)}
                    </td>
                    <td className="px-3 py-1.5 text-right tabular-nums text-muted-foreground">
                      {row.pct.toFixed(1)}%
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="bg-muted/30">
                <tr className="border-t">
                  <td className="px-3 py-2 font-medium">Total</td>
                  <td className="px-3 py-2 text-right tabular-nums font-medium">
                    {formatUsd(data.total)}
                  </td>
                  <td className="px-3 py-2 text-right text-muted-foreground">100%</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}

      <p className="text-xs text-muted-foreground">
        Sólo se muestran transacciones tipo Gasto. En nivel “Categoría padre” el drill-down no
        aplica — clickeá una fila hoja para ver las transacciones.
      </p>
    </div>
  );
}

