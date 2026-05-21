import Link from 'next/link';
import { redirect } from 'next/navigation';
import { requireHouseholdSession, SessionError } from '@/lib/auth/session';
import { loadCategoryTree } from '@/lib/categories/tree';
import { loadEvolutionData } from '@/lib/reports/evolution-data';
import { buildEvolutionSeries, type EvolutionCurrency } from '@/lib/reports/evolution';
import { Button } from '@/components/ui/button';
import { Label as FormLabel } from '@/components/ui/label';
import { Display, Label, Body } from '@/components/ui/typography';
import { cn } from '@/lib/utils';
import { ReportsNav } from '../reports-nav';
import { EvolutionChart } from './chart';

export const metadata = {
  title: 'Evolución 12 meses · gd-finanzas',
};

const MONTH_LABELS = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
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

  const activeCategory = categoryId ? tree.find((c) => c.id === categoryId) : null;

  function format(n: number): string {
    return new Intl.NumberFormat('es-AR', {
      style: 'currency',
      currency,
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(n);
  }

  return (
    <div className="space-y-8">
      <ReportsNav active="evolution" />

      <header className="flex flex-wrap items-end justify-between gap-6">
        <div className="min-w-0">
          <Label>Reportes · Evolución 12 meses</Label>
          <Display size="lg" className="mt-2 block">
            Hasta {monthLabel}
          </Display>
          <Body className="mt-2 max-w-2xl">
            Ventana móvil de 12 meses.
            {activeCategory && (
              <>
                {' '}Filtrando por{' '}
                <span className="text-foreground">{activeCategory.name}</span>.
              </>
            )}
          </Body>
        </div>
        <nav className="flex items-baseline gap-5 font-display">
          <Link
            href={buildHref({ endYear: prev.year, endMonth: prev.month, currency, categoryId })}
            className="text-sm italic text-muted-foreground transition-colors hover:text-primary"
          >
            ◀ atrás
          </Link>
          <Link
            href={buildHref({ endYear: next.year, endMonth: next.month, currency, categoryId })}
            className="text-sm italic text-muted-foreground transition-colors hover:text-primary"
          >
            adelante ▶
          </Link>
        </nav>
      </header>

      {/* CONTROLS */}
      <form
        method="get"
        action="/reports/evolution"
        className="flex flex-wrap items-end gap-4 border border-border bg-card/30 px-5 py-4"
      >
        <input type="hidden" name="endYear" value={endYear} />
        <input type="hidden" name="endMonth" value={pad2(endMonth)} />
        <div className="space-y-1.5">
          <FormLabel htmlFor="currency">Moneda</FormLabel>
          <select
            id="currency"
            name="currency"
            defaultValue={currency}
            className="flex h-10 w-28 rounded-md border border-input bg-background px-3 py-2 text-sm"
          >
            <option value="USD">USD</option>
            <option value="ARS">ARS</option>
          </select>
        </div>
        <div className="space-y-1.5">
          <FormLabel htmlFor="categoryId">Categoría</FormLabel>
          <select
            id="categoryId"
            name="categoryId"
            defaultValue={categoryId ?? ''}
            className="flex h-10 w-72 rounded-md border border-input bg-background px-3 py-2 text-sm"
          >
            <option value="">Todas</option>
            {tree.map((c) => (
              <option key={c.id} value={c.id}>
                {c.depth === 1 ? `    ↳ ${c.name}` : c.name}
              </option>
            ))}
          </select>
        </div>
        <Button type="submit">Aplicar</Button>
        {(currency !== 'USD' || categoryId) && (
          <Button variant="ghost" asChild>
            <Link
              href={buildHref({ endYear, endMonth, currency: 'USD', categoryId: null })}
            >
              Reset
            </Link>
          </Button>
        )}
      </form>

      <EvolutionChart data={series} currency={currency} />

      {/* TOTALS STRIP */}
      <section className="grid grid-cols-1 gap-px bg-border sm:grid-cols-3">
        <TotalBox label="Ingresos 12m" value={format(totalIncome)} variant="good" />
        <TotalBox label="Gastos 12m" value={format(totalExpense)} variant="bad" />
        <TotalBox
          label="Neto 12m"
          value={format(totalNet)}
          variant={totalNet >= 0 ? 'good' : 'bad'}
        />
      </section>

      <Body className="text-xs">
        Para ver el agregado de un padre + sus children juntos, usá el breakdown del mes.
      </Body>
    </div>
  );
}

function TotalBox({
  label,
  value,
  variant,
}: {
  label: string;
  value: string;
  variant: 'good' | 'bad';
}) {
  return (
    <div className="bg-card p-5">
      <Label>{label}</Label>
      <Display
        size="md"
        className={cn(
          'mt-3 block tabular-nums',
          variant === 'good' && 'text-[color:var(--good)]',
          variant === 'bad' && 'text-[color:var(--bad)]',
        )}
      >
        {value}
      </Display>
    </div>
  );
}
