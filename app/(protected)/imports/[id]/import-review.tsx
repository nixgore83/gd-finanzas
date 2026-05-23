'use client';

import { useRouter } from 'next/navigation';
import { useMemo, useState, useTransition } from 'react';
import Decimal from 'decimal.js';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';
import type { CategoryNode } from '@/lib/categories/tree';
import type { ParsedTxLine } from '@/lib/imports/parsers/types';
import { setLineStatus } from '@/app/actions/imports/set-line-status';
import { updateImportLine } from '@/app/actions/imports/update-line';
import { bulkSetCategory } from '@/app/actions/imports/bulk-set-category';
import { confirmImport } from '@/app/actions/imports/confirm';

type LineRow = {
  id: string;
  parsedData: ParsedTxLine;
  proposedCategoryId: string | null;
  status: 'pending' | 'accepted' | 'rejected' | 'edited';
  transactionId: string | null;
};

type Props = {
  importId: string;
  status: string;
  lines: LineRow[];
  tree: CategoryNode[];
  accounts: Array<{ id: string; name: string; currency: 'ARS' | 'USD'; institutionId: string | null }>;
  importInstitutionId: string | null;
};

const STATUS_BADGE: Record<string, string> = {
  pending: 'bg-slate-100 text-slate-800 border-slate-300',
  accepted: 'bg-emerald-100 text-emerald-900 border-emerald-300',
  rejected: 'bg-rose-100 text-rose-900 border-rose-300',
  edited: 'bg-blue-100 text-blue-900 border-blue-300',
};

const STATUS_LABEL: Record<string, string> = {
  pending: 'Pendiente',
  accepted: 'Aceptada',
  rejected: 'Rechazada',
  edited: 'Editada',
};

export function ImportReview({ importId, status, lines, tree, accounts, importInstitutionId }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const defaultAccount = (importInstitutionId
    ? accounts.find((a) => a.institutionId === importInstitutionId)
    : null) ?? accounts[0];
  const [accountId, setAccountId] = useState<string>(defaultAccount?.id ?? '');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkCategoryId, setBulkCategoryId] = useState<string>('');

  const summary = useMemo(() => {
    const c = { pending: 0, accepted: 0, rejected: 0, edited: 0 };
    for (const l of lines) c[l.status] += 1;
    return c;
  }, [lines]);

  const totals = useMemo(() => computeTotalsByCurrency(lines), [lines]);

  // `readOnly` global: solo aplica si el import está confirmed Y todas las líneas
  // tienen transactionId (estado terminal limpio). Si quedan sin tx, dejamos
  // editar (necesario para corregir fallas parciales).
  const allLinesLinked = lines.every((l) => l.transactionId !== null);
  const isConfirmed = status === 'confirmed' && allLinesLinked;
  const readOnly = isConfirmed;

  const selectedLines = useMemo(
    () => lines.filter((l) => selectedIds.has(l.id)),
    [lines, selectedIds],
  );

  const selectedKinds = useMemo(() => {
    const set = new Set<'income' | 'expense'>();
    for (const l of selectedLines) set.add(l.parsedData.kind);
    return set;
  }, [selectedLines]);

  const uniformKind: 'income' | 'expense' | null =
    selectedKinds.size === 1 ? [...selectedKinds][0]! : null;

  const bulkCategoryOptions = useMemo(
    () => (uniformKind ? tree.filter((c) => c.kind === uniformKind) : []),
    [tree, uniformKind],
  );

  function toggleOne(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAllPending() {
    const pendingIds = lines.filter((l) => l.status !== 'rejected').map((l) => l.id);
    const allSelected =
      pendingIds.length > 0 && pendingIds.every((id) => selectedIds.has(id));
    setSelectedIds(allSelected ? new Set() : new Set(pendingIds));
  }

  function doBulkCategory() {
    if (selectedIds.size === 0) {
      toast.error('No hay líneas seleccionadas');
      return;
    }
    if (!bulkCategoryId) {
      toast.error('Elegí una categoría');
      return;
    }
    if (!uniformKind) {
      toast.error('Las líneas seleccionadas son de tipos distintos (ingreso y gasto). Filtrá por tipo antes.');
      return;
    }
    startTransition(async () => {
      const res = await bulkSetCategory({
        importId,
        lineIds: [...selectedIds],
        categoryId: bulkCategoryId,
      });
      if (res.ok) {
        const skippedMsg = res.skipped > 0 ? ` · ${res.skipped} saltadas` : '';
        toast.success(`Categoría asignada a ${res.updated} líneas${skippedMsg}`);
        setSelectedIds(new Set());
        setBulkCategoryId('');
        router.refresh();
      } else {
        toast.error(`Error: ${res.error}`);
      }
    });
  }

  function doBulk(status: 'accepted' | 'rejected') {
    const ids = lines.filter((l) => l.status === 'pending').map((l) => l.id);
    if (ids.length === 0) {
      toast.info('No hay líneas pendientes');
      return;
    }
    startTransition(async () => {
      const res = await setLineStatus({ importId, lineIds: ids, status });
      if (res.ok) {
        toast.success(`${status === 'accepted' ? 'Aceptadas' : 'Rechazadas'} · ${res.updated}`);
        router.refresh();
      } else {
        toast.error(`Error: ${res.error}`);
      }
    });
  }

  function doSetStatus(lineId: string, next: 'accepted' | 'rejected' | 'pending') {
    startTransition(async () => {
      const res = await setLineStatus({ importId, lineIds: [lineId], status: next });
      if (res.ok) router.refresh();
      else toast.error(`Error: ${res.error}`);
    });
  }

  function doConfirm() {
    if (!accountId) {
      toast.error('Elegí una cuenta destino');
      return;
    }
    if (summary.accepted + summary.edited === 0) {
      toast.error('No hay líneas aceptadas para confirmar');
      return;
    }
    startTransition(async () => {
      const res = await confirmImport({ importId, accountId });
      if (res.ok) {
        if (res.rejectedCount > 0) {
          toast.warning(
            `${res.createdCount} confirmadas · ${res.rejectedCount} con error (ver detalle abajo)`,
          );
          router.refresh();
        } else {
          toast.success(`Import confirmado · ${res.createdCount} transacciones creadas`);
          router.push('/transactions');
        }
      } else {
        toast.error(res.message ?? `Error: ${res.error}`);
        if (res.lineErrors && res.lineErrors.length > 0) {
          console.error('[import] line errors', res.lineErrors);
        }
      }
    });
  }

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold">
          Líneas extraídas · {lines.length}
        </h2>
        <div className="flex flex-wrap gap-2 text-xs">
          <Badge label="Pending" count={summary.pending} tone="slate" />
          <Badge label="Aceptadas" count={summary.accepted} tone="emerald" />
          <Badge label="Editadas" count={summary.edited} tone="blue" />
          <Badge label="Rechazadas" count={summary.rejected} tone="rose" />
        </div>
      </div>

      {!readOnly && (
        <div className="space-y-2">
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => doBulk('accepted')}
              disabled={isPending || summary.pending === 0}
            >
              Aceptar todas las pending
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => doBulk('rejected')}
              disabled={isPending || summary.pending === 0}
            >
              Rechazar todas las pending
            </Button>
          </div>

          {selectedIds.size > 0 && (
            <div className="flex flex-wrap items-end gap-3 rounded-md border border-blue-300 bg-blue-50 p-3">
              <div className="space-y-1">
                <p className="text-sm font-medium text-blue-900">
                  {selectedIds.size} línea{selectedIds.size === 1 ? '' : 's'} seleccionada
                  {selectedIds.size === 1 ? '' : 's'}
                </p>
                {uniformKind === null ? (
                  <p className="text-xs text-blue-800">
                    Mezcla de ingresos y gastos. Filtrá por tipo antes de asignar
                    categoría en lote.
                  </p>
                ) : (
                  <p className="text-xs text-blue-800">
                    Todas son {uniformKind === 'expense' ? 'gastos' : 'ingresos'}.
                  </p>
                )}
              </div>
              <Select
                value={bulkCategoryId}
                onValueChange={setBulkCategoryId}
                disabled={uniformKind === null || isPending}
              >
                <SelectTrigger className="w-64">
                  <SelectValue placeholder="Elegí categoría" />
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
                type="button"
                size="sm"
                onClick={doBulkCategory}
                disabled={isPending || !bulkCategoryId || uniformKind === null}
              >
                Aplicar a {selectedIds.size}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => setSelectedIds(new Set())}
              >
                Limpiar selección
              </Button>
            </div>
          )}
        </div>
      )}

      <div className="overflow-x-auto rounded-md border">
        <table className="w-full text-sm">
          <thead className="bg-muted/40">
            <tr className="text-left">
              {!readOnly && (
                <th className="px-2 py-2 w-8">
                  <input
                    type="checkbox"
                    aria-label="Seleccionar todas"
                    checked={
                      lines.filter((l) => l.status !== 'rejected').length > 0 &&
                      lines
                        .filter((l) => l.status !== 'rejected')
                        .every((l) => selectedIds.has(l.id))
                    }
                    onChange={toggleAllPending}
                    className="size-4 rounded border-input"
                  />
                </th>
              )}
              <th className="px-2 py-2 font-medium">Fecha</th>
              <th className="px-2 py-2 font-medium">Descripción</th>
              <th className="px-2 py-2 font-medium">Tipo</th>
              <th className="px-2 py-2 text-right font-medium">Monto</th>
              <th className="px-2 py-2 font-medium">Mon.</th>
              <th className="px-2 py-2 font-medium">Categoría</th>
              <th className="px-2 py-2 font-medium">Estado</th>
              {!readOnly && <th className="px-2 py-2 font-medium">Acciones</th>}
            </tr>
          </thead>
          <tbody>
            {lines.map((l) => (
              <LineRowEditor
                key={l.id}
                line={l}
                importId={importId}
                tree={tree}
                readOnly={readOnly}
                isPending={isPending}
                onSetStatus={doSetStatus}
                isSelected={selectedIds.has(l.id)}
                onToggleSelect={() => toggleOne(l.id)}
              />
            ))}
            {lines.length === 0 && (
              <tr>
                <td
                  colSpan={readOnly ? 7 : 9}
                  className="px-3 py-6 text-center text-muted-foreground"
                >
                  Sin líneas. ¿Ya parseaste el archivo?
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {totals.length > 0 && (
        <div className="rounded-md border bg-muted/20 p-3">
          <p className="mb-2 text-xs font-medium text-muted-foreground">
            Totales extraídos (excluye rechazadas) — verificá contra los subtotales del
            resumen.
          </p>
          <div className="grid grid-cols-1 gap-2 text-sm md:grid-cols-2">
            {totals.map((t) => (
              <div
                key={t.currency}
                className="flex items-center justify-between rounded border bg-card px-3 py-2"
              >
                <span className="font-medium">
                  {t.currency} · {t.count} {t.count === 1 ? 'línea' : 'líneas'}
                </span>
                <span className="flex flex-wrap items-center gap-3 tabular-nums">
                  <span className="text-rose-700">
                    Gastos {formatAmount(t.expense, t.currency)}
                  </span>
                  <span className="text-emerald-700">
                    Ingresos {formatAmount(t.income, t.currency)}
                  </span>
                  <span className="font-semibold">
                    Neto {formatAmount(t.net, t.currency)}
                  </span>
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {!readOnly && (
        <div className="flex flex-wrap items-end justify-between gap-3 rounded-md border bg-card p-4">
          <div className="space-y-1.5">
            <label className="text-sm font-medium" htmlFor="accountId">
              Cuenta destino (común a todas las líneas)
            </label>
            <Select value={accountId} onValueChange={setAccountId}>
              <SelectTrigger id="accountId" className="w-72">
                <SelectValue placeholder="Elegí una cuenta" />
              </SelectTrigger>
              <SelectContent>
                {accounts.map((a) => (
                  <SelectItem key={a.id} value={a.id}>
                    {a.name} · {a.currency}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button
            type="button"
            onClick={doConfirm}
            disabled={isPending || summary.accepted + summary.edited === 0}
          >
            Confirmar import ({summary.accepted + summary.edited})
          </Button>
        </div>
      )}
    </section>
  );
}

function LineRowEditor({
  line,
  importId,
  tree,
  readOnly,
  isPending,
  onSetStatus,
  isSelected,
  onToggleSelect,
}: {
  line: LineRow;
  importId: string;
  tree: CategoryNode[];
  readOnly: boolean;
  isPending: boolean;
  onSetStatus: (id: string, status: 'accepted' | 'rejected' | 'pending') => void;
  isSelected: boolean;
  onToggleSelect: () => void;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<ParsedTxLine>(line.parsedData);
  const [categoryId, setCategoryId] = useState<string | null>(line.proposedCategoryId);

  const categoriesForKind = useMemo(
    () => tree.filter((c) => c.kind === draft.kind),
    [tree, draft.kind],
  );
  const categoryName = useMemo(() => {
    const c = tree.find((n) => n.id === (categoryId ?? line.proposedCategoryId));
    return c?.name ?? null;
  }, [tree, categoryId, line.proposedCategoryId]);

  function save() {
    startTransition(async () => {
      const res = await updateImportLine({
        lineId: line.id,
        importId,
        parsed: draft,
        proposedCategoryId: categoryId,
      });
      if (res.ok) {
        toast.success('Línea actualizada');
        setEditing(false);
        router.refresh();
      } else {
        toast.error(`Error: ${res.error}`);
      }
    });
  }

  return (
    <tr
      className={cn(
        'border-t align-top',
        isSelected && !readOnly && 'bg-blue-50/50',
      )}
    >
      {!readOnly && (
        <td className="px-2 py-1.5">
          <input
            type="checkbox"
            aria-label="Seleccionar línea"
            checked={isSelected}
            onChange={onToggleSelect}
            disabled={line.status === 'rejected'}
            className="size-4 rounded border-input"
          />
        </td>
      )}
      <td className="px-2 py-1.5 tabular-nums">
        {editing ? (
          <Input
            value={draft.date}
            onChange={(e) => setDraft({ ...draft, date: e.target.value })}
            className="h-8 w-32"
          />
        ) : (
          line.parsedData.date
        )}
      </td>
      <td className="px-2 py-1.5">
        {editing ? (
          <Input
            value={draft.description}
            onChange={(e) => setDraft({ ...draft, description: e.target.value })}
            className="h-8"
          />
        ) : (
          line.parsedData.description
        )}
      </td>
      <td className="px-2 py-1.5">
        {editing ? (
          <Select
            value={draft.kind}
            onValueChange={(v) => setDraft({ ...draft, kind: v as 'income' | 'expense' })}
          >
            <SelectTrigger className="h-8 w-28">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="expense">Gasto</SelectItem>
              <SelectItem value="income">Ingreso</SelectItem>
            </SelectContent>
          </Select>
        ) : line.parsedData.kind === 'expense' ? (
          'Gasto'
        ) : (
          'Ingreso'
        )}
      </td>
      <td className="px-2 py-1.5 text-right tabular-nums">
        {editing ? (
          <Input
            value={draft.amountOriginal}
            onChange={(e) => setDraft({ ...draft, amountOriginal: e.target.value })}
            className="h-8 w-24 text-right"
          />
        ) : (
          line.parsedData.amountOriginal
        )}
      </td>
      <td className="px-2 py-1.5">
        {editing ? (
          <Select
            value={draft.currencyOriginal}
            onValueChange={(v) =>
              setDraft({ ...draft, currencyOriginal: v as 'ARS' | 'USD' })
            }
          >
            <SelectTrigger className="h-8 w-20">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ARS">ARS</SelectItem>
              <SelectItem value="USD">USD</SelectItem>
            </SelectContent>
          </Select>
        ) : (
          line.parsedData.currencyOriginal
        )}
      </td>
      <td className="px-2 py-1.5">
        {editing ? (
          <Select
            value={categoryId ?? ''}
            onValueChange={(v) => setCategoryId(v || null)}
          >
            <SelectTrigger className="h-8 w-56">
              <SelectValue placeholder="—" />
            </SelectTrigger>
            <SelectContent>
              {categoriesForKind.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.depth === 1 ? '↳ ' : ''}
                  {c.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : (
          categoryName ?? <span className="text-muted-foreground">—</span>
        )}
      </td>
      <td className="px-2 py-1.5">
        <div className="flex flex-col gap-1">
          <span
            className={cn(
              'inline-block rounded-full border px-2 py-0.5 text-xs',
              STATUS_BADGE[line.status] ?? '',
            )}
          >
            {STATUS_LABEL[line.status] ?? line.status}
          </span>
          {line.transactionId && (
            <a
              href={`/transactions/${line.transactionId}`}
              className="text-[10px] text-emerald-700 hover:underline"
            >
              → tx
            </a>
          )}
        </div>
      </td>
      {!readOnly && (
        <td className="px-2 py-1.5">
          {line.transactionId ? (
            <span className="text-xs text-muted-foreground">linkeada</span>
          ) : editing ? (
            <div className="flex gap-1">
              <Button size="sm" type="button" onClick={save} disabled={isPending}>
                Guardar
              </Button>
              <Button
                size="sm"
                type="button"
                variant="ghost"
                onClick={() => {
                  setEditing(false);
                  setDraft(line.parsedData);
                  setCategoryId(line.proposedCategoryId);
                }}
              >
                X
              </Button>
            </div>
          ) : (
            <div className="flex flex-wrap gap-1">
              {line.status === 'pending' && (
                <>
                  <Button
                    size="sm"
                    type="button"
                    variant="outline"
                    onClick={() => onSetStatus(line.id, 'accepted')}
                    disabled={isPending}
                  >
                    ✓
                  </Button>
                  <Button
                    size="sm"
                    type="button"
                    variant="outline"
                    onClick={() => onSetStatus(line.id, 'rejected')}
                    disabled={isPending}
                  >
                    ✕
                  </Button>
                </>
              )}
              {line.status !== 'pending' && line.status !== 'rejected' && (
                <Button
                  size="sm"
                  type="button"
                  variant="outline"
                  onClick={() => onSetStatus(line.id, 'pending')}
                  disabled={isPending}
                >
                  Volver
                </Button>
              )}
              <Button
                size="sm"
                type="button"
                variant="ghost"
                onClick={() => setEditing(true)}
                disabled={isPending}
              >
                Editar
              </Button>
            </div>
          )}
        </td>
      )}
    </tr>
  );
}

function Badge({
  label,
  count,
  tone,
}: {
  label: string;
  count: number;
  tone: 'slate' | 'emerald' | 'blue' | 'rose';
}) {
  const cls =
    tone === 'emerald'
      ? 'bg-emerald-100 text-emerald-900 border-emerald-300'
      : tone === 'blue'
        ? 'bg-blue-100 text-blue-900 border-blue-300'
        : tone === 'rose'
          ? 'bg-rose-100 text-rose-900 border-rose-300'
          : 'bg-slate-100 text-slate-800 border-slate-300';
  return (
    <span className={cn('inline-block rounded-full border px-2 py-0.5', cls)}>
      {label} · {count}
    </span>
  );
}

type CurrencyTotals = {
  currency: 'ARS' | 'USD';
  count: number;
  expense: string;
  income: string;
  net: string;
};

function computeTotalsByCurrency(lines: LineRow[]): CurrencyTotals[] {
  const buckets = new Map<'ARS' | 'USD', { count: number; expense: Decimal; income: Decimal }>();
  for (const l of lines) {
    if (l.status === 'rejected') continue;
    const ccy = l.parsedData.currencyOriginal;
    const b = buckets.get(ccy) ?? { count: 0, expense: new Decimal(0), income: new Decimal(0) };
    b.count += 1;
    const amount = new Decimal(l.parsedData.amountOriginal);
    if (l.parsedData.kind === 'expense') b.expense = b.expense.plus(amount);
    else b.income = b.income.plus(amount);
    buckets.set(ccy, b);
  }
  const out: CurrencyTotals[] = [];
  for (const ccy of ['ARS', 'USD'] as const) {
    const b = buckets.get(ccy);
    if (!b) continue;
    out.push({
      currency: ccy,
      count: b.count,
      expense: b.expense.toFixed(2),
      income: b.income.toFixed(2),
      net: b.income.minus(b.expense).toFixed(2),
    });
  }
  return out;
}

function formatAmount(amount: string, currency: 'ARS' | 'USD'): string {
  const n = Number.parseFloat(amount);
  if (!Number.isFinite(n)) return '—';
  return new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n);
}
