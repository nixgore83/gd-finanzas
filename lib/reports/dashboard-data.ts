import { and, asc, desc, eq, gte, isNotNull, lte, sum } from 'drizzle-orm';
import { getDb } from '@/lib/db/client';
import { accounts, categories, forecasts, recurrences, transactions } from '@/db/schema';
import { loadCashflowData, monthRange } from './cashflow-data';
import type { CashflowTotals } from './cashflow';

export type DashboardData = {
  totals: CashflowTotals;
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

  const [cashflow, topRows, forecastRows, recentRows] = await Promise.all([
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
  ]);

  // Filtrar el monto null por si la SUM devuelve null (no debería con count>0).
  const top = topRows
    .filter((r): r is { id: string; name: string; total: string } => r.total !== null)
    .map((r) => ({ id: r.id, name: r.name, total: r.total }));

  return {
    totals: cashflow.report.totals,
    topExpenseCategories: top,
    upcomingForecasts: forecastRows,
    recentTransactions: recentRows,
  };
}

