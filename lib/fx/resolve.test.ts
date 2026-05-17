import { describe, it, expect } from 'vitest';
import { resolveFxRate, FALLBACK_SOURCE, type FxRateRow } from './resolve';

const row = (date: string, mid: string, source = 'BCRA_minorista'): FxRateRow => ({
  date,
  currencyPair: 'USD/ARS',
  mid,
  source,
});

describe('resolveFxRate', () => {
  it('devuelve match exacto sin tocar el source', () => {
    const rows = [row('2026-05-15', '1100.50'), row('2026-05-14', '1099.00')];
    const out = resolveFxRate(rows, '2026-05-15', 'USD/ARS');
    expect(out).not.toBeNull();
    expect(out!.rate.toFixed(2)).toBe('1100.50');
    expect(out!.source).toBe('BCRA_minorista');
    expect(out!.effectiveDate).toBe('2026-05-15');
  });

  it('cae al día anterior y marca BCRA_last_available', () => {
    const rows = [row('2026-05-14', '1099.00'), row('2026-05-13', '1098.00')];
    const out = resolveFxRate(rows, '2026-05-15', 'USD/ARS');
    expect(out).not.toBeNull();
    expect(out!.rate.toFixed(2)).toBe('1099.00');
    expect(out!.source).toBe(FALLBACK_SOURCE);
    expect(out!.effectiveDate).toBe('2026-05-14');
  });

  it('en finde largo encuentra el viernes previo', () => {
    // 2026-05-16 sábado, 17 domingo. Pedimos para el domingo.
    const rows = [
      row('2026-05-15', '1100.00'),
      row('2026-05-14', '1099.00'),
      row('2026-05-13', '1098.00'),
    ];
    const out = resolveFxRate(rows, '2026-05-17', 'USD/ARS');
    expect(out!.effectiveDate).toBe('2026-05-15');
    expect(out!.source).toBe(FALLBACK_SOURCE);
  });

  it('devuelve null si todas las rows son posteriores', () => {
    const rows = [row('2026-05-15', '1100.00')];
    const out = resolveFxRate(rows, '2026-05-14', 'USD/ARS');
    expect(out).toBeNull();
  });

  it('devuelve null con array vacío', () => {
    expect(resolveFxRate([], '2026-05-15', 'USD/ARS')).toBeNull();
  });

  it('filtra por currencyPair', () => {
    const rows: FxRateRow[] = [
      { date: '2026-05-15', currencyPair: 'EUR/ARS', mid: '1200', source: 'BCRA_minorista' },
      { date: '2026-05-14', currencyPair: 'USD/ARS', mid: '1099', source: 'BCRA_minorista' },
    ];
    const out = resolveFxRate(rows, '2026-05-15', 'USD/ARS');
    expect(out!.effectiveDate).toBe('2026-05-14');
    expect(out!.rate.toFixed(2)).toBe('1099.00');
    expect(out!.source).toBe(FALLBACK_SOURCE);
  });

  it('ignora rows con date posterior pero del mismo pair', () => {
    const rows = [
      row('2026-05-20', '1105.00'),
      row('2026-05-15', '1100.00'),
      row('2026-05-14', '1099.00'),
    ];
    const out = resolveFxRate(rows, '2026-05-15', 'USD/ARS');
    expect(out!.effectiveDate).toBe('2026-05-15');
    expect(out!.source).toBe('BCRA_minorista');
  });
});
