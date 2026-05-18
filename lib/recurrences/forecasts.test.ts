import { describe, it, expect } from 'vitest';
import { computeForecastDates } from './forecasts';

describe('computeForecastDates', () => {
  describe('monthly', () => {
    it('12 fechas para horizon=12m con día estándar', () => {
      const dates = computeForecastDates({
        frequency: 'monthly',
        dayOfMonth: 15,
        startDate: '2026-01-01',
        endDate: null,
        horizonFrom: '2026-05-18',
      });
      expect(dates).toHaveLength(12);
      expect(dates[0]).toBe('2026-06-15');
      expect(dates[11]).toBe('2027-05-15');
    });

    it('día 31 en meses cortos → cliplapsado al último día', () => {
      const dates = computeForecastDates({
        frequency: 'monthly',
        dayOfMonth: 31,
        startDate: '2026-01-01',
        endDate: null,
        horizonFrom: '2026-01-01',
        horizonMonths: 6,
      });
      // feb (no leap en 2026) → 28; abr → 30
      expect(dates).toContain('2026-01-31');
      expect(dates).toContain('2026-02-28');
      expect(dates).toContain('2026-03-31');
      expect(dates).toContain('2026-04-30');
      expect(dates).toContain('2026-05-31');
      expect(dates).toContain('2026-06-30');
    });

    it('día 29 feb leap year → 29', () => {
      const dates = computeForecastDates({
        frequency: 'monthly',
        dayOfMonth: 29,
        startDate: '2028-02-01',
        endDate: null,
        horizonFrom: '2028-02-01',
        horizonMonths: 2,
      });
      expect(dates).toContain('2028-02-29');
      expect(dates).toContain('2028-03-29');
    });
  });

  describe('bimonthly', () => {
    it('6 fechas espaciadas 2 meses', () => {
      const dates = computeForecastDates({
        frequency: 'bimonthly',
        dayOfMonth: 10,
        startDate: '2026-01-01',
        endDate: null,
        horizonFrom: '2026-01-01',
      });
      expect(dates).toHaveLength(6);
      expect(dates[0]).toBe('2026-01-10');
      expect(dates[1]).toBe('2026-03-10');
      expect(dates[5]).toBe('2026-11-10');
    });
  });

  describe('quarterly', () => {
    it('4 fechas espaciadas 3 meses', () => {
      const dates = computeForecastDates({
        frequency: 'quarterly',
        dayOfMonth: 1,
        startDate: '2026-01-01',
        endDate: null,
        horizonFrom: '2026-01-01',
      });
      expect(dates).toHaveLength(4);
      expect(dates).toEqual(['2026-01-01', '2026-04-01', '2026-07-01', '2026-10-01']);
    });
  });

  describe('yearly', () => {
    it('1 fecha si el aniversario cae en el horizon', () => {
      const dates = computeForecastDates({
        frequency: 'yearly',
        dayOfMonth: 15,
        startDate: '2024-03-15',
        endDate: null,
        horizonFrom: '2026-05-01',
      });
      expect(dates).toHaveLength(1);
      expect(dates[0]).toBe('2027-03-15');
    });
  });

  describe('endDate', () => {
    it('corta el horizon si endDate cae antes', () => {
      const dates = computeForecastDates({
        frequency: 'monthly',
        dayOfMonth: 5,
        startDate: '2026-01-01',
        endDate: '2026-04-30',
        horizonFrom: '2026-01-01',
      });
      expect(dates).toEqual(['2026-01-05', '2026-02-05', '2026-03-05', '2026-04-05']);
    });
  });

  describe('edges', () => {
    it('startDate después del horizon → []', () => {
      const dates = computeForecastDates({
        frequency: 'monthly',
        dayOfMonth: 10,
        startDate: '2030-01-01',
        endDate: null,
        horizonFrom: '2026-01-01',
      });
      expect(dates).toEqual([]);
    });

    it('startDate antes del horizon: arranca dentro del rolling 12m', () => {
      const dates = computeForecastDates({
        frequency: 'monthly',
        dayOfMonth: 5,
        startDate: '2024-01-01',
        endDate: null,
        horizonFrom: '2026-05-18',
      });
      expect(dates).toHaveLength(12);
      expect(dates[0]).toBe('2026-06-05');
    });

    it('startDate igual a horizonFrom con dayOfMonth posterior → incluye ese mes', () => {
      const dates = computeForecastDates({
        frequency: 'monthly',
        dayOfMonth: 20,
        startDate: '2026-05-18',
        endDate: null,
        horizonFrom: '2026-05-18',
        horizonMonths: 2,
      });
      expect(dates[0]).toBe('2026-05-20');
    });

    it('endDate ya pasado → []', () => {
      const dates = computeForecastDates({
        frequency: 'monthly',
        dayOfMonth: 10,
        startDate: '2024-01-01',
        endDate: '2025-12-31',
        horizonFrom: '2026-05-18',
      });
      expect(dates).toEqual([]);
    });
  });
});
