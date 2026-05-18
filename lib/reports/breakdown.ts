import Decimal from 'decimal.js';
import { toMoneyString } from '@/lib/schemas/money';

/**
 * Lógica pura del rollup parent/leaf para el reporte B. Sin DB.
 *
 * El caller pasa los buckets agregados por categoría (id, parentId, name,
 * amount). Acá los devolvemos según `level`:
 *  - 'leaf': tal cual.
 *  - 'parent': los children se suman al parent (parentId no-null → bucket).
 *    Los buckets sin parent (top-level) se mantienen y suman lo que les
 *    corresponda.
 */

export type BreakdownLevel = 'parent' | 'leaf';

export type BreakdownInput = {
  id: string;
  parentId: string | null;
  name: string;
  parentName: string | null;
  color: string | null;
  parentColor: string | null;
  amount: string;
};

export type BreakdownRow = {
  id: string;       // category id (parent o leaf según level)
  name: string;
  color: string | null;
  amount: string;
  pct: number;      // 0-100
  isLeaf: boolean;  // true si proviene de un bucket que es categoría hoja
};

export function rollupBuckets(
  buckets: readonly BreakdownInput[],
  level: BreakdownLevel,
): { total: string; rows: BreakdownRow[] } {
  // Map id → { name, color, amount, isLeaf } pre-rollup
  const aggregated = new Map<
    string,
    { name: string; color: string | null; amount: Decimal; isLeaf: boolean }
  >();

  for (const b of buckets) {
    if (level === 'parent' && b.parentId !== null) {
      // Atribuir al parent
      const prev = aggregated.get(b.parentId);
      if (prev) {
        prev.amount = prev.amount.plus(b.amount);
      } else {
        aggregated.set(b.parentId, {
          name: b.parentName ?? '(sin nombre)',
          color: b.parentColor,
          amount: new Decimal(b.amount),
          isLeaf: false,
        });
      }
    } else {
      // Bucket queda tal cual (es leaf en su nivel o estamos en level='leaf')
      const prev = aggregated.get(b.id);
      if (prev) {
        prev.amount = prev.amount.plus(b.amount);
      } else {
        aggregated.set(b.id, {
          name: b.name,
          color: b.color,
          amount: new Decimal(b.amount),
          isLeaf: level === 'leaf' || b.parentId === null,
        });
      }
    }
  }

  let total = new Decimal(0);
  for (const v of aggregated.values()) total = total.plus(v.amount);

  const rows: BreakdownRow[] = [];
  for (const [id, v] of aggregated.entries()) {
    if (v.amount.isZero()) continue;
    rows.push({
      id,
      name: v.name,
      color: v.color,
      amount: toMoneyString(v.amount),
      pct: total.isZero() ? 0 : v.amount.div(total).times(100).toNumber(),
      isLeaf: v.isLeaf,
    });
  }
  rows.sort((a, b) => Number.parseFloat(b.amount) - Number.parseFloat(a.amount));

  return { total: toMoneyString(total), rows };
}
