import { desc, eq } from 'drizzle-orm';
import { getDb } from '@/lib/db/client';
import { netWorthSnapshots } from '@/db/schema';

export interface SnapshotSummary {
  id: string;
  date: string;
  totalUsd: string;
  notes: string | null;
  createdAt: Date;
}

export async function loadSnapshots(householdId: string): Promise<SnapshotSummary[]> {
  const db = getDb();
  const rows = await db
    .select({
      id: netWorthSnapshots.id,
      date: netWorthSnapshots.date,
      totalUsd: netWorthSnapshots.totalUsd,
      notes: netWorthSnapshots.notes,
      createdAt: netWorthSnapshots.createdAt,
    })
    .from(netWorthSnapshots)
    .where(eq(netWorthSnapshots.householdId, householdId))
    .orderBy(desc(netWorthSnapshots.date));

  return rows;
}
