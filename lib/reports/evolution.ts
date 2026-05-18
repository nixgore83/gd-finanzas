import Decimal from 'decimal.js';

/**
 * Lógica pura del reporte C — evolución 12 meses. Sin DB.
 *
 * El caller pasa los buckets ya agregados por (year, month) con income y
 * expense en la moneda elegida; la función arma la serie lista para
 * recharts y calcula el net.
 */

export type EvolutionCurrency = 'USD' | 'ARS';

export type EvolutionBucket = {
  year: number;
  month: number; // 1-12
  income: string;
  expense: string;
};

export type EvolutionSeriesPoint = {
  year: number;
  month: number;
  label: string;
  income: number;
  expense: number;
  net: number;
};

const MONTH_SHORT = [
  'Ene',
  'Feb',
  'Mar',
  'Abr',
  'May',
  'Jun',
  'Jul',
  'Ago',
  'Sep',
  'Oct',
  'Nov',
  'Dic',
];

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

export function buildEvolutionSeries(
  buckets: readonly EvolutionBucket[],
): EvolutionSeriesPoint[] {
  // Orden ascendente por (year, month)
  const sorted = [...buckets].sort((a, b) =>
    a.year !== b.year ? a.year - b.year : a.month - b.month,
  );
  return sorted.map((b) => {
    const income = new Decimal(b.income).toNumber();
    const expense = new Decimal(b.expense).toNumber();
    const net = new Decimal(b.income).minus(b.expense).toNumber();
    const monthIdx = Math.min(Math.max(b.month - 1, 0), 11);
    const label = `${MONTH_SHORT[monthIdx] ?? pad2(b.month)} ${String(b.year).slice(-2)}`;
    return {
      year: b.year,
      month: b.month,
      label,
      income,
      expense,
      net,
    };
  });
}

/**
 * Genera el array de 12 meses { year, month } terminando en (endYear, endMonth).
 * Útil para llenar gaps en buckets que vengan de DB sin datos en algún mes.
 */
export function rollingMonths(
  endYear: number,
  endMonth: number,
  count = 12,
): { year: number; month: number }[] {
  const result: { year: number; month: number }[] = [];
  let y = endYear;
  let m = endMonth;
  for (let i = 0; i < count; i++) {
    result.unshift({ year: y, month: m });
    m -= 1;
    if (m === 0) {
      m = 12;
      y -= 1;
    }
  }
  return result;
}
