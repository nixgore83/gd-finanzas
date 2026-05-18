'use server';

import { revalidatePath } from 'next/cache';
import { sql } from 'drizzle-orm';
import { getDb } from '@/lib/db/client';
import { financialGoals } from '@/db/schema';
import { parseFinancialGoalsFormData } from '@/lib/schemas/financial-goals';
import { requireHouseholdSession, SessionError } from '@/lib/auth/session';

export type UpsertFinancialGoalsResult =
  | { ok: true }
  | {
      ok: false;
      error: 'invalid_input' | 'session' | 'unknown';
      fields?: Record<string, string>;
    };

export async function upsertFinancialGoals(
  formData: FormData,
): Promise<UpsertFinancialGoalsResult> {
  let session;
  try {
    session = await requireHouseholdSession();
  } catch (err) {
    if (err instanceof SessionError) return { ok: false, error: 'session' };
    throw err;
  }

  const parsed = parseFinancialGoalsFormData(formData);
  if (!parsed.success) {
    const fields: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const key = String(issue.path[0] ?? '_');
      fields[key] ??= issue.message;
    }
    return { ok: false, error: 'invalid_input', fields };
  }

  const db = getDb();
  try {
    await db
      .insert(financialGoals)
      .values({
        householdId: session.householdId,
        targetAhorroMensualUsd: parsed.data.targetAhorroMensualUsd,
        edadTargetIfNico: parsed.data.edadTargetIfNico,
        edadTargetIfPau: parsed.data.edadTargetIfPau,
        numeroRetiroUsd: parsed.data.numeroRetiroUsd,
        numeroEducacionUsd: parsed.data.numeroEducacionUsd,
        bufferUsd: parsed.data.bufferUsd,
        notas: parsed.data.notas,
        updatedBy: session.userId,
      })
      .onConflictDoUpdate({
        target: financialGoals.householdId,
        set: {
          targetAhorroMensualUsd: parsed.data.targetAhorroMensualUsd,
          edadTargetIfNico: parsed.data.edadTargetIfNico,
          edadTargetIfPau: parsed.data.edadTargetIfPau,
          numeroRetiroUsd: parsed.data.numeroRetiroUsd,
          numeroEducacionUsd: parsed.data.numeroEducacionUsd,
          bufferUsd: parsed.data.bufferUsd,
          notas: parsed.data.notas,
          updatedAt: sql`now()`,
          updatedBy: session.userId,
        },
      });

    revalidatePath('/settings/metas');
    return { ok: true };
  } catch (err) {
    console.error('[financial-goals] upsert failed', {
      code: (err as { code?: string }).code,
    });
    return { ok: false, error: 'unknown' };
  }
}
