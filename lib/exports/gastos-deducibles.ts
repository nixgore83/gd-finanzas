import { toCsv } from './csv';
import { monthOf, type ExportAccount, type ExportCategory, type ExportTx } from './types';

/**
 * CSV 04: gastos marcados con `deducible_ganancias=true`. Una fila por tx.
 */
export function buildGastosDeduciblesCsv(
  txns: readonly ExportTx[],
  accountsById: Map<string, ExportAccount>,
  categoriesById: Map<string, ExportCategory>,
): string {
  const rows = txns
    .filter((t) => t.deducibleGanancias && t.kind === 'expense')
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((t) => ({
      fecha: t.date,
      mes: monthOf(t.date),
      cuenta: accountsById.get(t.accountId)?.name ?? '',
      categoria: t.categoryId ? categoriesById.get(t.categoryId)?.name ?? '' : '',
      descripcion: t.description,
      monto_original: t.amountOriginal,
      moneda: t.currencyOriginal,
      monto_usd: t.amountUsd,
      monto_ars: t.amountArs,
      notas: t.notes ?? '',
    }));

  return toCsv(rows, [
    { key: 'fecha', label: 'fecha' },
    { key: 'mes', label: 'mes' },
    { key: 'cuenta', label: 'cuenta' },
    { key: 'categoria', label: 'categoria' },
    { key: 'descripcion', label: 'descripcion' },
    { key: 'monto_original', label: 'monto_original' },
    { key: 'moneda', label: 'moneda' },
    { key: 'monto_usd', label: 'monto_usd' },
    { key: 'monto_ars', label: 'monto_ars' },
    { key: 'notas', label: 'notas' },
  ]);
}
