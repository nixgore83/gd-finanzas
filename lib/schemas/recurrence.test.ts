import { describe, it, expect } from 'vitest';
import { recurrenceInputSchema } from './recurrence';

const UUID = '00000000-0000-0000-0000-000000000001';
const UUID2 = '00000000-0000-0000-0000-000000000002';

const valid = {
  name: 'Sueldo Nico',
  accountId: UUID,
  categoryId: UUID2,
  kind: 'income' as const,
  amount: '10000.50',
  currency: 'USD' as const,
  frequency: 'monthly' as const,
  dayOfMonth: 2,
  startDate: '2026-01-02',
  endDate: null,
  active: true,
};

describe('recurrenceInputSchema', () => {
  it('happy path income', () => {
    const out = recurrenceInputSchema.parse(valid);
    expect(out.amount).toBe('10000.50');
    expect(out.dayOfMonth).toBe(2);
    expect(out.endDate).toBeNull();
    expect(out.active).toBe(true);
  });

  it('endDate vacío / undefined → null', () => {
    expect(recurrenceInputSchema.parse({ ...valid, endDate: '' }).endDate).toBeNull();
    expect(recurrenceInputSchema.parse({ ...valid, endDate: undefined }).endDate).toBeNull();
  });

  it('dayOfMonth coerce desde string', () => {
    const out = recurrenceInputSchema.parse({ ...valid, dayOfMonth: '15' });
    expect(out.dayOfMonth).toBe(15);
  });

  it('rechaza dayOfMonth fuera de rango', () => {
    expect(() => recurrenceInputSchema.parse({ ...valid, dayOfMonth: 0 })).toThrow();
    expect(() => recurrenceInputSchema.parse({ ...valid, dayOfMonth: 32 })).toThrow();
    expect(() => recurrenceInputSchema.parse({ ...valid, dayOfMonth: 'abc' })).toThrow();
  });

  it('rechaza frequency=custom (no expuesto en V1)', () => {
    expect(() =>
      recurrenceInputSchema.parse({ ...valid, frequency: 'custom' as 'monthly' }),
    ).toThrow();
  });

  it('rechaza endDate < startDate', () => {
    expect(() =>
      recurrenceInputSchema.parse({ ...valid, endDate: '2025-12-31' }),
    ).toThrow(/fin debe ser/);
  });

  it('acepta endDate == startDate', () => {
    const out = recurrenceInputSchema.parse({ ...valid, endDate: '2026-01-02' });
    expect(out.endDate).toBe('2026-01-02');
  });

  it('rechaza amount negativo', () => {
    expect(() => recurrenceInputSchema.parse({ ...valid, amount: '-1' })).toThrow();
  });

  it('rechaza name vacío y >80', () => {
    expect(() => recurrenceInputSchema.parse({ ...valid, name: '' })).toThrow();
    expect(() =>
      recurrenceInputSchema.parse({ ...valid, name: 'x'.repeat(81) }),
    ).toThrow();
  });

  it('rechaza UUIDs inválidos', () => {
    expect(() =>
      recurrenceInputSchema.parse({ ...valid, accountId: 'not-uuid' }),
    ).toThrow();
    expect(() =>
      recurrenceInputSchema.parse({ ...valid, categoryId: 'not-uuid' }),
    ).toThrow();
  });

  it('rechaza currency fuera de ARS/USD', () => {
    expect(() =>
      recurrenceInputSchema.parse({ ...valid, currency: 'EUR' as 'USD' }),
    ).toThrow();
  });
});
