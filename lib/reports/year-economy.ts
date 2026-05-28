import Decimal from 'decimal.js';
import type { CategoryNode } from '@/lib/categories/tree';
import { toMoneyString } from '@/lib/schemas/money';

/**
 * Reporte D — año económico + trayectoria a IF.
 *
 * Función pura. El caller agrega transacciones reales y forecasts pending por
 * (year, month, kind, categoryId) y pasa los buckets ya convertidos a USD.
 *
 * "Ahorro" = neto + categorías de inversión. Las categorías con
 * isInvestment=true representan egresos que son ahorro disfrazado (ej.
 * aportes a Rabbit Hole); el reporte las suma de vuelta al neto.
 */

export type YearEconomyBucket = {
  year: number;
  month: number; // 1-12
  kind: 'income' | 'expense';
  categoryId: string | null;
  totalUsd: string;
};

export type YearEconomyBudget = { categoryId: string; totalUsd: string };

export type YearEconomyMonthly = {
  month: number; // 1-12
  isProjected: boolean;
  income: number;
  expense: number;
  net: number;
  investment: number;
  savings: number;
};

export type YearEconomyKpis = {
  incomeYtdUsd: string;
  expenseYtdUsd: string;
  netYtdUsd: string;
  investmentYtdUsd: string;
  savingsYtdUsd: string;
  savingsRateYtdPct: number | null;
};

export type YearEconomyTrajectory = {
  targetMonthlyUsd: number;
  monthsElapsed: number;
  expectedAccumUsd: number;
  actualAccumUsd: number;
  deltaUsd: number;
  pct: number | null;
  semaphore: 'green' | 'yellow' | 'red' | 'neutral';
};

export type YearEconomyCategoryRow = {
  id: string;
  name: string;
  depth: 0 | 1;
  kind: 'income' | 'expense';
  isInvestment: boolean;
  isLeaf: boolean;
  realYtdUsd: string;
  projectedDecUsd: string;
  budgetAnnualUsd: string;
  deltaUsd: string;
};

export type YearEconomyReport = {
  kpis: YearEconomyKpis;
  monthly: YearEconomyMonthly[];
  trajectory: YearEconomyTrajectory;
  categoryRows: YearEconomyCategoryRow[];
};

export function computeMonthsElapsed(year: number, today: string): number {
  const parts = today.split('-');
  const ty = Number(parts[0]);
  const tm = Number(parts[1]);
  if (year < ty) return 12;
  if (year > ty) return 0;
  return tm;
}

export function buildYearEconomyReport(input: {
  year: number;
  today: string;
  tree: readonly CategoryNode[];
  txByMonthCat: readonly YearEconomyBucket[];
  forecastByMonthCat: readonly YearEconomyBucket[];
  budgetsByCategory: readonly YearEconomyBudget[];
  targetSavingsMonthlyUsd: string;
}): YearEconomyReport {
  const {
    year,
    today,
    tree,
    txByMonthCat,
    forecastByMonthCat,
    budgetsByCategory,
    targetSavingsMonthlyUsd,
  } = input;

  const monthsElapsed = computeMonthsElapsed(year, today);
  const parts = today.split('-');
  const todayYear = Number(parts[0]);
  const todayMonth = Number(parts[1]);

  const investmentIds = new Set<string>();
  for (const c of tree) if (c.isInvestment) investmentIds.add(c.id);

  // Monthly buckets initialized en cero. isProjected = mes >= hoy (en mismo
  // año o año futuro).
  const monthly: YearEconomyMonthly[] = Array.from({ length: 12 }, (_, i) => {
    const m = i + 1;
    let isProjected = false;
    if (year > todayYear) isProjected = true;
    else if (year === todayYear && m >= todayMonth) isProjected = true;
    return { month: m, isProjected, income: 0, expense: 0, net: 0, investment: 0, savings: 0 };
  });

  // YTD accumulators (only real, only months <= monthsElapsed)
  let incomeYtd = new Decimal(0);
  let expenseYtd = new Decimal(0);
  let investmentYtd = new Decimal(0);

  // Per-category: real YTD vs projected (real all months + forecasts)
  const realYtdByCat = new Map<string, Decimal>();
  const projectedByCat = new Map<string, Decimal>();

  for (const b of txByMonthCat) {
    if (b.year !== year) continue;
    if (b.month < 1 || b.month > 12) continue;
    const amount = new Decimal(b.totalUsd);
    const slot = monthly[b.month - 1];
    if (!slot) continue;

    if (b.kind === 'income') slot.income += amount.toNumber();
    else slot.expense += amount.toNumber();

    const isInv =
      b.kind === 'expense' && b.categoryId !== null && investmentIds.has(b.categoryId);
    if (isInv) slot.investment += amount.toNumber();

    if (b.month <= monthsElapsed) {
      if (b.kind === 'income') incomeYtd = incomeYtd.plus(amount);
      else expenseYtd = expenseYtd.plus(amount);
      if (isInv) investmentYtd = investmentYtd.plus(amount);
    }

    if (b.categoryId) {
      if (b.month <= monthsElapsed) {
        realYtdByCat.set(
          b.categoryId,
          (realYtdByCat.get(b.categoryId) ?? new Decimal(0)).plus(amount),
        );
      }
      projectedByCat.set(
        b.categoryId,
        (projectedByCat.get(b.categoryId) ?? new Decimal(0)).plus(amount),
      );
    }
  }

  for (const b of forecastByMonthCat) {
    if (b.year !== year) continue;
    if (b.month < 1 || b.month > 12) continue;
    const amount = new Decimal(b.totalUsd);
    const slot = monthly[b.month - 1];
    if (!slot) continue;

    if (b.kind === 'income') slot.income += amount.toNumber();
    else slot.expense += amount.toNumber();

    const isInv =
      b.kind === 'expense' && b.categoryId !== null && investmentIds.has(b.categoryId);
    if (isInv) slot.investment += amount.toNumber();

    if (b.categoryId) {
      projectedByCat.set(
        b.categoryId,
        (projectedByCat.get(b.categoryId) ?? new Decimal(0)).plus(amount),
      );
    }
  }

  for (const m of monthly) {
    m.net = m.income - m.expense;
    m.savings = m.net + m.investment;
  }

  const netYtd = incomeYtd.minus(expenseYtd);
  const savingsYtd = netYtd.plus(investmentYtd);
  const savingsRateYtdPct = incomeYtd.isZero()
    ? null
    : savingsYtd.div(incomeYtd).times(100).toNumber();

  const targetMonthly = new Decimal(targetSavingsMonthlyUsd);
  const expectedAccum = targetMonthly.times(monthsElapsed);
  const trajectoryDelta = savingsYtd.minus(expectedAccum);
  const pct = expectedAccum.isZero() ? null : savingsYtd.div(expectedAccum).toNumber();
  let semaphore: 'green' | 'yellow' | 'red' | 'neutral';
  if (pct === null) semaphore = 'neutral';
  else if (pct >= 1) semaphore = 'green';
  else if (pct >= 0.8) semaphore = 'yellow';
  else semaphore = 'red';

  // categoryRows: aggregate parents from children
  const childrenByParent = new Map<string, CategoryNode[]>();
  for (const c of tree) {
    if (c.parentId === null) continue;
    const arr = childrenByParent.get(c.parentId) ?? [];
    arr.push(c);
    childrenByParent.set(c.parentId, arr);
  }
  const isLeaf = (id: string) => !childrenByParent.has(id);

  const budgetByCat = new Map<string, Decimal>();
  for (const b of budgetsByCategory) {
    budgetByCat.set(b.categoryId, new Decimal(b.totalUsd));
  }

  function aggregateCat(catId: string): { real: Decimal; projected: Decimal; budget: Decimal } {
    if (isLeaf(catId)) {
      return {
        real: realYtdByCat.get(catId) ?? new Decimal(0),
        projected: projectedByCat.get(catId) ?? new Decimal(0),
        budget: budgetByCat.get(catId) ?? new Decimal(0),
      };
    }
    let r = new Decimal(0);
    let p = new Decimal(0);
    let bg = new Decimal(0);
    for (const child of childrenByParent.get(catId) ?? []) {
      const sub = aggregateCat(child.id);
      r = r.plus(sub.real);
      p = p.plus(sub.projected);
      bg = bg.plus(sub.budget);
    }
    return { real: r, projected: p, budget: bg };
  }

  const categoryRows: YearEconomyCategoryRow[] = [];
  for (const c of tree) {
    const { real, projected, budget } = aggregateCat(c.id);
    categoryRows.push({
      id: c.id,
      name: c.name,
      depth: c.depth,
      kind: c.kind,
      isInvestment: c.isInvestment,
      isLeaf: isLeaf(c.id),
      realYtdUsd: toMoneyString(real),
      projectedDecUsd: toMoneyString(projected),
      budgetAnnualUsd: toMoneyString(budget),
      deltaUsd: toMoneyString(projected.minus(budget)),
    });
  }

  return {
    kpis: {
      incomeYtdUsd: toMoneyString(incomeYtd),
      expenseYtdUsd: toMoneyString(expenseYtd),
      netYtdUsd: toMoneyString(netYtd),
      investmentYtdUsd: toMoneyString(investmentYtd),
      savingsYtdUsd: toMoneyString(savingsYtd),
      savingsRateYtdPct,
    },
    monthly,
    trajectory: {
      targetMonthlyUsd: targetMonthly.toNumber(),
      monthsElapsed,
      expectedAccumUsd: expectedAccum.toNumber(),
      actualAccumUsd: savingsYtd.toNumber(),
      deltaUsd: trajectoryDelta.toNumber(),
      pct,
      semaphore,
    },
    categoryRows,
  };
}
