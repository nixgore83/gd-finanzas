import { alias } from 'drizzle-orm/pg-core';
import { and, eq, gte, isNotNull, lte, sum } from 'drizzle-orm';
import { getDb } from '@/lib/db/client';
import { categories, transactions } from '@/db/schema';
import { monthRange } from './cashflow-data';
import { rollupBuckets, type BreakdownLevel, type BreakdownRow } from './breakdown';

export async function loadBreakdownData(
  householdId: string,
  year: number,
  month: number,
  level: BreakdownLevel,
): Promise<{ total: string; rows: BreakdownRow[] }> {
  const db = getDb();
  const range = monthRange(year, month);

  const parents = alias(categories, 'parents');

  const rows = await db
    .select({
      id: categories.id,
      parentId: categories.parentId,
      name: categories.name,
      color: categories.color,
      parentName: parents.name,
      parentColor: parents.color,
      total: sum(transactions.amountUsd).mapWith(String),
    })
    .from(transactions)
    .innerJoin(categories, eq(categories.id, transactions.categoryId))
    .leftJoin(parents, eq(parents.id, categories.parentId))
    .where(
      and(
        eq(transactions.householdId, householdId),
        eq(transactions.kind, 'expense'),
        isNotNull(transactions.categoryId),
        gte(transactions.date, range.from),
        lte(transactions.date, range.to),
      ),
    )
    .groupBy(categories.id, parents.id);

  const buckets = rows
    .filter((r): r is typeof r & { total: string } => r.total !== null)
    .map((r) => ({
      id: r.id,
      parentId: r.parentId,
      name: r.name,
      parentName: r.parentName,
      color: r.color,
      parentColor: r.parentColor,
      amount: r.total,
    }));

  return rollupBuckets(buckets, level);
}
