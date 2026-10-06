import Decimal from 'decimal.js';
import { addMonths, monthOf, type MonthKey } from './months';

/**
 * Marca de cuota en la descripción de un consumo de TC: "C.03/06", "03/06",
 * "5 de 6". Los dígitos no pueden venir pegados a otros: "ALLIANZ 0210/18" es
 * un número de póliza que se cobra todos los meses, no una cuota.
 * Único lugar donde se define: lo usan el runway y la revisión asistida de
 * imports (`lib/imports/bulk-review.ts`).
 */
export const CUOTA_RE = /(?<!\d)(\d{1,2})\s*(?:\/|de)\s*(\d{1,2})(?!\d)/;

/** Más de esto no es un plan de cuotas real; probablemente es una fecha o un código. */
const MAX_CUOTAS = 36;

export function parseCuota(description: string): { n: number; total: number } | null {
  const m = CUOTA_RE.exec(description);
  if (!m) return null;
  const n = Number(m[1]);
  const total = Number(m[2]);
  if (n < 1 || total < 2 || total > MAX_CUOTAS || n > total) return null;
  return { n, total };
}

export type CuotaLine = {
  description: string;
  /** Monto de UNA cuota, en ARS, positivo. */
  amountArs: string;
  /** Fecha de cierre del resumen donde aparece la línea (`imports.period_end`). */
  closeDate: string;
};

/**
 * Proyecta lo que queda por pagar de las cuotas que aparecen en el último
 * resumen de cada tarjeta, por MES DE PAGO.
 *
 * Una línea "C.03/06" en el resumen que cierra en el mes M es la cuota 3, que se
 * paga en M+1; las cuotas 4, 5 y 6 se pagan en M+2, M+3 y M+4. Sólo devuelve
 * meses >= `fromMonth`: lo ya pagado no es salida futura.
 */
export function projectRemainingCuotas(
  lines: readonly CuotaLine[],
  fromMonth: MonthKey,
): Map<MonthKey, Decimal> {
  const out = new Map<MonthKey, Decimal>();
  for (const line of lines) {
    const c = parseCuota(line.description);
    if (!c) continue;
    const amount = new Decimal(line.amountArs).abs();
    const firstPayMonth = addMonths(monthOf(line.closeDate), 1);
    for (let k = 0; k <= c.total - c.n; k++) {
      const month = addMonths(firstPayMonth, k);
      if (month < fromMonth) continue;
      out.set(month, (out.get(month) ?? new Decimal(0)).plus(amount));
    }
  }
  return out;
}
