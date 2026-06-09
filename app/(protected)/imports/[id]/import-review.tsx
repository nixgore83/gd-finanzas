'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState, useTransition, type ReactNode } from 'react';
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
import { SortableHeader } from '@/components/ui/sortable-header';
import type { CategoryNode } from '@/lib/categories/tree';
import type { ParsedTxLine } from '@/lib/imports/parsers/types';
import { CounterpartyTag } from '@/components/transactions/counterparty-tag';
import { setLineStatus } from '@/app/actions/imports/set-line-status';
import { updateImportLine } from '@/app/actions/imports/update-line';
import { bulkSetCategory } from '@/app/actions/imports/bulk-set-category';
import { bulkSetCurrency } from '@/app/actions/imports/bulk-set-currency';
import { learnAccountNumber } from '@/app/actions/imports/learn-account-number';
import { confirmImport } from '@/app/actions/imports/confirm';

type LineRow = {
  id: string;
  parsedData: ParsedTxLine;
  proposedCategoryId: string | null;
  status: 'pending' | 'accepted' | 'rejected' | 'edited';
  transactionId: string | null;
};

type ImportSummary = {
  totalExpense?: string;
  totalIncome?: string;
  currency?: string;
} | null;

type Props = {
  importId: string;
  status: string;
  lines: LineRow[];
  tree: CategoryNode[];
  accounts: Array<{ id: string; name: string; currency: 'ARS' | 'USD'; institutionId: string | null; ownerTag: string; accountNumber: string | null }>;
  importInstitutionId: string | null;
  importAccountId: string | null;
  /** Nº de cuenta propia del extracto extraído por el parser (encabezado). */
  statementAccountRef: string | null;
  /** ID de la cuenta que matchea statementAccountRef (ya aprendida), si la hay. */
  suggestedAccountId: string | null;
  pdfUrl: string | null;
  summary: ImportSummary;
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

export function ImportReview({ importId, status, lines, tree, accounts, importInstitutionId, importAccountId, statementAccountRef, suggestedAccountId, pdfUrl, summary }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [confirmDone, setConfirmDone] = useState<{ count: number; autoMatchCount: number } | null>(null);
  const [sortField, setSortField] = useState<string>('category');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const handleSort = (field: string, dir: 'asc' | 'desc') => { setSortField(field); setSortDir(dir); };
  // Preferencia de cuenta destino: cuenta sugerida por nº de extracto > la del
  // import > la de la institución > la primera.
  const defaultAccount = (suggestedAccountId
    ? accounts.find((a) => a.id === suggestedAccountId)
    : null) ?? (importAccountId
    ? accounts.find((a) => a.id === importAccountId)
    : null) ?? (importInstitutionId
    ? accounts.find((a) => a.institutionId === importInstitutionId)
    : null) ?? accounts[0];
  const [accountId, setAccountId] = useState<string>(defaultAccount?.id ?? '');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkCategoryId, setBulkCategoryId] = useState<string>('');
  const [bulkCurrency, setBulkCurrency] = useState<'ARS' | 'USD' | ''>('');

  const lineSummary = useMemo(() => {
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

  function doBulkCurrency() {
    if (selectedIds.size === 0) {
      toast.error('No hay líneas seleccionadas');
      return;
    }
    if (!bulkCurrency) {
      toast.error('Elegí una moneda');
      return;
    }
    startTransition(async () => {
      const res = await bulkSetCurrency({
        importId,
        lineIds: [...selectedIds],
        currency: bulkCurrency,
      });
      if (res.ok) {
        toast.success(`Moneda ${bulkCurrency} asignada a ${res.updated} líneas`);
        setSelectedIds(new Set());
        setBulkCurrency('');
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
    const hasToConfirm = lineSummary.accepted + lineSummary.edited > 0;
    if (hasToConfirm && !accountId) {
      toast.error('Elegí una cuenta destino');
      return;
    }
    if (!hasToConfirm && lineSummary.pending > 0) {
      toast.error('No hay líneas aceptadas para confirmar');
      return;
    }
    startTransition(async () => {
      const res = await confirmImport({ importId, accountId });
      if (res.ok) {
        const matchMsg = res.autoMatchCount > 0
          ? ` · ${res.autoMatchCount} linkeadas con previsiones`
          : '';
        if (res.rejectedCount > 0) {
          toast.warning(
            `${res.createdCount} confirmadas${matchMsg} · ${res.rejectedCount} con error (ver detalle abajo)`,
          );
          router.refresh();
        } else {
          setConfirmDone({ count: res.createdCount, autoMatchCount: res.autoMatchCount });
          router.refresh();
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
          <Badge label="Pending" count={lineSummary.pending} tone="slate" />
          <Badge label="Aceptadas" count={lineSummary.accepted} tone="emerald" />
          <Badge label="Editadas" count={lineSummary.edited} tone="blue" />
          <Badge label="Rechazadas" count={lineSummary.rejected} tone="rose" />
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
              disabled={isPending || lineSummary.pending === 0}
            >
              Aceptar todas las pending
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => doBulk('rejected')}
              disabled={isPending || lineSummary.pending === 0}
            >
              Rechazar todas las pending
            </Button>
          </div>

          {selectedIds.size > 0 && (
            <div className="sticky top-0 z-30 flex flex-wrap items-end gap-3 rounded-md border border-blue-300 bg-blue-50 p-3 shadow-sm">
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
              <div className="flex flex-wrap items-end gap-2">
                <CategoryCombobox
                  options={bulkCategoryOptions}
                  value={bulkCategoryId}
                  onChange={setBulkCategoryId}
                  disabled={uniformKind === null || isPending}
                  placeholder="Buscar categoría…"
                />
                <Button
                  type="button"
                  size="sm"
                  onClick={doBulkCategory}
                  disabled={isPending || !bulkCategoryId || uniformKind === null}
                >
                  Aplicar categoría
                </Button>
              </div>
              <div className="flex flex-wrap items-end gap-2">
                <div className="space-y-1">
                  <label className="block text-xs font-medium text-blue-900">Moneda</label>
                  <Select
                    value={bulkCurrency}
                    onValueChange={(v) => setBulkCurrency(v as 'ARS' | 'USD')}
                  >
                    <SelectTrigger className="h-9 w-24 bg-background">
                      <SelectValue placeholder="—" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="ARS">ARS</SelectItem>
                      <SelectItem value="USD">USD</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <Button
                  type="button"
                  size="sm"
                  onClick={doBulkCurrency}
                  disabled={isPending || !bulkCurrency}
                >
                  Aplicar moneda
                </Button>
              </div>
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

      <div className="max-h-[75vh] overflow-auto rounded-md border">
        <table className="w-full text-sm">
          <thead className="sticky top-0 z-10 bg-muted">
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
              <th className="px-2 py-2 font-medium"><SortableHeader label="Fecha" field="date" currentSort={sortField} currentDir={sortDir} onSort={handleSort} /></th>
              <th className="px-2 py-2 font-medium"><SortableHeader label="Descripción" field="description" currentSort={sortField} currentDir={sortDir} onSort={handleSort} /></th>
              <th className="px-2 py-2 font-medium">Tipo</th>
              <th className="px-2 py-2 text-right font-medium"><SortableHeader label="Monto" field="amount" currentSort={sortField} currentDir={sortDir} onSort={handleSort} /></th>
              <th className="px-2 py-2 font-medium">Mon.</th>
              <th className="px-2 py-2 font-medium"><SortableHeader label="Categoría" field="category" currentSort={sortField} currentDir={sortDir} onSort={handleSort} /></th>
              <th className="px-2 py-2 font-medium"><SortableHeader label="Estado" field="status" currentSort={sortField} currentDir={sortDir} onSort={handleSort} /></th>
              {!readOnly && <th className="px-2 py-2 font-medium">Acciones</th>}
            </tr>
          </thead>
          <tbody>
            {[...lines].sort((a, b) => {
              const aP = a.parsedData as ParsedTxLine;
              const bP = b.parsedData as ParsedTxLine;
              const catMap = new Map(tree.map((c) => [c.id, c.name]));
              let cmp = 0;
              switch (sortField) {
                case 'date': cmp = (aP.date ?? '').localeCompare(bP.date ?? ''); break;
                case 'description': cmp = (aP.description ?? '').localeCompare(bP.description ?? '', 'es'); break;
                case 'amount': cmp = parseFloat(aP.amountOriginal ?? '0') - parseFloat(bP.amountOriginal ?? '0'); break;
                case 'status': cmp = (a.status ?? '').localeCompare(b.status ?? ''); break;
                case 'category': {
                  const aCat = a.proposedCategoryId ? (catMap.get(a.proposedCategoryId) ?? '') : '';
                  const bCat = b.proposedCategoryId ? (catMap.get(b.proposedCategoryId) ?? '') : '';
                  // Sin categoría siempre arriba
                  if (!aCat && bCat) return -1;
                  if (aCat && !bCat) return 1;
                  cmp = aCat.localeCompare(bCat, 'es');
                  break;
                }
                default: cmp = 0;
              }
              return sortDir === 'desc' ? -cmp : cmp;
            }).map((l) => (
              <LineRowEditor
                key={l.id}
                line={l}
                importId={importId}
                tree={tree}
                accounts={accounts}
                currentAccountId={accountId}
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
          <div className="mb-2 flex items-center justify-between">
            <p className="text-xs font-medium text-muted-foreground">
              Totales extraídos (excluye rechazadas)
            </p>
            {pdfUrl && (
              <a
                href={pdfUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs font-medium text-primary hover:underline"
              >
                Abrir PDF para verificar ↗
              </a>
            )}
          </div>
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

          {/* Summary validation: compare extracted lines vs PDF subtotals */}
          {summary && (summary.totalExpense || summary.totalIncome) ? (
            <SummaryValidation totals={totals} summary={summary} />
          ) : (
            <p className="mt-2 text-xs text-muted-foreground">
              Subtotales del resumen no disponibles — re-parseá para extraerlos o verificá manualmente.
            </p>
          )}
        </div>
      )}

      {!readOnly && (
        <div className="space-y-3 rounded-md border bg-card p-4">
          {lineSummary.pending > 0 && (
            <div className="flex gap-2">
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => doBulk('accepted')}
                disabled={isPending}
              >
                Aceptar todas las pending ({lineSummary.pending})
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => doBulk('rejected')}
                disabled={isPending}
              >
                Rechazar todas las pending
              </Button>
            </div>
          )}
          <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="space-y-1.5">
            <label className="text-sm font-medium" htmlFor="accountId">
              Cuenta destino (común a todas las líneas)
            </label>
            <Select
              value={accountId}
              onValueChange={(v) => {
                setAccountId(v);
                // Si el extracto trae un nº no reconocido, lo "aprendemos" en la
                // cuenta elegida para auto-sugerirla en imports futuros.
                if (statementAccountRef && !suggestedAccountId && v) {
                  startTransition(async () => {
                    const res = await learnAccountNumber({
                      accountId: v,
                      accountNumber: statementAccountRef,
                      importId,
                    });
                    if (res.ok && res.updated) {
                      toast.success(
                        `Nº ${statementAccountRef} guardado en la cuenta — la próxima se sugiere sola`,
                      );
                      router.refresh();
                    }
                  });
                }
              }}
            >
              <SelectTrigger id="accountId" className="w-72">
                <SelectValue placeholder="Elegí una cuenta" />
              </SelectTrigger>
              <SelectContent>
                {accounts.map((a) => (
                  <SelectItem key={a.id} value={a.id}>
                    {a.name} ({a.ownerTag}) · {a.currency}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {statementAccountRef &&
              (suggestedAccountId ? (
                <p className="text-xs text-emerald-700">
                  ✓ Cuenta sugerida por el Nº <span className="font-mono">{statementAccountRef}</span> del extracto.
                </p>
              ) : (
                <p className="text-xs text-amber-700">
                  Extracto de la cuenta Nº <span className="font-mono">{statementAccountRef}</span> (no reconocido).
                  Al elegir la cuenta correcta, guardamos el número para sugerirla sola la próxima vez.
                </p>
              ))}
          </div>
          <Button
            type="button"
            onClick={doConfirm}
            disabled={isPending || (lineSummary.accepted + lineSummary.edited === 0 && lineSummary.pending > 0)}
          >
            {lineSummary.accepted + lineSummary.edited === 0
              ? 'Confirmar import'
              : `Confirmar import (${lineSummary.accepted + lineSummary.edited})`}
          </Button>
          </div>
        </div>
      )}

      {confirmDone && (
        <div className="rounded-md border border-emerald-300 bg-emerald-50 p-4 text-sm text-emerald-900 dark:border-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-200">
          <p className="font-medium">
            Import confirmado — {confirmDone.count} transacciones creadas
            {confirmDone.autoMatchCount > 0 && (
              <> · {confirmDone.autoMatchCount} linkeadas con previsiones</>
            )}
          </p>
          <div className="mt-3 flex gap-3">
            <Button variant="outline" size="sm" onClick={() => router.push('/transactions')}>
              Ver transacciones
            </Button>
            <Button variant="outline" size="sm" onClick={() => router.push('/imports')}>
              Importados
            </Button>
            <Button variant="outline" size="sm" onClick={() => router.push('/imports/new')}>
              Importar otro archivo
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}

function LineRowEditor({
  line,
  importId,
  tree,
  accounts,
  currentAccountId,
  readOnly,
  isPending,
  onSetStatus,
  isSelected,
  onToggleSelect,
}: {
  line: LineRow;
  importId: string;
  tree: CategoryNode[];
  accounts: Array<{ id: string; name: string; currency: 'ARS' | 'USD'; institutionId: string | null; ownerTag: string }>;
  currentAccountId: string;
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

  function cancelEdit() {
    setEditing(false);
    setDraft(line.parsedData);
    setCategoryId(line.proposedCategoryId);
  }

  const colCount = readOnly ? 7 : 9;
  const counterpart = accounts.find((a) => a.id === line.parsedData.transferAccountId);

  return (
    <>
    <tr
      className={cn(
        'border-t align-top',
        isSelected && !readOnly && 'bg-blue-50/50',
        editing && !readOnly && 'bg-blue-50/40',
        !readOnly && !editing && line.status !== 'rejected' && 'cursor-pointer',
      )}
      onClick={(e) => {
        if (readOnly || editing || line.status === 'rejected') return;
        const tag = (e.target as HTMLElement).closest('button, input, select, a, [role="combobox"]');
        if (tag) return;
        onToggleSelect();
      }}
    >
      {!readOnly && (
        <td className="px-2 py-1.5">
          <input
            type="checkbox"
            aria-label="Seleccionar línea"
            checked={isSelected}
            onChange={onToggleSelect}
            disabled={line.status === 'rejected' || editing}
            className="size-4 rounded border-input"
          />
        </td>
      )}
      <td className="px-2 py-1.5 tabular-nums">{line.parsedData.date}</td>
      <td className="px-2 py-1.5">
        {line.parsedData.description}
        <CounterpartyTag counterparty={line.parsedData.counterparty} className="mt-0.5" />
      </td>
      <td className="px-2 py-1.5">
        <div className="flex flex-wrap items-center gap-1">
          {line.parsedData.kind === 'expense' ? (
            <span className="text-[color:var(--bad)]">Gasto</span>
          ) : (
            <span className="text-[color:var(--good)]">Ingreso</span>
          )}
          {line.parsedData.isTransfer && (
            <span className="inline-block rounded-full border border-amber-300 bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-900">
              Transfer
            </span>
          )}
        </div>
      </td>
      <td className="px-2 py-1.5 text-right tabular-nums">
        <span className={line.parsedData.kind === 'income' ? 'text-[color:var(--good)]' : 'text-[color:var(--bad)]'}>
          {line.parsedData.amountOriginal}
        </span>
      </td>
      <td className="px-2 py-1.5">{line.parsedData.currencyOriginal}</td>
      <td className="px-2 py-1.5">
        {line.parsedData.isTransfer ? (
          counterpart ? (
            <span className="text-amber-800">
              {counterpart.name} ({counterpart.ownerTag})
            </span>
          ) : (
            <span className="text-muted-foreground">Sin contraparte</span>
          )
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
            <span className="text-xs font-medium text-blue-700">✎ editando ↓</span>
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
                <>
                  <Button
                    size="sm"
                    type="button"
                    variant="outline"
                    onClick={() => onSetStatus(line.id, 'rejected')}
                    disabled={isPending}
                  >
                    ✕
                  </Button>
                  <Button
                    size="sm"
                    type="button"
                    variant="outline"
                    onClick={() => onSetStatus(line.id, 'pending')}
                    disabled={isPending}
                  >
                    Volver
                  </Button>
                </>
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
              {!line.parsedData.isTransfer && (
                <Button
                  size="sm"
                  type="button"
                  variant="ghost"
                  onClick={() => {
                    setDraft({ ...line.parsedData, isTransfer: true });
                    setCategoryId(null);
                    setEditing(true);
                  }}
                  disabled={isPending}
                  className="text-amber-700"
                >
                  ⇄ Transfer
                </Button>
              )}
            </div>
          )}
        </td>
      )}
    </tr>
    {editing && !readOnly && (
      <tr className="border-t bg-blue-50/40">
        <td colSpan={colCount} className="px-3 py-3">
          <div className="space-y-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-blue-900">
              Editando línea
            </p>
            <div className="flex flex-wrap items-end gap-3">
              <Field label="Fecha">
                <Input
                  value={draft.date}
                  onChange={(e) => setDraft({ ...draft, date: e.target.value })}
                  className="h-8 w-32"
                />
              </Field>
              <Field label="Tipo">
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
              </Field>
              <Field label="Monto">
                <Input
                  value={draft.amountOriginal}
                  onChange={(e) => setDraft({ ...draft, amountOriginal: e.target.value })}
                  className="h-8 w-32 text-right"
                />
              </Field>
              <Field label="Moneda">
                <Select
                  value={draft.currencyOriginal}
                  onValueChange={(v) => setDraft({ ...draft, currencyOriginal: v as 'ARS' | 'USD' })}
                >
                  <SelectTrigger className="h-8 w-20">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ARS">ARS</SelectItem>
                    <SelectItem value="USD">USD</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
            </div>
            <div className="flex flex-wrap items-end gap-3">
              <Field label="Descripción" className="min-w-[240px] flex-1">
                <Input
                  value={draft.description}
                  onChange={(e) => setDraft({ ...draft, description: e.target.value })}
                  className="h-8 w-full"
                />
              </Field>
              {draft.counterparty && (
                <Field label="Etiqueta contraparte" className="min-w-[180px]">
                  <Input
                    value={draft.counterparty.label ?? ''}
                    onChange={(e) =>
                      setDraft({
                        ...draft,
                        counterparty: { ...draft.counterparty, label: e.target.value || undefined },
                      })
                    }
                    placeholder="ej. Niñera, Alquiler…"
                    className="h-8 w-48"
                  />
                </Field>
              )}
              <Field label="Categoría">
                <CategoryCombobox
                  options={categoriesForKind}
                  value={categoryId ?? ''}
                  onChange={(id) => {
                    setCategoryId(id || null);
                    // Asignar categoría desmarca la transferencia (mutuamente excluyentes).
                    if (id && draft.isTransfer) {
                      setDraft({ ...draft, isTransfer: false, transferAccountId: undefined });
                    }
                  }}
                  placeholder="Buscar categoría…"
                />
              </Field>
              {draft.isTransfer && (
                <Field label="Cuenta contraparte">
                  <Combobox
                    options={accounts
                      .filter((a) => a.id !== currentAccountId)
                      .map((a) => ({
                        id: a.id,
                        label: `${a.name} (${a.ownerTag}) · ${a.currency}`,
                      }))}
                    value={draft.transferAccountId ?? ''}
                    onChange={(id) => setDraft({ ...draft, transferAccountId: id || undefined })}
                    placeholder="Buscar cuenta…"
                  />
                </Field>
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" type="button" onClick={save} disabled={isPending}>
                Guardar
              </Button>
              <Button size="sm" type="button" variant="outline" onClick={cancelEdit} disabled={isPending}>
                Cancelar
              </Button>
              {draft.isTransfer ? (
                <Button
                  size="sm"
                  type="button"
                  variant="ghost"
                  onClick={() => setDraft({ ...draft, isTransfer: false, transferAccountId: undefined })}
                  className="text-amber-700"
                >
                  No es transfer
                </Button>
              ) : (
                <Button
                  size="sm"
                  type="button"
                  variant="ghost"
                  onClick={() => {
                    setDraft({ ...draft, isTransfer: true });
                    setCategoryId(null);
                  }}
                  className="text-amber-700"
                >
                  ⇄ Marcar como transfer
                </Button>
              )}
            </div>
          </div>
        </td>
      </tr>
    )}
    </>
  );
}

function Field({
  label,
  className,
  children,
}: {
  label: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={cn('space-y-1', className)}>
      <label className="block text-xs font-medium text-muted-foreground">{label}</label>
      {children}
    </div>
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

type ComboOption = { id: string; label: string; indent?: boolean };

/**
 * Combobox genérico con búsqueda (type-ahead) + cierre por click-outside.
 * Reusado por el selector masivo y los selectores inline (categoría, contraparte).
 */
function Combobox({
  options,
  value,
  onChange,
  disabled,
  placeholder,
  widthClassName = 'w-64',
}: {
  options: ComboOption[];
  value: string;
  onChange: (id: string) => void;
  disabled?: boolean;
  placeholder?: string;
  widthClassName?: string;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const ref = useRef<HTMLDivElement>(null);

  const selected = options.find((o) => o.id === value);

  const filtered = useMemo(() => {
    if (!search) return options;
    const q = search.toLowerCase();
    return options.filter((o) => o.label.toLowerCase().includes(q));
  }, [options, search]);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  return (
    <div ref={ref} className={cn('relative', widthClassName)}>
      <button
        type="button"
        onClick={() => { if (!disabled) setOpen(!open); }}
        disabled={disabled}
        className={cn(
          'flex h-9 w-full items-center justify-between rounded-md border bg-transparent px-3 py-2 text-sm',
          'border-input ring-offset-background',
          disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer',
        )}
      >
        <span className={cn('truncate', selected ? '' : 'text-muted-foreground')}>
          {selected ? (selected.indent ? `↳ ${selected.label}` : selected.label) : (placeholder ?? 'Elegí…')}
        </span>
        <svg className="ml-1 h-4 w-4 shrink-0 opacity-50" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="m6 9 6 6 6-6"/></svg>
      </button>
      {open && (
        <div className="absolute z-50 mt-1 w-full rounded-md border bg-popover shadow-md">
          <div className="p-1.5">
            <input
              autoFocus
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar…"
              className="h-8 w-full rounded border-0 bg-transparent px-2 text-sm outline-none ring-1 ring-input focus:ring-primary"
            />
          </div>
          <div className="max-h-56 overflow-y-auto p-1">
            {filtered.length === 0 && (
              <p className="px-2 py-1.5 text-sm text-muted-foreground">Sin resultados</p>
            )}
            {filtered.map((o) => (
              <button
                key={o.id}
                type="button"
                onClick={() => { onChange(o.id); setOpen(false); setSearch(''); }}
                className={cn(
                  'flex w-full items-center rounded px-2 py-1.5 text-left text-sm hover:bg-accent',
                  o.id === value && 'bg-accent font-medium',
                )}
              >
                {o.indent ? <span className="mr-1 text-muted-foreground">↳</span> : null}
                {o.label}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function CategoryCombobox({
  options,
  value,
  onChange,
  disabled,
  placeholder,
}: {
  options: CategoryNode[];
  value: string;
  onChange: (id: string) => void;
  disabled?: boolean;
  placeholder?: string;
}) {
  const comboOptions = useMemo<ComboOption[]>(
    () => options.map((c) => ({ id: c.id, label: c.name, indent: c.depth === 1 })),
    [options],
  );
  return (
    <Combobox
      options={comboOptions}
      value={value}
      onChange={onChange}
      disabled={disabled}
      placeholder={placeholder ?? 'Elegí categoría'}
    />
  );
}

function SummaryValidation({
  totals,
  summary,
}: {
  totals: CurrencyTotals[];
  summary: NonNullable<ImportSummary>;
}) {
  const summaryCcy = summary.currency ?? 'ARS';
  const matchingTotal = totals.find((t) => t.currency === summaryCcy);

  const extractedExpense = matchingTotal ? Number.parseFloat(matchingTotal.expense) : 0;
  const extractedIncome = matchingTotal ? Number.parseFloat(matchingTotal.income) : 0;
  const pdfExpense = summary.totalExpense ? Number.parseFloat(summary.totalExpense) : null;
  const pdfIncome = summary.totalIncome ? Number.parseFloat(summary.totalIncome) : null;

  const expenseDelta = pdfExpense !== null ? extractedExpense - pdfExpense : null;
  const incomeDelta = pdfIncome !== null ? extractedIncome - pdfIncome : null;

  const expenseOk = expenseDelta !== null && pdfExpense !== null
    ? Math.abs(expenseDelta) < Math.max(pdfExpense * 0.01, 1)
    : null;
  const incomeOk = incomeDelta !== null && pdfIncome !== null
    ? Math.abs(incomeDelta) < Math.max(pdfIncome * 0.01, 1)
    : null;

  const allOk = (expenseOk === null || expenseOk) && (incomeOk === null || incomeOk);

  return (
    <div className={cn(
      'mt-3 rounded border p-3 text-sm',
      allOk
        ? 'border-emerald-300 bg-emerald-50 text-emerald-900 dark:border-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-200'
        : 'border-rose-300 bg-rose-50 text-rose-900 dark:border-rose-700 dark:bg-rose-950/30 dark:text-rose-200',
    )}>
      <p className="mb-2 font-medium">
        {allOk ? '✓ Totales coinciden con el resumen' : '✕ Diferencia detectada vs resumen'}
      </p>
      <div className="grid grid-cols-1 gap-1 text-xs md:grid-cols-2">
        {pdfExpense !== null && (
          <div className="flex items-center gap-2">
            <span className={expenseOk ? '' : 'font-semibold'}>
              Gastos: extraído {formatAmount(String(extractedExpense), summaryCcy as 'ARS' | 'USD')}
              {' · resumen dice '}
              {formatAmount(String(pdfExpense), summaryCcy as 'ARS' | 'USD')}
              {expenseDelta !== null && Math.abs(expenseDelta) >= 0.01 && (
                <span className={expenseOk ? '' : 'font-bold'}>
                  {' · Δ '}{expenseDelta > 0 ? '+' : ''}{formatAmount(String(expenseDelta), summaryCcy as 'ARS' | 'USD')}
                </span>
              )}
            </span>
          </div>
        )}
        {pdfIncome !== null && (
          <div className="flex items-center gap-2">
            <span className={incomeOk ? '' : 'font-semibold'}>
              Ingresos: extraído {formatAmount(String(extractedIncome), summaryCcy as 'ARS' | 'USD')}
              {' · resumen dice '}
              {formatAmount(String(pdfIncome), summaryCcy as 'ARS' | 'USD')}
              {incomeDelta !== null && Math.abs(incomeDelta) >= 0.01 && (
                <span className={incomeOk ? '' : 'font-bold'}>
                  {' · Δ '}{incomeDelta > 0 ? '+' : ''}{formatAmount(String(incomeDelta), summaryCcy as 'ARS' | 'USD')}
                </span>
              )}
            </span>
          </div>
        )}
      </div>
    </div>
  );
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
