import { describe, it, expect } from 'vitest';
import Decimal from 'decimal.js';
import { toMoneyString, parseMoney, moneySchema, positiveMoneySchema } from './money';

describe('toMoneyString', () => {
  it('formats integers with two decimals', () => {
    expect(toMoneyString(1)).toBe('1.00');
    expect(toMoneyString(0)).toBe('0.00');
    expect(toMoneyString(-50)).toBe('-50.00');
  });

  it('accepts string input', () => {
    expect(toMoneyString('1.5')).toBe('1.50');
    expect(toMoneyString('1234567.89')).toBe('1234567.89');
  });

  it('accepts Decimal input', () => {
    expect(toMoneyString(new Decimal('1.005'))).toBe('1.01');
  });

  it('rounds half up away from zero', () => {
    expect(toMoneyString('0.005')).toBe('0.01');
    expect(toMoneyString('0.004')).toBe('0.00');
    expect(toMoneyString('-0.005')).toBe('-0.01');
  });

  it('preserves large values without floating-point drift', () => {
    expect(toMoneyString('99999999999999.99')).toBe('99999999999999.99');
  });

  it('throws on non-finite', () => {
    expect(() => toMoneyString('Infinity')).toThrow();
    expect(() => toMoneyString(NaN)).toThrow();
  });
});

describe('parseMoney', () => {
  it('returns a Decimal', () => {
    const d = parseMoney('100.25');
    expect(d).toBeInstanceOf(Decimal);
    expect(d.toFixed(2)).toBe('100.25');
  });

  it('arithmetic does not drift', () => {
    const total = parseMoney('0.1').plus(parseMoney('0.2'));
    expect(total.toFixed(2)).toBe('0.30');
  });
});

describe('moneySchema', () => {
  it('canonicalizes string inputs to two decimals', () => {
    expect(moneySchema.parse('1')).toBe('1.00');
    expect(moneySchema.parse('  1.5 ')).toBe('1.50');
    expect(moneySchema.parse('1.005')).toBe('1.01');
  });

  it('accepts numbers', () => {
    expect(moneySchema.parse(1.5)).toBe('1.50');
    expect(moneySchema.parse(-50)).toBe('-50.00');
  });

  it('rejects garbage', () => {
    expect(() => moneySchema.parse('abc')).toThrow();
    expect(() => moneySchema.parse('')).toThrow();
    expect(() => moneySchema.parse('Infinity')).toThrow();
    expect(() => moneySchema.parse(NaN)).toThrow();
  });
});

describe('positiveMoneySchema', () => {
  it('accepts zero and positive', () => {
    expect(positiveMoneySchema.parse('0')).toBe('0.00');
    expect(positiveMoneySchema.parse('100')).toBe('100.00');
  });

  it('rejects negative', () => {
    expect(() => positiveMoneySchema.parse('-1')).toThrow();
    expect(() => positiveMoneySchema.parse(-50)).toThrow();
  });
});
