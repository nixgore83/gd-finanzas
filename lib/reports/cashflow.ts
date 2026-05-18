import Decimal from 'decimal.js';
import type { CategoryNode } from '@/lib/categories/tree';
import { toMoneyString } from '@/lib/schemas/money';

/**
 * Construye el Reporte A — cashflow real vs budget — a partir de:
 *  - tree de categorías en orden de árbol (parents seguidos de sus children)
 *  - mapa categoryId → amount budgeteado (del mes)
 *  - mapa categoryId → amount real (suma de amount_usd de income/expense del mes)
 *
 * Función pura. Cálculos con Decimal para evitar drift en agregados.
 */

export type CashflowInputBudget = { categoryId: string; amountUsd: string };
export type CashflowInputReal = { categoryId: string; realUsd: string };

export type CashflowRow = {
  category: CategoryNode;
  budget: string; // USD, 2 decimales
  real: string;
  deltaUsd: string;
  deltaPct: number | null; // null si budget = 0
  isLeaf: boolean;
};

export type CashflowTotals = {
  income: { budget: string; real: string; delta: string };
  expense: { budget: string; real: string; delta: string };
  net: { budget: string; real: string; delta: string };
};

export type CashflowReport = {
  rows: CashflowRow[];
  totals: CashflowTotals;
};

function decimalFromMap(map: Map<string, string>, key: string): Decimal {
  const raw = map.get(key);
  return raw ? new Decimal(raw) : new Decimal(0);
}

export function buildCashflowReport(
  tree: readonly CategoryNode[],
  budgets: readonly CashflowInputBudget[],
  reals: readonly CashflowInputReal[],
): CashflowReport {
  const budgetMap = new Map<string, string>();
  for (const b of budgets) budgetMap.set(b.categoryId, b.amountUsd);
  const realMap = new Map<string, string>();
  for (const r of reals) realMap.set(r.categoryId, r.realUsd);

  // Determinar hojas y agregar children a parents
  const childrenByParent = new Map<string, CategoryNode[]>();
  for (const c of tree) {
    if (c.parentId === null) continue;
    const arr = childrenByParent.get(c.parentId) ?? [];
    arr.push(c);
    childrenByParent.set(c.parentId, arr);
  }
  const isLeaf = (id: string) => !childrenByParent.has(id);

  function aggregate(catId: string): { budget: Decimal; real: Decimal } {
    if (isLeaf(catId)) {
      return { budget: decimalFromMap(budgetMap, catId), real: decimalFromMap(realMap, catId) };
    }
    let totalBudget = new Decimal(0);
    let totalReal = new Decimal(0);
    for (const child of childrenByParent.get(catId) ?? []) {
      const sub = aggregate(child.id);
      totalBudget = totalBudget.plus(sub.budget);
      totalReal = totalReal.plus(sub.real);
    }
    return { budget: totalBudget, real: totalReal };
  }

  const rows: CashflowRow[] = [];
  let incomeBudget = new Decimal(0);
  let incomeReal = new Decimal(0);
  let expenseBudget = new Decimal(0);
  let expenseReal = new Decimal(0);

  for (const c of tree) {
    const { budget, real } = aggregate(c.id);
    const delta = real.minus(budget);
    const deltaPct = budget.isZero() ? null : delta.div(budget).times(100).toNumber();
    rows.push({
      category: c,
      budget: toMoneyString(budget),
      real: toMoneyString(real),
      deltaUsd: toMoneyString(delta),
      deltaPct,
      isLeaf: isLeaf(c.id),
    });

    // Acumular en totales solo desde top-level (evita doble conteo)
    if (c.parentId === null) {
      if (c.kind === 'income') {
        incomeBudget = incomeBudget.plus(budget);
        incomeReal = incomeReal.plus(real);
      } else {
        expenseBudget = expenseBudget.plus(budget);
        expenseReal = expenseReal.plus(real);
      }
    }
  }

  const incomeDelta = incomeReal.minus(incomeBudget);
  const expenseDelta = expenseReal.minus(expenseBudget);
  const netBudget = incomeBudget.minus(expenseBudget);
  const netReal = incomeReal.minus(expenseReal);
  const netDelta = netReal.minus(netBudget);

  return {
    rows,
    totals: {
      income: {
        budget: toMoneyString(incomeBudget),
        real: toMoneyString(incomeReal),
        delta: toMoneyString(incomeDelta),
      },
      expense: {
        budget: toMoneyString(expenseBudget),
        real: toMoneyString(expenseReal),
        delta: toMoneyString(expenseDelta),
      },
      net: {
        budget: toMoneyString(netBudget),
        real: toMoneyString(netReal),
        delta: toMoneyString(netDelta),
      },
    },
  };
}

/**
 * Verde si el Δ es "favorable", rojo si no, neutral si 0.
 * Income: favorable = real ≥ budget (más ingreso del esperado).
 * Expense: favorable = real ≤ budget (menos gasto).
 */
export function deltaTone(
  kind: 'income' | 'expense',
  deltaUsd: string,
): 'good' | 'bad' | 'neutral' {
  const d = new Decimal(deltaUsd);
  if (d.isZero()) return 'neutral';
  const positive = d.isPositive();
  if (kind === 'income') return positive ? 'good' : 'bad';
  return positive ? 'bad' : 'good';
}
