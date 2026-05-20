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
  // YYYY-MM-DD → dd MMM
  const [y, m, d] = date.split('-').map(Number);
  if (!y || !m || !d) return date;
  return new Intl.DateTimeFormat('es-AR', { day: '2-digit', month: 'short', year: 'numeric' }).format(
    new Date(Date.UTC(y, m - 1, d)),
  );
}

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

  const allSelected =
    rows.length > 0 && rows.every((r) => selected.has(r.id));

  return (
    <div className="space-y-3">
      {selected.size > 0 && (
        <div className="flex flex-wrap items-end gap-3 rounded-md border border-primary/30 bg-primary/5 p-3">
          <div className="space-y-1">
            <p className="text-sm font-medium">
              {selected.size} seleccionada{selected.size === 1 ? '' : 's'}
            </p>
            {uniformKind === null && selectedKinds.size > 1 && (
              <p className="text-xs text-muted-foreground">
                Tipos mixtos: la recategorización solo funciona con selección de un mismo
                kind.
              </p>
            )}
          </div>
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
      )}

      <div className="overflow-x-auto rounded-md border">
        <table className="w-full text-sm">
          <thead className="bg-muted/40">
            <tr className="text-left">
              <th className="px-3 py-2 w-8">
                <input
                  type="checkbox"
                  aria-label="Seleccionar todas"
                  checked={allSelected}
                  onChange={toggleAll}
                  className="size-4 rounded border-input"
                />
              </th>
              <th className="px-3 py-2 font-medium">Tipo</th>
              <th className="px-3 py-2 font-medium">Cuenta</th>
              <th className="px-3 py-2 font-medium">Categoría</th>
              <th className="px-3 py-2 text-right font-medium">Monto</th>
              <th className="px-3 py-2 text-right font-medium">USD</th>
              <th className="px-3 py-2 font-medium">Descripción</th>
              <th className="px-3 py-2 font-medium" />
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
  return (
    <>
      <tr className="border-t bg-muted/20">
        <td colSpan={8} className="px-3 py-1.5 text-xs font-medium text-muted-foreground">
          {formatDayHeader(date)}
        </td>
      </tr>
      {rows.map((row) => (
        <tr
          key={row.id}
          className={cn('border-t', selected.has(row.id) && 'bg-primary/5')}
        >
          <td className="px-3 py-2">
            <input
              type="checkbox"
              aria-label={`Seleccionar transacción ${row.description}`}
              checked={selected.has(row.id)}
              onChange={() => onToggle(row.id)}
              className="size-4 rounded border-input"
            />
          </td>
          <td className="px-3 py-2">
            <span
              className={cn(
                'rounded px-1.5 py-0.5 text-xs',
                row.kind === 'income' &&
                  'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300',
                row.kind === 'expense' &&
                  'bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-300',
                row.kind === 'transfer' &&
                  'bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-300',
              )}
            >
              {ALL_KIND_LABELS[row.kind]}
            </span>
          </td>
          <td className="px-3 py-2 text-muted-foreground">{row.accountName ?? '—'}</td>
          <td className="px-3 py-2 text-muted-foreground">{row.categoryName ?? '—'}</td>
          <td className="px-3 py-2 text-right tabular-nums">
            {formatAmount(row.amountOriginal, row.currencyOriginal)}
          </td>
          <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
            {formatAmount(row.amountUsd, 'USD')}
          </td>
          <td className="px-3 py-2">
            <div className="flex flex-wrap items-center gap-1.5">
              <span>{row.description}</span>
              {row.tags.map((t, i) => (
                <span
                  key={i}
                  className="rounded-full border px-1.5 py-0.5 text-[10px] font-medium"
                  style={
                    t.color
                      ? { borderColor: t.color, color: t.color }
                      : undefined
                  }
                >
                  {t.name}
                </span>
              ))}
            </div>
          </td>
          <td className="px-3 py-2 text-right">
            <div className="flex justify-end gap-2">
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
