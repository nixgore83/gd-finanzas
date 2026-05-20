import { toCsv } from './csv';
import { domesticServiceMetaSchema } from '@/lib/schemas/transaction';
import type { ExportTx } from './types';

/**
 * CSV 03: pagos de servicio doméstico. Una fila por transacción con
 * `transaction_subtype='domestic_service'`, expandiendo los campos del jsonb
 * `meta`. Si meta no parsea, la línea se saltea (silenciosamente).
 */
export function buildServicioDomesticoCsv(txns: readonly ExportTx[]): string {
  const rows = txns
    .filter((t) => t.transactionSubtype === 'domestic_service')
    .map((t) => {
      const metaParsed = domesticServiceMetaSchema.safeParse(t.meta);
      if (!metaParsed.success) return null;
      return {
        empleado_nombre: metaParsed.data.empleado_nombre,
        empleado_cuil: metaParsed.data.empleado_cuil,
        concepto: metaParsed.data.concepto,
        periodo: metaParsed.data.periodo,
        fecha_pago: t.date,
        monto_original: t.amountOriginal,
        moneda: t.currencyOriginal,
        monto_usd: t.amountUsd,
        monto_ars: t.amountArs,
        descripcion: t.description,
      };
    })
    .filter((r): r is NonNullable<typeof r> => r !== null)
    .sort(
      (a, b) =>
        a.empleado_nombre.localeCompare(b.empleado_nombre) ||
        a.periodo.localeCompare(b.periodo),
    );

  return toCsv(rows, [
    { key: 'empleado_nombre', label: 'empleado_nombre' },
    { key: 'empleado_cuil', label: 'empleado_cuil' },
    { key: 'concepto', label: 'concepto' },
    { key: 'periodo', label: 'periodo' },
    { key: 'fecha_pago', label: 'fecha_pago' },
    { key: 'monto_original', label: 'monto_original' },
    { key: 'moneda', label: 'moneda' },
    { key: 'monto_usd', label: 'monto_usd' },
    { key: 'monto_ars', label: 'monto_ars' },
    { key: 'descripcion', label: 'descripcion' },
  ]);
}
