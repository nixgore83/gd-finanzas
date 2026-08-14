import { describe, it, expect } from 'vitest';
import {
  buildConfirmErrorMessage,
  countByReason,
  hasFxError,
  type LineError,
} from './confirm-error-summary';

/** Filas sintéticas (nunca datos reales). */
function errs(spec: Record<string, number>): LineError[] {
  const out: LineError[] = [];
  let n = 0;
  for (const [reason, count] of Object.entries(spec)) {
    for (let i = 0; i < count; i++) out.push({ lineId: `line-${n++}`, reason });
  }
  return out;
}

describe('countByReason', () => {
  it('agrupa y ordena de mayor a menor', () => {
    expect(countByReason(errs({ a: 2, b: 5, c: 1 }))).toEqual([
      { reason: 'b', count: 5 },
      { reason: 'a', count: 2 },
      { reason: 'c', count: 1 },
    ]);
  });

  it('empata alfabético para que el mensaje sea estable entre corridas', () => {
    // Sin desempate determinístico, el texto persistido cambiaría solo y
    // ensuciaría el historial del import.
    const a = countByReason(errs({ zeta: 3, alfa: 3 }));
    const b = countByReason(errs({ alfa: 3, zeta: 3 }));
    expect(a).toEqual(b);
    expect(a[0]?.reason).toBe('alfa');
  });

  it('lista vacía → sin motivos', () => {
    expect(countByReason([])).toEqual([]);
  });
});

describe('buildConfirmErrorMessage', () => {
  it('REGRESIÓN: el caso real que mandó a buscar el problema en el lugar equivocado', () => {
    // 2026-08-14, caja de ahorro de Pau: el cartel decía sólo "51 confirmadas,
    // 130 pendientes con error" y sugería revisar el FX. El FX estaba perfecto:
    // fallaban por transferencias sin contracuenta.
    const msg = buildConfirmErrorMessage(51, errs({ 'transfer sin cuenta contraparte': 130 }));
    expect(msg).toBe(
      '51 confirmadas, 130 pendientes con error — 130 transfer sin cuenta contraparte',
    );
  });

  it('desglosa varios motivos, del más frecuente al menos', () => {
    const msg = buildConfirmErrorMessage(
      51,
      errs({ 'sin categoría asignada': 12, 'transfer sin cuenta contraparte': 118 }),
    );
    expect(msg).toBe(
      '51 confirmadas, 130 pendientes con error — 118 transfer sin cuenta contraparte, 12 sin categoría asignada',
    );
  });

  it('agrupa la cola en "otros" para que el cartel siga siendo legible', () => {
    const msg = buildConfirmErrorMessage(
      0,
      errs({ uno: 10, dos: 8, tres: 6, cuatro: 3, cinco: 2 }),
    );
    expect(msg).toBe('29 líneas con error — 10 uno, 8 dos, 6 tres, 5 otros');
  });

  it('sin ninguna confirmada usa la otra redacción', () => {
    expect(buildConfirmErrorMessage(0, errs({ 'sin cotización FX': 4 }))).toBe(
      '4 líneas con error — 4 sin cotización FX',
    );
  });

  it('sin errores no agrega desglose', () => {
    expect(buildConfirmErrorMessage(51, [])).toBe('51 confirmadas, 0 pendientes con error');
  });
});

describe('hasFxError', () => {
  it('detecta el motivo de FX para decidir si la pista aplica', () => {
    expect(hasFxError(errs({ 'sin cotización FX': 1 }))).toBe(true);
  });

  it('NO sugiere FX cuando el problema es otro', () => {
    // El bug de UX original: sugerir "backfill de FX" en un import donde el FX
    // estaba bien mandaba a perder el tiempo.
    expect(hasFxError(errs({ 'transfer sin cuenta contraparte': 130 }))).toBe(false);
    expect(hasFxError([])).toBe(false);
  });
});
