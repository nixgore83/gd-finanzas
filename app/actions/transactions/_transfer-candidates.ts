import { and, eq, gte, lte, ne, isNull } from 'drizzle-orm';
import { getDb } from '@/lib/db/client';
import { accounts, transactions } from '@/db/schema';
import { transferDirection } from './_build-transfer';

const WINDOW_DAYS = 7;

function shiftIsoDate(iso: string, days: number): string {
  const ms = Date.parse(`${iso}T00:00:00Z`) + days * 86_400_000;
  return new Date(ms).toISOString().slice(0, 10);
}

function daysBetween(a: string, b: string): number {
  const da = Date.parse(`${a}T00:00:00Z`);
  const db = Date.parse(`${b}T00:00:00Z`);
  return Math.round(Math.abs(da - db) / 86_400_000);
}

export type TransferLinkCandidate = {
  id: string;
  date: string;
  accountName: string;
  amountOriginal: string;
  currencyOriginal: 'ARS' | 'USD';
  kind: 'income' | 'expense' | 'transfer';
  description: string;
};

/**
 * Candidatos para linkear una pata de transferencia sin parear con su contraparte:
 * movimientos de OTRA cuenta, dirección opuesta, sin parear ni linkeados a
 * previsión, dentro de ±7 días. No filtra por monto (sirve para cross-currency).
 */
export async function findTransferLinkCandidates(
  txId: string,
  householdId: string,
): Promise<TransferLinkCandidate[]> {
  const db = getDb();

  const [tx] = await db
    .select({
      kind: transactions.kind,
      accountId: transactions.accountId,
      amountOriginal: transactions.amountOriginal,
      date: transactions.date,
    })
    .from(transactions)
    .where(and(eq(transactions.id, txId), eq(transactions.householdId, householdId)))
    .limit(1);
  if (!tx) return [];

  const myDir = transferDirection(tx.kind, tx.amountOriginal);
  const wantDir = myDir === 'out' ? 'in' : 'out';

  const rows = await db
    .select({
      id: transactions.id,
      date: transactions.date,
      amountOriginal: transactions.amountOriginal,
      currencyOriginal: transactions.currencyOriginal,
      kind: transactions.kind,
      description: transactions.description,
      accountName: accounts.name,
    })
    .from(transactions)
    .innerJoin(accounts, eq(accounts.id, transactions.accountId))
    .where(
      and(
        eq(transactions.householdId, householdId),
        ne(transactions.accountId, tx.accountId),
        isNull(transactions.transferPairId),
        isNull(transactions.recurrenceId),
        gte(transactions.date, shiftIsoDate(tx.date, -WINDOW_DAYS)),
        lte(transactions.date, shiftIsoDate(tx.date, WINDOW_DAYS)),
      ),
    );

  return rows
    .filter((r) => transferDirection(r.kind, r.amountOriginal) === wantDir)
    .sort((a, b) => daysBetween(a.date, tx.date) - daysBetween(b.date, tx.date))
    .slice(0, 20);
}
