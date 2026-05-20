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
import { Label } from '@/components/ui/label';
import { TransactionsTable, type TxRow } from './transactions-table';

export const metadata = {
  title: 'Transacciones · gd-finanzas',
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

  return {
    kind: kind.success ? kind.data : undefined,
    accountId: accountId.success ? accountId.data : undefined,
    categoryId: categoryId.success ? categoryId.data : undefined,
    tagId: tagId.success ? tagId.data : undefined,
    from: from.success ? from.data : undefined,
    to: to.success ? to.data : undefined,
    q: q.success ? q.data : undefined,
    page: page.success ? page.data : 1,
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
  if (pageOverride > 1) sp.set('page', String(pageOverride));
  const qs = sp.toString();
  return qs.length > 0 ? `${base}?${qs}` : base;
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
    .select({ id: accounts.id, name: accounts.name })
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

  // El COUNT necesita los mismos JOINs que la query principal cuando `q` filtra
  // sobre accounts.name / categories.name. LEFT JOIN no duplica filas
  // (each tx tiene 1 account y 1 category).
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
    .orderBy(desc(transactions.date), desc(transactions.createdAt))
    .limit(PAGE_LIMIT)
    .offset(offset);

  // Segunda query batch: tags por transacción visible.
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

  // Empty state guard: ¿el household tiene siquiera 1 cuenta?
  const accountCount = await db
    .select({ id: accounts.id })
    .from(accounts)
    .where(eq(accounts.householdId, session.householdId))
    .limit(1);

  const showStart = total === 0 ? 0 : offset + 1;
  const showEnd = Math.min(offset + rows.length, total);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-2xl font-semibold">Transacciones</h1>
        <div className="flex gap-2">
          <Button variant="outline" asChild>
            <Link href="/transactions/new-transfer">↔ Transferencia</Link>
          </Button>
          <Button asChild>
            <Link href="/transactions/new">+ Nueva transacción</Link>
          </Button>
        </div>
      </div>

      {accountCount.length === 0 ? (
        <div className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">
          Necesitás al menos una cuenta. Andá a{' '}
          <Link href="/accounts/new" className="underline">
            /accounts/new
          </Link>
          .
        </div>
      ) : (
        <>
          {(() => {
            const activeChips: Array<{ label: string; value: string }> = [];
            if (filters.kind) {
              const kindLabel =
                filters.kind === 'income'
                  ? 'Ingreso'
                  : filters.kind === 'expense'
                    ? 'Gasto'
                    : 'Transferencia';
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
            if (activeChips.length === 0) return null;
            return (
              <div className="flex flex-wrap items-center gap-2 rounded-md border border-border bg-muted/30 px-3 py-2 text-xs">
                <span className="text-muted-foreground">Filtros activos:</span>
                {activeChips.map((c, i) => (
                  <span
                    key={i}
                    className="rounded-full bg-primary/10 px-2 py-0.5 font-medium text-primary"
                  >
                    {c.label}: {c.value}
                  </span>
                ))}
                <Link
                  href="/transactions"
                  className="ml-auto text-muted-foreground hover:text-foreground hover:underline"
                >
                  Limpiar
                </Link>
              </div>
            );
          })()}

          {/* Form GET collapsible. Default cerrado para no robar vertical;
              si hay filtros activos, abierto. */}
          <details
            className="rounded-md border bg-muted/20"
            open={
              !!(
                filters.kind ||
                filters.accountId ||
                filters.categoryId ||
                filters.tagId ||
                filters.from ||
                filters.to ||
                filters.q
              )
            }
          >
            <summary className="cursor-pointer select-none px-4 py-2 text-sm font-medium">
              Filtros
            </summary>
          <form
            method="get"
            action="/transactions"
            className="p-4 pt-2 space-y-3"
          >
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <div className="space-y-1.5 md:col-span-2">
                <Label htmlFor="q">Búsqueda</Label>
                <Input
                  id="q"
                  name="q"
                  defaultValue={filters.q ?? ''}
                  maxLength={200}
                  placeholder="texto en descripción, cuenta o categoría…"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="kind">Tipo</Label>
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
                <Label htmlFor="accountId">Cuenta</Label>
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
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="categoryId">Categoría</Label>
                <select
                  id="categoryId"
                  name="categoryId"
                  defaultValue={filters.categoryId ?? ''}
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                >
                  <option value="">Todas</option>
                  {categoryOptions.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.depth === 1 ? `    ↳ ${c.name}` : c.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="tagId">Etiqueta</Label>
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
                <Label htmlFor="from">Desde</Label>
                <Input id="from" name="from" type="date" defaultValue={filters.from ?? ''} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="to">Hasta</Label>
                <Input id="to" name="to" type="date" defaultValue={filters.to ?? ''} />
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" asChild>
                <Link href="/transactions">Limpiar</Link>
              </Button>
              <Button type="submit">Aplicar</Button>
            </div>
          </form>
          </details>

          {rows.length === 0 ? (
            <div className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">
              {total === 0
                ? 'Sin transacciones que coincidan con esos filtros.'
                : 'Esta página está fuera de rango. Volvé a la primera.'}
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
                return <TransactionsTable rows={tableRows} categories={categoryOptions} />;
              })()}

              <div className="flex items-center justify-between text-sm text-muted-foreground">
                <span>
                  Mostrando {showStart}–{showEnd} de {total}
                </span>
                {totalPages > 1 && (
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      asChild={page > 1}
                      disabled={page <= 1}
                    >
                      {page > 1 ? (
                        <Link href={buildHref('/transactions', filters, page - 1)}>
                          ← Anterior
                        </Link>
                      ) : (
                        <span>← Anterior</span>
                      )}
                    </Button>
                    <span className="text-xs">
                      Página {page} de {totalPages}
                    </span>
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

