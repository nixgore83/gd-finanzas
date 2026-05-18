'use client';

import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import Decimal from 'decimal.js';
import type { CategoryNode } from '@/lib/categories/tree';
import { setBudget } from '@/app/actions/budgets/set';
import { clearBudget } from '@/app/actions/budgets/clear';
import { cn } from '@/lib/utils';

type Props = {
  year: number;
  currentYearMonth: { year: number; month: number };
  categories: CategoryNode[];
  initialBudgets: { categoryId: string; month: number; amountUsd: string }[];
};

const MONTH_LABELS = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];

function keyOf(catId: string, month: number): string {
  return `${catId}-${month}`;
}

function formatUsd(amount: string | number): string {
  const n = typeof amount === 'string' ? Number.parseFloat(amount) : amount;
  if (!Number.isFinite(n) || n === 0) return '';
  return new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(n);
}

export function BudgetGrid({ year, currentYearMonth, categories, initialBudgets }: Props) {
  const router = useRouter();
  const [, startTransition] = useTransition();

  // Map id_mes → string value. Normalizamos a entero al cargar y al guardar:
  // los budgets son cifras gruesas (USD redondeados); los .00 que vienen del
  // numeric(18,2) en DB son ruido visual.
  const [values, setValues] = useState<Map<string, string>>(() => {
    const m = new Map<string, string>();
    for (const b of initialBudgets) {
      const n = Math.round(Number(b.amountUsd));
      if (Number.isFinite(n)) m.set(keyOf(b.categoryId, b.month), String(n));
    }
    return m;
  });

  // Leaves set para no editar parents
  const childrenByParent = useMemo(() => {
    const m = new Map<string, CategoryNode[]>();
    for (const c of categories) {
      if (c.parentId === null) continue;
      const arr = m.get(c.parentId) ?? [];
      arr.push(c);
      m.set(c.parentId, arr);
    }
    return m;
  }, [categories]);

  function isLeaf(catId: string): boolean {
    return !childrenByParent.has(catId);
  }

  function isPastMonth(month: number): boolean {
    if (year < currentYearMonth.year) return true;
    if (year > currentYearMonth.year) return false;
    return month < currentYearMonth.month;
  }

  function sumOf(catId: string, month: number): Decimal {
    if (isLeaf(catId)) {
      const v = values.get(keyOf(catId, month));
      return v && v !== '' ? new Decimal(v) : new Decimal(0);
    }
    let total = new Decimal(0);
    for (const child of childrenByParent.get(catId) ?? []) {
      total = total.plus(sumOf(child.id, month));
    }
    return total;
  }

  function rowYearTotal(catId: string): Decimal {
    let total = new Decimal(0);
    for (let m = 1; m <= 12; m++) total = total.plus(sumOf(catId, m));
    return total;
  }

  function monthTotalByKind(month: number, kind: 'income' | 'expense'): Decimal {
    let total = new Decimal(0);
    for (const c of categories) {
      if (c.kind !== kind) continue;
      if (c.parentId !== null) continue; // sumar solo desde top-level (recursión a children adentro)
      total = total.plus(sumOf(c.id, month));
    }
    return total;
  }

  function handleCellSave(catId: string, month: number, rawValue: string) {
    const trimmed = rawValue.trim();
    const previousValue = values.get(keyOf(catId, month)) ?? '';

    // Normalizamos a entero antes de optimistic update y de mandar al server.
    let normalized = '';
    if (trimmed !== '') {
      const n = Number(trimmed);
      if (!Number.isFinite(n)) {
        toast.error('Valor inválido');
        return;
      }
      normalized = String(Math.round(n));
    }

    // Optimistic update
    const newMap = new Map(values);
    if (normalized === '') {
      newMap.delete(keyOf(catId, month));
    } else {
      newMap.set(keyOf(catId, month), normalized);
    }
    setValues(newMap);

    startTransition(async () => {
      const fd = new FormData();
      fd.set('year', String(year));
      fd.set('month', String(month));
      fd.set('categoryId', catId);

      if (normalized === '') {
        const result = await clearBudget(fd);
        if (!result.ok) {
          toast.error('No pudimos borrar');
          revert();
        } else {
          router.refresh();
        }
      } else {
        fd.set('amountUsd', normalized);
        const result = await setBudget(fd);
        if (!result.ok) {
          toast.error(
            result.error === 'invalid_refs'
              ? 'Categoría inválida'
              : 'No pudimos guardar',
          );
          revert();
        } else {
          router.refresh();
        }
      }
    });

    function revert() {
      setValues((prev) => {
        const m = new Map(prev);
        if (previousValue === '') m.delete(keyOf(catId, month));
        else m.set(keyOf(catId, month), previousValue);
        return m;
      });
    }
  }

  return (
    <div className="overflow-x-auto rounded-md border">
      <table className="w-full text-sm">
        <thead className="bg-muted/40">
          <tr className="text-left">
            <th className="sticky left-0 z-10 bg-muted/40 px-3 py-2 font-medium">Categoría</th>
            {MONTH_LABELS.map((m, i) => {
              const monthNum = i + 1;
              const isCurrent =
                year === currentYearMonth.year && monthNum === currentYearMonth.month;
              return (
                <th
                  key={m}
                  className={cn(
                    'px-2 py-2 text-right font-medium',
                    isCurrent && 'bg-sky-50 text-sky-900',
                  )}
                >
                  {m}
                </th>
              );
            })}
            <th className="px-3 py-2 text-right font-medium">Total</th>
          </tr>
        </thead>
        <tbody>
          {categories.map((c) => {
            const leaf = isLeaf(c.id);
            return (
              <tr key={c.id} className={cn('border-t', !leaf && 'bg-muted/10 font-medium')}>
                <td
                  className={cn(
                    'sticky left-0 z-10 bg-background px-3 py-1.5 whitespace-nowrap',
                    !leaf && 'bg-muted/10',
                    c.depth === 1 && 'pl-8 text-muted-foreground',
                  )}
                >
                  {c.depth === 1 ? '↳ ' : ''}
                  {c.name}
                </td>
                {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => {
                  const cellKey = keyOf(c.id, m);
                  const value = values.get(cellKey) ?? '';
                  const past = isPastMonth(m);
                  const subtotal = leaf ? null : sumOf(c.id, m);
                  return (
                    <td
                      key={m}
                      className={cn(
                        'px-1 py-1 text-right tabular-nums',
                        past && 'bg-muted/20',
                      )}
                    >
                      {leaf ? (
                        <input
                          type="number"
                          step="1"
                          inputMode="numeric"
                          defaultValue={value}
                          disabled={past}
                          onBlur={(e) => {
                            if (e.currentTarget.value !== value) {
                              handleCellSave(c.id, m, e.currentTarget.value);
                            }
                          }}
                          className={cn(
                            'w-16 rounded border-transparent bg-transparent px-1 py-0.5 text-right text-sm focus:border focus:border-input focus:bg-background focus:outline-none focus:ring-1 focus:ring-ring',
                            past && 'cursor-not-allowed opacity-50',
                          )}
                          aria-label={`${c.name} ${MONTH_LABELS[m - 1]} ${year}`}
                        />
                      ) : (
                        <span className="text-muted-foreground">
                          {subtotal && !subtotal.isZero() ? formatUsd(subtotal.toNumber()) : '—'}
                        </span>
                      )}
                    </td>
                  );
                })}
                <td className="px-3 py-1.5 text-right tabular-nums font-medium">
                  {formatUsd(rowYearTotal(c.id).toNumber()) || '—'}
                </td>
              </tr>
            );
          })}
        </tbody>
        <tfoot className="bg-muted/30 text-sm">
          <tr className="border-t">
            <td className="sticky left-0 z-10 bg-muted/30 px-3 py-2 font-medium">
              Subtotal Ingresos
            </td>
            {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
              <td key={m} className="px-1 py-2 text-right tabular-nums">
                {formatUsd(monthTotalByKind(m, 'income').toNumber()) || '—'}
              </td>
            ))}
            <td className="px-3 py-2 text-right tabular-nums font-medium">
              {formatUsd(
                Array.from({ length: 12 }, (_, i) => monthTotalByKind(i + 1, 'income'))
                  .reduce((a, b) => a.plus(b), new Decimal(0))
                  .toNumber(),
              ) || '—'}
            </td>
          </tr>
          <tr className="border-t">
            <td className="sticky left-0 z-10 bg-muted/30 px-3 py-2 font-medium">
              Subtotal Gastos
            </td>
            {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
              <td key={m} className="px-1 py-2 text-right tabular-nums">
                {formatUsd(monthTotalByKind(m, 'expense').toNumber()) || '—'}
              </td>
            ))}
            <td className="px-3 py-2 text-right tabular-nums font-medium">
              {formatUsd(
                Array.from({ length: 12 }, (_, i) => monthTotalByKind(i + 1, 'expense'))
                  .reduce((a, b) => a.plus(b), new Decimal(0))
                  .toNumber(),
              ) || '—'}
            </td>
          </tr>
          <tr className="border-t bg-muted/50">
            <td className="sticky left-0 z-10 bg-muted/50 px-3 py-2 font-semibold">Neto</td>
            {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => {
              const net = monthTotalByKind(m, 'income').minus(monthTotalByKind(m, 'expense'));
              return (
                <td key={m} className="px-1 py-2 text-right tabular-nums font-medium">
                  {net.isZero() ? '—' : formatUsd(net.toNumber())}
                </td>
              );
            })}
            <td className="px-3 py-2 text-right tabular-nums font-semibold">
              {(() => {
                const total = Array.from({ length: 12 }, (_, i) => i + 1)
                  .map((m) => monthTotalByKind(m, 'income').minus(monthTotalByKind(m, 'expense')))
                  .reduce((a, b) => a.plus(b), new Decimal(0));
                return total.isZero() ? '—' : formatUsd(total.toNumber());
              })()}
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
