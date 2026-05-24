import { desc, eq } from 'drizzle-orm';
import { getDb } from '@/lib/db/client';
import { netWorthSnapshots } from '@/db/schema';

export interface NetWorthPoint {
  date: string;
  totalUsd: string;
}

/**
 * Returns all net worth snapshots as a time series, ordered by date ascending.
 * Used for charts (evolution of net worth over time).
 */
export async function loadNetWorthSeries(householdId: string): Promise<NetWorthPoint[]> {
  const db = getDb();
  const rows = await db
    .select({
      date: netWorthSnapshots.date,
      totalUsd: netWorthSnapshots.totalUsd,
    })
    .from(netWorthSnapshots)
    .where(eq(netWorthSnapshots.householdId, householdId))
    .orderBy(netWorthSnapshots.date);

  return rows;
}

/**
 * Returns the latest snapshot's total USD value, or null if no snapshots exist.
 */
export async function getLatestNetWorth(householdId: string): Promise<NetWorthPoint | null> {
  const db = getDb();
  const [row] = await db
    .select({
      date: netWorthSnapshots.date,
      totalUsd: netWorthSnapshots.totalUsd,
    })
    .from(netWorthSnapshots)
    .where(eq(netWorthSnapshots.householdId, householdId))
    .orderBy(desc(netWorthSnapshots.date))
    .limit(1);

  return row ?? null;
}
