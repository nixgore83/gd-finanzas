import { and, eq, sql } from 'drizzle-orm';
import { getDb } from '@/lib/db/client';
import { accounts, imports, importLines, institutions } from '@/db/schema';

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

/**
 * Detects missing monthly imports for accounts that have `expectsMonthlyImport = true`.
 *
 * For each such account, looks at the range from the earliest confirmed import line date
 * to today, and finds months with no confirmed import lines.
 *
 * Returns only accounts that have at least one gap.
 */
export async function detectImportGaps(householdId: string): Promise<ImportGap[]> {
  const db = getDb();

  // 1. Get accounts expecting monthly imports
  const watchedAccounts = await db
    .select({
      id: accounts.id,
      name: accounts.name,
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
      // 2. Find months that have confirmed import lines for this account
      const coveredRows = await db
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
        .groupBy(sql`to_char((${importLines.parsedData}->>'date')::date, 'YYYY-MM')`);

      const coveredMonths = new Set(coveredRows.map((r) => r.month));

      if (coveredMonths.size === 0) return null; // No imports yet — no gaps to report

      // 3. Find the range: earliest covered month to current month, pero nunca
      //    antes de EARLIEST_TRACKED_MONTH (no esperamos imports previos a 2026).
      const sortedMonths = [...coveredMonths].sort();
      const earliest = sortedMonths[0]!;
      const rangeStart = earliest < EARLIEST_TRACKED_MONTH ? EARLIEST_TRACKED_MONTH : earliest;

      // 4. Generate all expected months in range
      const expectedMonths = generateMonthRange(rangeStart, currentMonth);

      // 5. Find missing months (exclude current month — it may not be due yet)
      const missing = expectedMonths.filter((m) => m !== currentMonth && !coveredMonths.has(m));

      if (missing.length === 0) return null;

      return {
        accountId: acc.id,
        accountName: acc.name,
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
