import Decimal from 'decimal.js';
import { monthRange, type MonthKey } from './months';

/**
 * Proyección de runway, mes a mes. Lógica pura: todo llega ya en ARS.
 *
 *   saldo[m] = saldo[m-1] + ingresos[m] − gastoBase[m] − cuotas[m] − eventos[m]
 *
 * - `baseBurn`: gasto mensual de la casa (promedio real, o el techo en el
 *   escenario "con tope"). Ya incluye los gastos mensuales recurrentes que
 *   existen hoy (colegio, expensas, auto…).
 * - `burnReleases`: gastos mensuales que terminan (el auto en dic-26). Desde
 *   `fromMonth` se descuentan del gasto base, porque ya no se pagan.
 * - `events`: salidas que NO están en el gasto base (alquiler anual,
 *   vacaciones, compromisos mensuales nuevos), positivas.
 * - `incomes`: entradas (sueldos, alquiler cobrado, aguinaldo), positivas.
 *
 * Supuestos explícitos: montos nominales (sin inflación); el mes del snapshot
 * se proyecta completo.
 */

export type MonthAmount = { month: MonthKey; amount: Decimal; label?: string };

export type RunwayInput = {
  startMonth: MonthKey;
  months: number;
  startBalance: Decimal;
  incomes: readonly MonthAmount[];
  baseBurn: Decimal;
  burnReleases: readonly { fromMonth: MonthKey; amount: Decimal }[];
  cuotas: ReadonlyMap<MonthKey, Decimal>;
  events: readonly MonthAmount[];
  /** Saldo mínimo que no se quiere perforar (ej. buffer de metas). Default 0. */
  floor?: Decimal;
};

export type RunwayRow = {
  month: MonthKey;
  income: Decimal;
  base: Decimal;
  cuotas: Decimal;
  events: Decimal;
  eventLabels: string[];
  gap: Decimal;
  balance: Decimal;
};

export type RunwayResult = {
  rows: RunwayRow[];
  /** Primer mes cuyo saldo de cierre queda por debajo del piso. Null = no pasa en el horizonte. */
  runOutMonth: MonthKey | null;
};

function sumFor(
  list: readonly MonthAmount[],
  month: MonthKey,
): { total: Decimal; labels: string[] } {
  let total = new Decimal(0);
  const labels: string[] = [];
  for (const it of list) {
    if (it.month !== month) continue;
    total = total.plus(it.amount);
    if (it.label) labels.push(it.label);
  }
  return { total, labels };
}

export function buildRunwayProjection(input: RunwayInput): RunwayResult {
  const floor = input.floor ?? new Decimal(0);
  const rows: RunwayRow[] = [];
  let balance = input.startBalance;
  let runOutMonth: MonthKey | null = null;

  for (const month of monthRange(input.startMonth, input.months)) {
    const income = sumFor(input.incomes, month).total;
    const released = input.burnReleases
      .filter((r) => r.fromMonth <= month)
      .reduce((acc, r) => acc.plus(r.amount), new Decimal(0));
    const base = Decimal.max(input.baseBurn.minus(released), 0);
    const cuotas = input.cuotas.get(month) ?? new Decimal(0);
    const ev = sumFor(input.events, month);

    const gap = income.minus(base).minus(cuotas).minus(ev.total);
    balance = balance.plus(gap);
    if (runOutMonth === null && balance.lessThan(floor)) runOutMonth = month;

    rows.push({
      month,
      income,
      base,
      cuotas,
      events: ev.total,
      eventLabels: ev.labels,
      gap,
      balance,
    });
  }

  return { rows, runOutMonth };
}
