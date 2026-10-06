/** Helpers de meses `YYYY-MM` sin Date/timezone (mismo criterio que lib/recurrences/forecasts.ts). */

export type MonthKey = string; // 'YYYY-MM'

export function monthOf(iso: string): MonthKey {
  return iso.slice(0, 7);
}

export function addMonths(month: MonthKey, delta: number): MonthKey {
  const y = Number(month.slice(0, 4));
  const m = Number(month.slice(5, 7));
  const zero = y * 12 + (m - 1) + delta;
  const ny = Math.floor(zero / 12);
  const nm = (zero % 12) + 1;
  return `${ny}-${nm < 10 ? `0${nm}` : nm}`;
}

/** `count` meses consecutivos desde `from` (inclusive). */
export function monthRange(from: MonthKey, count: number): MonthKey[] {
  return Array.from({ length: count }, (_, i) => addMonths(from, i));
}

export function daysInMonth(month: MonthKey): number {
  const y = Number(month.slice(0, 4));
  const m = Number(month.slice(5, 7));
  if ([1, 3, 5, 7, 8, 10, 12].includes(m)) return 31;
  if ([4, 6, 9, 11].includes(m)) return 30;
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0 ? 29 : 28;
}
