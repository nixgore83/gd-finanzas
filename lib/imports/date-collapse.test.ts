import { describe, it, expect } from 'vitest';
import {
  detectDateCollapse,
  dateCollapseMessage,
  isCuotaLine,
  MIN_COLLAPSE_LINES,
  type DateCollapseCandidate,
} from './date-collapse';
import { UNREADABLE_DATE_MARKER } from './parsers/tc-date-rules';

/** Filas sintéticas (nunca datos reales). */
function line(
  date: string,
  description = 'COMERCIO SINTETICO',
  notes?: string,
): DateCollapseCandidate {
  return { date, description, notes };
}

describe('isCuotaLine', () => {
  it('reconoce los marcadores de cuota habituales', () => {
    expect(isCuotaLine('MERPAGO*ALGO C.03/06')).toBe(true);
    expect(isCuotaLine('COMERCIO C 3/6')).toBe(true);
    expect(isCuotaLine('COMERCIO CUOTA 3/6')).toBe(true);
    expect(isCuotaLine('COMERCIO CUOTA 3 DE 6')).toBe(true);
  });

  it('no marca consumos normales', () => {
    expect(isCuotaLine('SUPERMERCADO')).toBe(false);
    expect(isCuotaLine('NETFLIX SUSCRIPCION')).toBe(false);
    // No confundir un número suelto con una cuota
    expect(isCuotaLine('ESTACION 24/7')).toBe(false);
  });
});

describe('detectDateCollapse', () => {
  it('detecta el bug: todos los consumos con la fecha de cierre', () => {
    const lines = Array.from({ length: 8 }, (_, i) => line('2026-07-02', `COMERCIO ${i}`));
    const res = detectDateCollapse(lines);
    expect(res.collapsed).toBe(true);
    if (res.collapsed) {
      expect(res.date).toBe('2026-07-02');
      expect(res.lineCount).toBe(8);
    }
  });

  it('no marca un resumen con fechas distribuidas', () => {
    const lines = [
      line('2026-06-05'),
      line('2026-06-11'),
      line('2026-06-11'),
      line('2026-06-20'),
      line('2026-06-28'),
      line('2026-07-01'),
    ];
    expect(detectDateCollapse(lines).collapsed).toBe(false);
  });

  it('basta UNA fecha distinta para no marcar (conservador)', () => {
    const lines = [
      ...Array.from({ length: 20 }, () => line('2026-07-02')),
      line('2026-06-15'),
    ];
    expect(detectDateCollapse(lines).collapsed).toBe(false);
  });

  it('las cuotas llevan la fecha de cierre por regla de negocio → no son colapso', () => {
    const lines = Array.from({ length: 10 }, (_, i) =>
      line('2026-07-02', `COMERCIO ${i} C.0${(i % 6) + 1}/06`),
    );
    expect(detectDateCollapse(lines).collapsed).toBe(false);
  });

  it('cuotas + pocos consumos reales el mismo día → no alcanza el mínimo', () => {
    const lines = [
      ...Array.from({ length: 10 }, (_, i) => line('2026-07-02', `CUOTA ${i} C.02/06`)),
      line('2026-07-02', 'SUPERMERCADO'),
      line('2026-07-02', 'CAFE'),
    ];
    expect(detectDateCollapse(lines).collapsed).toBe(false);
  });

  it('cuotas + suficientes consumos reales colapsados → sí marca', () => {
    const lines = [
      ...Array.from({ length: 10 }, (_, i) => line('2026-07-02', `CUOTA ${i} C.02/06`)),
      ...Array.from({ length: MIN_COLLAPSE_LINES }, (_, i) =>
        line('2026-07-02', `COMERCIO ${i}`),
      ),
    ];
    const res = detectDateCollapse(lines);
    expect(res.collapsed).toBe(true);
    if (res.collapsed) expect(res.lineCount).toBe(MIN_COLLAPSE_LINES);
  });

  it('ignora las líneas que el LLM marcó con fecha ilegible', () => {
    const lines = [
      ...Array.from({ length: 6 }, (_, i) =>
        line('2026-07-02', `COMERCIO ${i}`, UNREADABLE_DATE_MARKER),
      ),
      line('2026-06-10', 'SUPERMERCADO'),
    ];
    expect(detectDateCollapse(lines).collapsed).toBe(false);
  });

  it('resumen chico con todo el mismo día → no marca (falso positivo plausible)', () => {
    const lines = [line('2026-07-02', 'A'), line('2026-07-02', 'B'), line('2026-07-02', 'C')];
    expect(detectDateCollapse(lines).collapsed).toBe(false);
  });

  it('lista vacía → no marca', () => {
    expect(detectDateCollapse([]).collapsed).toBe(false);
  });

  it('el umbral es configurable', () => {
    const lines = [line('2026-07-02', 'A'), line('2026-07-02', 'B'), line('2026-07-02', 'C')];
    expect(detectDateCollapse(lines, 3).collapsed).toBe(true);
  });

  it('el mensaje nombra la fecha y el conteo, sin montos', () => {
    const res = detectDateCollapse(
      Array.from({ length: 7 }, (_, i) => line('2026-07-02', `COMERCIO ${i}`)),
    );
    expect(res.collapsed).toBe(true);
    if (!res.collapsed) return;
    const msg = dateCollapseMessage(res);
    expect(msg).toContain('2026-07-02');
    expect(msg).toContain('7');
    expect(msg.toLowerCase()).toContain('no confirmes');
  });
});
