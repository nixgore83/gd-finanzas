import { and, asc, desc, eq, gte, isNotNull, lte, sql, sum } from 'drizzle-orm';
import { getDb } from '@/lib/db/client';
import { accounts, categories, forecasts, recurrences, transactions } from '@/db/schema';
import { loadCashflowData, monthRange } from './cashflow-data';
import type { CashflowTotals } from './cashflow';

export type DashboardMonthPoint = {
  year: number;
  month: number;
  income: number;
  expense: number;
  net: number;
};

export type DashboardData = {
  totals: CashflowTotals;
  /** Últimos 6 meses (incluido el actual), orden ascendente por (year, month). */
  monthly: DashboardMonthPoint[];
  topExpenseCategories: { id: string; name: string; total: string }[];
  upcomingForecasts: {
    id: string;
    expectedDate: string;
    recurrenceName: string;
    expectedAmount: string;
    currency: 'ARS' | 'USD';
  }[];
  recentTransactions: {
    id: string;
    date: string;
    kind: 'income' | 'expense' | 'transfer';
    description: string;
    amountOriginal: string;
    currencyOriginal: 'ARS' | 'USD';
    categoryName: string | null;
    accountName: string | null;
  }[];
};

const TOP_N = 5;
const RECENT_N = 10;
const UPCOMING_DAYS = 14;
const SPARKLINE_MONTHS = 6;

function rollingMonths(endYear: number, endMonth: number, count: number) {
  const out: { year: number; month: number }[] = [];
  let y = endYear;
  let m = endMonth;
  for (let i = 0; i < count; i++) {
    out.unshift({ year: y, month: m });
    m -= 1;
    if (m === 0) {
      m = 12;
      y -= 1;
    }
  }
  return out;
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

function lastDay(year: number, month: number): number {
  if ([1, 3, 5, 7, 8, 10, 12].includes(month)) return 31;
  if ([4, 6, 9, 11].includes(month)) return 30;
  const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
  return leap ? 29 : 28;
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function plusDaysIso(base: string, days: number): string {
  const ms = Date.parse(`${base}T00:00:00Z`) + days * 24 * 60 * 60 * 1000;
  return new Date(ms).toISOString().slice(0, 10);
}

export async function loadDashboardData(
  householdId: string,
  year: number,
  month: number,
): Promise<DashboardData> {
  const db = getDb();
  const range = monthRange(year, month);
  const today = todayIso();
  const horizon = plusDaysIso(today, UPCOMING_DAYS);

  const months = rollingMonths(year, month, SPARKLINE_MONTHS);
  const first = months[0]!;
  const last = months[months.length - 1]!;
  const monthlyStart = `${first.year}-${pad2(first.month)}-01`;
  const monthlyEnd = `${last.year}-${pad2(last.month)}-${pad2(lastDay(last.year, last.month))}`;

  const [cashflow, topRows, forecastRows, recentRows, monthlyRows] = await Promise.all([
    loadCashflowData(householdId, year, month),

    // Top N categorías de gasto del mes (solo income/expense; transfers fuera)
    db
      .select({
        id: categories.id,
        name: categories.name,
        total: sum(transactions.amountUsd).mapWith(String),
      })
      .from(transactions)
      .innerJoin(categories, eq(categories.id, transactions.categoryId))
      .where(
        and(
          eq(transactions.householdId, householdId),
          eq(transactions.kind, 'expense'),
          isNotNull(transactions.categoryId),
          gte(transactions.date, range.from),
          lte(transactions.date, range.to),
        ),
      )
      .groupBy(categories.id, categories.name)
      .orderBy(desc(sum(transactions.amountUsd)))
      .limit(TOP_N),

    // Próximos 14 días de forecasts pending
    db
      .select({
        id: forecasts.id,
        expectedDate: forecasts.expectedDate,
        recurrenceName: recurrences.name,
        expectedAmount: forecasts.expectedAmount,
        currency: forecasts.currency,
      })
      .from(forecasts)
      .innerJoin(recurrences, eq(recurrences.id, forecasts.recurrenceId))
      .where(
        and(
          eq(recurrences.householdId, householdId),
          eq(forecasts.status, 'pending'),
          gte(forecasts.expectedDate, today),
          lte(forecasts.expectedDate, horizon),
        ),
      )
      .orderBy(asc(forecasts.expectedDate))
      .limit(50),

    // Últimas 10 transacciones del household
    db
      .select({
        id: transactions.id,
        date: transactions.date,
        kind: transactions.kind,
        description: transactions.description,
        amountOriginal: transactions.amountOriginal,
        currencyOriginal: transactions.currencyOriginal,
        categoryName: categories.name,
        accountName: accounts.name,
      })
      .from(transactions)
      .leftJoin(accounts, eq(accounts.id, transactions.accountId))
      .leftJoin(categories, eq(categories.id, transactions.categoryId))
      .where(eq(transactions.householdId, householdId))
      .orderBy(desc(transactions.date), desc(transactions.createdAt))
      .limit(RECENT_N),

    // Histórico 6m income/expense en USD (para sparklines)
    db
      .select({
        year: sql<number>`extract(year from ${transactions.date})::int`,
        month: sql<number>`extract(month from ${transactions.date})::int`,
        kind: transactions.kind,
        total: sum(transactions.amountUsd).mapWith(String),
      })
      .from(transactions)
      .where(
        and(
          eq(transactions.householdId, householdId),
          isNotNull(transactions.categoryId),
          gte(transactions.date, monthlyStart),
          lte(transactions.date, monthlyEnd),
        ),
      )
      .groupBy(
        sql`extract(year from ${transactions.date})`,
        sql`extract(month from ${transactions.date})`,
        transactions.kind,
      ),
  ]);

  const byKey = new Map<string, { income: number; expense: number }>();
  for (const r of monthlyRows) {
    if (r.kind !== 'income' && r.kind !== 'expense') continue;
    const key = `${r.year}-${r.month}`;
    const slot = byKey.get(key) ?? { income: 0, expense: 0 };
    const v = Number.parseFloat(r.total ?? '0');
    if (r.kind === 'income') slot.income += v;
    else slot.expense += v;
    byKey.set(key, slot);
  }
  const monthly: DashboardMonthPoint[] = months.map(({ year: y, month: m }) => {
    const v = byKey.get(`${y}-${m}`) ?? { income: 0, expense: 0 };
    return { year: y, month: m, income: v.income, expense: v.expense, net: v.income - v.expense };
  });

  // Filtrar el monto null por si la SUM devuelve null (no debería con count>0).
  const top = topRows
    .filter((r): r is { id: string; name: string; total: string } => r.total !== null)
    .map((r) => ({ id: r.id, name: r.name, total: r.total }));

  return {
    totals: cashflow.report.totals,
    monthly,
    topExpenseCategories: top,
    upcomingForecasts: forecastRows,
    recentTransactions: recentRows,
  };
}

