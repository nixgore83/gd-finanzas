import { and, eq } from 'drizzle-orm';
import { getDb } from '@/lib/db/client';
import { netWorthSnapshots, accountBalances, holdings, accounts } from '@/db/schema';

export interface SnapshotBalance {
  id: string;
  accountId: string;
  accountName: string;
  accountType: string;
  ownerTag: string;
  balance: string;
  currency: 'ARS' | 'USD';
  balanceUsd: string;
  fxRateUsed: string | null;
  fxRateSource: string | null;
}

export interface SnapshotHolding {
  id: string;
  accountId: string;
  accountName: string;
  ticker: string;
  name: string;
  assetType: string;
  quantity: string;
  pricePerUnit: string;
  currency: 'ARS' | 'USD';
  totalValue: string;
  totalValueUsd: string;
  fxRateUsed: string | null;
  fxRateSource: string | null;
}

export interface SnapshotDetail {
  id: string;
  date: string;
  totalUsd: string;
  notes: string | null;
  createdAt: Date;
  balances: SnapshotBalance[];
  holdings: SnapshotHolding[];
}

export async function loadSnapshotDetail(
  snapshotId: string,
  householdId: string,
): Promise<SnapshotDetail | null> {
  const db = getDb();

  const [snapshot] = await db
    .select({
      id: netWorthSnapshots.id,
      date: netWorthSnapshots.date,
      totalUsd: netWorthSnapshots.totalUsd,
      notes: netWorthSnapshots.notes,
      createdAt: netWorthSnapshots.createdAt,
    })
    .from(netWorthSnapshots)
    .where(
      and(
        eq(netWorthSnapshots.id, snapshotId),
        eq(netWorthSnapshots.householdId, householdId),
      ),
    )
    .limit(1);

  if (!snapshot) return null;

  const [balanceRows, holdingRows] = await Promise.all([
    db
      .select({
        id: accountBalances.id,
        accountId: accountBalances.accountId,
        accountName: accounts.name,
        accountType: accounts.type,
        ownerTag: accounts.ownerTag,
        balance: accountBalances.balance,
        currency: accountBalances.currency,
        balanceUsd: accountBalances.balanceUsd,
        fxRateUsed: accountBalances.fxRateUsed,
        fxRateSource: accountBalances.fxRateSource,
      })
      .from(accountBalances)
      .innerJoin(accounts, eq(accounts.id, accountBalances.accountId))
      .where(eq(accountBalances.snapshotId, snapshotId)),
    db
      .select({
        id: holdings.id,
        accountId: holdings.accountId,
        accountName: accounts.name,
        ticker: holdings.ticker,
        name: holdings.name,
        assetType: holdings.assetType,
        quantity: holdings.quantity,
        pricePerUnit: holdings.pricePerUnit,
        currency: holdings.currency,
        totalValue: holdings.totalValue,
        totalValueUsd: holdings.totalValueUsd,
        fxRateUsed: holdings.fxRateUsed,
        fxRateSource: holdings.fxRateSource,
      })
      .from(holdings)
      .innerJoin(accounts, eq(accounts.id, holdings.accountId))
      .where(eq(holdings.snapshotId, snapshotId)),
  ]);

  return {
    ...snapshot,
    balances: balanceRows,
    holdings: holdingRows,
  };
}
