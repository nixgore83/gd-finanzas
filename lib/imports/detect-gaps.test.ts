import { describe, expect, it } from 'vitest';
import { buildCoveredMonths, computeMissingMonths } from './detect-gaps';

describe('buildCoveredMonths', () => {
  it('expande el período de un import consolidado a todos sus meses', () => {
    const covered = buildCoveredMonths(
      [{ periodStart: '2026-01-02', periodEnd: '2026-06-09' }],
      [],
    );
    expect([...covered].sort()).toEqual([
      '2026-01',
      '2026-02',
      '2026-03',
      '2026-04',
      '2026-05',
      '2026-06',
    ]);
  });

  it('un mes sin movimientos dentro del período cuenta como cubierto (caso ICBC CA USD feb)', () => {
    // El import consolidado declara ene–jun; feb no tiene líneas.
    const covered = buildCoveredMonths(
      [{ periodStart: '2026-01-01', periodEnd: '2026-06-30' }],
      ['2026-01', '2026-03', '2026-04', '2026-05', '2026-06'],
    );
    expect(covered.has('2026-02')).toBe(true);
  });

  it('sin período declarado cae al fallback por meses con líneas', () => {
    const covered = buildCoveredMonths(
      [{ periodStart: null, periodEnd: null }],
      ['2026-03', '2026-04'],
    );
    expect([...covered].sort()).toEqual(['2026-03', '2026-04']);
  });

  it('período sin fin usa el mes de inicio', () => {
    const covered = buildCoveredMonths([{ periodStart: '2026-02-15', periodEnd: null }], []);
    expect([...covered]).toEqual(['2026-02']);
  });

  it('une períodos de varios imports con las líneas', () => {
    const covered = buildCoveredMonths(
      [
        { periodStart: '2026-01-01', periodEnd: '2026-02-28' },
        { periodStart: '2026-04-01', periodEnd: '2026-04-30' },
      ],
      ['2026-05'],
    );
    expect([...covered].sort()).toEqual(['2026-01', '2026-02', '2026-04', '2026-05']);
  });
});

describe('computeMissingMonths', () => {
  it('reporta los meses no cubiertos entre el primero cubierto y el actual', () => {
    const covered = new Set(['2026-01', '2026-03']);
    expect(computeMissingMonths(covered, '2026-06')).toEqual(['2026-02', '2026-04', '2026-05']);
  });

  it('sin cobertura no reporta gaps (cuenta sin imports todavía)', () => {
    expect(computeMissingMonths(new Set(), '2026-06')).toEqual([]);
  });

  it('excluye el mes corriente aunque no esté cubierto', () => {
    const covered = new Set(['2026-05']);
    expect(computeMissingMonths(covered, '2026-06')).toEqual([]);
  });

  it('no reporta meses previos a EARLIEST_TRACKED_MONTH', () => {
    const covered = new Set(['2025-11']);
    expect(computeMissingMonths(covered, '2026-03', '2026-01')).toEqual([
      '2026-01',
      '2026-02',
    ]);
  });

  it('cobertura completa por período → sin gaps (fix del falso positivo)', () => {
    const covered = buildCoveredMonths(
      [{ periodStart: '2026-01-02', periodEnd: '2026-06-09' }],
      ['2026-01', '2026-03'], // feb/abr/may sin movimientos
    );
    expect(computeMissingMonths(covered, '2026-06')).toEqual([]);
  });
});
