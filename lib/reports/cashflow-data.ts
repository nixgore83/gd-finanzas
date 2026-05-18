import { and, eq, gte, inArray, isNotNull, lte, sum } from 'drizzle-orm';
import { getDb } from '@/lib/db/client';
import { budgets, transactions } from '@/db/schema';
import { loadCategoryTree } from '@/lib/categories/tree';
import { buildCashflowReport, type CashflowReport } from './cashflow';

function lastDayOfMonth(year: number, month1: number): number {
  if ([1, 3, 5, 7, 8, 10, 12].includes(month1)) return 31;
  if ([4, 6, 9, 11].includes(month1)) return 30;
  const isLeap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
  return isLeap ? 29 : 28;
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

export type CashflowDateRange = { from: string; to: string };

export function monthRange(year: number, month: number): CashflowDateRange {
  return {
    from: `${year}-${pad2(month)}-01`,
    to: `${year}-${pad2(month)}-${pad2(lastDayOfMonth(year, month))}`,
  };
}

export async function loadCashflowData(
  householdId: string,
  year: number,
  month: number,
): Promise<{ report: CashflowReport; range: CashflowDateRange }> {
  const db = getDb();
  const tree = await loadCategoryTree(householdId);

  const budgetRows = await db
    .select({ categoryId: budgets.categoryId, amountUsd: budgets.amountUsd })
    .from(budgets)
    .where(
      and(
        eq(budgets.householdId, householdId),
        eq(budgets.year, year),
        eq(budgets.month, month),
      ),
    );

  const range = monthRange(year, month);

  const txRows = await db
    .select({
      categoryId: transactions.categoryId,
      realUsd: sum(transactions.amountUsd).mapWith(String),
    })
    .from(transactions)
    .where(
      and(
        eq(transactions.householdId, householdId),
        inArray(transactions.kind, ['income', 'expense']),
        isNotNull(transactions.categoryId),
        gte(transactions.date, range.from),
        lte(transactions.date, range.to),
      ),
    )
    .groupBy(transactions.categoryId);

  const reals = txRows
    .filter((r): r is { categoryId: string; realUsd: string } => r.categoryId !== null)
    .map((r) => ({ categoryId: r.categoryId, realUsd: r.realUsd ?? '0' }));

  const report = buildCashflowReport(
    tree,
    budgetRows.map((b) => ({ categoryId: b.categoryId, amountUsd: b.amountUsd })),
    reals,
  );

  return { report, range };
}
