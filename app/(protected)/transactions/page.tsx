import Link from 'next/link';
import { redirect } from 'next/navigation';
import {
  and,
  asc,
  count,
  desc,
  eq,
  gte,
  ilike,
  inArray,
  lte,
  or,
  sql,
  type SQL,
} from 'drizzle-orm';
import { z } from 'zod';
import { getDb } from '@/lib/db/client';
import { accounts, categories, tags, transactionTags, transactions } from '@/db/schema';
import { requireHouseholdSession, SessionError } from '@/lib/auth/session';
import { loadCategoryTree } from '@/lib/categories/tree';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label as FormLabel } from '@/components/ui/label';
import { Display, Label, Num, Hair, Body } from '@/components/ui/typography';
import { TransactionsTable, type TxRow } from './transactions-table';

export const metadata = {
  title: 'Movimientos · gd-finanzas',
};

const PAGE_LIMIT = 50;

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// Cada campo se parsea por separado: si uno está mal, se descarta sin romper
// la página. Mejor degradación que 400.
function parseFilters(sp: Record<string, string | string[] | undefined>) {
  const get = (k: string): string | undefined => {
    const v = sp[k];
    if (typeof v === 'string' && v.length > 0) return v;
    return undefined;
  };

  const kind = z.enum(['income', 'expense', 'transfer']).safeParse(get('kind'));
  const accountId = z.string().uuid().safeParse(get('accountId'));
  const categoryId = z.string().uuid().safeParse(get('categoryId'));
  const tagId = z.string().uuid().safeParse(get('tagId'));
  const from = z.string().regex(ISO_DATE_RE).safeParse(get('from'));
  const to = z.string().regex(ISO_DATE_RE).safeParse(get('to'));
  const q = z.string().trim().min(1).max(200).safeParse(get('q'));
  const page = z.coerce.number().int().positive().safeParse(get('page'));
  const sort = z.enum(['date', 'description', 'amount', 'account', 'category', 'kind']).safeParse(get('sort'));
  const dir = z.enum(['asc', 'desc']).safeParse(get('dir'));

  return {
    kind: kind.success ? kind.data : undefined,
    accountId: accountId.success ? accountId.data : undefined,
    categoryId: categoryId.success ? categoryId.data : undefined,
    tagId: tagId.success ? tagId.data : undefined,
    from: from.success ? from.data : undefined,
    to: to.success ? to.data : undefined,
    q: q.success ? q.data : undefined,
    page: page.success ? page.data : 1,
    sort: sort.success ? sort.data : 'date',
    dir: dir.success ? dir.data : 'desc',
  };
}

type Filters = ReturnType<typeof parseFilters>;

function buildHref(base: string, filters: Filters, pageOverride: number): string {
  const sp = new URLSearchParams();
  if (filters.kind) sp.set('kind', filters.kind);
  if (filters.accountId) sp.set('accountId', filters.accountId);
  if (filters.categoryId) sp.set('categoryId', filters.categoryId);
  if (filters.tagId) sp.set('tagId', filters.tagId);
  if (filters.from) sp.set('from', filters.from);
  if (filters.to) sp.set('to', filters.to);
  if (filters.q) sp.set('q', filters.q);
  if (filters.sort && filters.sort !== 'date') sp.set('sort', filters.sort);
  if (filters.dir && filters.dir !== 'desc') sp.set('dir', filters.dir);
  if (pageOverride > 1) sp.set('page', String(pageOverride));
  const qs = sp.toString();
  return qs.length > 0 ? `${base}?${qs}` : base;
}

function buildExportHref(filters: Filters): string {
  const sp = new URLSearchParams();
  if (filters.kind) sp.set('kind', filters.kind);
  if (filters.accountId) sp.set('accountId', filters.accountId);
  if (filters.categoryId) sp.set('categoryId', filters.categoryId);
  if (filters.tagId) sp.set('tagId', filters.tagId);
  if (filters.from) sp.set('from', filters.from);
  if (filters.to) sp.set('to', filters.to);
  if (filters.q) sp.set('q', filters.q);
  const qs = sp.toString();
  return qs.length > 0 ? `/api/exports/transactions?${qs}` : '/api/exports/transactions';
}

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function TransactionsPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
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

  // Cargar listas para los Selects de filtro.
  const accountOptions = await db
    .select({ id: accounts.id, name: accounts.name, ownerTag: accounts.ownerTag })
    .from(accounts)
    .where(eq(accounts.householdId, session.householdId))
    .orderBy(asc(accounts.name));

  const categoryOptions = await loadCategoryTree(session.householdId);

  const tagOptions = await db
    .select({ id: tags.id, name: tags.name })
    .from(tags)
    .where(eq(tags.householdId, session.householdId))
    .orderBy(asc(tags.name));

  // WHERE dinámico
  const conditions: SQL[] = [eq(transactions.householdId, session.householdId)];
  if (filters.kind) conditions.push(eq(transactions.kind, filters.kind));
  if (filters.accountId) conditions.push(eq(transactions.accountId, filters.accountId));
  if (filters.categoryId) conditions.push(eq(transactions.categoryId, filters.categoryId));
  if (filters.tagId) {
    conditions.push(
      sql`exists (select 1 from ${transactionTags} tt where tt.transaction_id = ${transactions.id} and tt.tag_id = ${filters.tagId})`,
    );
  }
  if (filters.from) conditions.push(gte(transactions.date, filters.from));
  if (filters.to) conditions.push(lte(transactions.date, filters.to));
  if (filters.q) {
    const pattern = `%${filters.q}%`;
    const orClause = or(
      ilike(transactions.description, pattern),
      ilike(accounts.name, pattern),
      ilike(categories.name, pattern),
    );
    if (orClause) conditions.push(orClause);
  }

  const whereClause = conditions.length === 1 ? conditions[0] : and(...conditions);

  const totalRows = await db
    .select({ total: count() })
    .from(transactions)
    .leftJoin(accounts, eq(accounts.id, transactions.accountId))
    .leftJoin(categories, eq(categories.id, transactions.categoryId))
    .where(whereClause);
  const total = totalRows[0]?.total ?? 0;

  const totalPages = total === 0 ? 1 : Math.ceil(total / PAGE_LIMIT);
  const page = Math.min(filters.page, totalPages);
  const offset = (page - 1) * PAGE_LIMIT;

  const rows = await db
    .select({
      id: transactions.id,
      date: transactions.date,
      kind: transactions.kind,
      amountOriginal: transactions.amountOriginal,
      currencyOriginal: transactions.currencyOriginal,
      amountUsd: transactions.amountUsd,
      description: transactions.description,
      accountName: accounts.name,
      categoryName: categories.name,
    })
    .from(transactions)
    .leftJoin(accounts, eq(accounts.id, transactions.accountId))
    .leftJoin(categories, eq(categories.id, transactions.categoryId))
    .where(whereClause)
    .orderBy(
      (() => {
        const d = filters.dir === 'asc' ? asc : desc;
        switch (filters.sort) {
          case 'description': return d(transactions.description);
          case 'amount': return d(transactions.amountOriginal);
          case 'account': return d(accounts.name);
          case 'category': return d(categories.name);
          case 'kind': return d(transactions.kind);
          default: return d(transactions.date);
        }
      })(),
      desc(transactions.createdAt),
    )
    .limit(PAGE_LIMIT)
    .offset(offset);

  const txIds = rows.map((r) => r.id);
  const tagLinks =
    txIds.length === 0
      ? []
      : await db
          .select({
            transactionId: transactionTags.transactionId,
            name: tags.name,
            color: tags.color,
          })
          .from(transactionTags)
          .innerJoin(tags, eq(tags.id, transactionTags.tagId))
          .where(inArray(transactionTags.transactionId, txIds));

  const tagsByTx = new Map<string, Array<{ name: string; color: string | null }>>();
  for (const link of tagLinks) {
    const arr = tagsByTx.get(link.transactionId) ?? [];
    arr.push({ name: link.name, color: link.color });
    tagsByTx.set(link.transactionId, arr);
  }

  const accountCount = await db
    .select({ id: accounts.id })
    .from(accounts)
    .where(eq(accounts.householdId, session.householdId))
    .limit(1);

  const showStart = total === 0 ? 0 : offset + 1;
  const showEnd = Math.min(offset + rows.length, total);

  // Compute summary for the strapline
  const netUsd = rows.reduce((sum, r) => {
    const n = Number.parseFloat(r.amountUsd) || 0;
    if (r.kind === 'income') return sum + n;
    if (r.kind === 'expense') return sum - n;
    return sum;
  }, 0);
  const daysCount = new Set(rows.map((r) => r.date)).size;

  const activeChips: Array<{ label: string; value: string }> = [];
  if (filters.kind) {
    const kindLabel =
      filters.kind === 'income' ? 'Ingreso' : filters.kind === 'expense' ? 'Gasto' : 'Transferencia';
    activeChips.push({ label: 'Tipo', value: kindLabel });
  }
  if (filters.accountId) {
    const acc = accountOptions.find((a) => a.id === filters.accountId);
    activeChips.push({ label: 'Cuenta', value: acc?.name ?? '—' });
  }
  if (filters.categoryId) {
    const cat = categoryOptions.find((c) => c.id === filters.categoryId);
    activeChips.push({ label: 'Categoría', value: cat?.name ?? '—' });
  }
  if (filters.tagId) {
    const tag = tagOptions.find((t) => t.id === filters.tagId);
    activeChips.push({ label: 'Tag', value: tag?.name ?? '—' });
  }
  if (filters.from) activeChips.push({ label: 'Desde', value: filters.from });
  if (filters.to) activeChips.push({ label: 'Hasta', value: filters.to });
  if (filters.q) activeChips.push({ label: 'Texto', value: filters.q });

  const hasActiveFilters = activeChips.length > 0;

  const formatUsd = (n: number) =>
    new Intl.NumberFormat('es-AR', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(n);

  return (
    <div className="space-y-8">
      {/* ============ HEADER ============ */}
      <header className="flex flex-wrap items-end justify-between gap-6 pt-2">
        <div className="min-w-0">
          <Label>Operar · Movimientos</Label>
          <Display size="lg" className="mt-2 block">
            Movimientos
          </Display>
          {total > 0 ? (
            <Body className="mt-1">
              {total} {total === 1 ? 'movimiento' : 'movimientos'} en total ·{' '}
              {daysCount} {daysCount === 1 ? 'día' : 'días'} en la página · neto{' '}
              <Num
                className={
                  netUsd >= 0
                    ? 'not-italic text-[color:var(--good)]'
                    : 'not-italic text-[color:var(--bad)]'
                }
              >
                {netUsd >= 0 ? '+' : ''}
                {formatUsd(netUsd)}
              </Num>
            </Body>
          ) : (
            <Body className="mt-1">Sin movimientos que mostrar todavía.</Body>
          )}
        </div>
        <div className="flex gap-2">
          {total > 0 && (
            <Button variant="ghost" size="sm" asChild>
              <a href={buildExportHref(filters)} download>
                ↓ CSV
              </a>
            </Button>
          )}
          <Button variant="outline" asChild>
            <Link href="/transactions/new-transfer">↔ Transferencia</Link>
          </Button>
          <Button asChild>
            <Link href="/transactions/new">+ Nuevo movimiento</Link>
          </Button>
        </div>
      </header>

      <Hair thick />

      {accountCount.length === 0 ? (
        <div className="border border-dashed border-border p-10 text-center">
          <Body className="mx-auto max-w-md">
            Necesitás al menos una cuenta para empezar a cargar movimientos. Andá a{' '}
            <Link href="/accounts/new" className="link not-italic">
              /accounts/new
            </Link>
            .
          </Body>
        </div>
      ) : (
        <>
          {/* Active filter chips */}
          {hasActiveFilters && (
            <div className="flex flex-wrap items-center gap-2 border-l-2 border-primary bg-primary/[0.06] px-4 py-2.5">
              <Label className="text-foreground">Filtros activos</Label>
              {activeChips.map((c, i) => (
                <span
                  key={i}
                  className="inline-flex items-baseline gap-1 rounded-full bg-primary/15 px-2.5 py-0.5 font-sans text-[11px] font-medium text-primary"
                >
                  <span className="text-[9px] uppercase tracking-[0.14em] opacity-70">
                    {c.label}
                  </span>
                  <span>{c.value}</span>
                </span>
              ))}
              <Link
                href="/transactions"
                className="link ml-auto font-display text-sm italic text-muted-foreground"
              >
                Limpiar
              </Link>
            </div>
          )}

          {/* Filters details */}
          <details
            className="group border border-border bg-card/40"
            open={hasActiveFilters}
          >
            <summary className="flex cursor-pointer select-none items-center justify-between px-4 py-3 hover:bg-accent/50">
              <Label className="text-foreground">Filtrar y buscar</Label>
              <span className="font-sans text-[10px] uppercase tracking-[0.18em] text-muted-foreground transition-transform group-open:rotate-180">
                ▼
              </span>
            </summary>

            <form method="get" action="/transactions" className="border-t border-border p-5 pt-4 space-y-4">
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div className="space-y-1.5 md:col-span-2">
                  <FormLabel htmlFor="q">Búsqueda</FormLabel>
                  <Input
                    id="q"
                    name="q"
                    defaultValue={filters.q ?? ''}
                    maxLength={200}
                    placeholder="texto en descripción, cuenta o categoría…"
                  />
                </div>
                <div className="space-y-1.5">
                  <FormLabel htmlFor="kind">Tipo</FormLabel>
                  <select
                    id="kind"
                    name="kind"
                    defaultValue={filters.kind ?? ''}
                    className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  >
                    <option value="">Todos</option>
                    <option value="income">Ingreso</option>
                    <option value="expense">Gasto</option>
                    <option value="transfer">Transferencia</option>
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
                        {a.name}{a.ownerTag ? ` (${a.ownerTag})` : ''}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1.5">
                  <FormLabel htmlFor="categoryId">Categoría</FormLabel>
                  <select
                    id="categoryId"
                    name="categoryId"
                    defaultValue={filters.categoryId ?? ''}
                    className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  >
                    <option value="">Todas</option>
                    {categoryOptions.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.depth === 1 ? `    ↳ ${c.name}` : c.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1.5">
                  <FormLabel htmlFor="tagId">Etiqueta</FormLabel>
                  <select
                    id="tagId"
                    name="tagId"
                    defaultValue={filters.tagId ?? ''}
                    className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  >
                    <option value="">Todas</option>
                    {tagOptions.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1.5">
                  <FormLabel htmlFor="from">Desde</FormLabel>
                  <Input id="from" name="from" type="date" defaultValue={filters.from ?? ''} />
                </div>
                <div className="space-y-1.5">
                  <FormLabel htmlFor="to">Hasta</FormLabel>
                  <Input id="to" name="to" type="date" defaultValue={filters.to ?? ''} />
                </div>
              </div>
              <div className="flex justify-end gap-2 border-t border-border/60 pt-4">
                <Button variant="ghost" asChild>
                  <Link href="/transactions">Limpiar</Link>
                </Button>
                <Button type="submit">Aplicar filtros</Button>
              </div>
            </form>
          </details>

          {rows.length === 0 ? (
            <div className="border border-dashed border-border p-10 text-center">
              <Body className="mx-auto max-w-md">
                {total === 0
                  ? 'Sin movimientos que coincidan con esos filtros.'
                  : 'Esta página está fuera de rango. Volvé a la primera.'}
              </Body>
            </div>
          ) : (
            <>
              {(() => {
                const tableRows: TxRow[] = rows.map((row) => ({
                  id: row.id,
                  date: row.date,
                  kind: row.kind as 'income' | 'expense' | 'transfer',
                  amountOriginal: row.amountOriginal,
                  currencyOriginal: row.currencyOriginal,
                  amountUsd: row.amountUsd,
                  description: row.description,
                  accountName: row.accountName,
                  categoryName: row.categoryName,
                  tags: tagsByTx.get(row.id) ?? [],
                }));
                return <TransactionsTable rows={tableRows} categories={categoryOptions} sort={filters.sort ?? 'date'} dir={filters.dir ?? 'desc'} />;
              })()}

              {/* Pagination */}
              <div className="flex items-center justify-between border-t border-border pt-4">
                <Num className="text-xs uppercase tracking-[0.14em] text-muted-foreground">
                  Mostrando {showStart}–{showEnd} de {total}
                </Num>
                {totalPages > 1 && (
                  <div className="flex items-center gap-3">
                    <Button variant="outline" size="sm" asChild={page > 1} disabled={page <= 1}>
                      {page > 1 ? (
                        <Link href={buildHref('/transactions', filters, page - 1)}>← Anterior</Link>
                      ) : (
                        <span>← Anterior</span>
                      )}
                    </Button>
                    <Num className="text-xs uppercase tracking-[0.14em] text-muted-foreground">
                      Pág. {page} de {totalPages}
                    </Num>
                    <Button
                      variant="outline"
                      size="sm"
                      asChild={page < totalPages}
                      disabled={page >= totalPages}
                    >
                      {page < totalPages ? (
                        <Link href={buildHref('/transactions', filters, page + 1)}>
                          Siguiente →
                        </Link>
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
