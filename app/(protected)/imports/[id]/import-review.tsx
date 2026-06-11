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
import { formatAccount, type AccountForDisplay } from '@/lib/accounts/format';
import { SortableHeader } from '@/components/ui/sortable-header';
import { applySortClick, type SortCriterion } from '@/lib/sorting/criteria';
import { makeReviewComparator, type ReviewSortField } from '@/lib/imports/review-sort';
import type { CategoryNode } from '@/lib/categories/tree';
import type { ParsedTxLine } from '@/lib/imports/parsers/types';
import { CounterpartyTag } from '@/components/transactions/counterparty-tag';
import { sameCounterpartyIdentity } from '@/lib/imports/counterparty-identity';
import { mergeCounterpartyLabels } from '@/lib/imports/counterparty-labels';
import { setLineStatus } from '@/app/actions/imports/set-line-status';
import { updateImportLine } from '@/app/actions/imports/update-line';
import { bulkSetCategory } from '@/app/actions/imports/bulk-set-category';
import { bulkSetCounterpartyLabel } from '@/app/actions/imports/bulk-set-counterparty-label';
import { bulkSetCurrency } from '@/app/actions/imports/bulk-set-currency';
import { bulkSetTransfer } from '@/app/actions/imports/bulk-set-transfer';
import { bulkSetDeducible } from '@/app/actions/imports/bulk-set-deducible';
import { bulkSetTags } from '@/app/actions/imports/bulk-set-tags';
import {
  findLineForecastCandidates,
  type LineForecastCandidate,
} from '@/app/actions/imports/line-forecast-candidates';
import {
  findLineTransferMatch,
  type LineTransferMatch,
} from '@/app/actions/imports/line-transfer-match';
import { resuggestPendingLines } from '@/app/actions/imports/resuggest-pending';
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

type TagOption = { id: string; name: string };

type Props = {
  importId: string;
  status: string;
  lines: LineRow[];
  tree: CategoryNode[];
  tags: TagOption[];
  /** Etiquetas de contraparte ya usadas en transacciones del household. */
  knownCounterpartyLabels: string[];
  accounts: Array<{ id: string; name: string; type: AccountForDisplay['type']; cardBrand: AccountForDisplay['cardBrand']; institutionName: string | null; currency: 'ARS' | 'USD'; institutionId: string | null; ownerTag: string; accountNumber: string | null }>;
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

const PAGE_SIZE = 50;

type FilterStatus = 'all' | 'pending' | 'accepted' | 'edited' | 'rejected';

export function ImportReview({ importId, status, lines, tree, tags, knownCounterpartyLabels, accounts, importInstitutionId, importAccountId, statementAccountRef, suggestedAccountId, pdfUrl, summary }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [confirmDone, setConfirmDone] = useState<{ count: number; autoMatchCount: number } | null>(null);
  const [sortCriteria, setSortCriteria] = useState<SortCriterion<ReviewSortField>[]>([
    { field: 'category', dir: 'asc' },
  ]);
  const handleSort = (field: ReviewSortField, additive: boolean) => {
    setSortCriteria((prev) => applySortClick(prev, field, { append: additive }));
    // Reordenar es acción explícita → descongela la lista estable.
    setPinnedIds(null);
  };
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
  const [bulkTagIds, setBulkTagIds] = useState<Set<string>>(new Set());
  const [bulkCounterpartyLabel, setBulkCounterpartyLabel] = useState('');

  // Filtros de la lista (todo client-side sobre `lines`). Con cientos de filas,
  // permiten aislar un grupo homogéneo (ej. "TRANSF MOBILE") y bulk-categorizarlo.
  const [textFilter, setTextFilter] = useState('');
  const [catFilter, setCatFilter] = useState<'all' | 'uncat' | 'categorized' | 'transfer'>('all');
  const [kindFilter, setKindFilter] = useState<'all' | 'expense' | 'income'>('all');
  const [statusFilter, setStatusFilter] = useState<FilterStatus>('all');
  const [page, setPage] = useState(0);

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

  // Etiquetas para el combobox de contraparte: historial primero (su casing es
  // el canónico), después las de este import.
  const counterpartyLabelOptions = useMemo<ComboOption[]>(
    () =>
      mergeCounterpartyLabels(
        knownCounterpartyLabels,
        lines.map((l) => l.parsedData.counterparty?.label),
      ).map((label) => ({ id: label, label })),
    [knownCounterpartyLabels, lines],
  );

  // Predicado de filtro (texto + categoría/transfer + tipo + estado). Se reusa
  // para derivar la lista en vivo y para atenuar filas que dejaron de matchear
  // cuando la lista está congelada.
  const matchesFilter = useMemo(() => {
    const q = textFilter.trim().toLowerCase();
    return (l: LineRow): boolean => {
      const p = l.parsedData;
      if (q) {
        const hay = `${p.description ?? ''} ${p.counterparty?.label ?? ''} ${p.counterparty?.name ?? ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      if (kindFilter !== 'all' && p.kind !== kindFilter) return false;
      if (statusFilter !== 'all' && l.status !== statusFilter) return false;
      if (catFilter === 'uncat' && (l.proposedCategoryId !== null || p.isTransfer)) return false;
      if (catFilter === 'categorized' && l.proposedCategoryId === null) return false;
      if (catFilter === 'transfer' && !p.isTransfer) return false;
      return true;
    };
  }, [textFilter, kindFilter, statusFilter, catFilter]);

  const filteredLines = useMemo(() => lines.filter(matchesFilter), [lines, matchesFilter]);

  const catNameById = useMemo(() => new Map(tree.map((c) => [c.id, c.name])), [tree]);
  const sortedFiltered = useMemo(
    () => [...filteredLines].sort(makeReviewComparator(sortCriteria, catNameById)),
    [filteredLines, sortCriteria, catNameById],
  );

  // Lista ESTABLE: al primer cambio (categorizar, aceptar, etc.) se congela el
  // conjunto visible (ids + orden). Las ediciones actualizan el contenido de la
  // fila in-place pero no la sacan ni reordenan — revisar en lote sin que la
  // lista "se mueva bajo los dedos". Cambiar filtro/orden o "Recargar" recomputa.
  const [pinnedIds, setPinnedIds] = useState<string[] | null>(null);
  const lineById = useMemo(() => new Map(lines.map((l) => [l.id, l])), [lines]);
  const visibleLines = useMemo(() => {
    if (pinnedIds === null) return sortedFiltered;
    return pinnedIds.map((id) => lineById.get(id)).filter((l): l is LineRow => l !== undefined);
  }, [pinnedIds, lineById, sortedFiltered]);

  /** Congela la lista visible actual antes de la primera mutación. */
  function pinList() {
    if (pinnedIds === null) setPinnedIds(sortedFiltered.map((l) => l.id));
  }

  function unpinList() {
    setPinnedIds(null);
  }

  const filtersActive =
    textFilter.trim() !== '' || catFilter !== 'all' || kindFilter !== 'all' || statusFilter !== 'all';

  // Paginación client-side: mantiene ≤PAGE_SIZE filas en el DOM (367+ filas sin lag).
  const totalPages = Math.max(1, Math.ceil(visibleLines.length / PAGE_SIZE));
  const pageClamped = Math.min(page, totalPages - 1);
  const pageLines = visibleLines.slice(pageClamped * PAGE_SIZE, pageClamped * PAGE_SIZE + PAGE_SIZE);

  // Cada cambio de filtro vuelve a la página 1 (evita quedar en una página vacía)
  // y descongela la lista (el cambio de filtro es una acción explícita del usuario).
  // Se hace en los setters (no en un effect) para no disparar renders en cascada.
  function applyTextFilter(v: string) { setTextFilter(v); setPage(0); setPinnedIds(null); }
  function applyCatFilter(v: typeof catFilter) { setCatFilter(v); setPage(0); setPinnedIds(null); }
  function applyKindFilter(v: typeof kindFilter) { setKindFilter(v); setPage(0); setPinnedIds(null); }
  function applyStatusFilter(v: FilterStatus) { setStatusFilter(v); setPage(0); setPinnedIds(null); }

  function clearFilters() {
    setTextFilter('');
    setCatFilter('all');
    setKindFilter('all');
    setStatusFilter('all');
    setPage(0);
    setPinnedIds(null);
  }

  function toggleOne(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  // Selecciona/deselecciona TODAS las filas filtradas (no solo la página visible).
  // Incluye rechazadas: hace falta poder seleccionarlas para des-rechazar en lote.
  const selectableFilteredIds = useMemo(
    () => filteredLines.filter((l) => l.transactionId === null).map((l) => l.id),
    [filteredLines],
  );
  const allFilteredSelected =
    selectableFilteredIds.length > 0 && selectableFilteredIds.every((id) => selectedIds.has(id));

  function toggleAllFiltered() {
    setSelectedIds(allFilteredSelected ? new Set() : new Set(selectableFilteredIds));
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
    pinList();
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
    pinList();
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

  function doBulkTransfer(isTransfer: boolean) {
    if (selectedIds.size === 0) {
      toast.error('No hay líneas seleccionadas');
      return;
    }
    pinList();
    startTransition(async () => {
      const res = await bulkSetTransfer({
        importId,
        lineIds: [...selectedIds],
        isTransfer,
      });
      if (res.ok) {
        toast.success(
          `${res.updated} ${res.updated === 1 ? 'línea marcada' : 'líneas marcadas'} como ${isTransfer ? 'transferencia' : 'no transferencia'}`,
        );
        setSelectedIds(new Set());
        router.refresh();
      } else {
        toast.error(`Error: ${res.error}`);
      }
    });
  }

  // Deducible Ganancias en lote (solo gastos no-transfer; el action saltea el resto).
  function doBulkDeducible(deducible: boolean) {
    if (selectedIds.size === 0) {
      toast.error('No hay líneas seleccionadas');
      return;
    }
    pinList();
    startTransition(async () => {
      const res = await bulkSetDeducible({ importId, lineIds: [...selectedIds], deducible });
      if (res.ok) {
        const skippedMsg = res.skipped > 0 ? ` · ${res.skipped} saltadas (no son gasto)` : '';
        toast.success(
          `${res.updated} ${res.updated === 1 ? 'línea' : 'líneas'} ${deducible ? 'marcadas deducible' : 'sin deducible'}${skippedMsg}`,
        );
        setSelectedIds(new Set());
        router.refresh();
      } else {
        toast.error(`Error: ${res.error}`);
      }
    });
  }

  // Tags en lote: reemplaza el set de tags de las líneas seleccionadas.
  function doBulkTags() {
    if (selectedIds.size === 0) {
      toast.error('No hay líneas seleccionadas');
      return;
    }
    if (bulkTagIds.size === 0) {
      toast.error('Elegí al menos un tag');
      return;
    }
    pinList();
    startTransition(async () => {
      const res = await bulkSetTags({ importId, lineIds: [...selectedIds], tagIds: [...bulkTagIds] });
      if (res.ok) {
        toast.success(`Tags aplicados a ${res.updated} líneas`);
        setSelectedIds(new Set());
        setBulkTagIds(new Set());
        router.refresh();
      } else {
        toast.error(`Error: ${res.error}`);
      }
    });
  }

  // Contraparte en lote: setea la etiqueta en las seleccionadas, creando
  // counterparty {label} en las que no tienen (sin inventar identificadores).
  function doBulkCounterpartyLabel() {
    if (selectedIds.size === 0) {
      toast.error('No hay líneas seleccionadas');
      return;
    }
    const label = bulkCounterpartyLabel.trim();
    if (!label) {
      toast.error('Elegí o escribí una etiqueta');
      return;
    }
    pinList();
    startTransition(async () => {
      const res = await bulkSetCounterpartyLabel({ importId, lineIds: [...selectedIds], label });
      if (res.ok) {
        toast.success(`Etiqueta aplicada a ${res.updated} líneas`);
        setSelectedIds(new Set());
        setBulkCounterpartyLabel('');
        router.refresh();
      } else {
        toast.error(`Error: ${res.error}`);
      }
    });
  }

  // Deshacer en lote: vuelve la SELECCIÓN a pendiente (aceptadas, editadas o
  // rechazadas). Sin esto, un "aceptar todas" accidental era irreversible en la
  // práctica (deshacer era clic por clic).
  function doBulkBackToPending() {
    if (selectedIds.size === 0) {
      toast.error('No hay líneas seleccionadas');
      return;
    }
    pinList();
    startTransition(async () => {
      const res = await setLineStatus({ importId, lineIds: [...selectedIds], status: 'pending' });
      if (res.ok) {
        toast.success(`${res.updated} ${res.updated === 1 ? 'línea vuelta' : 'líneas vueltas'} a pendiente`);
        setSelectedIds(new Set());
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
    pinList();
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
    pinList();
    startTransition(async () => {
      const res = await setLineStatus({ importId, lineIds: [lineId], status: next });
      if (res.ok) router.refresh();
      else toast.error(`Error: ${res.error}`);
    });
  }

  // Propagación intra-import por contraparte: tras categorizar/etiquetar una
  // línea, ofrecer aplicar lo mismo a las hermanas PENDING con la misma identidad
  // (CUIT/CBU/cuenta/alias; fallback nombre normalizado). Complemento intra-import
  // del aprendizaje inter-import de counterparty-suggest.
  function offerCategoryPropagation(sourceId: string, categoryId: string) {
    const source = lineById.get(sourceId);
    const cp = source?.parsedData.counterparty;
    if (!source || !cp) return;
    const siblings = lines.filter(
      (l) =>
        l.id !== sourceId &&
        l.status === 'pending' &&
        !l.parsedData.isTransfer &&
        l.proposedCategoryId !== categoryId &&
        l.parsedData.kind === source.parsedData.kind &&
        sameCounterpartyIdentity(cp, l.parsedData.counterparty),
    );
    if (siblings.length === 0) return;
    const catName = tree.find((c) => c.id === categoryId)?.name ?? 'la categoría';
    const who = cp.label || cp.name || 'la misma contraparte';
    toast(`Hay ${siblings.length} línea${siblings.length === 1 ? '' : 's'} más de ${who}.`, {
      duration: 12_000,
      action: {
        label: `Aplicar ${catName}`,
        onClick: () => {
          startTransition(async () => {
            const res = await bulkSetCategory({
              importId,
              lineIds: siblings.map((l) => l.id),
              categoryId,
            });
            if (res.ok) {
              toast.success(`Categoría aplicada a ${res.updated} líneas más`);
              router.refresh();
            } else {
              toast.error(`Error: ${res.error}`);
            }
          });
        },
      },
    });
  }

  function offerLabelPropagation(sourceId: string, label: string) {
    const source = lineById.get(sourceId);
    const cp = source?.parsedData.counterparty;
    if (!source || !cp || !label.trim()) return;
    const siblings = lines.filter(
      (l) =>
        l.id !== sourceId &&
        l.status === 'pending' &&
        l.parsedData.counterparty &&
        l.parsedData.counterparty.label !== label &&
        sameCounterpartyIdentity(cp, l.parsedData.counterparty),
    );
    if (siblings.length === 0) return;
    toast(`Hay ${siblings.length} línea${siblings.length === 1 ? '' : 's'} más de la misma contraparte.`, {
      duration: 12_000,
      action: {
        label: `Etiquetar "${label}"`,
        onClick: () => {
          startTransition(async () => {
            const res = await bulkSetCounterpartyLabel({
              importId,
              lineIds: siblings.map((l) => l.id),
              label,
            });
            if (res.ok) {
              toast.success(`Etiqueta aplicada a ${res.updated} líneas más`);
              router.refresh();
            } else {
              toast.error(`Error: ${res.error}`);
            }
          });
        },
      },
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

      {/* Barra de filtros: aísla un subconjunto homogéneo para revisar/categorizar. */}
      <div className="space-y-2 rounded-md border bg-muted/20 p-3">
        <div className="flex flex-wrap items-center gap-2">
          <Input
            value={textFilter}
            onChange={(e) => applyTextFilter(e.target.value)}
            placeholder="Buscar en descripción / contraparte…"
            className="h-9 w-full max-w-xs"
          />
          <span className="text-xs text-muted-foreground">
            Mostrando <span className="font-medium tabular-nums">{visibleLines.length}</span> de{' '}
            <span className="tabular-nums">{lines.length}</span>
          </span>
          {filtersActive && (
            <Button type="button" size="sm" variant="ghost" onClick={clearFilters}>
              Limpiar filtros
            </Button>
          )}
          {pinnedIds !== null && (
            <span className="flex items-center gap-2 text-xs text-muted-foreground">
              <span className="rounded-full border border-slate-300 bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-700">
                Lista congelada — tus cambios no la reordenan
              </span>
              <Button type="button" size="sm" variant="outline" onClick={unpinList}>
                Recargar lista
              </Button>
            </span>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <FilterGroup label="Categoría">
            <FilterChip active={catFilter === 'all'} onClick={() => applyCatFilter('all')}>Todas</FilterChip>
            <FilterChip active={catFilter === 'uncat'} onClick={() => applyCatFilter('uncat')}>Sin categorizar</FilterChip>
            <FilterChip active={catFilter === 'categorized'} onClick={() => applyCatFilter('categorized')}>Categorizadas</FilterChip>
            <FilterChip active={catFilter === 'transfer'} onClick={() => applyCatFilter('transfer')}>Transfers</FilterChip>
          </FilterGroup>
          <FilterGroup label="Tipo">
            <FilterChip active={kindFilter === 'all'} onClick={() => applyKindFilter('all')}>Todos</FilterChip>
            <FilterChip active={kindFilter === 'expense'} onClick={() => applyKindFilter('expense')}>Gasto</FilterChip>
            <FilterChip active={kindFilter === 'income'} onClick={() => applyKindFilter('income')}>Ingreso</FilterChip>
          </FilterGroup>
          <FilterGroup label="Estado">
            <FilterChip active={statusFilter === 'all'} onClick={() => applyStatusFilter('all')}>Todos</FilterChip>
            <FilterChip active={statusFilter === 'pending'} onClick={() => applyStatusFilter('pending')}>Pending</FilterChip>
            <FilterChip active={statusFilter === 'accepted'} onClick={() => applyStatusFilter('accepted')}>Aceptadas</FilterChip>
            <FilterChip active={statusFilter === 'edited'} onClick={() => applyStatusFilter('edited')}>Editadas</FilterChip>
            <FilterChip active={statusFilter === 'rejected'} onClick={() => applyStatusFilter('rejected')}>Rechazadas</FilterChip>
          </FilterGroup>
        </div>
        {!readOnly && selectableFilteredIds.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 border-t pt-2">
            <Button type="button" size="sm" variant="outline" onClick={toggleAllFiltered}>
              {allFilteredSelected
                ? 'Deseleccionar filtradas'
                : `Seleccionar las ${selectableFilteredIds.length} filtradas`}
            </Button>
            {filtersActive && (
              <span className="text-xs text-muted-foreground">
                Filtrá un grupo homogéneo y asignale categoría/transfer en lote desde la barra azul.
              </span>
            )}
          </div>
        )}
      </div>

      {!readOnly && (
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
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => {
              pinList();
              startTransition(async () => {
                const res = await resuggestPendingLines({ importId });
                if (res.ok) {
                  toast.success(
                    res.updated > 0
                      ? `${res.updated} de ${res.scanned} pendientes enriquecidas con el historial`
                      : 'Sin cambios — las pendientes ya estaban al día',
                  );
                  router.refresh();
                } else {
                  toast.error(`Error: ${res.error}`);
                }
              });
            }}
            disabled={isPending || lineSummary.pending === 0}
            title="Re-aplica las sugerencias aprendidas (categoría, tags, deducible, cuenta destino) solo sobre las líneas pendientes, sin pisar tus ediciones"
          >
            ↻ Re-sugerir pendientes
          </Button>
        </div>
      )}

      {/* Barra de acciones en lote: hija directa de la section (no de un div corto)
          para que `sticky` la mantenga pegada arriba mientras se scrollea la lista. */}
      {!readOnly && selectedIds.size > 0 && (
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
          <div className="flex flex-wrap items-end gap-2">
            <div className="space-y-1">
              <label className="block text-xs font-medium text-blue-900">Transferencia</label>
              <div className="flex gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => doBulkTransfer(true)}
                  disabled={isPending}
                  className="bg-background"
                >
                  Marcar transfer
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => doBulkTransfer(false)}
                  disabled={isPending}
                  className="bg-background"
                >
                  No es transfer
                </Button>
              </div>
            </div>
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <div className="space-y-1">
              <label className="block text-xs font-medium text-blue-900">Deducible</label>
              <div className="flex gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => doBulkDeducible(true)}
                  disabled={isPending}
                  className="bg-background"
                >
                  Marcar
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => doBulkDeducible(false)}
                  disabled={isPending}
                  className="bg-background"
                >
                  Quitar
                </Button>
              </div>
            </div>
          </div>
          {tags.length > 0 && (
            <div className="flex flex-wrap items-end gap-2">
              <div className="space-y-1">
                <label className="block text-xs font-medium text-blue-900">Tags</label>
                <div className="flex flex-wrap items-center gap-1">
                  {tags.map((t) => (
                    <FilterChip
                      key={t.id}
                      active={bulkTagIds.has(t.id)}
                      onClick={() =>
                        setBulkTagIds((prev) => {
                          const next = new Set(prev);
                          if (next.has(t.id)) next.delete(t.id);
                          else next.add(t.id);
                          return next;
                        })
                      }
                    >
                      {t.name}
                    </FilterChip>
                  ))}
                </div>
              </div>
              <Button
                type="button"
                size="sm"
                onClick={doBulkTags}
                disabled={isPending || bulkTagIds.size === 0}
              >
                Aplicar tags
              </Button>
            </div>
          )}
          <div className="flex flex-wrap items-end gap-2">
            <div className="space-y-1">
              <label className="block text-xs font-medium text-blue-900">Contraparte</label>
              <Combobox
                options={counterpartyLabelOptions}
                value={bulkCounterpartyLabel}
                onChange={setBulkCounterpartyLabel}
                allowFreeText
                disabled={isPending}
                placeholder="Etiqueta…"
                widthClassName="w-48"
              />
            </div>
            <Button
              type="button"
              size="sm"
              onClick={doBulkCounterpartyLabel}
              disabled={isPending || !bulkCounterpartyLabel.trim()}
            >
              Aplicar etiqueta
            </Button>
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <div className="space-y-1">
              <label className="block text-xs font-medium text-blue-900">Estado</label>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={doBulkBackToPending}
                disabled={isPending}
                className="bg-background"
              >
                Volver a pendiente
              </Button>
            </div>
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

      <div className="overflow-x-auto rounded-md border">
        <table className="w-full text-sm">
          <thead className="bg-muted/40">
            <tr className="text-left">
              {!readOnly && (
                <th className="px-2 py-2 w-8">
                  <input
                    type="checkbox"
                    aria-label="Seleccionar todas las filtradas"
                    checked={allFilteredSelected}
                    onChange={toggleAllFiltered}
                    className="size-4 rounded border-input"
                  />
                </th>
              )}
              <th className="px-2 py-2 font-medium"><SortableHeader label="Fecha" field="date" criteria={sortCriteria} onSort={handleSort} /></th>
              <th className="px-2 py-2 font-medium"><SortableHeader label="Descripción" field="description" criteria={sortCriteria} onSort={handleSort} /></th>
              <th className="px-2 py-2 font-medium">Tipo</th>
              <th className="px-2 py-2 text-right font-medium"><SortableHeader label="Monto" field="amount" criteria={sortCriteria} onSort={handleSort} /></th>
              <th className="px-2 py-2 font-medium">Mon.</th>
              <th className="px-2 py-2 font-medium"><SortableHeader label="Categoría" field="category" criteria={sortCriteria} onSort={handleSort} /></th>
              <th className="px-2 py-2 font-medium"><SortableHeader label="Estado" field="status" criteria={sortCriteria} onSort={handleSort} /></th>
              {!readOnly && <th className="px-2 py-2 font-medium">Acciones</th>}
            </tr>
          </thead>
          <tbody>
            {pageLines.map((l) => (
              <LineRowEditor
                key={l.id}
                line={l}
                importId={importId}
                tree={tree}
                tags={tags}
                accounts={accounts}
                currentAccountId={accountId}
                readOnly={readOnly}
                isPending={isPending}
                onSetStatus={doSetStatus}
                isSelected={selectedIds.has(l.id)}
                onToggleSelect={() => toggleOne(l.id)}
                onMutate={pinList}
                dimmed={pinnedIds !== null && !matchesFilter(l)}
                onCategoryApplied={offerCategoryPropagation}
                onLabelApplied={offerLabelPropagation}
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
            {lines.length > 0 && filteredLines.length === 0 && (
              <tr>
                <td
                  colSpan={readOnly ? 7 : 9}
                  className="px-3 py-6 text-center text-muted-foreground"
                >
                  Ninguna línea coincide con los filtros.{' '}
                  <button type="button" onClick={clearFilters} className="text-primary hover:underline">
                    Limpiar filtros
                  </button>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-between gap-2 text-sm">
          <span className="text-xs text-muted-foreground tabular-nums">
            {pageClamped * PAGE_SIZE + 1}–{Math.min((pageClamped + 1) * PAGE_SIZE, visibleLines.length)} de{' '}
            {visibleLines.length}
          </span>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              disabled={pageClamped === 0}
            >
              ← Anterior
            </Button>
            <span className="text-xs tabular-nums">
              Página {pageClamped + 1} / {totalPages}
            </span>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
              disabled={pageClamped >= totalPages - 1}
            >
              Siguiente →
            </Button>
          </div>
        </div>
      )}

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
                    {accountLabel(a)}
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
  tags,
  accounts,
  currentAccountId,
  readOnly,
  isPending,
  onSetStatus,
  isSelected,
  onToggleSelect,
  onMutate,
  dimmed,
  onCategoryApplied,
  onLabelApplied,
}: {
  line: LineRow;
  importId: string;
  tree: CategoryNode[];
  tags: TagOption[];
  accounts: Array<{ id: string; name: string; type: AccountForDisplay['type']; cardBrand: AccountForDisplay['cardBrand']; institutionName: string | null; currency: 'ARS' | 'USD'; institutionId: string | null; ownerTag: string }>;
  currentAccountId: string;
  readOnly: boolean;
  isPending: boolean;
  onSetStatus: (id: string, status: 'accepted' | 'rejected' | 'pending') => void;
  isSelected: boolean;
  onToggleSelect: () => void;
  /** Congela la lista estable antes de mutar (ver pinList en el padre). */
  onMutate: () => void;
  /** La fila ya no matchea el filtro pero sigue visible (lista congelada). */
  dimmed: boolean;
  /** Ofrecer propagar la categoría a líneas hermanas con la misma contraparte. */
  onCategoryApplied: (lineId: string, categoryId: string) => void;
  /** Ídem para la etiqueta de contraparte. */
  onLabelApplied: (lineId: string, label: string) => void;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<ParsedTxLine>(line.parsedData);
  const [categoryId, setCategoryId] = useState<string | null>(line.proposedCategoryId);

  // Candidatos de previsión para la línea: se buscan al abrir el editor (no por
  // fila — un import puede tener cientos). null = aún no buscados.
  const [forecastCands, setForecastCands] = useState<LineForecastCandidate[] | null>(null);
  useEffect(() => {
    if (!editing || forecastCands !== null || draft.isTransfer || !currentAccountId) return;
    let cancelled = false;
    findLineForecastCandidates({
      accountId: currentAccountId,
      date: line.parsedData.date,
      kind: line.parsedData.kind,
      amount: line.parsedData.amountOriginal,
      currency: line.parsedData.currencyOriginal,
    }).then((res) => {
      if (!cancelled) setForecastCands(res.ok ? res.candidates : []);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing]);

  // Item 14: para líneas transfer, buscar si matchea una transacción YA existente
  // (la pata del otro extracto). Si hay match, se informa y se pre-carga la cuenta
  // destino; el pareo real lo hace el match-al-confirmar (#44).
  const [transferMatch, setTransferMatch] = useState<LineTransferMatch | null | undefined>(undefined);
  useEffect(() => {
    if (!editing || transferMatch !== undefined || !draft.isTransfer || !currentAccountId) return;
    let cancelled = false;
    findLineTransferMatch({
      importAccountId: currentAccountId,
      date: line.parsedData.date,
      kind: line.parsedData.kind,
      amount: line.parsedData.amountOriginal,
      currency: line.parsedData.currencyOriginal,
    }).then((res) => {
      if (cancelled) return;
      const match = res.ok ? res.match : null;
      setTransferMatch(match);
      // Pre-cargar la cuenta destino si todavía no hay una elegida.
      if (match && !draft.transferAccountId) {
        setDraft((d) => ({ ...d, transferAccountId: match.accountId }));
      }
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing, draft.isTransfer]);

  const categoriesForKind = useMemo(
    () => tree.filter((c) => c.kind === draft.kind),
    [tree, draft.kind],
  );
  const categoryName = useMemo(() => {
    const c = tree.find((n) => n.id === (categoryId ?? line.proposedCategoryId));
    return c?.name ?? null;
  }, [tree, categoryId, line.proposedCategoryId]);

  function save() {
    // Validación temprana del sub-form doméstico (el server lo rechazaría con un
    // "invalid_input" genérico).
    if (draft.domesticService) {
      if (!draft.domesticService.empleado_nombre.trim()) {
        toast.error('Servicio doméstico: falta el nombre del empleado/a');
        return;
      }
      if (!/^\d{2}-\d{8}-\d{1}$/.test(draft.domesticService.empleado_cuil)) {
        toast.error('Servicio doméstico: CUIL inválido (formato ##-########-#)');
        return;
      }
      if (!/^\d{4}-\d{2}$/.test(draft.domesticService.periodo)) {
        toast.error('Servicio doméstico: período inválido (YYYY-MM)');
        return;
      }
    }
    onMutate();
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
        // Propagación intra-import: si cambió la categoría o la etiqueta de
        // contraparte, ofrecer aplicar a las hermanas con la misma identidad.
        if (categoryId && categoryId !== line.proposedCategoryId && !draft.isTransfer) {
          onCategoryApplied(line.id, categoryId);
        }
        const newLabel = draft.counterparty?.label?.trim();
        if (newLabel && newLabel !== line.parsedData.counterparty?.label?.trim()) {
          onLabelApplied(line.id, newLabel);
        }
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

  // Asignación rápida de categoría desde la celda, sin abrir el editor completo.
  // Reusa `bulkSetCategory` (valida kind, desmarca transfer) con un solo lineId.
  function quickCategory(catId: string) {
    setCategoryId(catId || null);
    onMutate();
    startTransition(async () => {
      const res = await bulkSetCategory({ importId, lineIds: [line.id], categoryId: catId });
      if (res.ok) {
        router.refresh();
        if (catId) onCategoryApplied(line.id, catId);
      } else {
        setCategoryId(line.proposedCategoryId);
        toast.error(`Error: ${res.error}`);
      }
    });
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
        line.status === 'rejected' && 'opacity-70',
        dimmed && 'opacity-50',
        !readOnly && !editing && 'cursor-pointer',
      )}
      onClick={(e) => {
        if (readOnly || editing) return;
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
            disabled={editing || line.transactionId !== null}
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
          {line.parsedData.isRefund && (
            <span className="inline-block rounded-full border border-emerald-300 bg-emerald-50 px-2 py-0.5 text-[10px] font-medium text-emerald-800">
              Devolución
            </span>
          )}
          {line.parsedData.deducibleGanancias && (
            <span className="inline-block rounded-full border border-violet-300 bg-violet-50 px-2 py-0.5 text-[10px] font-medium text-violet-800">
              Deducible
            </span>
          )}
          {line.parsedData.domesticService && (
            <span className="inline-block rounded-full border border-sky-300 bg-sky-50 px-2 py-0.5 text-[10px] font-medium text-sky-800">
              Doméstico
            </span>
          )}
          {line.parsedData.forecastId && (
            <span className="inline-block rounded-full border border-indigo-300 bg-indigo-50 px-2 py-0.5 text-[10px] font-medium text-indigo-800">
              Previsión
            </span>
          )}
          {(line.parsedData.tagIds ?? []).map((tid) => {
            const t = tags.find((x) => x.id === tid);
            return t ? (
              <span
                key={tid}
                className="inline-block rounded-full border border-slate-300 bg-slate-50 px-2 py-0.5 text-[10px] font-medium text-slate-700"
              >
                #{t.name}
              </span>
            ) : null;
          })}
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
            // "Sin contraparte" era engañoso: esta columna es la CUENTA PROPIA destino
            // del transfer, no la identidad de contraparte (que se ve bajo la descripción).
            <span className="text-muted-foreground">Cuenta destino sin asignar</span>
          )
        ) : readOnly || line.transactionId || editing ? (
          categoryName ?? <span className="text-muted-foreground">—</span>
        ) : (
          // Combobox inline: categorizar un gasto/ingreso suelto en un clic.
          <CategoryCombobox
            options={categoriesForKind}
            value={categoryId ?? ''}
            onChange={quickCategory}
            disabled={isPending}
            placeholder="Categoría…"
          />
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
          {line.status === 'rejected' && (
            <span className="text-[10px] leading-tight text-muted-foreground">
              {rejectReason(line)}
            </span>
          )}
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
            // Rechazada: única acción posible es recuperarla a pendiente. Editar una
            // rechazada no tiene sentido (primero se des-rechaza, después se edita) y
            // es la red de seguridad ante falsos positivos del dedup automático.
            <div className="flex flex-wrap gap-1">
              {line.status === 'rejected' ? (
                <Button
                  size="sm"
                  type="button"
                  variant="outline"
                  onClick={() => onSetStatus(line.id, 'pending')}
                  disabled={isPending}
                >
                  Des-rechazar
                </Button>
              ) : (
                <>
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
                  {line.status !== 'pending' && (
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
                </>
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
                  // Un reembolso es siempre un gasto negativo: con el checkbox tildado
                  // el Tipo queda fijo en Gasto (no se puede cambiar a Ingreso).
                  disabled={draft.isRefund}
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
              {/* Siempre visible: si la línea no tiene counterparty, al guardar se
                  crea {label} (el preprocess del schema lo omite si queda vacío). */}
              <Field label="Etiqueta contraparte" className="min-w-[180px]">
                <Input
                  value={draft.counterparty?.label ?? ''}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      counterparty: {
                        ...(draft.counterparty ?? {}),
                        label: e.target.value || undefined,
                      },
                    })
                  }
                  placeholder="ej. Niñera, Alquiler…"
                  className="h-8 w-48"
                />
              </Field>
              {/* Categoría y transfer son mutuamente excluyentes: si es transfer no se
                  muestra el selector de categoría (antes quedaba clickeable e invitaba
                  a un estado contradictorio). */}
              {!draft.isTransfer && (
                <Field label="Categoría">
                  <CategoryCombobox
                    options={categoriesForKind}
                    value={categoryId ?? ''}
                    onChange={(id) => {
                      setCategoryId(id || null);
                    }}
                    placeholder="Buscar categoría…"
                  />
                </Field>
              )}
              {draft.isTransfer && (
                <Field label="Cuenta destino (transfer)">
                  <Combobox
                    options={accounts
                      .filter((a) => a.id !== currentAccountId)
                      .map((a) => ({
                        id: a.id,
                        label: accountLabel(a),
                      }))}
                    value={draft.transferAccountId ?? ''}
                    onChange={(id) => setDraft({ ...draft, transferAccountId: id || undefined })}
                    placeholder="Buscar cuenta…"
                  />
                </Field>
              )}
            </div>
            {!draft.isTransfer && (
              <label className="flex max-w-xl items-start gap-2 rounded-md border border-emerald-200 bg-emerald-50/60 p-2 text-sm dark:border-emerald-900 dark:bg-emerald-950/30">
                <input
                  type="checkbox"
                  checked={draft.isRefund ?? false}
                  onChange={(e) => {
                    if (e.target.checked) {
                      // Un reembolso es siempre un gasto negativo → forzar Gasto y, si la
                      // categoría elegida era de ingreso, resetearla para que se re-elija.
                      setDraft({ ...draft, isRefund: true, kind: 'expense' });
                      const cat = tree.find((c) => c.id === categoryId);
                      if (cat && cat.kind !== 'expense') setCategoryId(null);
                    } else {
                      setDraft({ ...draft, isRefund: false });
                    }
                  }}
                  className="mt-0.5 size-4 rounded border-input"
                />
                <span>
                  <span className="font-medium">Es una devolución / reembolso recibido</span>
                  <span className="block text-xs text-muted-foreground">
                    Entra como gasto negativo en la misma categoría (fija el Tipo en Gasto).
                    Cargá el monto en positivo; se niega al confirmar.
                  </span>
                </span>
              </label>
            )}
            {/* Item 14: aviso de match con una transacción existente (pata del otro
                extracto ya importada). El pareo lo concreta el confirm. */}
            {draft.isTransfer && transferMatch && (
              <div className="max-w-xl rounded-md border border-emerald-300 bg-emerald-50/70 p-2 text-sm text-emerald-900">
                ✓ Matchea con una transferencia existente en{' '}
                <span className="font-medium">{transferMatch.accountLabel}</span>{' '}
                ({transferMatch.date} · {transferMatch.amountOriginal}).
                <span className="block text-xs text-emerald-800">
                  Cuenta destino pre-cargada — al confirmar, ambas patas se parean en vez de
                  duplicarse.{' '}
                  <a
                    href={`/transactions/${transferMatch.transactionId}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="underline"
                  >
                    Ver transacción ↗
                  </a>
                </span>
              </div>
            )}
            {/* Previsión: linkear la línea a un forecast pendiente (1-click, regla
                PRD §5.3). Siempre visible — el toggle de auto-match solo gobierna
                el match automático al confirmar. */}
            {!draft.isTransfer && (
              <div className="max-w-xl">
                {forecastCands === null ? (
                  <p className="text-xs text-muted-foreground">Buscando previsiones…</p>
                ) : forecastCands.length === 0 ? (
                  draft.forecastId ? null : (
                    <p className="text-xs text-muted-foreground">
                      Sin previsiones candidatas (±5 días, ±10% del monto).
                    </p>
                  )
                ) : (
                  <Field label="Linkear a previsión">
                    <div className="flex items-center gap-2">
                      <Combobox
                        options={forecastCands.map((c) => ({
                          id: c.id,
                          label: `${c.recurrenceName} · ${c.expectedDate} · ${c.currency} ${c.expectedAmount}`,
                        }))}
                        value={draft.forecastId ?? ''}
                        onChange={(id) => setDraft({ ...draft, forecastId: id || undefined })}
                        placeholder="Elegí una previsión…"
                        widthClassName="w-96"
                      />
                      {draft.forecastId && (
                        <Button
                          size="sm"
                          type="button"
                          variant="ghost"
                          onClick={() => setDraft({ ...draft, forecastId: undefined })}
                        >
                          Quitar
                        </Button>
                      )}
                    </div>
                  </Field>
                )}
              </div>
            )}
            {/* Tags: disponibles en cualquier línea — en transferencias son el
                clasificador (no llevan categoría). */}
            {tags.length > 0 && (
              <Field label="Tags">
                <div className="flex flex-wrap gap-1">
                  {tags.map((t) => {
                    const active = (draft.tagIds ?? []).includes(t.id);
                    return (
                      <FilterChip
                        key={t.id}
                        active={active}
                        onClick={() => {
                          const current = draft.tagIds ?? [];
                          setDraft({
                            ...draft,
                            tagIds: active
                              ? current.filter((id) => id !== t.id)
                              : [...current, t.id],
                          });
                        }}
                      >
                        {t.name}
                      </FilterChip>
                    );
                  })}
                </div>
              </Field>
            )}
            {!draft.isTransfer && draft.kind === 'expense' && (
              <div className="space-y-2">
                <label className="flex max-w-xl items-start gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={draft.deducibleGanancias ?? false}
                    onChange={(e) => setDraft({ ...draft, deducibleGanancias: e.target.checked })}
                    className="mt-0.5 size-4 rounded border-input"
                  />
                  <span>
                    <span className="font-medium">Deducible Ganancias</span>
                    <span className="block text-xs text-muted-foreground">
                      Entra al CSV de deducibles del export contador.
                    </span>
                  </span>
                </label>
                {!draft.isRefund && (
                  <label className="flex max-w-xl items-start gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={!!draft.domesticService}
                      onChange={(e) =>
                        setDraft({
                          ...draft,
                          domesticService: e.target.checked
                            ? {
                                empleado_nombre: draft.domesticService?.empleado_nombre ?? '',
                                empleado_cuil: draft.domesticService?.empleado_cuil ?? '',
                                concepto: draft.domesticService?.concepto ?? 'sueldo',
                                periodo: draft.domesticService?.periodo ?? draft.date.slice(0, 7),
                              }
                            : undefined,
                        })
                      }
                      className="mt-0.5 size-4 rounded border-input"
                    />
                    <span>
                      <span className="font-medium">Servicio doméstico</span>
                      <span className="block text-xs text-muted-foreground">
                        Alimenta el CSV 03 (por empleado/mes) del export contador.
                      </span>
                    </span>
                  </label>
                )}
                {draft.domesticService && (
                  <div className="flex flex-wrap items-end gap-3 rounded-md border border-sky-200 bg-sky-50/50 p-2">
                    <Field label="Empleado/a">
                      <Input
                        value={draft.domesticService.empleado_nombre}
                        onChange={(e) =>
                          setDraft({
                            ...draft,
                            domesticService: { ...draft.domesticService!, empleado_nombre: e.target.value },
                          })
                        }
                        placeholder="Nombre y apellido"
                        className="h-8 w-48"
                      />
                    </Field>
                    <Field label="CUIL">
                      <Input
                        value={draft.domesticService.empleado_cuil}
                        onChange={(e) =>
                          setDraft({
                            ...draft,
                            domesticService: { ...draft.domesticService!, empleado_cuil: e.target.value },
                          })
                        }
                        placeholder="27-12345678-9"
                        className="h-8 w-36"
                      />
                    </Field>
                    <Field label="Concepto">
                      <Select
                        value={draft.domesticService.concepto}
                        onValueChange={(v) =>
                          setDraft({
                            ...draft,
                            domesticService: {
                              ...draft.domesticService!,
                              concepto: v as 'sueldo' | 'aporte' | 'aguinaldo',
                            },
                          })
                        }
                      >
                        <SelectTrigger className="h-8 w-32">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="sueldo">Sueldo</SelectItem>
                          <SelectItem value="aporte">Aporte</SelectItem>
                          <SelectItem value="aguinaldo">Aguinaldo</SelectItem>
                        </SelectContent>
                      </Select>
                    </Field>
                    <Field label="Período">
                      <Input
                        value={draft.domesticService.periodo}
                        onChange={(e) =>
                          setDraft({
                            ...draft,
                            domesticService: { ...draft.domesticService!, periodo: e.target.value },
                          })
                        }
                        placeholder="YYYY-MM"
                        className="h-8 w-28"
                      />
                    </Field>
                  </div>
                )}
              </div>
            )}
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
                    setDraft({ ...draft, isTransfer: true, isRefund: false });
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

function FilterGroup({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-xs font-medium text-muted-foreground">{label}:</span>
      <div className="flex flex-wrap gap-1">{children}</div>
    </div>
  );
}

function FilterChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'rounded-full border px-2.5 py-0.5 text-xs transition-colors',
        active
          ? 'border-primary bg-primary text-primary-foreground'
          : 'border-input bg-background text-foreground hover:bg-accent',
      )}
    >
      {children}
    </button>
  );
}

/**
 * Motivo legible del rechazo de una línea. Las auto-rechazadas por dedup llevan
 * el marcador `[DUPLICADA]` en `parsedData.notes` (parse-internal); el resto
 * fueron rechazadas a mano por el usuario.
 */
function rejectReason(line: LineRow): string {
  if (line.parsedData.notes?.includes('[DUPLICADA]')) {
    return 'Auto: duplicada — ya existía como transacción. No requiere acción.';
  }
  return 'Rechazada por vos.';
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
  allowFreeText = false,
}: {
  options: ComboOption[];
  value: string;
  onChange: (id: string) => void;
  disabled?: boolean;
  placeholder?: string;
  widthClassName?: string;
  /** Permite confirmar el texto buscado como valor aunque no sea una opción. */
  allowFreeText?: boolean;
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
        <span className={cn('truncate', selected || (allowFreeText && value) ? '' : 'text-muted-foreground')}>
          {selected
            ? (selected.indent ? `↳ ${selected.label}` : selected.label)
            : (allowFreeText && value ? value : (placeholder ?? 'Elegí…'))}
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
            {allowFreeText &&
              search.trim() !== '' &&
              !options.some((o) => o.label.toLowerCase() === search.trim().toLowerCase()) && (
                <button
                  type="button"
                  onClick={() => { onChange(search.trim()); setOpen(false); setSearch(''); }}
                  className="flex w-full items-center rounded px-2 py-1.5 text-left text-sm hover:bg-accent"
                >
                  Usar «{search.trim()}»
                </button>
              )}
            {filtered.length === 0 && !(allowFreeText && search.trim() !== '') && (
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

/** Nombre legible de una cuenta (el shape de review usa `currency`, no `currencyDefault`). */
function accountLabel(a: {
  institutionName: string | null;
  type: AccountForDisplay['type'];
  cardBrand: AccountForDisplay['cardBrand'];
  name: string;
  ownerTag: string;
  currency: 'ARS' | 'USD';
}): string {
  return formatAccount({
    institutionName: a.institutionName,
    type: a.type,
    cardBrand: a.cardBrand,
    name: a.name,
    ownerTag: a.ownerTag,
    currency: a.currency,
  });
}
