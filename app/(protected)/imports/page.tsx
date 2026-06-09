import Link from 'next/link';
import { redirect } from 'next/navigation';
import { and, asc, count, desc, eq, gte, ilike, inArray, lte, or, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import { getDb } from '@/lib/db/client';
import { accounts, imports, institutions } from '@/db/schema';
import { requireHouseholdSession, SessionError } from '@/lib/auth/session';
import { IMPORT_TYPES, IMPORT_TYPE_LABELS } from '@/lib/schemas/import';
import {
  IMPORT_VIEWS,
  IMPORT_VIEW_LABELS,
  viewToStatuses,
  type ImportView,
} from '@/lib/imports/list-filters';
import { detectImportGaps } from '@/lib/imports/detect-gaps';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label as FormLabel } from '@/components/ui/label';
import { Display, Label, Num, Hair, Body } from '@/components/ui/typography';
import { cn } from '@/lib/utils';
import { ImportsTable, type ImportRow } from './imports-table';

export const metadata = { title: 'Imports · gd-finanzas' };

const PAGE_LIMIT = 50;
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

type Filters = {
  view: ImportView;
  type: 'tc' | 'banco' | 'broker' | undefined;
  institutionId: string | undefined;
  accountId: string | undefined;
  from: string | undefined;
  to: string | undefined;
  q: string | undefined;
  sort: 'created' | 'account' | 'period' | 'status' | 'txns';
  dir: 'asc' | 'desc';
  page: number;
};

function parseFilters(sp: Record<string, string | string[] | undefined>): Filters {
  const get = (k: string): string | undefined => {
    const v = sp[k];
    return typeof v === 'string' && v.length > 0 ? v : undefined;
  };

  const view = z.enum(IMPORT_VIEWS).safeParse(get('view'));
  const type = z.enum(IMPORT_TYPES).safeParse(get('type'));
  const institutionId = z.string().uuid().safeParse(get('institutionId'));
  const accountId = z.string().uuid().safeParse(get('accountId'));
  const from = z.string().regex(ISO_DATE_RE).safeParse(get('from'));
  const to = z.string().regex(ISO_DATE_RE).safeParse(get('to'));
  const q = z.string().trim().min(1).max(200).safeParse(get('q'));
  const sort = z.enum(['created', 'account', 'period', 'status', 'txns']).safeParse(get('sort'));
  const dir = z.enum(['asc', 'desc']).safeParse(get('dir'));
  const page = z.coerce.number().int().positive().safeParse(get('page'));

  return {
    // Default: la vista "para revisar" (los que esperan acción del usuario).
    view: view.success ? view.data : 'review',
    type: type.success ? type.data : undefined,
    institutionId: institutionId.success ? institutionId.data : undefined,
    accountId: accountId.success ? accountId.data : undefined,
    from: from.success ? from.data : undefined,
    to: to.success ? to.data : undefined,
    q: q.success ? q.data : undefined,
    sort: sort.success ? sort.data : 'created',
    dir: dir.success ? dir.data : 'desc',
    page: page.success ? page.data : 1,
  };
}

function buildHref(filters: Filters, pageOverride: number): string {
  const sp = new URLSearchParams();
  // 'review' es el default (URL sin ?view); cualquier otra vista va explícita.
  if (filters.view !== 'review') sp.set('view', filters.view);
  if (filters.type) sp.set('type', filters.type);
  if (filters.institutionId) sp.set('institutionId', filters.institutionId);
  if (filters.accountId) sp.set('accountId', filters.accountId);
  if (filters.from) sp.set('from', filters.from);
  if (filters.to) sp.set('to', filters.to);
  if (filters.q) sp.set('q', filters.q);
  if (filters.sort !== 'created') sp.set('sort', filters.sort);
  if (filters.dir !== 'desc') sp.set('dir', filters.dir);
  if (pageOverride > 1) sp.set('page', String(pageOverride));
  const qs = sp.toString();
  return qs.length > 0 ? `/imports?${qs}` : '/imports';
}

function viewHref(filters: Filters, view: ImportView): string {
  // Cambiar de tab resetea la paginación pero conserva el resto de los filtros.
  return buildHref({ ...filters, view, page: 1 }, 1);
}

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function ImportsListPage({ searchParams }: { searchParams: SearchParams }) {
  let session;
  try {
    session = await requireHouseholdSession();
  } catch (err) {
    if (err instanceof SessionError) redirect('/login');
    throw err;
  }

  const sp = await searchParams;
  const filters = parseFilters(sp);
  const db = getDb();
  const householdId = session.householdId;

  // ===== Conteos por tab (sin filtros, solo household) =====
  const statusCountRows = await db
    .select({ status: imports.status, c: count() })
    .from(imports)
    .where(eq(imports.householdId, householdId))
    .groupBy(imports.status);
  const byStatus = new Map(statusCountRows.map((r) => [r.status, Number(r.c)]));
  const reviewStatuses = viewToStatuses('review') ?? [];
  const tabCounts: Record<ImportView, number> = {
    all: statusCountRows.reduce((s, r) => s + Number(r.c), 0),
    review: reviewStatuses.reduce((s, st) => s + (byStatus.get(st) ?? 0), 0),
    confirmed: byStatus.get('confirmed') ?? 0,
    error: byStatus.get('error') ?? 0,
  };

  // ===== Opciones de filtro =====
  const [accountOptions, institutionOptions] = await Promise.all([
    db
      .select({ id: accounts.id, name: accounts.name, ownerTag: accounts.ownerTag })
      .from(accounts)
      .where(eq(accounts.householdId, householdId))
      .orderBy(asc(accounts.name)),
    db
      .select({ id: institutions.id, name: institutions.name })
      .from(institutions)
      .orderBy(asc(institutions.name)),
  ]);

  // ===== WHERE dinámico =====
  const conditions: SQL[] = [eq(imports.householdId, householdId)];
  const viewStatuses = viewToStatuses(filters.view);
  if (viewStatuses) conditions.push(inArray(imports.status, viewStatuses));
  if (filters.type) conditions.push(eq(imports.type, filters.type));
  if (filters.institutionId) conditions.push(eq(imports.institutionId, filters.institutionId));
  if (filters.accountId) conditions.push(eq(imports.accountId, filters.accountId));
  // Filtro por solape de período del extracto.
  if (filters.to) conditions.push(lte(imports.periodStart, filters.to));
  if (filters.from) conditions.push(gte(imports.periodEnd, filters.from));
  if (filters.q) {
    const pattern = `%${filters.q}%`;
    const orClause = or(
      ilike(imports.fileName, pattern),
      ilike(institutions.name, pattern),
      ilike(accounts.name, pattern),
    );
    if (orClause) conditions.push(orClause);
  }
  const whereClause = conditions.length === 1 ? conditions[0] : and(...conditions);

  // ===== Total filtrado + paginación =====
  const totalRows = await db
    .select({ total: count() })
    .from(imports)
    .leftJoin(institutions, eq(institutions.id, imports.institutionId))
    .leftJoin(accounts, eq(accounts.id, imports.accountId))
    .where(whereClause);
  const total = totalRows[0]?.total ?? 0;
  const totalPages = total === 0 ? 1 : Math.ceil(total / PAGE_LIMIT);
  const page = Math.min(filters.page, totalPages);
  const offset = (page - 1) * PAGE_LIMIT;

  const orderExpr = (() => {
    const d = filters.dir === 'asc' ? asc : desc;
    switch (filters.sort) {
      case 'account':
        return d(accounts.name);
      case 'period':
        return d(imports.periodStart);
      case 'status':
        return d(imports.status);
      case 'txns':
        return d(imports.transactionCount);
      default:
        return d(imports.createdAt);
    }
  })();

  const rows = await db
    .select({
      id: imports.id,
      type: imports.type,
      status: imports.status,
      institutionName: institutions.name,
      accountName: accounts.name,
      accountOwner: accounts.ownerTag,
      fileName: imports.fileName,
      createdAt: imports.createdAt,
      periodStart: imports.periodStart,
      periodEnd: imports.periodEnd,
      transactionCount: imports.transactionCount,
    })
    .from(imports)
    .leftJoin(institutions, eq(institutions.id, imports.institutionId))
    .leftJoin(accounts, eq(accounts.id, imports.accountId))
    .where(whereClause)
    .orderBy(orderExpr, desc(imports.createdAt))
    .limit(PAGE_LIMIT)
    .offset(offset);

  const tableRows: ImportRow[] = rows.map((r) => ({
    id: r.id,
    type: r.type,
    status: r.status,
    institutionName: r.institutionName,
    accountName: r.accountName,
    accountOwner: r.accountOwner,
    fileName: r.fileName,
    createdAt: r.createdAt.toISOString(),
    periodStart: r.periodStart,
    periodEnd: r.periodEnd,
    transactionCount: r.transactionCount,
  }));

  // ===== Chips de filtros activos =====
  const activeChips: Array<{ label: string; value: string }> = [];
  if (filters.type) activeChips.push({ label: 'Tipo', value: IMPORT_TYPE_LABELS[filters.type] });
  if (filters.institutionId) {
    activeChips.push({
      label: 'Institución',
      value: institutionOptions.find((i) => i.id === filters.institutionId)?.name ?? '—',
    });
  }
  if (filters.accountId) {
    const acc = accountOptions.find((a) => a.id === filters.accountId);
    activeChips.push({
      label: 'Cuenta',
      value: acc ? `${acc.name}${acc.ownerTag ? ` (${acc.ownerTag})` : ''}` : '—',
    });
  }

  if (filters.from) activeChips.push({ label: 'Desde', value: filters.from });
  if (filters.to) activeChips.push({ label: 'Hasta', value: filters.to });
  if (filters.q) activeChips.push({ label: 'Texto', value: filters.q });
  const hasActiveFilters = activeChips.length > 0;

  const showStart = total === 0 ? 0 : offset + 1;
  const showEnd = Math.min(offset + rows.length, total);

  const gaps = await detectImportGaps(householdId);

  return (
    <div className="space-y-8">
      <header className="flex flex-wrap items-end justify-between gap-6 pt-2">
        <div className="min-w-0">
          <Label>Tools · Imports</Label>
          <Display size="lg" className="mt-2 block">
            Imports
          </Display>
          <Body className="mt-2 max-w-2xl">
            {tabCounts.all === 0 ? (
              <>Sin imports todavía. Subí un resumen para empezar.</>
            ) : (
              <>
                <span className="text-foreground">{tabCounts.all}</span> archivos
                {tabCounts.review > 0 && (
                  <>
                    {' '}·{' '}
                    <span className="text-[color:var(--attn)]">{tabCounts.review}</span> para revisar
                  </>
                )}
                {tabCounts.error > 0 && (
                  <>
                    {' '}·{' '}
                    <span className="text-[color:var(--bad)]">{tabCounts.error}</span> con error
                  </>
                )}
              </>
            )}
          </Body>
        </div>
        <Button asChild size="lg">
          <Link href="/imports/new">+ Subir extracto</Link>
        </Button>
      </header>

      <Hair thick />

      {gaps.length > 0 && (
        <div className="space-y-2 rounded-md border border-amber-300 bg-amber-50 p-4 dark:border-amber-700 dark:bg-amber-950/30">
          <p className="text-sm font-medium text-amber-900 dark:text-amber-200">Resúmenes faltantes</p>
          <div className="space-y-1.5">
            {gaps.map((gap) => (
              <div key={gap.accountId} className="text-sm text-amber-800 dark:text-amber-300">
                <span className="font-medium">{gap.accountName}</span>
                {gap.institutionName && (
                  <span className="text-amber-700 dark:text-amber-400"> · {gap.institutionName}</span>
                )}
                <span className="ml-1">
                  — falta{gap.missingMonths.length > 1 ? 'n' : ''}{' '}
                  {gap.missingMonths
                    .map((m) => {
                      const [y, mo] = m.split('-');
                      return `${MONTHS[Number(mo) - 1]} ${y}`;
                    })
                    .join(', ')}
                </span>
                <Link
                  href={`/imports/new${gap.institutionId ? `?institutionId=${gap.institutionId}&accountId=${gap.accountId}` : ''}`}
                  className="ml-2 text-amber-900 underline hover:text-amber-700 dark:text-amber-200"
                >
                  Importar →
                </Link>
              </div>
            ))}
          </div>
        </div>
      )}

      {tabCounts.all === 0 ? (
        <div className="border border-dashed border-border p-12 text-center">
          <Display size="sm">Sin imports todavía</Display>
          <Body className="mx-auto mt-3 max-w-md">
            Subí un PDF o CSV de resumen de banco / TC / broker. El parser LLM lo procesa, vos revisás
            y confirmás las transacciones.
          </Body>
          <Button asChild className="mt-6" size="lg">
            <Link href="/imports/new">+ Subir el primero</Link>
          </Button>
        </div>
      ) : (
        <>
          {/* ===== Tabs por estado ===== */}
          <div className="flex flex-wrap gap-1 border-b border-border">
            {IMPORT_VIEWS.map((v) => {
              const activeTab = filters.view === v;
              return (
                <Link
                  key={v}
                  href={viewHref(filters, v)}
                  className={cn(
                    '-mb-px border-b-2 px-3 py-2 font-sans text-[11px] font-semibold uppercase tracking-[0.16em] transition-colors',
                    activeTab
                      ? 'border-primary text-primary'
                      : 'border-transparent text-muted-foreground hover:text-foreground',
                  )}
                >
                  {IMPORT_VIEW_LABELS[v]}
                  <span className="ml-1.5 text-muted-foreground/70">{tabCounts[v]}</span>
                </Link>
              );
            })}
          </div>

          {/* ===== Chips activos ===== */}
          {hasActiveFilters && (
            <div className="flex flex-wrap items-center gap-2 border-l-2 border-primary bg-primary/[0.06] px-4 py-2.5">
              <Label className="text-foreground">Filtros activos</Label>
              {activeChips.map((c, i) => (
                <span
                  key={i}
                  className="inline-flex items-baseline gap-1 rounded-full bg-primary/15 px-2.5 py-0.5 font-sans text-[11px] font-medium text-primary"
                >
                  <span className="text-[9px] uppercase tracking-[0.14em] opacity-70">{c.label}</span>
                  <span>{c.value}</span>
                </span>
              ))}
              <Link href={viewHref({ ...filters, type: undefined, institutionId: undefined, accountId: undefined, from: undefined, to: undefined, q: undefined }, filters.view)} className="link ml-auto font-display text-sm italic text-muted-foreground">
                Limpiar
              </Link>
            </div>
          )}

          {/* ===== Form de filtros ===== */}
          <details className="group border border-border bg-card/40" open={hasActiveFilters}>
            <summary className="flex cursor-pointer select-none items-center justify-between px-4 py-3 hover:bg-accent/50">
              <Label className="text-foreground">Filtrar y buscar</Label>
              <span className="font-sans text-[10px] uppercase tracking-[0.18em] text-muted-foreground transition-transform group-open:rotate-180">
                ▼
              </span>
            </summary>
            <form method="get" action="/imports" className="space-y-4 border-t border-border p-5 pt-4">
              <input type="hidden" name="view" value={filters.view} />
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div className="space-y-1.5 md:col-span-2">
                  <FormLabel htmlFor="q">Búsqueda</FormLabel>
                  <Input
                    id="q"
                    name="q"
                    defaultValue={filters.q ?? ''}
                    maxLength={200}
                    placeholder="nombre de archivo, institución o cuenta…"
                  />
                </div>
                <div className="space-y-1.5">
                  <FormLabel htmlFor="type">Tipo</FormLabel>
                  <select
                    id="type"
                    name="type"
                    defaultValue={filters.type ?? ''}
                    className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  >
                    <option value="">Todos</option>
                    {IMPORT_TYPES.map((t) => (
                      <option key={t} value={t}>
                        {IMPORT_TYPE_LABELS[t]}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1.5">
                  <FormLabel htmlFor="institutionId">Institución</FormLabel>
                  <select
                    id="institutionId"
                    name="institutionId"
                    defaultValue={filters.institutionId ?? ''}
                    className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  >
                    <option value="">Todas</option>
                    {institutionOptions.map((i) => (
                      <option key={i.id} value={i.id}>
                        {i.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1.5">
                  <FormLabel htmlFor="accountId">Cuenta</FormLabel>
                  <select
                    id="accountId"
                    name="accountId"
                    defaultValue={filters.accountId ?? ''}
                    className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  >
                    <option value="">Todas</option>
                    {accountOptions.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name}
                        {a.ownerTag ? ` (${a.ownerTag})` : ''}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1.5">
                  <FormLabel htmlFor="from">Período desde</FormLabel>
                  <Input id="from" name="from" type="date" defaultValue={filters.from ?? ''} />
                </div>
                <div className="space-y-1.5">
                  <FormLabel htmlFor="to">Período hasta</FormLabel>
                  <Input id="to" name="to" type="date" defaultValue={filters.to ?? ''} />
                </div>
              </div>
              <div className="flex justify-end gap-2 border-t border-border/60 pt-4">
                <Button variant="ghost" asChild>
                  <Link href={viewHref({ ...filters, type: undefined, institutionId: undefined, accountId: undefined, from: undefined, to: undefined, q: undefined }, filters.view)}>
                    Limpiar
                  </Link>
                </Button>
                <Button type="submit">Aplicar filtros</Button>
              </div>
            </form>
          </details>

          {rows.length === 0 ? (
            <div className="border border-dashed border-border p-10 text-center">
              <Body className="mx-auto max-w-md">
                {total === 0
                  ? 'Sin imports que coincidan con esos filtros.'
                  : 'Esta página está fuera de rango. Volvé a la primera.'}
              </Body>
            </div>
          ) : (
            <>
              <ImportsTable rows={tableRows} sort={filters.sort} dir={filters.dir} />

              <div className="flex items-center justify-between border-t border-border pt-4">
                <Num className="text-xs uppercase tracking-[0.14em] text-muted-foreground">
                  Mostrando {showStart}–{showEnd} de {total}
                </Num>
                {totalPages > 1 && (
                  <div className="flex items-center gap-3">
                    <Button variant="outline" size="sm" asChild={page > 1} disabled={page <= 1}>
                      {page > 1 ? (
                        <Link href={buildHref(filters, page - 1)}>← Anterior</Link>
                      ) : (
                        <span>← Anterior</span>
                      )}
                    </Button>
                    <Num className="text-xs uppercase tracking-[0.14em] text-muted-foreground">
                      Pág. {page} de {totalPages}
                    </Num>
                    <Button variant="outline" size="sm" asChild={page < totalPages} disabled={page >= totalPages}>
                      {page < totalPages ? (
                        <Link href={buildHref(filters, page + 1)}>Siguiente →</Link>
                      ) : (
                        <span>Siguiente →</span>
                      )}
                    </Button>
                  </div>
                )}
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
