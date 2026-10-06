import Decimal from 'decimal.js';
import { daysInMonth, monthOf } from './months';

export type SpendCapLevel = 'ok' | 'warn' | 'over';

export type SpendCapStatus = {
  /** Gastado / techo, en %. */
  pct: number;
  /** Gastado / techo prorrateado a la fecha, en %. >100 = vas más rápido que el techo. */
  pacePct: number;
  /** Lo que "corresponde" haber gastado a hoy si se respetara el techo parejo. */
  expectedToDate: Decimal;
  level: SpendCapLevel;
};

/**
 * Semáforo del techo mensual: verde hasta 80%, amarillo 80–100%, rojo arriba de
 * 100%. El ritmo (`pacePct`) es informativo: un 50% gastado el día 5 es más
 * preocupante que un 50% el día 25.
 */
export function spendCapStatus(args: {
  spent: Decimal;
  cap: Decimal;
  today: string;
}): SpendCapStatus {
  const { spent, cap, today } = args;
  if (cap.lte(0)) {
    return { pct: 0, pacePct: 0, expectedToDate: new Decimal(0), level: 'ok' };
  }
  const day = Number(today.slice(8, 10));
  const expectedToDate = cap.mul(day).div(daysInMonth(monthOf(today)));
  const pct = spent.div(cap).mul(100).toNumber();
  const pacePct = expectedToDate.isZero() ? 0 : spent.div(expectedToDate).mul(100).toNumber();
  const level: SpendCapLevel = pct > 100 ? 'over' : pct >= 80 ? 'warn' : 'ok';
  return { pct, pacePct, expectedToDate, level };
}
