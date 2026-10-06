import Decimal from 'decimal.js';
import { computeForecastDates, type Frequency } from '@/lib/recurrences/forecasts';
import { addMonths, monthOf, type MonthKey } from './months';
import type { MonthAmount } from './project';

export type RecurrenceForRunway = {
  name: string;
  kind: 'income' | 'expense';
  amount: string;
  currency: 'ARS' | 'USD';
  frequency: Frequency | 'custom';
  dayOfMonth: number;
  startDate: string;
  endDate: string | null;
  categoryId: string | null;
};

const STEP: Record<Frequency, number> = { monthly: 1, bimonthly: 2, quarterly: 3, yearly: 12 };

/**
 * Una recurrencia de gasto "no mensual" (anual o puntual) NO está en el gasto
 * base: se modela como evento. Sus categorías se sacan del promedio del gasto
 * base para no contarla dos veces (ej. Vacaciones, Vivienda › Alquiler anual).
 */
export function isNonMonthlyExpense(r: RecurrenceForRunway): boolean {
  if (r.kind !== 'expense') return false;
  return r.frequency === 'yearly' || (r.endDate !== null && r.endDate === r.startDate);
}

/**
 * Traduce las recurrencias activas a flujos del runway:
 * - ingresos → `incomes` (todas sus ocurrencias en el horizonte);
 * - gasto anual / puntual → `events`;
 * - gasto mensual (o bi/trimestral) que ya existía en la ventana del gasto base:
 *   ya está adentro del promedio; si termina dentro del horizonte, libera su
 *   equivalente mensual desde el mes siguiente (`burnReleases`);
 * - gasto mensual NUEVO (arranca después de la ventana del promedio): no está en
 *   el promedio → sus ocurrencias van a `events`.
 *
 * Los montos en USD se pasan a ARS con `fxRate` (tipo de cambio de hoy).
 */
export function recurrenceFlows(
  recs: readonly RecurrenceForRunway[],
  opts: { startMonth: MonthKey; months: number; baseWindowEnd: string; fxRate: Decimal },
): {
  incomes: MonthAmount[];
  events: MonthAmount[];
  burnReleases: { fromMonth: MonthKey; amount: Decimal; label: string }[];
} {
  const incomes: MonthAmount[] = [];
  const events: MonthAmount[] = [];
  const burnReleases: { fromMonth: MonthKey; amount: Decimal; label: string }[] = [];
  const horizonFrom = `${opts.startMonth}-01`;
  const horizonEndMonth = addMonths(opts.startMonth, opts.months);

  for (const r of recs) {
    if (r.frequency === 'custom') continue; // no se expone en la UI; sin regla de fechas
    const amountArs =
      r.currency === 'USD' ? new Decimal(r.amount).mul(opts.fxRate) : new Decimal(r.amount);
    const dates = computeForecastDates({
      frequency: r.frequency,
      dayOfMonth: r.dayOfMonth,
      startDate: r.startDate,
      endDate: r.endDate,
      horizonFrom,
      horizonMonths: opts.months,
    });
    const occurrences = dates.map((d) => ({ month: monthOf(d), amount: amountArs, label: r.name }));

    if (r.kind === 'income') {
      incomes.push(...occurrences);
      continue;
    }
    if (isNonMonthlyExpense(r) || r.startDate > opts.baseWindowEnd) {
      events.push(...occurrences);
      continue;
    }
    if (r.endDate !== null) {
      const fromMonth = addMonths(monthOf(r.endDate), 1);
      if (fromMonth >= opts.startMonth && fromMonth < horizonEndMonth) {
        burnReleases.push({ fromMonth, amount: amountArs.div(STEP[r.frequency]), label: r.name });
      }
    }
  }
  return { incomes, events, burnReleases };
}
