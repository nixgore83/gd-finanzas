/**
 * Lógica pura de generación de fechas de forecast para una recurrencia.
 * Sin DB, sin Date timezone tricks — trabaja con strings `YYYY-MM-DD`.
 *
 * Cubre PRD §5.3: forecasts rolling 12 meses desde `horizonFrom` (por defecto
 * hoy). Las fechas se anclan a `dayOfMonth`, recortando al último día válido
 * del mes (ej. day 31 en feb → 28/29).
 */

export const FORECAST_HORIZON_MONTHS = 12;

export type Frequency = 'monthly' | 'bimonthly' | 'quarterly' | 'yearly';

const FREQUENCY_STEP_MONTHS: Record<Frequency, number> = {
  monthly: 1,
  bimonthly: 2,
  quarterly: 3,
  yearly: 12,
};

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

function lastDayOfMonth(year: number, month1: number): number {
  // month1 = 1..12
  if ([1, 3, 5, 7, 8, 10, 12].includes(month1)) return 31;
  if ([4, 6, 9, 11].includes(month1)) return 30;
  return isLeapYear(year) ? 29 : 28;
}

function parseIso(d: string): { year: number; month: number; day: number } {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d);
  if (!m || !m[1] || !m[2] || !m[3]) throw new Error(`Invalid ISO date: ${d}`);
  return { year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) };
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

function toIso(year: number, month1: number, day: number): string {
  return `${year}-${pad2(month1)}-${pad2(day)}`;
}

function addMonths(year: number, month1: number, delta: number): { year: number; month1: number } {
  // month1 is 1-based
  const zero = (year * 12 + (month1 - 1)) + delta;
  return { year: Math.floor(zero / 12), month1: (zero % 12) + 1 };
}

function clampedDate(year: number, month1: number, dayOfMonth: number): string {
  const clamped = Math.min(dayOfMonth, lastDayOfMonth(year, month1));
  return toIso(year, month1, clamped);
}

export function computeForecastDates(args: {
  frequency: Frequency;
  dayOfMonth: number; // 1..31
  startDate: string; // 'YYYY-MM-DD'
  endDate: string | null;
  horizonFrom: string; // 'YYYY-MM-DD', anchor del rolling 12m
  horizonMonths?: number;
}): string[] {
  const step = FREQUENCY_STEP_MONTHS[args.frequency];
  const horizonMonths = args.horizonMonths ?? FORECAST_HORIZON_MONTHS;
  const start = parseIso(args.startDate);
  const horizon = parseIso(args.horizonFrom);

  // Compute horizonEnd = horizonFrom + horizonMonths (exclusive upper bound by date string compare).
  const endAnchor = addMonths(horizon.year, horizon.month, horizonMonths);
  const horizonEnd = clampedDate(endAnchor.year, endAnchor.month1, horizon.day);

  // First occurrence: anchored on startDate's year/month, advancing by step until >= startDate.
  // We anchor month by startDate.month and tick forward.
  let cur = { year: start.year, month1: start.month };
  let curDate = clampedDate(cur.year, cur.month1, args.dayOfMonth);

  // If curDate < startDate, advance month by `step` until >= startDate.
  while (curDate < args.startDate) {
    cur = addMonths(cur.year, cur.month1, step);
    curDate = clampedDate(cur.year, cur.month1, args.dayOfMonth);
  }

  // Now skip occurrences that are before horizonFrom (we only emit dates in the
  // rolling window [horizonFrom, horizonEnd)).
  while (curDate < args.horizonFrom) {
    cur = addMonths(cur.year, cur.month1, step);
    curDate = clampedDate(cur.year, cur.month1, args.dayOfMonth);
  }

  const result: string[] = [];
  while (curDate < horizonEnd) {
    if (args.endDate !== null && curDate > args.endDate) break;
    result.push(curDate);
    cur = addMonths(cur.year, cur.month1, step);
    curDate = clampedDate(cur.year, cur.month1, args.dayOfMonth);
  }
  return result;
}
