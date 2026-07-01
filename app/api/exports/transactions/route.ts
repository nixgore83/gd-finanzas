import { NextResponse } from 'next/server';
import {
  and,
  asc,
  desc,
  eq,
  gte,
  ilike,
  isNull,
  lte,
  or,
  sql,
  type SQL,
} from 'drizzle-orm';
import { z } from 'zod';
import { getDb } from '@/lib/db/client';
import { accounts, categories, tags, transactionTags, transactions } from '@/db/schema';
import { requireHouseholdSession, SessionError } from '@/lib/auth/session';
import { toCsv } from '@/lib/exports/csv';
import { categoryFilterSchema } from '@/lib/transactions/category-filter';

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const filtersSchema = z.object({
  kind: z.enum(['income', 'expense', 'transfer']).optional(),
  accountId: z.string().uuid().optional(),
  categoryId: categoryFilterSchema.optional(),
  tagId: z.string().uuid().optional(),
  from: z.string().regex(ISO_DATE_RE).optional(),
  to: z.string().regex(ISO_DATE_RE).optional(),
  q: z.string().trim().min(1).max(200).optional(),
  format: z.enum(['csv', 'json']).optional(),
});

export async function GET(request: Request): Promise<Response> {
  let session;
  try {
    session = await requireHouseholdSession();
  } catch (err) {
    if (err instanceof SessionError) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }
    throw err;
  }

  const url = new URL(request.url);
  const raw: Record<string, string | undefined> = {};
  for (const key of ['kind', 'accountId', 'categoryId', 'tagId', 'from', 'to', 'q', 'format']) {
    raw[key] = url.searchParams.get(key) ?? undefined;
  }
  const parsed = filtersSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid_filters' }, { status: 400 });
  }
  const filters = parsed.data;
  const format = filters.format ?? 'csv';

  const db = getDb();

  const conditions: SQL[] = [eq(transactions.householdId, session.householdId)];
  if (filters.kind) conditions.push(eq(transactions.kind, filters.kind));
  if (filters.accountId) conditions.push(eq(transactions.accountId, filters.accountId));
  if (filters.categoryId) {
    if (filters.categoryId === 'unclassified') {
      conditions.push(isNull(transactions.categoryId));
    } else {
      conditions.push(eq(transactions.categoryId, filters.categoryId));
    }
  }
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

  const rows = await db
    .select({
      id: transactions.id,
      date: transactions.date,
      kind: transactions.kind,
      description: transactions.description,
      amountOriginal: transactions.amountOriginal,
      currencyOriginal: transactions.currencyOriginal,
      amountUsd: transactions.amountUsd,
      amountArs: transactions.amountArs,
      fxRateUsed: transactions.fxRateUsed,
      fxRateSource: transactions.fxRateSource,
      accountName: accounts.name,
      categoryName: categories.name,
      notes: transactions.notes,
      source: transactions.source,
      deducibleGanancias: transactions.deducibleGanancias,
      transactionSubtype: transactions.transactionSubtype,
    })
    .from(transactions)
    .leftJoin(accounts, eq(accounts.id, transactions.accountId))
    .leftJoin(categories, eq(categories.id, transactions.categoryId))
    .where(whereClause)
    .orderBy(asc(transactions.date), desc(transactions.createdAt));

  // Load tags for all exported transactions
  const txIds = rows.map((r) => r.id);
  const tagLinks =
    txIds.length === 0
      ? []
      : await db
          .select({
            transactionId: transactionTags.transactionId,
            name: tags.name,
          })
          .from(transactionTags)
          .innerJoin(tags, eq(tags.id, transactionTags.tagId))
          .where(sql`${transactionTags.transactionId} = ANY(${txIds})`);

  const tagsByTx = new Map<string, string[]>();
  for (const link of tagLinks) {
    const arr = tagsByTx.get(link.transactionId) ?? [];
    arr.push(link.name);
    tagsByTx.set(link.transactionId, arr);
  }

  const exportRows = rows.map((r) => ({
    fecha: r.date,
    tipo: r.kind,
    subtipo: r.transactionSubtype,
    descripcion: r.description,
    cuenta: r.accountName ?? '',
    categoria: r.categoryName ?? '',
    tags: tagsByTx.get(r.id)?.join('; ') ?? '',
    monto_original: r.amountOriginal,
    moneda: r.currencyOriginal,
    monto_usd: r.amountUsd,
    monto_ars: r.amountArs,
    fx_rate: r.fxRateUsed,
    fx_source: r.fxRateSource,
    notas: r.notes ?? '',
    origen: r.source,
    deducible_ganancias: r.deducibleGanancias,
  }));

  const today = new Date().toISOString().slice(0, 10);

  if (format === 'json') {
    const filename = `transacciones-${today}.json`;
    return new Response(JSON.stringify(exportRows, null, 2), {
      status: 200,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'no-store, max-age=0',
      },
    });
  }

  const csvString = toCsv(exportRows, [
    { key: 'fecha', label: 'Fecha' },
    { key: 'tipo', label: 'Tipo' },
    { key: 'subtipo', label: 'Subtipo' },
    { key: 'descripcion', label: 'Descripción' },
    { key: 'cuenta', label: 'Cuenta' },
    { key: 'categoria', label: 'Categoría' },
    { key: 'tags', label: 'Tags' },
    { key: 'monto_original', label: 'Monto original' },
    { key: 'moneda', label: 'Moneda' },
    { key: 'monto_usd', label: 'Monto USD' },
    { key: 'monto_ars', label: 'Monto ARS' },
    { key: 'fx_rate', label: 'FX Rate' },
    { key: 'fx_source', label: 'FX Source' },
    { key: 'notas', label: 'Notas' },
    { key: 'origen', label: 'Origen' },
    { key: 'deducible_ganancias', label: 'Deducible Ganancias' },
  ]);

  const filename = `transacciones-${today}.csv`;
  return new Response(csvString, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store, max-age=0',
    },
  });
}
