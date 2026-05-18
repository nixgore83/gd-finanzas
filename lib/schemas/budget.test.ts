import { describe, it, expect } from 'vitest';
import { budgetInputSchema, parseSetBudgetFormData } from './budget';

const UUID = '00000000-0000-0000-0000-000000000001';

describe('budgetInputSchema', () => {
  it('happy path', () => {
    const out = budgetInputSchema.parse({
      year: 2026,
      month: 5,
      categoryId: UUID,
      amountUsd: '1000',
    });
    expect(out.year).toBe(2026);
    expect(out.month).toBe(5);
    expect(out.amountUsd).toBe('1000.00');
  });

  it('coerce de strings', () => {
    const out = budgetInputSchema.parse({
      year: '2026',
      month: '12',
      categoryId: UUID,
      amountUsd: '500.5',
    });
    expect(out.year).toBe(2026);
    expect(out.month).toBe(12);
    expect(out.amountUsd).toBe('500.50');
  });

  it('amount = 0 acepta', () => {
    const out = budgetInputSchema.parse({
      year: 2026,
      month: 5,
      categoryId: UUID,
      amountUsd: '0',
    });
    expect(out.amountUsd).toBe('0.00');
  });

  it('amount negativo acepta (raro pero permitido)', () => {
    const out = budgetInputSchema.parse({
      year: 2026,
      month: 5,
      categoryId: UUID,
      amountUsd: '-100',
    });
    expect(out.amountUsd).toBe('-100.00');
  });

  it('rechaza month fuera de rango', () => {
    expect(() =>
      budgetInputSchema.parse({ year: 2026, month: 0, categoryId: UUID, amountUsd: '1' }),
    ).toThrow();
    expect(() =>
      budgetInputSchema.parse({ year: 2026, month: 13, categoryId: UUID, amountUsd: '1' }),
    ).toThrow();
  });

  it('rechaza year fuera de rango', () => {
    expect(() =>
      budgetInputSchema.parse({ year: 2019, month: 1, categoryId: UUID, amountUsd: '1' }),
    ).toThrow();
    expect(() =>
      budgetInputSchema.parse({ year: 2101, month: 1, categoryId: UUID, amountUsd: '1' }),
    ).toThrow();
  });

  it('rechaza categoryId no-uuid', () => {
    expect(() =>
      budgetInputSchema.parse({
        year: 2026,
        month: 1,
        categoryId: 'not-uuid',
        amountUsd: '1',
      }),
    ).toThrow();
  });
});

describe('parseSetBudgetFormData', () => {
  it('parsea FormData válida', () => {
    const fd = new FormData();
    fd.set('year', '2026');
    fd.set('month', '5');
    fd.set('categoryId', UUID);
    fd.set('amountUsd', '1234.56');
    const out = parseSetBudgetFormData(fd);
    expect(out.success).toBe(true);
    if (out.success) expect(out.data.amountUsd).toBe('1234.56');
  });
});
