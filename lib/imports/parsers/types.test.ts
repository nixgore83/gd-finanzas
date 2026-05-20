import { describe, it, expect } from 'vitest';
import { parsedTxLineSchema, parserOutputSchema } from './types';

describe('parsedTxLineSchema', () => {
  it('happy path', () => {
    const out = parsedTxLineSchema.safeParse({
      date: '2026-05-20',
      description: 'NETFLIX SUSCRIPCION',
      amountOriginal: '12.99',
      currencyOriginal: 'USD',
      kind: 'expense',
    });
    expect(out.success).toBe(true);
  });

  it('rechaza date sin formato YYYY-MM-DD', () => {
    const out = parsedTxLineSchema.safeParse({
      date: '20/05/2026',
      description: 'X',
      amountOriginal: '10.00',
      currencyOriginal: 'ARS',
      kind: 'expense',
    });
    expect(out.success).toBe(false);
  });

  it('rechaza amount no numérico', () => {
    const out = parsedTxLineSchema.safeParse({
      date: '2026-05-20',
      description: 'X',
      amountOriginal: '$10,00',
      currencyOriginal: 'ARS',
      kind: 'expense',
    });
    expect(out.success).toBe(false);
  });

  it('rechaza currency fuera del enum', () => {
    const out = parsedTxLineSchema.safeParse({
      date: '2026-05-20',
      description: 'X',
      amountOriginal: '10.00',
      currencyOriginal: 'EUR',
      kind: 'expense',
    });
    expect(out.success).toBe(false);
  });
});

describe('parserOutputSchema', () => {
  it('array de líneas válidas', () => {
    const out = parserOutputSchema.safeParse({
      lines: [
        {
          date: '2026-05-20',
          description: 'X',
          amountOriginal: '10.00',
          currencyOriginal: 'ARS',
          kind: 'expense',
        },
      ],
    });
    expect(out.success).toBe(true);
  });
  it('array vacío válido', () => {
    expect(parserOutputSchema.safeParse({ lines: [] }).success).toBe(true);
  });
});
