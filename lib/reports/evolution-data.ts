import { and, eq, gte, isNotNull, lte, sql, sum } from 'drizzle-orm';
import { getDb } from '@/lib/db/client';
import { transactions } from '@/db/schema';
import {
  rollingMonths,
  type EvolutionBucket,
  type EvolutionCurrency,
} from './evolution';

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

function lastDayOfMonth(year: number, month1: number): number {
  if ([1, 3, 5, 7, 8, 10, 12].includes(month1)) return 31;
  if ([4, 6, 9, 11].includes(month1)) return 30;
  const isLeap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
  return isLeap ? 29 : 28;
}

export async function loadEvolutionData(
  householdId: string,
  endYear: number,
  endMonth: number,
  currency: EvolutionCurrency,
  categoryId: string | null = null,
): Promise<EvolutionBucket[]> {
  const db = getDb();

  const months = rollingMonths(endYear, endMonth);
  const first = months[0]!;
  const last = months[months.length - 1]!;
  const startDate = `${first.year}-${pad2(first.month)}-01`;
  const endDate = `${last.year}-${pad2(last.month)}-${pad2(lastDayOfMonth(last.year, last.month))}`;

  const amountCol = currency === 'USD' ? transactions.amountUsd : transactions.amountArs;

  const conditions = [
    eq(transactions.householdId, householdId),
    isNotNull(transactions.categoryId),
    gte(transactions.date, startDate),
    lte(transactions.date, endDate),
  ];
  if (categoryId) conditions.push(eq(transactions.categoryId, categoryId));

  const rows = await db
    .select({
      year: sql<number>`extract(year from ${transactions.date})::int`,
      month: sql<number>`extract(month from ${transactions.date})::int`,
      kind: transactions.kind,
      total: sum(amountCol).mapWith(String),
    })
    .from(transactions)
    .where(and(...conditions))
    .groupBy(
      sql`extract(year from ${transactions.date})`,
      sql`extract(month from ${transactions.date})`,
      transactions.kind,
    );

  // Map (year-month) → {income, expense}
  const byKey = new Map<string, { income: string; expense: string }>();
  for (const r of rows) {
    if (r.kind !== 'income' && r.kind !== 'expense') continue;
    const key = `${r.year}-${r.month}`;
    const prev = byKey.get(key) ?? { income: '0', expense: '0' };
    if (r.kind === 'income') prev.income = r.total ?? '0';
    else prev.expense = r.total ?? '0';
    byKey.set(key, prev);
  }

  // Llenar gaps: para cada mes del rolling, devolver bucket (0 si no hubo data)
  return months.map(({ year, month }) => {
    const v = byKey.get(`${year}-${month}`) ?? { income: '0', expense: '0' };
    return { year, month, income: v.income, expense: v.expense };
  });
}
