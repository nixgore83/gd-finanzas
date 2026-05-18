import Link from 'next/link';
import { redirect } from 'next/navigation';
import { requireHouseholdSession, SessionError } from '@/lib/auth/session';
import { loadCategoryTree } from '@/lib/categories/tree';
import { loadEvolutionData } from '@/lib/reports/evolution-data';
import { buildEvolutionSeries, type EvolutionCurrency } from '@/lib/reports/evolution';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { ReportsNav } from '../reports-nav';
import { EvolutionChart } from './chart';

export const metadata = {
  title: 'Evolución 12 meses · gd-finanzas',
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
  endYear: number;
  endMonth: number;
  currency: EvolutionCurrency;
  categoryId: string | null;
} {
  const yearRaw = sp.endYear;
  const monthRaw = sp.endMonth;
  const currencyRaw = sp.currency;
  const categoryRaw = sp.categoryId;
  const now = new Date();
  const endYear =
    typeof yearRaw === 'string' &&
    /^\d{4}$/.test(yearRaw) &&
    Number(yearRaw) >= 2020 &&
    Number(yearRaw) <= 2100
      ? Number(yearRaw)
      : now.getFullYear();
  const endMonth =
    typeof monthRaw === 'string' &&
    /^\d{1,2}$/.test(monthRaw) &&
    Number(monthRaw) >= 1 &&
    Number(monthRaw) <= 12
      ? Number(monthRaw)
      : now.getMonth() + 1;
  const currency: EvolutionCurrency = currencyRaw === 'ARS' ? 'ARS' : 'USD';
  const categoryId =
    typeof categoryRaw === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(categoryRaw)
      ? categoryRaw
      : null;
  return { endYear, endMonth, currency, categoryId };
}

function prevMonth(y: number, m: number) {
  if (m === 1) return { year: y - 1, month: 12 };
  return { year: y, month: m - 1 };
}
function nextMonth(y: number, m: number) {
  if (m === 12) return { year: y + 1, month: 1 };
  return { year: y, month: m + 1 };
}

function buildHref(params: {
  endYear: number;
  endMonth: number;
  currency: EvolutionCurrency;
  categoryId: string | null;
}): string {
  const sp = new URLSearchParams();
  sp.set('endYear', String(params.endYear));
  sp.set('endMonth', pad2(params.endMonth));
  sp.set('currency', params.currency);
  if (params.categoryId) sp.set('categoryId', params.categoryId);
  return `/reports/evolution?${sp.toString()}`;
}

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function EvolutionReportPage({
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
  const { endYear, endMonth, currency, categoryId } = parseQuery(sp);

  const tree = await loadCategoryTree(session.householdId);
  const buckets = await loadEvolutionData(
    session.householdId,
    endYear,
    endMonth,
    currency,
    categoryId,
  );
  const series = buildEvolutionSeries(buckets);

  const prev = prevMonth(endYear, endMonth);
  const next = nextMonth(endYear, endMonth);
  const monthLabel = `${MONTH_LABELS[endMonth - 1]} ${endYear}`;

  const totalIncome = series.reduce((acc, p) => acc + p.income, 0);
  const totalExpense = series.reduce((acc, p) => acc + p.expense, 0);
  const totalNet = totalIncome - totalExpense;

  function format(n: number): string {
    return new Intl.NumberFormat('es-AR', {
      style: 'currency',
      currency,
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(n);
  }

  return (
    <div className="space-y-4">
      <ReportsNav active="evolution" />

      <div className="flex items-center justify-between gap-2">
        <h1 className="text-2xl font-semibold">Evolución · 12 meses a {monthLabel}</h1>
        <div className="flex items-center gap-3 text-sm">
          <Link
            href={buildHref({ endYear: prev.year, endMonth: prev.month, currency, categoryId })}
            className="text-muted-foreground hover:underline"
          >
            ◀ Mover ventana atrás
          </Link>
          <Link
            href={buildHref({ endYear: next.year, endMonth: next.month, currency, categoryId })}
            className="text-muted-foreground hover:underline"
          >
            Mover ventana adelante ▶
          </Link>
        </div>
      </div>

      {/* Controles */}
      <form
        method="get"
        action="/reports/evolution"
        className="flex flex-wrap items-end gap-3 rounded-md border bg-muted/20 p-3"
      >
        <input type="hidden" name="endYear" value={endYear} />
        <input type="hidden" name="endMonth" value={pad2(endMonth)} />
        <div className="space-y-1">
          <Label htmlFor="currency">Moneda</Label>
          <select
            id="currency"
            name="currency"
            defaultValue={currency}
            className="flex h-9 w-28 rounded-md border border-input bg-background px-2 text-sm"
          >
            <option value="USD">USD</option>
            <option value="ARS">ARS</option>
          </select>
        </div>
        <div className="space-y-1">
          <Label htmlFor="categoryId">Categoría</Label>
          <select
            id="categoryId"
            name="categoryId"
            defaultValue={categoryId ?? ''}
            className="flex h-9 w-64 rounded-md border border-input bg-background px-2 text-sm"
          >
            <option value="">Todas</option>
            {tree.map((c) => (
              <option key={c.id} value={c.id}>
                {c.depth === 1 ? `    ↳ ${c.name}` : c.name}
              </option>
            ))}
          </select>
        </div>
        <Button type="submit" size="sm">
          Aplicar
        </Button>
        {(currency !== 'USD' || categoryId) && (
          <Button variant="ghost" size="sm" asChild>
            <Link
              href={buildHref({ endYear, endMonth, currency: 'USD', categoryId: null })}
            >
              Reset
            </Link>
          </Button>
        )}
      </form>

      <EvolutionChart data={series} currency={currency} />

      {/* Totales de la ventana */}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <div className="rounded-md border p-3">
          <p className="text-xs text-muted-foreground">Ingresos totales (12m)</p>
          <p className="text-lg font-semibold tabular-nums">{format(totalIncome)}</p>
        </div>
        <div className="rounded-md border p-3">
          <p className="text-xs text-muted-foreground">Gastos totales (12m)</p>
          <p className="text-lg font-semibold tabular-nums">{format(totalExpense)}</p>
        </div>
        <div className="rounded-md border p-3">
          <p className="text-xs text-muted-foreground">Neto (12m)</p>
          <p
            className={
              totalNet >= 0
                ? 'text-lg font-semibold tabular-nums text-emerald-700'
                : 'text-lg font-semibold tabular-nums text-rose-700'
            }
          >
            {format(totalNet)}
          </p>
        </div>
      </div>

      <p className="text-xs text-muted-foreground">
        Ventana móvil de 12 meses. El filtro por categoría es exacto — para ver el agregado de
        un padre y sus children juntos, usá el breakdown del mes.
      </p>
    </div>
  );
}
