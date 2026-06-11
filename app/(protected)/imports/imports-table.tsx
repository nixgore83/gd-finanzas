'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useMemo, useState, useTransition } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Label, Num } from '@/components/ui/typography';
import { SortableHeader } from '@/components/ui/sortable-header';
import { cn } from '@/lib/utils';
import { IMPORT_TYPE_LABELS, type ImportType } from '@/lib/schemas/import';
import {
  IMPORT_STATUS_LABELS,
  IMPORT_STATUS_VARS,
  isDeletableStatus,
  type ImportStatus,
} from '@/lib/imports/list-filters';
import { parseImport } from '@/app/actions/imports/parse';
import { bulkDeleteImports, deleteImport } from '@/app/actions/imports/delete';

export type ImportRow = {
  id: string;
  type: ImportType;
  status: ImportStatus;
  institutionName: string | null;
  accountName: string | null;
  accountOwner: string | null;
  fileName: string | null;
  createdAt: string; // ISO
  periodStart: string | null; // YYYY-MM-DD
  periodEnd: string | null;
  transactionCount: number | null;
};

const MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return new Intl.DateTimeFormat('es-AR', {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(d);
}

function relativeAgo(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const days = Math.floor((Date.now() - d.getTime()) / 86_400_000);
  if (days <= 0) return 'hoy';
  if (days === 1) return 'ayer';
  if (days < 7) return `hace ${days} días`;
  if (days < 30) return `hace ${Math.floor(days / 7)} sem`;
  return `hace ${Math.floor(days / 30)} meses`;
}

function monthLabel(iso: string): string {
  const [y, m] = iso.split('-');
  if (!y || !m) return iso;
  return `${MONTHS[Number.parseInt(m, 10) - 1] ?? m} ${y}`;
}

function periodLabel(start: string | null, end: string | null): string {
  if (!start) return '—';
  const a = monthLabel(start);
  const b = end ? monthLabel(end) : a;
  return a === b ? a : `${a} – ${b}`;
}

type Props = {
  rows: ImportRow[];
  sort: string;
  dir: 'asc' | 'desc';
};

export function ImportsTable({ rows, sort, dir }: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const deletableIds = useMemo(
    () => rows.filter((r) => isDeletableStatus(r.status)).map((r) => r.id),
    [rows],
  );

  function handleSort(field: string, newDir: 'asc' | 'desc') {
    const sp = new URLSearchParams(searchParams.toString());
    sp.set('sort', field);
    sp.set('dir', newDir);
    sp.delete('page');
    router.push(`/imports?${sp.toString()}`);
  }

  function toggleOne(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    const allSelected = deletableIds.length > 0 && deletableIds.every((id) => selected.has(id));
    setSelected(allSelected ? new Set() : new Set(deletableIds));
  }

  function doBulkDelete() {
    if (selected.size === 0) return;
    if (!confirm(`Borrar ${selected.size} import${selected.size > 1 ? 's' : ''}? No se puede deshacer.`)) {
      return;
    }
    startTransition(async () => {
      const res = await bulkDeleteImports({ ids: [...selected] });
      if (res.ok) {
        const skipped = res.skipped > 0 ? ` · ${res.skipped} saltados (confirmados)` : '';
        toast.success(`${res.deleted} import${res.deleted === 1 ? '' : 's'} borrado${res.deleted === 1 ? '' : 's'}${skipped}`);
        setSelected(new Set());
        router.refresh();
      } else {
        toast.error(`Error al borrar: ${res.error}`);
      }
    });
  }

  function doRetry(id: string) {
    startTransition(async () => {
      const res = await parseImport(id);
      if (res.ok) {
        toast.success('Reparseo disparado');
        router.refresh();
      } else {
        toast.error(`No se pudo reparsear: ${res.error}`);
      }
    });
  }

  function doDeleteOne(id: string) {
    if (!confirm('Borrar este import? No se puede deshacer.')) return;
    startTransition(async () => {
      const res = await deleteImport({ id });
      if (res.ok && res.deleted > 0) {
        toast.success('Import borrado');
        router.refresh();
      } else if (res.ok) {
        toast.error('No se borró (estado no borrable)');
      } else {
        toast.error(`Error al borrar: ${res.error}`);
      }
    });
  }

  const allDeletableSelected =
    deletableIds.length > 0 && deletableIds.every((id) => selected.has(id));

  return (
    <div className="space-y-4">
      {selected.size > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-4 border-l-2 border-primary bg-primary/[0.06] p-4">
          <div className="flex items-baseline gap-2">
            <span className="font-display text-2xl font-light text-foreground">{selected.size}</span>
            <span className="font-display text-sm italic text-muted-foreground">
              {selected.size === 1 ? 'import seleccionado' : 'imports seleccionados'}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="destructive" onClick={doBulkDelete} disabled={isPending}>
              Borrar {selected.size}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())} disabled={isPending}>
              Limpiar
            </Button>
          </div>
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="border-y border-border">
              <th className="w-8 px-3 py-2.5">
                {deletableIds.length > 0 && (
                  <input
                    type="checkbox"
                    aria-label="Seleccionar borrables"
                    checked={allDeletableSelected}
                    onChange={toggleAll}
                    className="size-4 rounded-sm border-input accent-[color:var(--primary)]"
                  />
                )}
              </th>
              {([['Fecha', 'created'], ['Cuenta', 'account'], ['Período', 'period'], ['Estado', 'status']] as const).map(
                ([label, field]) => (
                  <th
                    key={field}
                    className="px-3 py-2.5 text-left font-sans text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground"
                  >
                    <SortableHeader label={label} field={field} currentSort={sort} currentDir={dir} onSort={handleSort} />
                  </th>
                ),
              )}
              <th className="px-3 py-2.5 text-right font-sans text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                <SortableHeader label="Txns" field="txns" currentSort={sort} currentDir={dir} onSort={handleSort} className="justify-end" />
              </th>
              <th className="px-3 py-2.5" />
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const statusVar = IMPORT_STATUS_VARS[r.status] ?? 'var(--muted-foreground)';
              const deletable = isDeletableStatus(r.status);
              return (
                <tr
                  key={r.id}
                  className={cn(
                    'border-t border-border/40 transition-colors hover:bg-primary/[0.04]',
                    selected.has(r.id) && 'bg-primary/[0.08]',
                  )}
                >
                  <td className="px-3 py-3">
                    {deletable && (
                      <input
                        type="checkbox"
                        aria-label={`Seleccionar ${r.fileName ?? r.id}`}
                        checked={selected.has(r.id)}
                        onChange={() => toggleOne(r.id)}
                        className="size-4 rounded-sm border-input accent-[color:var(--primary)]"
                      />
                    )}
                  </td>
                  <td className="px-3 py-3">
                    <Num className="block text-sm text-foreground">{formatDateTime(r.createdAt)}</Num>
                    <Label className="mt-0.5 normal-case tracking-[0.05em]">{relativeAgo(r.createdAt)}</Label>
                  </td>
                  <td className="px-3 py-3">
                    <Link
                      href={`/imports/${r.id}`}
                      className="text-sm font-medium text-foreground transition-colors hover:text-primary"
                    >
                      {r.accountName ?? r.institutionName ?? '—'}
                      {r.accountOwner ? ` (${r.accountOwner})` : ''}
                    </Link>
                    <Label className="mt-0.5 block normal-case tracking-[0.05em]">
                      {r.institutionName} · {IMPORT_TYPE_LABELS[r.type]}
                    </Label>
                  </td>
                  <td className="px-3 py-3">
                    <span className="text-sm text-foreground">{periodLabel(r.periodStart, r.periodEnd)}</span>
                  </td>
                  <td className="px-3 py-3">
                    <span
                      className="inline-block rounded-full border px-2.5 py-[3px] font-sans text-[10px] font-semibold uppercase tracking-[0.14em]"
                      style={{
                        borderColor: `color-mix(in oklab, ${statusVar} 40%, transparent)`,
                        background: `color-mix(in oklab, ${statusVar} 12%, transparent)`,
                        color: statusVar,
                      }}
                    >
                      {IMPORT_STATUS_LABELS[r.status] ?? r.status}
                    </span>
                  </td>
                  <td className="px-3 py-3 text-right">
                    <Num className="text-sm text-foreground">{r.transactionCount ?? '—'}</Num>
                  </td>
                  <td className="px-3 py-3 text-right">
                    {/* Siempre visibles: con hover-only eran indescubribles (touch/mobile). */}
                    <div className="flex justify-end gap-1.5">
                      {r.status === 'error' && (
                        <Button variant="outline" size="sm" onClick={() => doRetry(r.id)} disabled={isPending}>
                          Reintentar
                        </Button>
                      )}
                      <Button variant="outline" size="sm" asChild>
                        <Link href={`/imports/${r.id}`}>Ver →</Link>
                      </Button>
                      {deletable && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => doDeleteOne(r.id)}
                          disabled={isPending}
                          className="text-[color:var(--bad)] hover:text-[color:var(--bad)]"
                        >
                          Borrar
                        </Button>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
