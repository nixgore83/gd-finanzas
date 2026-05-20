import { toCsv } from './csv';
import { monthOf, yearOf, type ExportAccount, type ExportCategory, type ExportTx } from './types';

/**
 * CSV 05: ingresos que NO son de sueldo. Heurística por nombre de categoría:
 * filtra income cuya categoría no contiene "sueldo" (case-insensitive).
 *
 * V1: simple. V1.2 (cuando se cierre taxonomía con Nico) se reemplaza por
 * flag explícito en `categories` o referencia por id.
 */
export function buildOtrosIngresosCsv(
  txns: readonly ExportTx[],
  accountsById: Map<string, ExportAccount>,
  categoriesById: Map<string, ExportCategory>,
): string {
  const rows = txns
    .filter((t) => {
      if (t.kind !== 'income') return false;
      if (!t.categoryId) return true; // sin categoría → contar como otros
      const cat = categoriesById.get(t.categoryId);
      if (!cat) return true;
      return !/sueldo/i.test(cat.name);
    })
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((t) => ({
      fecha: t.date,
      mes: monthOf(t.date),
      año: yearOf(t.date),
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
    { key: 'año', label: 'año' },
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
