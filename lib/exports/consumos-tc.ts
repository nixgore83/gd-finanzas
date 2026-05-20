import Decimal from 'decimal.js';
import { toCsv } from './csv';
import { monthOf, type ExportAccount, type ExportTx } from './types';

/**
 * CSV 02: consumos en tarjeta de crédito agregados por (account, moneda, mes).
 * Solo accounts type='credit_card'. kind='expense'.
 */
export function buildConsumosTcCsv(
  txns: readonly ExportTx[],
  accountsById: Map<string, ExportAccount>,
): string {
  type Bucket = {
    cuenta: string;
    mes: string;
    moneda: 'ARS' | 'USD';
    count: number;
    total_original: Decimal;
    total_usd: Decimal;
    total_ars: Decimal;
  };
  const map = new Map<string, Bucket>();

  for (const t of txns) {
    if (t.kind !== 'expense') continue;
    const acc = accountsById.get(t.accountId);
    if (!acc || acc.type !== 'credit_card') continue;

    const mes = monthOf(t.date);
    const key = `${acc.id}|${mes}|${t.currencyOriginal}`;
    const b: Bucket = map.get(key) ?? {
      cuenta: acc.name,
      mes,
      moneda: t.currencyOriginal,
      count: 0,
      total_original: new Decimal(0),
      total_usd: new Decimal(0),
      total_ars: new Decimal(0),
    };
    b.count += 1;
    b.total_original = b.total_original.plus(t.amountOriginal);
    b.total_usd = b.total_usd.plus(t.amountUsd);
    b.total_ars = b.total_ars.plus(t.amountArs);
    map.set(key, b);
  }

  const rows = [...map.values()]
    .sort((a, b) => a.mes.localeCompare(b.mes) || a.cuenta.localeCompare(b.cuenta))
    .map((b) => ({
      cuenta: b.cuenta,
      mes: b.mes,
      moneda: b.moneda,
      cantidad_consumos: b.count,
      total_original: b.total_original.toFixed(2),
      total_usd: b.total_usd.toFixed(2),
      total_ars: b.total_ars.toFixed(2),
    }));

  return toCsv(rows, [
    { key: 'cuenta', label: 'cuenta' },
    { key: 'mes', label: 'mes' },
    { key: 'moneda', label: 'moneda' },
    { key: 'cantidad_consumos', label: 'cantidad_consumos' },
    { key: 'total_original', label: 'total_original' },
    { key: 'total_usd', label: 'total_usd' },
    { key: 'total_ars', label: 'total_ars' },
  ]);
}
