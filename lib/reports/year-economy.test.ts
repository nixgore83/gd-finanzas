import { describe, it, expect } from 'vitest';
import {
  buildYearEconomyReport,
  computeMonthsElapsed,
  type YearEconomyBucket,
  type YearEconomyBudget,
} from './year-economy';
import type { CategoryNode } from '@/lib/categories/tree';

const tree: CategoryNode[] = [
  {
    id: 'sueldo',
    name: 'Sueldo',
    kind: 'income',
    depth: 0,
    parentId: null,
    isInvestment: false,
  },
  {
    id: 'sueldo-nico',
    name: 'Sueldo Nico',
    kind: 'income',
    depth: 1,
    parentId: 'sueldo',
    isInvestment: false,
  },
  {
    id: 'sueldo-pau',
    name: 'Sueldo Pau',
    kind: 'income',
    depth: 1,
    parentId: 'sueldo',
    isInvestment: false,
  },
  {
    id: 'vivienda',
    name: 'Vivienda',
    kind: 'expense',
    depth: 0,
    parentId: null,
    isInvestment: false,
  },
  {
    id: 'alquiler',
    name: 'Alquiler',
    kind: 'expense',
    depth: 1,
    parentId: 'vivienda',
    isInvestment: false,
  },
  {
    id: 'expensas',
    name: 'Expensas',
    kind: 'expense',
    depth: 1,
    parentId: 'vivienda',
    isInvestment: false,
  },
  {
    id: 'inv-rh',
    name: 'Inversión RH',
    kind: 'expense',
    depth: 0,
    parentId: null,
    isInvestment: true,
  },
];

const emptyBuckets: YearEconomyBucket[] = [];
const emptyBudgets: YearEconomyBudget[] = [];

describe('computeMonthsElapsed', () => {
  it('año pasado → 12', () => {
    expect(computeMonthsElapsed(2025, '2026-05-20')).toBe(12);
  });
  it('año futuro → 0', () => {
    expect(computeMonthsElapsed(2027, '2026-05-20')).toBe(0);
  });
  it('año actual → mes de hoy', () => {
    expect(computeMonthsElapsed(2026, '2026-05-20')).toBe(5);
  });
});

describe('buildYearEconomyReport', () => {
  it('buckets vacíos → KPIs en 0 y semáforo neutral cuando no hay meses transcurridos', () => {
    const out = buildYearEconomyReport({
      year: 2027,
      today: '2026-05-20',
      tree,
      txByMonthCat: emptyBuckets,
      forecastByMonthCat: emptyBuckets,
      budgetsByCategory: emptyBudgets,
      targetSavingsMonthlyUsd: '5700',
    });
    expect(out.kpis.incomeYtdUsd).toBe('0.00');
    expect(out.kpis.expenseYtdUsd).toBe('0.00');
    expect(out.kpis.savingsRateYtdPct).toBeNull();
    expect(out.trajectory.monthsElapsed).toBe(0);
    expect(out.trajectory.semaphore).toBe('neutral');
    expect(out.monthly.every((m) => m.isProjected)).toBe(true);
  });

  it('savingsRate con income > 0 → calculado, con income=0 → null', () => {
    const out = buildYearEconomyReport({
      year: 2026,
      today: '2026-05-20',
      tree,
      txByMonthCat: [
        { year: 2026, month: 1, kind: 'income', categoryId: 'sueldo-nico', totalUsd: '10000' },
        { year: 2026, month: 1, kind: 'expense', categoryId: 'alquiler', totalUsd: '2000' },
      ],
      forecastByMonthCat: emptyBuckets,
      budgetsByCategory: emptyBudgets,
      targetSavingsMonthlyUsd: '5700',
    });
    expect(out.kpis.savingsRateYtdPct).toBe(80); // (10000-2000)/10000 * 100

    const outZero = buildYearEconomyReport({
      year: 2026,
      today: '2026-05-20',
      tree,
      txByMonthCat: [
        { year: 2026, month: 1, kind: 'expense', categoryId: 'alquiler', totalUsd: '500' },
      ],
      forecastByMonthCat: emptyBuckets,
      budgetsByCategory: emptyBudgets,
      targetSavingsMonthlyUsd: '5700',
    });
    expect(outZero.kpis.savingsRateYtdPct).toBeNull();
  });

  it('semáforo green con savings >= target × meses', () => {
    const tx: YearEconomyBucket[] = Array.from({ length: 5 }, (_, i) => ({
      year: 2026,
      month: i + 1,
      kind: 'income' as const,
      categoryId: 'sueldo-nico',
      totalUsd: '6000',
    }));
    const out = buildYearEconomyReport({
      year: 2026,
      today: '2026-05-20',
      tree,
      txByMonthCat: tx,
      forecastByMonthCat: emptyBuckets,
      budgetsByCategory: emptyBudgets,
      targetSavingsMonthlyUsd: '5700',
    });
    // savings = 30000, expected = 5700*5 = 28500. ratio > 1
    expect(out.trajectory.semaphore).toBe('green');
  });

  it('semáforo yellow con savings entre 80% y 100% del target', () => {
    // 5 meses, target 5700 → expected 28500. Savings 24000 → 24000/28500 = 0.842 → yellow
    const tx: YearEconomyBucket[] = Array.from({ length: 5 }, (_, i) => ({
      year: 2026,
      month: i + 1,
      kind: 'income' as const,
      categoryId: 'sueldo-nico',
      totalUsd: '4800',
    }));
    const out = buildYearEconomyReport({
      year: 2026,
      today: '2026-05-20',
      tree,
      txByMonthCat: tx,
      forecastByMonthCat: emptyBuckets,
      budgetsByCategory: emptyBudgets,
      targetSavingsMonthlyUsd: '5700',
    });
    expect(out.trajectory.semaphore).toBe('yellow');
  });

  it('semáforo red con savings < 80% del target', () => {
    const tx: YearEconomyBucket[] = [
      { year: 2026, month: 1, kind: 'income', categoryId: 'sueldo-nico', totalUsd: '5000' },
    ];
    const out = buildYearEconomyReport({
      year: 2026,
      today: '2026-05-20',
      tree,
      txByMonthCat: tx,
      forecastByMonthCat: emptyBuckets,
      budgetsByCategory: emptyBudgets,
      targetSavingsMonthlyUsd: '5700',
    });
    // savings = 5000, expected = 28500. ratio = 0.175 → red
    expect(out.trajectory.semaphore).toBe('red');
  });

  it('categoría is_investment suma al ahorro (no resta del neto)', () => {
    const out = buildYearEconomyReport({
      year: 2026,
      today: '2026-05-20',
      tree,
      txByMonthCat: [
        { year: 2026, month: 1, kind: 'income', categoryId: 'sueldo-nico', totalUsd: '10000' },
        { year: 2026, month: 1, kind: 'expense', categoryId: 'alquiler', totalUsd: '2000' },
        { year: 2026, month: 1, kind: 'expense', categoryId: 'inv-rh', totalUsd: '3000' },
      ],
      forecastByMonthCat: emptyBuckets,
      budgetsByCategory: emptyBudgets,
      targetSavingsMonthlyUsd: '5700',
    });
    expect(out.kpis.incomeYtdUsd).toBe('10000.00');
    expect(out.kpis.expenseYtdUsd).toBe('5000.00');
    expect(out.kpis.netYtdUsd).toBe('5000.00');
    expect(out.kpis.investmentYtdUsd).toBe('3000.00');
    expect(out.kpis.savingsYtdUsd).toBe('8000.00');
  });

  it('año pasado completo: monthsElapsed=12, isProjected=false en todos', () => {
    const out = buildYearEconomyReport({
      year: 2025,
      today: '2026-05-20',
      tree,
      txByMonthCat: [],
      forecastByMonthCat: emptyBuckets,
      budgetsByCategory: emptyBudgets,
      targetSavingsMonthlyUsd: '5700',
    });
    expect(out.trajectory.monthsElapsed).toBe(12);
    expect(out.monthly.every((m) => m.isProjected === false)).toBe(true);
  });

  it('año futuro: monthsElapsed=0, isProjected=true en todos', () => {
    const out = buildYearEconomyReport({
      year: 2027,
      today: '2026-05-20',
      tree,
      txByMonthCat: emptyBuckets,
      forecastByMonthCat: [
        { year: 2027, month: 1, kind: 'income', categoryId: 'sueldo-nico', totalUsd: '7000' },
      ],
      budgetsByCategory: emptyBudgets,
      targetSavingsMonthlyUsd: '5700',
    });
    expect(out.trajectory.monthsElapsed).toBe(0);
    expect(out.monthly.every((m) => m.isProjected)).toBe(true);
    expect(out.monthly[0]?.income).toBe(7000);
  });

  it('categoryRows: parent agrega children, budget anual respeta sólo hojas', () => {
    const out = buildYearEconomyReport({
      year: 2026,
      today: '2026-05-20',
      tree,
      txByMonthCat: [
        { year: 2026, month: 1, kind: 'expense', categoryId: 'alquiler', totalUsd: '500' },
        { year: 2026, month: 2, kind: 'expense', categoryId: 'expensas', totalUsd: '100' },
      ],
      forecastByMonthCat: emptyBuckets,
      budgetsByCategory: [
        { categoryId: 'alquiler', totalUsd: '6000' },
        { categoryId: 'expensas', totalUsd: '1200' },
      ],
      targetSavingsMonthlyUsd: '5700',
    });
    const vivienda = out.categoryRows.find((r) => r.id === 'vivienda');
    expect(vivienda).toBeDefined();
    expect(vivienda?.realYtdUsd).toBe('600.00'); // 500 + 100
    expect(vivienda?.budgetAnnualUsd).toBe('7200.00'); // 6000 + 1200
    expect(vivienda?.deltaUsd).toBe('-6600.00'); // projected 600 - budget 7200
  });

  it('forecast con categoryId=null se cuenta en KPIs pero NO en categoryRows', () => {
    const out = buildYearEconomyReport({
      year: 2026,
      today: '2026-05-20',
      tree,
      txByMonthCat: emptyBuckets,
      forecastByMonthCat: [
        { year: 2026, month: 6, kind: 'income', categoryId: null, totalUsd: '500' },
      ],
      budgetsByCategory: emptyBudgets,
      targetSavingsMonthlyUsd: '5700',
    });
    expect(out.monthly[5]?.income).toBe(500);
    // No category row should have non-zero real/projected
    for (const r of out.categoryRows) {
      expect(r.realYtdUsd).toBe('0.00');
      expect(r.projectedDecUsd).toBe('0.00');
    }
  });

  it('proyección dic: real YTD + forecasts del resto del año', () => {
    const out = buildYearEconomyReport({
      year: 2026,
      today: '2026-05-20',
      tree,
      txByMonthCat: [
        { year: 2026, month: 1, kind: 'expense', categoryId: 'alquiler', totalUsd: '500' },
        { year: 2026, month: 2, kind: 'expense', categoryId: 'alquiler', totalUsd: '500' },
      ],
      forecastByMonthCat: [
        { year: 2026, month: 6, kind: 'expense', categoryId: 'alquiler', totalUsd: '600' },
        { year: 2026, month: 7, kind: 'expense', categoryId: 'alquiler', totalUsd: '600' },
      ],
      budgetsByCategory: [{ categoryId: 'alquiler', totalUsd: '6000' }],
      targetSavingsMonthlyUsd: '5700',
    });
    const alquiler = out.categoryRows.find((r) => r.id === 'alquiler');
    expect(alquiler?.realYtdUsd).toBe('1000.00');
    expect(alquiler?.projectedDecUsd).toBe('2200.00'); // 500+500 real + 600+600 forecast
    expect(alquiler?.deltaUsd).toBe('-3800.00'); // 2200 - 6000
  });
});
