'use server';

import { revalidatePath } from 'next/cache';
import Decimal from 'decimal.js';
import { getDb } from '@/lib/db/client';
import { netWorthSnapshots, accountBalances, holdings } from '@/db/schema';
import { snapshotFormSchema, type SnapshotFormInput } from '@/lib/schemas/patrimonio';
import { requireHouseholdSession, SessionError } from '@/lib/auth/session';

export type CreateSnapshotResult =
  | { ok: true; id: string }
  | { ok: false; error: 'invalid_input' | 'session' | 'duplicate_date' | 'unknown'; fields?: Record<string, string> };

export async function createSnapshot(input: unknown): Promise<CreateSnapshotResult> {
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

  // Calculate total net worth in USD
  const totalUsd = calculateTotalUsd(balances, holdingInputs);

  const db = getDb();
  try {
    const rows = await db
      .insert(netWorthSnapshots)
      .values({
        householdId: session.householdId,
        date,
        totalUsd: totalUsd.toFixed(2),
        notes: notes ?? null,
        createdBy: session.userId,
      })
      .returning({ id: netWorthSnapshots.id });

    const snapshot = rows[0]!;

    if (balances.length > 0) {
      await db.insert(accountBalances).values(
        balances.map((b) => ({
          snapshotId: snapshot.id,
          accountId: b.accountId,
          balance: b.balance,
          currency: b.currency as 'ARS' | 'USD',
          balanceUsd: computeBalanceUsd(b.balance, b.currency, b.fxRateUsed),
          fxRateUsed: b.fxRateUsed,
          fxRateSource: b.fxRateSource ?? null,
        })),
      );
    }

    if (holdingInputs.length > 0) {
      await db.insert(holdings).values(
        holdingInputs.map((h) => {
          const totalValue = new Decimal(h.quantity).times(h.pricePerUnit).toFixed(2);
          const totalValueUsd = computeBalanceUsd(totalValue, h.currency, h.fxRateUsed);
          return {
            snapshotId: snapshot.id,
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
    return { ok: true, id: snapshot.id };
  } catch (err) {
    const code = (err as { code?: string }).code;
    if (code === '23505') {
      return { ok: false, error: 'duplicate_date' };
    }
    console.error('[patrimonio] create-snapshot failed', { code });
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
    const usd = computeBalanceUsd(b.balance, b.currency, b.fxRateUsed);
    total = total.plus(usd);
  }

  for (const h of holdingInputs) {
    const totalValue = new Decimal(h.quantity).times(h.pricePerUnit).toFixed(2);
    const usd = computeBalanceUsd(totalValue, h.currency, h.fxRateUsed);
    total = total.plus(usd);
  }

  return total;
}
