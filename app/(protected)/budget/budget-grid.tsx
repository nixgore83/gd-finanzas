'use client';

import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import Decimal from 'decimal.js';
import type { CategoryNode } from '@/lib/categories/tree';
import { setBudget } from '@/app/actions/budgets/set';
import { clearBudget } from '@/app/actions/budgets/clear';
import { Num } from '@/components/ui/typography';
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

function formatCompact(amount: number): string {
  if (!Number.isFinite(amount) || amount === 0) return '';
  const abs = Math.abs(amount);
  if (abs >= 1_000_000) return `${(amount / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
  if (abs >= 10_000) return `${Math.round(amount / 1_000)}k`;
  if (abs >= 1_000) return `${(amount / 1_000).toFixed(1).replace(/\.0$/, '')}k`;
  return String(Math.round(amount));
}

export function BudgetGrid({ year, currentYearMonth, categories, initialBudgets }: Props) {
  const router = useRouter();
  const [, startTransition] = useTransition();

  // Map id_mes → string value (entero USD, no decimales).
  const [values, setValues] = useState<Map<string, string>>(() => {
    const m = new Map<string, string>();
    for (const b of initialBudgets) {
      const n = Math.round(Number(b.amountUsd));
      if (Number.isFinite(n)) m.set(keyOf(b.categoryId, b.month), String(n));
    }
    return m;
  });

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

  function isCurrentMonth(month: number): boolean {
    return year === currentYearMonth.year && month === currentYearMonth.month;
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
      if (c.parentId !== null) continue;
      total = total.plus(sumOf(c.id, month));
    }
    return total;
  }

  function handleCellSave(catId: string, month: number, rawValue: string) {
    const trimmed = rawValue.trim();
    const previousValue = values.get(keyOf(catId, month)) ?? '';

    let normalized = '';
    if (trimmed !== '') {
      const n = Number(trimmed);
      if (!Number.isFinite(n)) {
        toast.error('Valor inválido');
        return;
      }
      normalized = String(Math.round(n));
    }

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
            result.error === 'invalid_refs' ? 'Categoría inválida' : 'No pudimos guardar',
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

  // Year totals for footer
  const yearTotalsBy = (kind: 'income' | 'expense') =>
    Array.from({ length: 12 }, (_, i) => monthTotalByKind(i + 1, kind)).reduce(
      (a, b) => a.plus(b),
      new Decimal(0),
    );

  return (
    <div className="space-y-4">
      <div className="overflow-x-auto">
        <table className="w-full border-collapse">
          {/* ============ HEAD ============ */}
          <thead>
            <tr className="border-y border-border">
              <th
                scope="col"
                className="sticky left-0 z-10 bg-background px-4 py-3 text-left font-sans text-[10px] font-semibold uppercase tracking-[0.22em] text-muted-foreground"
              >
                Categoría
              </th>
              {MONTH_LABELS.map((m, i) => {
                const monthNum = i + 1;
                const current = isCurrentMonth(monthNum);
                return (
                  <th
                    key={m}
                    scope="col"
                    className={cn(
                      'px-2 py-3 text-right font-sans text-[10px] font-semibold uppercase tracking-[0.22em]',
                      current
                        ? 'bg-primary/[0.08] text-primary'
                        : 'text-muted-foreground',
                    )}
                  >
                    {m}
                  </th>
                );
              })}
              <th
                scope="col"
                className="px-4 py-3 text-right font-sans text-[10px] font-semibold uppercase tracking-[0.22em] text-muted-foreground"
              >
                Año
              </th>
            </tr>
          </thead>

          {/* ============ BODY ============ */}
          <tbody>
            {categories.map((c, idx) => {
              const leaf = isLeaf(c.id);
              const previous = idx === 0 ? null : categories[idx - 1];
              const prevWasParent = !previous || previous.parentId === null;
              const isParent = !leaf;
              return (
                <tr
                  key={c.id}
                  className={cn(
                    'transition-colors',
                    isParent && 'border-t border-border bg-card/40',
                    !isParent && 'border-t border-border/40 hover:bg-primary/[0.03]',
                    !isParent && prevWasParent && 'border-t-border',
                  )}
                >
                  {/* Categoria cell */}
                  <td
                    className={cn(
                      'sticky left-0 z-10 whitespace-nowrap px-4 py-2.5',
                      isParent ? 'bg-card/40' : 'bg-background',
                    )}
                  >
                    {isParent ? (
                      <div className="flex items-center gap-2">
                        <span
                          className={cn(
                            'h-3 w-[3px]',
                            c.kind === 'income'
                              ? 'bg-[color:var(--good)]'
                              : 'bg-[color:var(--bad)]',
                          )}
                          aria-hidden
                        />
                        <span className="font-display text-base text-foreground">{c.name}</span>
                      </div>
                    ) : (
                      <span className="pl-5 font-sans text-[13px] text-muted-foreground">
                        {c.name}
                      </span>
                    )}
                  </td>

                  {/* 12 month cells */}
                  {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => {
                    const cellKey = keyOf(c.id, m);
                    const value = values.get(cellKey) ?? '';
                    const past = isPastMonth(m);
                    const current = isCurrentMonth(m);
                    const subtotal = leaf ? null : sumOf(c.id, m);

                    return (
                      <td
                        key={m}
                        className={cn(
                          'px-1 py-1 text-right',
                          past && !current && 'bg-muted/30',
                          current && 'bg-primary/[0.06]',
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
                              'font-mono tabular-nums',
                              'w-16 border border-transparent bg-transparent px-1.5 py-1 text-right text-[13px] text-foreground',
                              'focus:border-primary/60 focus:bg-background focus:outline-none focus:ring-1 focus:ring-primary/40',
                              past && 'cursor-not-allowed text-muted-foreground/60',
                            )}
                            aria-label={`${c.name} ${MONTH_LABELS[m - 1]} ${year}`}
                          />
                        ) : (
                          <Num
                            className={cn(
                              'inline-block px-1.5 py-1 text-[13px]',
                              subtotal && !subtotal.isZero()
                                ? 'text-foreground'
                                : 'text-muted-foreground/40',
                            )}
                          >
                            {subtotal && !subtotal.isZero()
                              ? formatCompact(subtotal.toNumber())
                              : '—'}
                          </Num>
                        )}
                      </td>
                    );
                  })}

                  {/* Year total */}
                  <td className="border-l border-border/60 px-4 py-2.5 text-right">
                    <Num
                      className={cn(
                        'text-sm',
                        isParent ? 'text-primary' : 'text-foreground',
                        isParent && 'font-semibold',
                      )}
                    >
                      {formatUsd(rowYearTotal(c.id).toNumber()) || (
                        <span className="text-muted-foreground/40">—</span>
                      )}
                    </Num>
                  </td>
                </tr>
              );
            })}
          </tbody>

          {/* ============ FOOTER ============ */}
          <tfoot>
            {/* Income subtotal */}
            <tr className="border-t-2 border-border">
              <td className="sticky left-0 z-10 bg-background px-4 py-2.5">
                <span className="font-display text-base italic text-[color:var(--good)]">
                  Subtotal Ingresos
                </span>
              </td>
              {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
                <td
                  key={m}
                  className={cn(
                    'px-1 py-2.5 text-right',
                    isCurrentMonth(m) && 'bg-primary/[0.06]',
                    isPastMonth(m) && !isCurrentMonth(m) && 'bg-muted/30',
                  )}
                >
                  <Num className="text-[13px] text-foreground">
                    {formatCompact(monthTotalByKind(m, 'income').toNumber()) || (
                      <span className="text-muted-foreground/40">—</span>
                    )}
                  </Num>
                </td>
              ))}
              <td className="border-l border-border/60 px-4 py-2.5 text-right">
                <Num className="text-sm font-semibold text-[color:var(--good)]">
                  {formatUsd(yearTotalsBy('income').toNumber()) || '—'}
                </Num>
              </td>
            </tr>

            {/* Expense subtotal */}
            <tr className="border-t border-border/60">
              <td className="sticky left-0 z-10 bg-background px-4 py-2.5">
                <span className="font-display text-base italic text-[color:var(--bad)]">
                  Subtotal Gastos
                </span>
              </td>
              {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
                <td
                  key={m}
                  className={cn(
                    'px-1 py-2.5 text-right',
                    isCurrentMonth(m) && 'bg-primary/[0.06]',
                    isPastMonth(m) && !isCurrentMonth(m) && 'bg-muted/30',
                  )}
                >
                  <Num className="text-[13px] text-foreground">
                    {formatCompact(monthTotalByKind(m, 'expense').toNumber()) || (
                      <span className="text-muted-foreground/40">—</span>
                    )}
                  </Num>
                </td>
              ))}
              <td className="border-l border-border/60 px-4 py-2.5 text-right">
                <Num className="text-sm font-semibold text-[color:var(--bad)]">
                  {formatUsd(yearTotalsBy('expense').toNumber()) || '—'}
                </Num>
              </td>
            </tr>

            {/* Net row — the headliner */}
            <tr className="border-t-2 border-border bg-card/50">
              <td className="sticky left-0 z-10 bg-card/50 px-4 py-3">
                <span className="font-display text-lg italic text-foreground">Neto</span>
              </td>
              {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => {
                const net = monthTotalByKind(m, 'income').minus(monthTotalByKind(m, 'expense'));
                const n = net.toNumber();
                const empty = net.isZero();
                return (
                  <td
                    key={m}
                    className={cn(
                      'px-1 py-3 text-right',
                      isCurrentMonth(m) && 'bg-primary/[0.08]',
                      isPastMonth(m) && !isCurrentMonth(m) && 'bg-muted/30',
                    )}
                  >
                    <Num
                      className={cn(
                        'text-sm font-semibold',
                        empty && 'text-muted-foreground/40',
                        !empty && n > 0 && 'text-[color:var(--good)]',
                        !empty && n < 0 && 'text-[color:var(--bad)]',
                      )}
                    >
                      {empty ? '—' : formatCompact(n)}
                    </Num>
                  </td>
                );
              })}
              <td className="border-l border-border px-4 py-3 text-right">
                <Num className="text-base font-semibold text-primary">
                  {(() => {
                    const total = Array.from({ length: 12 }, (_, i) => i + 1)
                      .map((m) =>
                        monthTotalByKind(m, 'income').minus(monthTotalByKind(m, 'expense')),
                      )
                      .reduce((a, b) => a.plus(b), new Decimal(0));
                    return total.isZero() ? '—' : formatUsd(total.toNumber());
                  })()}
                </Num>
              </td>
            </tr>
          </tfoot>
        </table>
      </div>

      {/* ============ LEGEND ============ */}
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 px-1 pt-3 font-sans text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
        <div className="flex items-center gap-2">
          <span className="inline-block h-3 w-3 bg-primary/[0.08]" aria-hidden />
          <span>mes en curso · editable</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="inline-block h-3 w-3 bg-muted/30" aria-hidden />
          <span>mes pasado · read-only</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="inline-block h-3 w-[3px] bg-[color:var(--good)]" aria-hidden />
          <span>ingreso</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="inline-block h-3 w-[3px] bg-[color:var(--bad)]" aria-hidden />
          <span>gasto</span>
        </div>
        <span className="ml-auto font-display text-sm italic normal-case tracking-normal">
          Tab para moverse · Enter o blur para guardar
        </span>
      </div>
    </div>
  );
}
