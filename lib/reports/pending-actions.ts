import { and, asc, count, desc, eq, inArray, isNull, lt, or } from 'drizzle-orm';
import { getDb } from '@/lib/db/client';
import { accounts, budgets, forecasts, imports, institutions, recurrences, transactions } from '@/db/schema';
import { detectImportGaps, type ImportGap } from '@/lib/imports/detect-gaps';
import type { ImportType } from '@/lib/schemas/import';
import { formatAccount } from '@/lib/accounts/format';

export type OverdueKind = 'missed' | 'grace';

export type PendingImportReview = {
  id: string;
  fileName: string | null;
  type: ImportType;
  institutionName: string | null;
  accountName: string | null;
  status: 'parsed' | 'reviewing';
  createdAt: Date;
};

export type PendingImportError = {
  id: string;
  fileName: string | null;
  type: ImportType;
  errorMessage: string | null;
  createdAt: Date;
};

export type OverdueForecast = {
  id: string;
  recurrenceName: string;
  expectedDate: string;
  expectedAmount: string;
  currency: 'ARS' | 'USD';
  status: 'pending' | 'missed';
  overdueKind: OverdueKind;
};

export type UnmatchedTransfer = {
  id: string;
  date: string;
  amountOriginal: string;
  currencyOriginal: 'ARS' | 'USD';
  description: string;
  accountName: string;
};

export type PendingActions = {
  importsToReview: PendingImportReview[];
  importsErrored: PendingImportError[];
  overdueForecasts: OverdueForecast[];
  importGaps: ImportGap[];
  budgetMissing: boolean;
  unmatchedTransfers: UnmatchedTransfer[];
  /** Cantidad de ítems accionables, para el badge del nav y el resumen del dashboard. */
  totalCount: number;
};

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Clasifica una previsión vencida. Función pura para poder testearla.
 * - `missed`: el cron ya la marcó (pasó la fecha + 7 días de gracia).
 * - `grace`: sigue `pending` pero su fecha esperada ya pasó (vencida en gracia).
 * - `null`: no está vencida (todavía pendiente a futuro, o ya matched/cancelled).
 */
export function classifyOverdue(
  status: string,
  expectedDate: string,
  todayIsoStr: string,
): OverdueKind | null {
  if (status === 'missed') return 'missed';
  if (status === 'pending' && expectedDate < todayIsoStr) return 'grace';
  return null;
}

export async function loadPendingActions(householdId: string): Promise<PendingActions> {
  const db = getDb();
  const today = todayIso();
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1;

  const [importRows, forecastRows, budgetRows, importGaps, unmatchedTransferRows] = await Promise.all([
    // Imports que requieren acción: revisar (parsed/reviewing) o fallados (error).
    db
      .select({
        id: imports.id,
        fileName: imports.fileName,
        type: imports.type,
        status: imports.status,
        errorMessage: imports.errorMessage,
        institutionName: institutions.name,
        accountName: accounts.name,
        createdAt: imports.createdAt,
      })
      .from(imports)
      .leftJoin(institutions, eq(institutions.id, imports.institutionId))
      .leftJoin(accounts, eq(accounts.id, imports.accountId))
      .where(
        and(
          eq(imports.householdId, householdId),
          inArray(imports.status, ['parsed', 'reviewing', 'error']),
        ),
      )
      .orderBy(desc(imports.createdAt)),

    // Previsiones vencidas: missed o pending con fecha ya pasada.
    db
      .select({
        id: forecasts.id,
        recurrenceName: recurrences.name,
        expectedDate: forecasts.expectedDate,
        expectedAmount: forecasts.expectedAmount,
        currency: forecasts.currency,
        status: forecasts.status,
      })
      .from(forecasts)
      .innerJoin(recurrences, eq(recurrences.id, forecasts.recurrenceId))
      .where(
        and(
          eq(recurrences.householdId, householdId),
          or(
            eq(forecasts.status, 'missed'),
            and(eq(forecasts.status, 'pending'), lt(forecasts.expectedDate, today)),
          ),
        ),
      )
      .orderBy(asc(forecasts.expectedDate)),

    // ¿Hay budget cargado para el mes en curso?
    db
      .select({ c: count() })
      .from(budgets)
      .where(
        and(
          eq(budgets.householdId, householdId),
          eq(budgets.year, year),
          eq(budgets.month, month),
        ),
      ),

    detectImportGaps(householdId),

    // Transferencias sin parear (pata única)
    db
      .select({
        id: transactions.id,
        date: transactions.date,
        amountOriginal: transactions.amountOriginal,
        currencyOriginal: transactions.currencyOriginal,
        description: transactions.description,
        accName: accounts.name,
        accType: accounts.type,
        accCardBrand: accounts.cardBrand,
        accOwnerTag: accounts.ownerTag,
        accCurrency: accounts.currencyDefault,
        accInstitutionName: institutions.name,
      })
      .from(transactions)
      .leftJoin(accounts, eq(accounts.id, transactions.accountId))
      .leftJoin(institutions, eq(institutions.id, accounts.institutionId))
      .where(
        and(
          eq(transactions.householdId, householdId),
          eq(transactions.kind, 'transfer'),
          isNull(transactions.transferPairId),
        ),
      )
      .orderBy(asc(transactions.date)),
  ]);

  const importsToReview: PendingImportReview[] = [];
  const importsErrored: PendingImportError[] = [];
  for (const r of importRows) {
    if (r.status === 'error') {
      importsErrored.push({
        id: r.id,
        fileName: r.fileName,
        type: r.type,
        errorMessage: r.errorMessage,
        createdAt: r.createdAt,
      });
    } else if (r.status === 'parsed' || r.status === 'reviewing') {
      importsToReview.push({
        id: r.id,
        fileName: r.fileName,
        type: r.type,
        institutionName: r.institutionName,
        accountName: r.accountName,
        status: r.status,
        createdAt: r.createdAt,
      });
    }
  }

  const overdueForecasts: OverdueForecast[] = [];
  for (const f of forecastRows) {
    const overdueKind = classifyOverdue(f.status, f.expectedDate, today);
    if (!overdueKind) continue;
    // status acá solo puede ser 'missed' o 'pending' por el WHERE.
    overdueForecasts.push({
      id: f.id,
      recurrenceName: f.recurrenceName,
      expectedDate: f.expectedDate,
      expectedAmount: f.expectedAmount,
      currency: f.currency,
      status: f.status === 'missed' ? 'missed' : 'pending',
      overdueKind,
    });
  }

  const budgetMissing = (budgetRows[0]?.c ?? 0) === 0;

  const unmatchedTransfers: UnmatchedTransfer[] = unmatchedTransferRows.map((row) => ({
    id: row.id,
    date: row.date,
    amountOriginal: row.amountOriginal,
    currencyOriginal: row.currencyOriginal as 'ARS' | 'USD',
    description: row.description,
    accountName: row.accType
      ? formatAccount({
          institutionName: row.accInstitutionName,
          type: row.accType,
          cardBrand: row.accCardBrand,
          name: row.accName,
          ownerTag: row.accOwnerTag ?? '',
          currency: row.accCurrency ?? 'ARS',
        })
      : '—',
  }));

  const totalCount =
    importsToReview.length +
    importsErrored.length +
    overdueForecasts.length +
    importGaps.length +
    unmatchedTransfers.length +
    (budgetMissing ? 1 : 0);

  return {
    importsToReview,
    importsErrored,
    overdueForecasts,
    importGaps,
    budgetMissing,
    unmatchedTransfers,
    totalCount,
  };
}

/** Conteo liviano para el badge del nav. Reusa el loader para no duplicar la lógica. */
export async function countPendingActions(householdId: string): Promise<number> {
  const pending = await loadPendingActions(householdId);
  return pending.totalCount;
}
