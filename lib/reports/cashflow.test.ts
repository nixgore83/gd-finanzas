import { describe, it, expect } from 'vitest';
import { buildCashflowReport, deltaTone } from './cashflow';
import type { CategoryNode } from '@/lib/categories/tree';

const tree: CategoryNode[] = [
  { id: 'sueldo', name: 'Sueldo', kind: 'income', depth: 0, parentId: null, isInvestment: false },
  { id: 'sueldo-nico', name: 'Sueldo Nico', kind: 'income', depth: 1, parentId: 'sueldo', isInvestment: false },
  { id: 'sueldo-pau', name: 'Sueldo Pau', kind: 'income', depth: 1, parentId: 'sueldo', isInvestment: false },
  { id: 'otros-ing', name: 'Otros ingresos', kind: 'income', depth: 0, parentId: null, isInvestment: false },
  { id: 'vivienda', name: 'Vivienda', kind: 'expense', depth: 0, parentId: null, isInvestment: false },
  { id: 'alquiler', name: 'Alquiler', kind: 'expense', depth: 1, parentId: 'vivienda', isInvestment: false },
  { id: 'expensas', name: 'Expensas', kind: 'expense', depth: 1, parentId: 'vivienda', isInvestment: false },
  { id: 'vacaciones', name: 'Vacaciones', kind: 'expense', depth: 0, parentId: null, isInvestment: false },
];

describe('buildCashflowReport', () => {
  it('happy path con 1 income + 1 expense', () => {
    const out = buildCashflowReport(
      tree,
      [
        { categoryId: 'sueldo-nico', amountUsd: '5000' },
        { categoryId: 'alquiler', amountUsd: '500' },
      ],
      [
        { categoryId: 'sueldo-nico', realUsd: '5000' },
        { categoryId: 'alquiler', realUsd: '450' },
      ],
    );
    const sueldoNico = out.rows.find((r) => r.category.id === 'sueldo-nico')!;
    expect(sueldoNico.budget).toBe('5000.00');
    expect(sueldoNico.real).toBe('5000.00');
    expect(sueldoNico.deltaUsd).toBe('0.00');
    expect(sueldoNico.deltaPct).toBe(0);

    const alq = out.rows.find((r) => r.category.id === 'alquiler')!;
    expect(alq.budget).toBe('500.00');
    expect(alq.real).toBe('450.00');
    expect(alq.deltaUsd).toBe('-50.00');
    expect(alq.deltaPct).toBeCloseTo(-10);
  });

  it('budget = 0 → deltaPct null', () => {
    const out = buildCashflowReport(
      tree,
      [],
      [{ categoryId: 'vacaciones', realUsd: '300' }],
    );
    const v = out.rows.find((r) => r.category.id === 'vacaciones')!;
    expect(v.budget).toBe('0.00');
    expect(v.real).toBe('300.00');
    expect(v.deltaUsd).toBe('300.00');
    expect(v.deltaPct).toBeNull();
  });

  it('parent agrega children', () => {
    const out = buildCashflowReport(
      tree,
      [
        { categoryId: 'alquiler', amountUsd: '500' },
        { categoryId: 'expensas', amountUsd: '120' },
      ],
      [
        { categoryId: 'alquiler', realUsd: '500' },
        { categoryId: 'expensas', realUsd: '130' },
      ],
    );
    const viv = out.rows.find((r) => r.category.id === 'vivienda')!;
    expect(viv.budget).toBe('620.00');
    expect(viv.real).toBe('630.00');
    expect(viv.deltaUsd).toBe('10.00');
    expect(viv.isLeaf).toBe(false);
  });

  it('totales: income/expense/net consistentes', () => {
    const out = buildCashflowReport(
      tree,
      [
        { categoryId: 'sueldo-nico', amountUsd: '5000' },
        { categoryId: 'sueldo-pau', amountUsd: '3000' },
        { categoryId: 'alquiler', amountUsd: '500' },
        { categoryId: 'vacaciones', amountUsd: '200' },
      ],
      [
        { categoryId: 'sueldo-nico', realUsd: '5000' },
        { categoryId: 'sueldo-pau', realUsd: '3100' },
        { categoryId: 'alquiler', realUsd: '500' },
        { categoryId: 'vacaciones', realUsd: '0' },
      ],
    );
    expect(out.totals.income.budget).toBe('8000.00');
    expect(out.totals.income.real).toBe('8100.00');
    expect(out.totals.income.delta).toBe('100.00');

    expect(out.totals.expense.budget).toBe('700.00');
    expect(out.totals.expense.real).toBe('500.00');
    expect(out.totals.expense.delta).toBe('-200.00');

    expect(out.totals.net.budget).toBe('7300.00');
    expect(out.totals.net.real).toBe('7600.00');
    expect(out.totals.net.delta).toBe('300.00');
  });

  it('categoría sin budget ni real → todo 0, pct null', () => {
    const out = buildCashflowReport(tree, [], []);
    const v = out.rows.find((r) => r.category.id === 'vacaciones')!;
    expect(v.budget).toBe('0.00');
    expect(v.real).toBe('0.00');
    expect(v.deltaUsd).toBe('0.00');
    expect(v.deltaPct).toBeNull();
  });

  it('orden de filas = orden del tree', () => {
    const out = buildCashflowReport(tree, [], []);
    expect(out.rows.map((r) => r.category.id)).toEqual(tree.map((c) => c.id));
  });
});

describe('deltaTone', () => {
  it('income: real > budget → good', () => {
    expect(deltaTone('income', '100')).toBe('good');
  });
  it('income: real < budget → bad', () => {
    expect(deltaTone('income', '-100')).toBe('bad');
  });
  it('expense: real > budget → bad', () => {
    expect(deltaTone('expense', '100')).toBe('bad');
  });
  it('expense: real < budget → good', () => {
    expect(deltaTone('expense', '-100')).toBe('good');
  });
  it('delta 0 → neutral en ambos', () => {
    expect(deltaTone('income', '0')).toBe('neutral');
    expect(deltaTone('expense', '0')).toBe('neutral');
  });
});
