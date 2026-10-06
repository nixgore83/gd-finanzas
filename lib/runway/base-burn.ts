import Decimal from 'decimal.js';
import { addMonths, type MonthKey } from './months';

/**
 * Gasto base mensual: promedio de los últimos `count` meses CERRADOS (los
 * anteriores a `currentMonth`). Un mes sin ningún movimiento no es "gasté 0":
 * es un mes sin datos cargados, y se descarta en vez de bajar el promedio.
 */
export function averageClosedMonths(
  totalsByMonth: ReadonlyMap<MonthKey, Decimal>,
  currentMonth: MonthKey,
  count = 3,
): { average: Decimal; months: MonthKey[] } {
  const months: MonthKey[] = [];
  let sum = new Decimal(0);
  for (let i = count; i >= 1; i--) {
    const m = addMonths(currentMonth, -i);
    const t = totalsByMonth.get(m);
    if (!t || t.isZero()) continue;
    months.push(m);
    sum = sum.plus(t);
  }
  return {
    average: months.length === 0 ? new Decimal(0) : sum.div(months.length),
    months,
  };
}
