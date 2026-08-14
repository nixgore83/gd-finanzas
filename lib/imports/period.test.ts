import { describe, expect, it } from 'vitest';
import { formatPeriodDate, formatPeriodRange } from '@/lib/imports/period';

describe('formatPeriodDate', () => {
  it('formatea YYYY-MM-DD en es-AR abreviado, sin cero a la izquierda en el día', () => {
    expect(formatPeriodDate('2026-01-02')).toBe('2 ene 2026');
    expect(formatPeriodDate('2026-06-09')).toBe('9 jun 2026');
    expect(formatPeriodDate('2026-12-31')).toBe('31 dic 2026');
  });

  it('no corre la fecha por zona horaria (no pasa por new Date)', () => {
    // En un server en UTC, `new Date('2026-03-01')` renderizado en es-AR (UTC-3)
    // daría "28 feb". El período es una fecha sin hora: tiene que quedar igual.
    expect(formatPeriodDate('2026-03-01')).toBe('1 mar 2026');
  });

  it('devuelve el string crudo si no matchea el formato esperado', () => {
    expect(formatPeriodDate('no-es-fecha')).toBe('no-es-fecha');
    expect(formatPeriodDate('2026-13-01')).toBe('2026-13-01');
  });
});

describe('formatPeriodRange', () => {
  it('muestra el rango con guion largo', () => {
    expect(formatPeriodRange('2026-01-02', '2026-06-09')).toBe('2 ene 2026 – 9 jun 2026');
  });

  it('colapsa a una sola fecha si inicio y fin son el mismo día', () => {
    // Caso típico de los resúmenes de TC que apilan todo en la fecha de cierre.
    expect(formatPeriodRange('2026-06-09', '2026-06-09')).toBe('9 jun 2026');
  });

  it('sin fin, muestra solo el inicio', () => {
    expect(formatPeriodRange('2026-06-09', null)).toBe('9 jun 2026');
  });

  it('import sin parsear (sin período) → guion', () => {
    expect(formatPeriodRange(null, null)).toBe('—');
  });

  it('fin sin inicio (no debería pasar) → muestra el fin, no rompe', () => {
    expect(formatPeriodRange(null, '2026-06-09')).toBe('9 jun 2026');
  });
});
