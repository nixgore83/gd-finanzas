'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMemo, useState, useTransition } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Label, Num } from '@/components/ui/typography';
import { cn } from '@/lib/utils';
import { ALL_KIND_LABELS } from '@/lib/schemas/transaction';
import type { CategoryNode } from '@/lib/categories/tree';
import { bulkDeleteTransactions } from '@/app/actions/transactions/bulk-delete';
import { bulkSetTransactionCategory } from '@/app/actions/transactions/bulk-set-category';
import { DeleteTransactionButton } from './delete-button';

export type TxRow = {
  id: string;
  date: string;
  kind: 'income' | 'expense' | 'transfer';
  amountOriginal: string;
  currencyOriginal: 'ARS' | 'USD';
  amountUsd: string;
  description: string;
  accountName: string | null;
  categoryName: string | null;
  tags: Array<{ name: string; color: string | null }>;
};

function formatAmount(amount: string, currency: 'ARS' | 'USD'): string {
  const n = Number.parseFloat(amount);
  return new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number.isFinite(n) ? n : 0);
}

function formatDayHeader(date: string): string {
  // YYYY-MM-DD → "dd mmm yyyy"
  const [y, m, d] = date.split('-').map(Number);
  if (!y || !m || !d) return date;
  return new Intl.DateTimeFormat('es-AR', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(new Date(Date.UTC(y, m - 1, d)));
}

const TYPE_VAR: Record<TxRow['kind'], string> = {
  income: 'var(--good)',
  expense: 'var(--bad)',
  transfer: 'var(--attn)',
};

type Props = {
  rows: TxRow[];
  categories: CategoryNode[];
};

export function TransactionsTable({ rows, categories }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkCategoryId, setBulkCategoryId] = useState<string>('');

  const selectedRows = useMemo(
    () => rows.filter((r) => selected.has(r.id)),
    [rows, selected],
  );
  const selectedKinds = useMemo(() => {
    const set = new Set<'income' | 'expense'>();
    for (const r of selectedRows) {
      if (r.kind === 'income' || r.kind === 'expense') set.add(r.kind);
    }
    return set;
  }, [selectedRows]);
  const uniformKind: 'income' | 'expense' | null =
    selectedKinds.size === 1 ? [...selectedKinds][0]! : null;

  const bulkCategoryOptions = useMemo(
    () => (uniformKind ? categories.filter((c) => c.kind === uniformKind) : []),
    [categories, uniformKind],
  );

  function toggleOne(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    const allIds = rows.map((r) => r.id);
    const allSelected = allIds.length > 0 && allIds.every((id) => selected.has(id));
    setSelected(allSelected ? new Set() : new Set(allIds));
  }

  function doBulkDelete() {
    if (selected.size === 0) return;
    if (!confirm(`Borrar ${selected.size} transacciones? No se puede deshacer.`)) return;
    startTransition(async () => {
      const res = await bulkDeleteTransactions({ ids: [...selected] });
      if (res.ok) {
        toast.success(`${res.deleted} transacciones borradas`);
        setSelected(new Set());
        router.refresh();
      } else {
        toast.error(`Error: ${res.error}`);
      }
    });
  }

  function doBulkCategory() {
    if (selected.size === 0 || !bulkCategoryId) {
      toast.error('Elegí una categoría');
      return;
    }
    if (!uniformKind) {
      toast.error('Selección con tipos distintos. Filtrá por tipo antes.');
      return;
    }
    startTransition(async () => {
      const res = await bulkSetTransactionCategory({
        ids: [...selected],
        categoryId: bulkCategoryId,
      });
      if (res.ok) {
        const skipped = res.skipped > 0 ? ` · ${res.skipped} saltadas` : '';
        toast.success(`Categoría asignada a ${res.updated}${skipped}`);
        setSelected(new Set());
        setBulkCategoryId('');
        router.refresh();
      } else {
        toast.error(`Error: ${res.error}`);
      }
    });
  }

  // Agrupar por fecha para mostrar separadores
  const grouped = useMemo(() => {
    const out: Array<{ date: string; rows: TxRow[] }> = [];
    for (const r of rows) {
      const last = out[out.length - 1];
      if (last && last.date === r.date) last.rows.push(r);
      else out.push({ date: r.date, rows: [r] });
    }
    return out;
  }, [rows]);

  const allSelected = rows.length > 0 && rows.every((r) => selected.has(r.id));

  return (
    <div className="space-y-4">
      {/* ============ BULK ACTION PANEL ============ */}
      {selected.size > 0 && (
        <div className="flex flex-wrap items-end justify-between gap-4 border-l-2 border-primary bg-primary/[0.06] p-4">
          <div>
            <Label className="text-primary">Selección activa</Label>
            <div className="mt-1 flex items-baseline gap-2">
              <span className="font-display text-2xl font-light text-foreground">
                {selected.size}
              </span>
              <span className="font-display text-sm italic text-muted-foreground">
                {selected.size === 1 ? 'movimiento seleccionado' : 'movimientos seleccionados'}
              </span>
            </div>
            {uniformKind === null && selectedKinds.size > 1 && (
              <p className="mt-2 font-display text-sm italic text-[color:var(--bad)]">
                Tipos mixtos — la recategorización solo aplica a una sola categoría kind.
              </p>
            )}
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <Select
              value={bulkCategoryId}
              onValueChange={setBulkCategoryId}
              disabled={uniformKind === null || isPending}
            >
              <SelectTrigger className="w-64">
                <SelectValue placeholder="Recategorizar a…" />
              </SelectTrigger>
              <SelectContent>
                {bulkCategoryOptions.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.depth === 1 ? '↳ ' : ''}
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              size="sm"
              onClick={doBulkCategory}
              disabled={isPending || !bulkCategoryId || uniformKind === null}
            >
              Aplicar
            </Button>
            <Button
              size="sm"
              variant="destructive"
              onClick={doBulkDelete}
              disabled={isPending}
            >
              Borrar {selected.size}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
              Limpiar
            </Button>
          </div>
        </div>
      )}

      {/* ============ TABLE ============ */}
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="border-y border-border">
              <th className="w-8 px-3 py-2.5">
                <input
                  type="checkbox"
                  aria-label="Seleccionar todas"
                  checked={allSelected}
                  onChange={toggleAll}
                  className="size-4 rounded-sm border-input accent-[color:var(--primary)]"
                />
              </th>
              {['Tipo', 'Cuenta', 'Categoría'].map((h) => (
                <th
                  key={h}
                  className="px-3 py-2.5 text-left font-sans text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground"
                >
                  {h}
                </th>
              ))}
              {['Monto', 'USD'].map((h) => (
                <th
                  key={h}
                  className="px-3 py-2.5 text-right font-sans text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground"
                >
                  {h}
                </th>
              ))}
              <th className="px-3 py-2.5 text-left font-sans text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                Concepto
              </th>
              <th className="px-3 py-2.5" />
            </tr>
          </thead>
          <tbody>
            {grouped.map((group) => (
              <ByDayGroup
                key={group.date}
                date={group.date}
                rows={group.rows}
                selected={selected}
                onToggle={toggleOne}
              />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ByDayGroup({
  date,
  rows,
  selected,
  onToggle,
}: {
  date: string;
  rows: TxRow[];
  selected: Set<string>;
  onToggle: (id: string) => void;
}) {
  // Sum signed USD net for the day's strapline
  const dayNet = rows.reduce((s, r) => {
    const n = Number.parseFloat(r.amountUsd) || 0;
    if (r.kind === 'income') return s + n;
    if (r.kind === 'expense') return s - n;
    return s;
  }, 0);
  const formatUsd = (n: number) =>
    new Intl.NumberFormat('es-AR', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(n);

  return (
    <>
      {/* Day separator row */}
      <tr className="border-t border-border bg-card/30">
        <td colSpan={8} className="px-3 py-2">
          <div className="flex items-baseline justify-between gap-3">
            <span className="font-sans text-[10px] font-semibold uppercase tracking-[0.22em] text-primary">
              {formatDayHeader(date)}
            </span>
            <Num className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
              {rows.length} {rows.length === 1 ? 'mov' : 'movs'} · neto{' '}
              <span
                className={cn(
                  dayNet >= 0 ? 'text-[color:var(--good)]' : 'text-[color:var(--bad)]',
                )}
              >
                {dayNet >= 0 ? '+' : ''}
                {formatUsd(dayNet)}
              </span>
            </Num>
          </div>
        </td>
      </tr>

      {/* Movement rows */}
      {rows.map((row) => (
        <tr
          key={row.id}
          className={cn(
            'border-t border-border/40 transition-colors hover:bg-primary/[0.04]',
            selected.has(row.id) && 'bg-primary/[0.08]',
          )}
        >
          <td className="px-3 py-3">
            <input
              type="checkbox"
              aria-label={`Seleccionar ${row.description}`}
              checked={selected.has(row.id)}
              onChange={() => onToggle(row.id)}
              className="size-4 rounded-sm border-input accent-[color:var(--primary)]"
            />
          </td>
          <td className="px-3 py-3">
            <span
              className="inline-block rounded-sm px-2 py-[3px] font-sans text-[9px] font-semibold uppercase tracking-[0.14em]"
              style={{
                background: `color-mix(in oklab, ${TYPE_VAR[row.kind]} 15%, transparent)`,
                color: TYPE_VAR[row.kind],
              }}
            >
              {ALL_KIND_LABELS[row.kind]}
            </span>
          </td>
          <td className="px-3 py-3 font-sans text-xs text-muted-foreground">
            {row.accountName ?? '—'}
          </td>
          <td className="px-3 py-3 font-sans text-xs text-muted-foreground">
            {row.categoryName ?? '—'}
          </td>
          <td className="px-3 py-3 text-right">
            <Num
              className={cn(
                'text-sm',
                row.kind === 'income' && 'text-[color:var(--good)]',
                row.kind === 'transfer' && 'text-[color:var(--attn)]',
                row.kind === 'expense' && 'text-foreground',
              )}
            >
              {formatAmount(row.amountOriginal, row.currencyOriginal)}
            </Num>
          </td>
          <td className="px-3 py-3 text-right">
            <Num className="text-xs text-muted-foreground">
              {formatAmount(row.amountUsd, 'USD')}
            </Num>
          </td>
          <td className="px-3 py-3">
            <div className="flex flex-wrap items-baseline gap-2">
              <span className="font-display text-base text-foreground">{row.description}</span>
              {row.tags.map((t, i) => (
                <span
                  key={i}
                  className="inline-block rounded-full border px-2 py-[1px] font-sans text-[10px] font-medium"
                  style={
                    t.color
                      ? {
                          borderColor: `color-mix(in oklab, ${t.color} 60%, transparent)`,
                          color: t.color,
                          background: `color-mix(in oklab, ${t.color} 12%, transparent)`,
                        }
                      : {
                          borderColor: 'var(--border)',
                          color: 'var(--muted-foreground)',
                        }
                  }
                >
                  {t.name}
                </span>
              ))}
            </div>
          </td>
          <td className="px-3 py-3 text-right">
            <div className="flex justify-end gap-1.5 opacity-0 transition-opacity group-hover:opacity-100 [tr:hover_&]:opacity-100">
              <Button variant="outline" size="sm" asChild>
                <Link href={`/transactions/${row.id}`}>Editar</Link>
              </Button>
              <DeleteTransactionButton id={row.id} />
            </div>
          </td>
        </tr>
      ))}
    </>
  );
}
