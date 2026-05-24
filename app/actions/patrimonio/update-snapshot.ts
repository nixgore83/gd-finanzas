'use server';

import { revalidatePath } from 'next/cache';
import Decimal from 'decimal.js';
import { and, eq } from 'drizzle-orm';
import { getDb } from '@/lib/db/client';
import { netWorthSnapshots, accountBalances, holdings } from '@/db/schema';
import { snapshotFormSchema, type SnapshotFormInput } from '@/lib/schemas/patrimonio';
import { requireHouseholdSession, SessionError } from '@/lib/auth/session';

export type UpdateSnapshotResult =
  | { ok: true }
  | { ok: false; error: 'invalid_input' | 'session' | 'not_found' | 'duplicate_date' | 'unknown'; fields?: Record<string, string> };

export async function updateSnapshot(
  snapshotId: string,
  input: unknown,
): Promise<UpdateSnapshotResult> {
  let session;
  try {
    session = await requireHouseholdSession();
  } catch (err) {
    if (err instanceof SessionError) return { ok: false, error: 'session' };
    throw err;
  }

  const parsed = snapshotFormSchema.safeParse(input);
  if (!parsed.success) {
    const fields: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const key = issue.path.join('.');
      fields[key] ??= issue.message;
    }
    return { ok: false, error: 'invalid_input', fields };
  }

  const { date, balances, holdings: holdingInputs, notes } = parsed.data;
  const totalUsd = calculateTotalUsd(balances, holdingInputs);

  const db = getDb();
  try {
    // Verify ownership
    const [existing] = await db
      .select({ id: netWorthSnapshots.id })
      .from(netWorthSnapshots)
      .where(
        and(
          eq(netWorthSnapshots.id, snapshotId),
          eq(netWorthSnapshots.householdId, session.householdId),
        ),
      )
      .limit(1);

    if (!existing) return { ok: false, error: 'not_found' };

    // Update snapshot
    await db
      .update(netWorthSnapshots)
      .set({
        date,
        totalUsd: totalUsd.toFixed(2),
        notes: notes ?? null,
      })
      .where(eq(netWorthSnapshots.id, snapshotId));

    // Replace balances: delete all, re-insert
    await db
      .delete(accountBalances)
      .where(eq(accountBalances.snapshotId, snapshotId));

    if (balances.length > 0) {
      await db.insert(accountBalances).values(
        balances.map((b) => ({
          snapshotId,
          accountId: b.accountId,
          balance: b.balance,
          currency: b.currency as 'ARS' | 'USD',
          balanceUsd: computeBalanceUsd(b.balance, b.currency, b.fxRateUsed),
          fxRateUsed: b.fxRateUsed,
          fxRateSource: b.fxRateSource ?? null,
        })),
      );
    }

    // Replace holdings
    await db.delete(holdings).where(eq(holdings.snapshotId, snapshotId));

    if (holdingInputs.length > 0) {
      await db.insert(holdings).values(
        holdingInputs.map((h) => {
          const totalValue = new Decimal(h.quantity).times(h.pricePerUnit).toFixed(2);
          const totalValueUsd = computeBalanceUsd(totalValue, h.currency, h.fxRateUsed);
          return {
            snapshotId,
            accountId: h.accountId,
            ticker: h.ticker,
            name: h.name,
            assetType: h.assetType as 'stock' | 'etf' | 'bond' | 'cedear' | 'fci' | 'crypto' | 'other',
            quantity: h.quantity,
            pricePerUnit: h.pricePerUnit,
            currency: h.currency as 'ARS' | 'USD',
            totalValue,
            totalValueUsd,
            fxRateUsed: h.fxRateUsed,
            fxRateSource: h.fxRateSource ?? null,
          };
        }),
      );
    }

    revalidatePath('/patrimonio');
    revalidatePath(`/patrimonio/${snapshotId}`);
    return { ok: true };
  } catch (err) {
    const code = (err as { code?: string }).code;
    if (code === '23505') {
      return { ok: false, error: 'duplicate_date' };
    }
    console.error('[patrimonio] update-snapshot failed', { code });
    return { ok: false, error: 'unknown' };
  }
}

function computeBalanceUsd(
  amount: string,
  currency: string,
  fxRate: string | null | undefined,
): string {
  if (currency === 'USD') return new Decimal(amount).toFixed(2);
  if (!fxRate) throw new Error('FX rate required for ARS balances');
  return new Decimal(amount).div(fxRate).toFixed(2, Decimal.ROUND_HALF_UP);
}

function calculateTotalUsd(
  balances: SnapshotFormInput['balances'],
  holdingInputs: SnapshotFormInput['holdings'],
): Decimal {
  let total = new Decimal(0);
  for (const b of balances) {
    total = total.plus(computeBalanceUsd(b.balance, b.currency, b.fxRateUsed));
  }
  for (const h of holdingInputs) {
    const tv = new Decimal(h.quantity).times(h.pricePerUnit).toFixed(2);
    total = total.plus(computeBalanceUsd(tv, h.currency, h.fxRateUsed));
  }
  return total;
}
