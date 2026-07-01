import { and, eq, inArray, sql } from 'drizzle-orm';
import { getDb } from '@/lib/db/client';
import { accounts, imports, importLines, institutions, accountSkippedMonths } from '@/db/schema';
import { formatAccount } from '@/lib/accounts/format';

/**
 * No se esperan ni se sugieren imports previos a esta fecha: el tracking del
 * household arranca en 2026. Aunque haya líneas confirmadas con fechas anteriores
 * (p. ej. saldos/movimientos viejos), no se reportan gaps antes de este mes.
 */
const EARLIEST_TRACKED_MONTH = '2026-01';

export interface ImportGap {
  accountId: string;
  accountName: string;
  institutionId: string | null;
  institutionName: string | null;
  missingMonths: string[]; // ['2026-03', '2026-04']
}

/** Período declarado por un import confirmado (`imports.period_start/end`). */
export interface ImportPeriod {
  periodStart: string | null; // YYYY-MM-DD
  periodEnd: string | null;
}

/**
 * Meses 'YYYY-MM' cubiertos por una cuenta.
 *
 * Cobertura = unión de:
 * - los meses abarcados por el período de cada import confirmado (un consolidado
 *   ene–jun cubre feb aunque feb no tenga movimientos — antes eso daba falso
 *   "faltante" porque solo se miraban meses con líneas), y
 * - los meses con líneas confirmadas (fallback para imports sin período declarado).
 */
export function buildCoveredMonths(periods: ImportPeriod[], lineMonths: string[]): Set<string> {
  const covered = new Set<string>(lineMonths);
  for (const p of periods) {
    const start = p.periodStart?.slice(0, 7);
    if (!start) continue;
    const end = p.periodEnd?.slice(0, 7) ?? start;
    for (const m of generateMonthRange(start, end)) covered.add(m);
  }
  return covered;
}

/**
 * Meses faltantes para una cuenta dado su set de cobertura. Devuelve [] si no hay
 * nada cubierto todavía (sin imports no hay gaps que reportar) o si no falta nada.
 * Excluye el mes corriente (puede no haber vencido el resumen) y todo lo previo a
 * `EARLIEST_TRACKED_MONTH`.
 */
export function computeMissingMonths(
  covered: Set<string>,
  currentMonth: string,
  earliestTracked: string = EARLIEST_TRACKED_MONTH,
  skipped: Set<string> = new Set(),
): string[] {
  if (covered.size === 0) return [];
  const sortedMonths = [...covered].sort();
  const earliest = sortedMonths[0]!;
  const rangeStart = earliest < earliestTracked ? earliestTracked : earliest;
  const expectedMonths = generateMonthRange(rangeStart, currentMonth);
  // Excluye el mes corriente, los ya cubiertos, y los que el usuario marcó
  // explícitamente como "sin movimientos" (cuentas con actividad esporádica).
  return expectedMonths.filter((m) => m !== currentMonth && !covered.has(m) && !skipped.has(m));
}

/**
 * Detects missing monthly imports for accounts that have `expectsMonthlyImport = true`.
 * Returns only accounts that have at least one gap.
 */
export async function detectImportGaps(householdId: string): Promise<ImportGap[]> {
  const db = getDb();

  // 1. Get accounts expecting monthly imports
  const watchedAccounts = await db
    .select({
      id: accounts.id,
      name: accounts.name,
      type: accounts.type,
      cardBrand: accounts.cardBrand,
      ownerTag: accounts.ownerTag,
      currencyDefault: accounts.currencyDefault,
      institutionId: accounts.institutionId,
      institutionName: institutions.name,
    })
    .from(accounts)
    .leftJoin(institutions, eq(institutions.id, accounts.institutionId))
    .where(
      and(
        eq(accounts.householdId, householdId),
        eq(accounts.expectsMonthlyImport, true),
        eq(accounts.archived, false),
      ),
    );

  if (watchedAccounts.length === 0) return [];
  const watchedIds = watchedAccounts.map((a) => a.id);

  // Un mes (YYYY-MM) desde el campo `date` (texto) del parsed_data de una línea.
  const monthExpr = sql<string>`to_char((${importLines.parsedData}->>'date')::date, 'YYYY-MM')`;

  // Tres queries acotadas al household (agrupadas por cuenta en memoria), en vez
  // de 2 queries POR cuenta vigilada. Con muchas cuentas, el fan-out anterior
  // (2×N queries concurrentes) saturaba el pipelining de postgres-js sobre las
  // pocas conexiones del pooler (transaction mode) y wedgeaba una conexión → la
  // request quedaba colgada hasta el timeout de 300s (incidente 2026-07-01).
  const [skippedRows, periodRowsAll, coveredRowsAll] = await Promise.all([
    // Meses marcados "sin movimientos" por el usuario → se excluyen de los gaps.
    db
      .select({
        accountId: accountSkippedMonths.accountId,
        yearMonth: accountSkippedMonths.yearMonth,
      })
      .from(accountSkippedMonths)
      .where(eq(accountSkippedMonths.householdId, householdId)),
    // Períodos declarados por los imports confirmados, por cuenta.
    db
      .select({
        accountId: imports.accountId,
        periodStart: imports.periodStart,
        periodEnd: imports.periodEnd,
      })
      .from(imports)
      .where(
        and(
          eq(imports.householdId, householdId),
          eq(imports.status, 'confirmed'),
          inArray(imports.accountId, watchedIds),
        ),
      ),
    // Meses con líneas confirmadas (fallback si el import no declara período), por cuenta.
    db
      .select({ accountId: imports.accountId, month: monthExpr })
      .from(importLines)
      .innerJoin(imports, eq(imports.id, importLines.importId))
      .where(
        and(
          eq(imports.householdId, householdId),
          eq(imports.status, 'confirmed'),
          inArray(imports.accountId, watchedIds),
          sql`${importLines.transactionId} IS NOT NULL`,
        ),
      )
      .groupBy(imports.accountId, monthExpr),
  ]);

  // Agrupar todo por cuenta en memoria.
  const skippedByAccount = new Map<string, Set<string>>();
  for (const r of skippedRows) {
    let set = skippedByAccount.get(r.accountId);
    if (!set) {
      set = new Set<string>();
      skippedByAccount.set(r.accountId, set);
    }
    set.add(r.yearMonth);
  }
  const periodsByAccount = new Map<string, ImportPeriod[]>();
  for (const r of periodRowsAll) {
    if (!r.accountId) continue;
    const list = periodsByAccount.get(r.accountId) ?? [];
    list.push({ periodStart: r.periodStart, periodEnd: r.periodEnd });
    periodsByAccount.set(r.accountId, list);
  }
  const monthsByAccount = new Map<string, string[]>();
  for (const r of coveredRowsAll) {
    if (!r.accountId) continue;
    const list = monthsByAccount.get(r.accountId) ?? [];
    list.push(r.month);
    monthsByAccount.set(r.accountId, list);
  }

  const today = new Date();
  const currentMonth = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;

  const gaps: ImportGap[] = [];
  for (const acc of watchedAccounts) {
    const covered = buildCoveredMonths(
      periodsByAccount.get(acc.id) ?? [],
      monthsByAccount.get(acc.id) ?? [],
    );
    const missing = computeMissingMonths(
      covered,
      currentMonth,
      EARLIEST_TRACKED_MONTH,
      skippedByAccount.get(acc.id) ?? new Set<string>(),
    );
    if (missing.length === 0) continue;

    gaps.push({
      accountId: acc.id,
      // La institución se muestra aparte → acá solo producto + dueño + moneda.
      accountName: formatAccount(
        {
          institutionName: acc.institutionName,
          type: acc.type,
          cardBrand: acc.cardBrand,
          name: acc.name,
          ownerTag: acc.ownerTag,
          currency: acc.currencyDefault,
        },
        { withInstitution: false },
      ),
      institutionId: acc.institutionId,
      institutionName: acc.institutionName,
      missingMonths: missing,
    });
  }

  return gaps;
}

function generateMonthRange(from: string, to: string): string[] {
  const months: string[] = [];
  const [startYear, startMonth] = from.split('-').map(Number) as [number, number];
  const [endYear, endMonth] = to.split('-').map(Number) as [number, number];

  let y = startYear;
  let m = startMonth;

  while (y < endYear || (y === endYear && m <= endMonth)) {
    months.push(`${y}-${String(m).padStart(2, '0')}`);
    m++;
    if (m > 12) {
      m = 1;
      y++;
    }
  }

  return months;
}
