import { and, eq, gte, inArray, isNotNull, isNull, lte, sql, sum } from 'drizzle-orm';
import Decimal from 'decimal.js';
import { getDb } from '@/lib/db/client';
import { budgets, financialGoals, forecasts, recurrences, transactions } from '@/db/schema';
import { loadCategoryTree, type CategoryNode } from '@/lib/categories/tree';
import { getFxRate } from '@/lib/fx/get-fx-rate';
import { FINANCIAL_GOALS_DEFAULTS } from '@/lib/financial-goals/defaults';
import {
  buildYearEconomyReport,
  type YearEconomyBucket,
  type YearEconomyBudget,
  type YearEconomyReport,
} from './year-economy';

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

export type LoadYearEconomyResult = {
  report: YearEconomyReport;
  tree: CategoryNode[];
  targetSavingsMonthlyUsd: string;
};

export async function loadYearEconomyData(
  householdId: string,
  year: number,
  today: string,
): Promise<LoadYearEconomyResult> {
  const db = getDb();

  const tree = await loadCategoryTree(householdId);

  const startDate = `${year}-01-01`;
  const endDate = `${year}-12-31`;

  // 1) Transacciones reales agrupadas por (month, kind, category_id)
  const txRows = await db
    .select({
      month: sql<number>`extract(month from ${transactions.date})::int`,
      kind: transactions.kind,
      categoryId: transactions.categoryId,
      totalUsd: sum(transactions.amountUsd).mapWith(String),
    })
    .from(transactions)
    .where(
      and(
        eq(transactions.householdId, householdId),
        inArray(transactions.kind, ['income', 'expense']),
        isNotNull(transactions.categoryId),
        gte(transactions.date, startDate),
        lte(transactions.date, endDate),
      ),
    )
    .groupBy(
      sql`extract(month from ${transactions.date})`,
      transactions.kind,
      transactions.categoryId,
    );

  const txByMonthCat: YearEconomyBucket[] = [];
  for (const r of txRows) {
    if (r.kind !== 'income' && r.kind !== 'expense') continue;
    txByMonthCat.push({
      year,
      month: r.month,
      kind: r.kind,
      categoryId: r.categoryId,
      totalUsd: r.totalUsd ?? '0',
    });
  }

  // 2) Forecasts pending desde hoy hasta dic 31, JOIN recurrences para kind/categoryId
  const forecastStart = today > startDate ? today : startDate;
  const fcRows =
    forecastStart > endDate
      ? []
      : await db
          .select({
            expectedDate: forecasts.expectedDate,
            expectedAmount: forecasts.expectedAmount,
            currency: forecasts.currency,
            kind: recurrences.kind,
            categoryId: recurrences.categoryId,
          })
          .from(forecasts)
          .innerJoin(recurrences, eq(recurrences.id, forecasts.recurrenceId))
          .where(
            and(
              eq(recurrences.householdId, householdId),
              eq(forecasts.status, 'pending'),
              isNull(forecasts.matchedTransactionId),
              gte(forecasts.expectedDate, forecastStart),
              lte(forecasts.expectedDate, endDate),
            ),
          );

  // Convert + aggregate por (month, kind, categoryId)
  const fcAcc = new Map<string, Decimal>();
  for (const r of fcRows) {
    let usd: Decimal;
    if (r.currency === 'USD') {
      usd = new Decimal(r.expectedAmount);
    } else {
      const fx = await getFxRate({ date: r.expectedDate });
      usd = new Decimal(r.expectedAmount).div(fx.rate);
    }
    const parts = r.expectedDate.split('-');
    const month = Number(parts[1]);
    const key = `${month}|${r.kind}|${r.categoryId ?? ''}`;
    fcAcc.set(key, (fcAcc.get(key) ?? new Decimal(0)).plus(usd));
  }

  const forecastByMonthCat: YearEconomyBucket[] = [];
  for (const [key, total] of fcAcc) {
    const [monthStr, kind, catId] = key.split('|');
    if (kind !== 'income' && kind !== 'expense') continue;
    forecastByMonthCat.push({
      year,
      month: Number(monthStr),
      kind,
      categoryId: catId ? catId : null,
      totalUsd: total.toFixed(2, Decimal.ROUND_HALF_UP),
    });
  }

  // 3) Budgets del año por categoría
  const budgetRows = await db
    .select({
      categoryId: budgets.categoryId,
      totalUsd: sum(budgets.amountUsd).mapWith(String),
    })
    .from(budgets)
    .where(and(eq(budgets.householdId, householdId), eq(budgets.year, year)))
    .groupBy(budgets.categoryId);

  const budgetsByCategory: YearEconomyBudget[] = budgetRows.map((b) => ({
    categoryId: b.categoryId,
    totalUsd: b.totalUsd ?? '0',
  }));

  // 4) Target savings monthly del household
  const [goals] = await db
    .select({ targetAhorroMensualUsd: financialGoals.targetAhorroMensualUsd })
    .from(financialGoals)
    .where(eq(financialGoals.householdId, householdId))
    .limit(1);

  const targetSavingsMonthlyUsd =
    goals?.targetAhorroMensualUsd ?? FINANCIAL_GOALS_DEFAULTS.targetAhorroMensualUsd;

  const report = buildYearEconomyReport({
    year,
    today,
    tree,
    txByMonthCat,
    forecastByMonthCat,
    budgetsByCategory,
    targetSavingsMonthlyUsd,
  });

  return { report, tree, targetSavingsMonthlyUsd };
}

export function formatYearMonth(year: number, month: number): { from: string; to: string } {
  return { from: `${year}-${pad2(month)}-01`, to: `${year}-12-31` };
}
