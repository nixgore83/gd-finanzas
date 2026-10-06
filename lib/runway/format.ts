import type Decimal from 'decimal.js';

const MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

/** "2027-03" → "mar 27". */
export function monthLabel(month: string): string {
  const m = Number(month.slice(5, 7));
  return `${MONTHS[m - 1]} ${month.slice(2, 4)}`;
}

/** Millones de ARS con 1 decimal: 43.2. Para tablas densas de runway. */
export function millions(value: Decimal | number): string {
  const n = typeof value === 'number' ? value : value.toNumber();
  return new Intl.NumberFormat('es-AR', {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  }).format(n / 1_000_000);
}

export function ars(value: Decimal | number): string {
  const n = typeof value === 'number' ? value : value.toNumber();
  return new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency: 'ARS',
    maximumFractionDigits: 0,
  }).format(n);
}
