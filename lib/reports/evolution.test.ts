import { describe, it, expect } from 'vitest';
import { buildEvolutionSeries, rollingMonths } from './evolution';

describe('rollingMonths', () => {
  it('12 meses hasta mayo 2026 → jun 2025 a mayo 2026', () => {
    const months = rollingMonths(2026, 5);
    expect(months).toHaveLength(12);
    expect(months[0]).toEqual({ year: 2025, month: 6 });
    expect(months[11]).toEqual({ year: 2026, month: 5 });
  });

  it('count custom', () => {
    expect(rollingMonths(2026, 3, 4)).toEqual([
      { year: 2025, month: 12 },
      { year: 2026, month: 1 },
      { year: 2026, month: 2 },
      { year: 2026, month: 3 },
    ]);
  });

  it('terminar en enero cruza año', () => {
    const months = rollingMonths(2026, 1, 3);
    expect(months).toEqual([
      { year: 2025, month: 11 },
      { year: 2025, month: 12 },
      { year: 2026, month: 1 },
    ]);
  });
});

describe('buildEvolutionSeries', () => {
  it('ordena ascendente y calcula net', () => {
    const series = buildEvolutionSeries([
      { year: 2026, month: 5, income: '8000', expense: '5000' },
      { year: 2026, month: 4, income: '7000', expense: '5500' },
    ]);
    expect(series).toHaveLength(2);
    expect(series[0]?.month).toBe(4);
    expect(series[0]?.net).toBe(1500);
    expect(series[1]?.month).toBe(5);
    expect(series[1]?.net).toBe(3000);
  });

  it('label formato MMM YY', () => {
    const [p] = buildEvolutionSeries([
      { year: 2026, month: 1, income: '0', expense: '0' },
    ]);
    expect(p?.label).toBe('Ene 26');
  });

  it('net puede ser negativo', () => {
    const [p] = buildEvolutionSeries([
      { year: 2026, month: 5, income: '1000', expense: '3000' },
    ]);
    expect(p?.net).toBe(-2000);
  });

  it('buckets vacíos → []', () => {
    expect(buildEvolutionSeries([])).toEqual([]);
  });
});
