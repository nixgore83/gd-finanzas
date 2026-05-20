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

describe('parsedTxLineSchema preprocess (alias + coerce)', () => {
  it('mapea amount → amountOriginal', () => {
    const out = parsedTxLineSchema.safeParse({
      date: '2026-05-20',
      description: 'X',
      amount: '10.00',
      currency: 'ARS',
      kind: 'expense',
    });
    expect(out.success).toBe(true);
    if (out.success) expect(out.data.amountOriginal).toBe('10.00');
  });

  it('mapea monto/moneda/descripcion/fecha/tipo (español)', () => {
    const out = parsedTxLineSchema.safeParse({
      fecha: '2026-05-20',
      descripcion: 'COMERCIO XX',
      monto: '8350.50',
      moneda: 'ars',
      tipo: 'gasto',
    });
    expect(out.success).toBe(true);
    if (out.success) {
      expect(out.data.amountOriginal).toBe('8350.50');
      expect(out.data.currencyOriginal).toBe('ARS');
      expect(out.data.kind).toBe('expense');
    }
  });

  it('coerce number → string', () => {
    const out = parsedTxLineSchema.safeParse({
      date: '2026-05-20',
      description: 'X',
      amountOriginal: 1234.56,
      currencyOriginal: 'USD',
      kind: 'expense',
    });
    expect(out.success).toBe(true);
    if (out.success) expect(out.data.amountOriginal).toBe('1234.56');
  });

  it('amount negativo → flip + kind=expense si no estaba seteado', () => {
    const out = parsedTxLineSchema.safeParse({
      date: '2026-05-20',
      description: 'X',
      amount: '-50.00',
      currency: 'USD',
    });
    expect(out.success).toBe(true);
    if (out.success) {
      expect(out.data.amountOriginal).toBe('50.00');
      expect(out.data.kind).toBe('expense');
    }
  });

  it('separadores de miles US ("1,234.56") se limpian', () => {
    const out = parsedTxLineSchema.safeParse({
      date: '2026-05-20',
      description: 'X',
      amountOriginal: '1,234.56',
      currencyOriginal: 'USD',
      kind: 'expense',
    });
    expect(out.success).toBe(true);
    if (out.success) expect(out.data.amountOriginal).toBe('1234.56');
  });

  it('kind crédito → income', () => {
    const out = parsedTxLineSchema.safeParse({
      date: '2026-05-20',
      description: 'DEVOLUCION',
      amountOriginal: '500.00',
      currencyOriginal: 'ARS',
      kind: 'credito',
    });
    expect(out.success).toBe(true);
    if (out.success) expect(out.data.kind).toBe('income');
  });
});
