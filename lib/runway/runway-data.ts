import Decimal from 'decimal.js';
import { and, desc, eq, gte, inArray, isNotNull } from 'drizzle-orm';
import { getDb } from '@/lib/db/client';
import {
  accounts,
  categories,
  financialGoals,
  imports,
  recurrences,
  transactions,
} from '@/db/schema';
import { getLatestNetWorth } from '@/lib/patrimonio/net-worth-series';
import { getFxRate } from '@/lib/fx/get-fx-rate';
import { averageClosedMonths } from './base-burn';
import { CUOTA_RE, projectRemainingCuotas, type CuotaLine } from './cuotas';
import { addMonths, monthOf, type MonthKey } from './months';
import { buildRunwayProjection, type RunwayResult } from './project';
import { isNonMonthlyExpense, recurrenceFlows, type RecurrenceForRunway } from './recurrence-flows';
import { spendCapStatus, type SpendCapStatus } from './spend-cap';

/** Horizonte de la proyección. */
export const RUNWAY_MONTHS = 18;
/** Meses cerrados que se promedian para el gasto base. */
export const BASE_WINDOW_MONTHS = 3;
/** Un snapshot más viejo que esto ya no representa "el líquido de hoy". */
export const SNAPSHOT_STALE_DAYS = 35;

export type RunwayData = {
  today: string;
  fxRate: Decimal;
  snapshot: { date: string; totalUsd: Decimal; totalArs: Decimal; stale: boolean } | null;
  baseBurn: { average: Decimal; months: MonthKey[] };
  cap: Decimal | null;
  bufferArs: Decimal | null;
  real: RunwayResult | null;
  withCap: RunwayResult | null;
  currentMonth: { month: MonthKey; spent: Decimal; status: SpendCapStatus | null };
  /** Recurrencias que se modelaron como eventos (para mostrar los supuestos). */
  eventNames: string[];
  releaseNames: string[];
};

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
}

/**
 * Gasto de la casa por mes (ARS), con las reglas del runway:
 * - sólo `kind = 'expense'` (las transferencias nunca son gasto);
 * - sin categorías "fuera de la casa" (ni sus hijas);
 * - sin las cuotas de TC (se proyectan aparte, por mes de pago);
 * - sin las categorías de gastos anuales/puntuales (van como eventos).
 */
export async function householdSpendByMonth(
  householdId: string,
  fromDate: string,
  skipCategoryIds: ReadonlySet<string>,
): Promise<Map<MonthKey, Decimal>> {
  const db = getDb();
  const rows = await db
    .select({
      date: transactions.date,
      amountArs: transactions.amountArs,
      categoryId: transactions.categoryId,
      description: transactions.description,
      accountType: accounts.type,
    })
    .from(transactions)
    .innerJoin(accounts, eq(accounts.id, transactions.accountId))
    .where(
      and(
        eq(transactions.householdId, householdId),
        eq(transactions.kind, 'expense'),
        gte(transactions.date, fromDate),
      ),
    );

  const out = new Map<MonthKey, Decimal>();
  for (const r of rows) {
    if (r.categoryId && skipCategoryIds.has(r.categoryId)) continue;
    if (r.accountType === 'credit_card' && CUOTA_RE.test(r.description ?? '')) continue;
    const m = monthOf(r.date);
    out.set(m, (out.get(m) ?? new Decimal(0)).plus(r.amountArs));
  }
  return out;
}

/** Líneas de cuota del ÚLTIMO resumen confirmado de cada tarjeta. */
async function latestCuotaLines(
  householdId: string,
  excludedCategoryIds: ReadonlySet<string>,
): Promise<CuotaLine[]> {
  const db = getDb();
  const statements = await db
    .select({ id: imports.id, accountId: imports.accountId, periodEnd: imports.periodEnd })
    .from(imports)
    .innerJoin(accounts, eq(accounts.id, imports.accountId))
    .where(
      and(
        eq(imports.householdId, householdId),
        eq(imports.status, 'confirmed'),
        eq(accounts.type, 'credit_card'),
        isNotNull(imports.periodEnd),
      ),
    )
    .orderBy(desc(imports.periodEnd));

  const latestByAccount = new Map<string, { id: string; periodEnd: string }>();
  for (const s of statements) {
    if (!s.accountId || !s.periodEnd || latestByAccount.has(s.accountId)) continue;
    latestByAccount.set(s.accountId, { id: s.id, periodEnd: s.periodEnd });
  }
  if (latestByAccount.size === 0) return [];

  const closeByImport = new Map([...latestByAccount.values()].map((s) => [s.id, s.periodEnd]));
  const rows = await db
    .select({
      importBatchId: transactions.importBatchId,
      description: transactions.description,
      amountArs: transactions.amountArs,
      categoryId: transactions.categoryId,
    })
    .from(transactions)
    .where(
      and(
        eq(transactions.householdId, householdId),
        eq(transactions.kind, 'expense'),
        inArray(transactions.importBatchId, [...closeByImport.keys()]),
      ),
    );

  return rows
    .filter((r) => !(r.categoryId && excludedCategoryIds.has(r.categoryId)))
    .filter((r) => CUOTA_RE.test(r.description ?? ''))
    .map((r) => ({
      description: r.description ?? '',
      amountArs: r.amountArs,
      closeDate: closeByImport.get(r.importBatchId ?? '') ?? '',
    }))
    .filter((l) => l.closeDate !== '');
}

/**
 * Estado del techo del mes en curso, con las mismas reglas que el gasto base.
 * Liviano (3 queries) para el panel de pendientes / badge del nav.
 */
export async function loadCurrentSpendCap(
  householdId: string,
): Promise<{ spent: Decimal; cap: Decimal | null; status: SpendCapStatus | null }> {
  const db = getDb();
  const today = todayIso();
  const month = monthOf(today);
  const [goalsRow, catRows, recRows] = await Promise.all([
    db
      .select({ cap: financialGoals.topeGastoMensualArs })
      .from(financialGoals)
      .where(eq(financialGoals.householdId, householdId))
      .limit(1),
    db
      .select({
        id: categories.id,
        parentId: categories.parentId,
        excluded: categories.excludedFromHousehold,
      })
      .from(categories)
      .where(eq(categories.householdId, householdId)),
    db
      .select({
        kind: recurrences.kind,
        frequency: recurrences.frequency,
        startDate: recurrences.startDate,
        endDate: recurrences.endDate,
        categoryId: recurrences.categoryId,
      })
      .from(recurrences)
      .where(and(eq(recurrences.householdId, householdId), eq(recurrences.active, true))),
  ]);
  const capRaw = goalsRow[0]?.cap;
  const cap = capRaw ? new Decimal(capRaw) : null;
  if (!cap) return { spent: new Decimal(0), cap: null, status: null };
  const skip = skipCategoryIds(catRows, recRows);
  const byMonth = await householdSpendByMonth(householdId, `${month}-01`, skip);
  const spent = byMonth.get(month) ?? new Decimal(0);
  return { spent, cap, status: spendCapStatus({ spent, cap, today }) };
}

/** Fecha del último snapshot de patrimonio y si ya está viejo. */
export async function loadSnapshotFreshness(
  householdId: string,
): Promise<{ date: string | null; stale: boolean }> {
  const snap = await getLatestNetWorth(householdId);
  if (!snap) return { date: null, stale: true };
  return { date: snap.date, stale: daysBetween(snap.date, todayIso()) > SNAPSHOT_STALE_DAYS };
}

/**
 * Categorías que no cuentan como gasto base de la casa: las marcadas "fuera de
 * la casa" (y sus hijas) + las de gastos anuales/puntuales (van como eventos).
 */
function skipCategoryIds(
  catRows: readonly { id: string; parentId: string | null; excluded: boolean }[],
  recs: readonly Pick<
    RecurrenceForRunway,
    'kind' | 'frequency' | 'startDate' | 'endDate' | 'categoryId'
  >[],
): Set<string> {
  return excludedAndNonMonthly(catRows, recs).all;
}

function excludedAndNonMonthly(
  catRows: readonly { id: string; parentId: string | null; excluded: boolean }[],
  recs: readonly Pick<
    RecurrenceForRunway,
    'kind' | 'frequency' | 'startDate' | 'endDate' | 'categoryId'
  >[],
): { excluded: Set<string>; all: Set<string> } {
  const excludedParents = new Set(catRows.filter((c) => c.excluded).map((c) => c.id));
  const excluded = new Set(
    catRows
      .filter((c) => c.excluded || (c.parentId && excludedParents.has(c.parentId)))
      .map((c) => c.id),
  );
  const nonMonthly = recs
    .filter((r) => isNonMonthlyExpense(r as RecurrenceForRunway))
    .map((r) => r.categoryId)
    .filter((id): id is string => !!id);
  return { excluded, all: new Set([...excluded, ...nonMonthly]) };
}

export async function loadRunwayData(householdId: string): Promise<RunwayData> {
  const db = getDb();
  const today = todayIso();
  const currentMonth = monthOf(today);
  const baseFrom = addMonths(currentMonth, -BASE_WINDOW_MONTHS);
  const baseWindowEnd = `${addMonths(currentMonth, -1)}-31`;

  const [fx, snap, goalsRow, catRows, recRows] = await Promise.all([
    getFxRate({ date: today }),
    getLatestNetWorth(householdId),
    db
      .select({ bufferUsd: financialGoals.bufferUsd, cap: financialGoals.topeGastoMensualArs })
      .from(financialGoals)
      .where(eq(financialGoals.householdId, householdId))
      .limit(1),
    db
      .select({
        id: categories.id,
        parentId: categories.parentId,
        excluded: categories.excludedFromHousehold,
      })
      .from(categories)
      .where(eq(categories.householdId, householdId)),
    db
      .select({
        name: recurrences.name,
        kind: recurrences.kind,
        amount: recurrences.amount,
        currency: recurrences.currency,
        frequency: recurrences.frequency,
        dayOfMonth: recurrences.dayOfMonth,
        startDate: recurrences.startDate,
        endDate: recurrences.endDate,
        categoryId: recurrences.categoryId,
      })
      .from(recurrences)
      .where(and(eq(recurrences.householdId, householdId), eq(recurrences.active, true))),
  ]);
  const fxRate = fx.rate;

  const recs: RecurrenceForRunway[] = recRows.map((r) => ({
    ...r,
    dayOfMonth: r.dayOfMonth ?? Number(r.startDate.slice(8, 10)),
  }));
  const { excluded: excludedIds, all: skip } = excludedAndNonMonthly(catRows, recs);

  const [spendByMonth, cuotaLines] = await Promise.all([
    householdSpendByMonth(householdId, `${baseFrom}-01`, skip),
    latestCuotaLines(householdId, excludedIds),
  ]);

  const baseBurn = averageClosedMonths(spendByMonth, currentMonth, BASE_WINDOW_MONTHS);
  const goals = goalsRow[0];
  const cap = goals?.cap ? new Decimal(goals.cap) : null;
  const bufferArs = goals?.bufferUsd ? new Decimal(goals.bufferUsd).mul(fxRate) : null;

  const spentNow = spendByMonth.get(currentMonth) ?? new Decimal(0);
  const currentStatus = cap ? spendCapStatus({ spent: spentNow, cap, today }) : null;

  const flows = recurrenceFlows(recs, {
    startMonth: currentMonth,
    months: RUNWAY_MONTHS,
    baseWindowEnd,
    fxRate,
  });
  const cuotas = projectRemainingCuotas(cuotaLines, currentMonth);

  let snapshot: RunwayData['snapshot'] = null;
  let real: RunwayResult | null = null;
  let withCap: RunwayResult | null = null;
  if (snap) {
    const totalUsd = new Decimal(snap.totalUsd);
    const totalArs = totalUsd.mul(fxRate);
    snapshot = {
      date: snap.date,
      totalUsd,
      totalArs,
      stale: daysBetween(snap.date, today) > SNAPSHOT_STALE_DAYS,
    };
    const common = {
      startMonth: currentMonth,
      months: RUNWAY_MONTHS,
      startBalance: totalArs,
      incomes: flows.incomes,
      burnReleases: flows.burnReleases,
      cuotas,
      events: flows.events,
    };
    real = buildRunwayProjection({ ...common, baseBurn: baseBurn.average });
    if (cap) withCap = buildRunwayProjection({ ...common, baseBurn: cap });
  }

  return {
    today,
    fxRate,
    snapshot,
    baseBurn,
    cap,
    bufferArs,
    real,
    withCap,
    currentMonth: { month: currentMonth, spent: spentNow, status: currentStatus },
    eventNames: [...new Set(flows.events.map((e) => e.label ?? ''))].filter(Boolean),
    releaseNames: flows.burnReleases.map((r) => r.label),
  };
}
