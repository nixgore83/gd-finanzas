import { and, asc, eq, gte, inArray, lte } from 'drizzle-orm';
import { getDb } from '@/lib/db/client';
import { accounts, categories, households, institutions, transactions } from '@/db/schema';
import { formatAccount } from '@/lib/accounts/format';
import type { ExportAccount, ExportCategory, ExportTx } from './types';

export type GananciasData = {
  year: number;
  householdName: string;
  txns: ExportTx[];
  accountsById: Map<string, ExportAccount>;
  categoriesById: Map<string, ExportCategory>;
};

export async function loadGananciasData(
  householdId: string,
  year: number,
): Promise<GananciasData> {
  const db = getDb();

  const start = `${year}-01-01`;
  const end = `${year}-12-31`;

  const [hh] = await db
    .select({ name: households.name })
    .from(households)
    .where(eq(households.id, householdId))
    .limit(1);
  const householdName = hh?.name ?? 'household';

  const txRows = await db
    .select({
      id: transactions.id,
      date: transactions.date,
      accountId: transactions.accountId,
      categoryId: transactions.categoryId,
      kind: transactions.kind,
      transactionSubtype: transactions.transactionSubtype,
      amountOriginal: transactions.amountOriginal,
      currencyOriginal: transactions.currencyOriginal,
      amountUsd: transactions.amountUsd,
      amountArs: transactions.amountArs,
      description: transactions.description,
      notes: transactions.notes,
      deducibleGanancias: transactions.deducibleGanancias,
      meta: transactions.meta,
    })
    .from(transactions)
    .where(
      and(
        eq(transactions.householdId, householdId),
        inArray(transactions.kind, ['income', 'expense', 'transfer']),
        gte(transactions.date, start),
        lte(transactions.date, end),
      ),
    )
    .orderBy(asc(transactions.date));

  const txns: ExportTx[] = txRows.map((r) => ({
    id: r.id,
    date: r.date,
    accountId: r.accountId,
    categoryId: r.categoryId,
    kind: r.kind,
    transactionSubtype: r.transactionSubtype,
    amountOriginal: r.amountOriginal,
    currencyOriginal: r.currencyOriginal,
    amountUsd: r.amountUsd,
    amountArs: r.amountArs,
    description: r.description,
    notes: r.notes,
    deducibleGanancias: r.deducibleGanancias,
    meta: (r.meta ?? {}) as Record<string, unknown>,
  }));

  const accRows = await db
    .select({
      id: accounts.id,
      name: accounts.name,
      type: accounts.type,
      cardBrand: accounts.cardBrand,
      ownerTag: accounts.ownerTag,
      currencyDefault: accounts.currencyDefault,
      institutionName: institutions.name,
    })
    .from(accounts)
    .leftJoin(institutions, eq(accounts.institutionId, institutions.id))
    .where(eq(accounts.householdId, householdId));
  const accountsById = new Map<string, ExportAccount>(
    accRows.map((a) => [
      a.id,
      {
        id: a.id,
        // Nombre legible para el contador (institución + producto + dueño + moneda),
        // ya que `accounts.name` solo guarda el rótulo opcional.
        name: formatAccount({
          institutionName: a.institutionName,
          type: a.type,
          cardBrand: a.cardBrand,
          name: a.name,
          ownerTag: a.ownerTag,
          currency: a.currencyDefault,
        }),
        type: a.type,
      },
    ]),
  );

  const catRows = await db
    .select({ id: categories.id, name: categories.name })
    .from(categories)
    .where(eq(categories.householdId, householdId));
  const categoriesById = new Map<string, ExportCategory>(
    catRows.map((c) => [c.id, { id: c.id, name: c.name }]),
  );

  return { year, householdName, txns, accountsById, categoriesById };
}
