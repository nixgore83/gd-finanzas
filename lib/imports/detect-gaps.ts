import { and, eq, sql } from 'drizzle-orm';
import { getDb } from '@/lib/db/client';
import { accounts, imports, importLines, institutions } from '@/db/schema';
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
): string[] {
  if (covered.size === 0) return [];
  const sortedMonths = [...covered].sort();
  const earliest = sortedMonths[0]!;
  const rangeStart = earliest < earliestTracked ? earliestTracked : earliest;
  const expectedMonths = generateMonthRange(rangeStart, currentMonth);
  return expectedMonths.filter((m) => m !== currentMonth && !covered.has(m));
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

  const today = new Date();
  const currentMonth = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;

  // Una query por cuenta vigilada, pero en paralelo (antes era secuencial y la
  // latencia se acumulaba; en cold start podía empujar a /imports al timeout 504).
  const perAccount = await Promise.all(
    watchedAccounts.map(async (acc): Promise<ImportGap | null> => {
      const [periodRows, coveredRows] = await Promise.all([
        // 2a. Períodos declarados por los imports confirmados de la cuenta.
        db
          .select({ periodStart: imports.periodStart, periodEnd: imports.periodEnd })
          .from(imports)
          .where(
            and(
              eq(imports.householdId, householdId),
              eq(imports.accountId, acc.id),
              eq(imports.status, 'confirmed'),
            ),
          ),
        // 2b. Meses con líneas confirmadas (fallback si el import no declara período).
        db
          .select({
            month: sql<string>`to_char(
              (${importLines.parsedData}->>'date')::date,
              'YYYY-MM'
            )`,
          })
          .from(importLines)
          .innerJoin(imports, eq(imports.id, importLines.importId))
          .where(
            and(
              eq(imports.householdId, householdId),
              eq(imports.accountId, acc.id),
              eq(imports.status, 'confirmed'),
              sql`${importLines.transactionId} IS NOT NULL`,
            ),
          )
          .groupBy(sql`to_char((${importLines.parsedData}->>'date')::date, 'YYYY-MM')`),
      ]);

      const covered = buildCoveredMonths(periodRows, coveredRows.map((r) => r.month));
      const missing = computeMissingMonths(covered, currentMonth);

      if (missing.length === 0) return null;

      return {
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
      };
    }),
  );

  return perAccount.filter((g): g is ImportGap => g !== null);
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
