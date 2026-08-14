import { describe, it, expect } from 'vitest';
import {
  describeDateRange,
  hasDateRange,
  isIsoDate,
  matchesDateRange,
} from './date-range-filter';

describe('matchesDateRange', () => {
  it('CASO REAL: "hasta 2025-12-31" aísla el arrastre del ejercicio anterior', () => {
    // Extracto de caja de ahorro cerrado en enero-2026 con 192 líneas de 2025.
    expect(matchesDateRange('2025-09-23', '', '2025-12-31')).toBe(true);
    expect(matchesDateRange('2025-12-31', '', '2025-12-31')).toBe(true); // inclusive
    expect(matchesDateRange('2026-01-02', '', '2025-12-31')).toBe(false);
  });

  it('"desde" también es inclusive', () => {
    expect(matchesDateRange('2026-01-01', '2026-01-01', '')).toBe(true);
    expect(matchesDateRange('2025-12-31', '2026-01-01', '')).toBe(false);
  });

  it('acota por los dos lados', () => {
    expect(matchesDateRange('2026-03-15', '2026-01-01', '2026-06-30')).toBe(true);
    expect(matchesDateRange('2026-07-01', '2026-01-01', '2026-06-30')).toBe(false);
    expect(matchesDateRange('2025-12-31', '2026-01-01', '2026-06-30')).toBe(false);
  });

  it('sin extremos no filtra nada', () => {
    expect(matchesDateRange('2020-01-01', '', '')).toBe(true);
  });

  it('un extremo a medio tipear no vacía la lista', () => {
    // El input dispara onChange en cada tecla: "2026-0" no debe esconder todo.
    expect(matchesDateRange('2026-03-15', '2026-0', '')).toBe(true);
    expect(matchesDateRange('2026-03-15', '', 'basura')).toBe(true);
  });

  it('una línea sin fecha legible NUNCA se esconde', () => {
    // Es justo la que más necesita revisión humana: esconderla sería lo peor.
    expect(matchesDateRange(null, '2026-01-01', '2026-12-31')).toBe(true);
    expect(matchesDateRange('', '2026-01-01', '2026-12-31')).toBe(true);
    expect(matchesDateRange('FECHA_RARA', '2026-01-01', '2026-12-31')).toBe(true);
  });

  it('compara como string, sin pasar por Date (nada de corrimientos de huso)', () => {
    // Un movimiento es un día calendario, no un instante.
    expect(matchesDateRange('2026-01-01', '2026-01-01', '2026-01-01')).toBe(true);
  });
});

describe('isIsoDate', () => {
  it('acepta el formato y rechaza el resto', () => {
    expect(isIsoDate('2026-01-31')).toBe(true);
    expect(isIsoDate('2026-1-3')).toBe(false);
    expect(isIsoDate('31/01/2026')).toBe(false);
    expect(isIsoDate('')).toBe(false);
  });
});

describe('hasDateRange / describeDateRange', () => {
  it('describe cada combinación para el chip', () => {
    expect(describeDateRange('', '2025-12-31')).toBe('hasta 2025-12-31');
    expect(describeDateRange('2026-01-01', '')).toBe('desde 2026-01-01');
    expect(describeDateRange('2026-01-01', '2026-06-30')).toBe('2026-01-01 → 2026-06-30');
    expect(describeDateRange('', '')).toBe('');
  });

  it('ignora extremos mal formados', () => {
    expect(hasDateRange('2026-0', '')).toBe(false);
    expect(hasDateRange('', '2025-12-31')).toBe(true);
    expect(describeDateRange('2026-0', '')).toBe('');
  });
});
