'use server';

import { revalidatePath } from 'next/cache';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import { getDb } from '@/lib/db/client';
import { imports, importLines } from '@/db/schema';
import { requireHouseholdSession, SessionError } from '@/lib/auth/session';

const inputSchema = z.object({
  importId: z.string().uuid(),
  lineIds: z.array(z.string().uuid()).min(1).max(500),
  deducible: z.boolean(),
});

export type BulkSetDeducibleResult =
  | { ok: true; updated: number; skipped: number }
  | { ok: false; error: 'session' | 'invalid_input' | 'not_found' | 'unknown' };

/**
 * Marca/desmarca `deducibleGanancias` en bloque. Solo aplica a GASTOS no-transfer
 * (las demás se saltan y se reportan en `skipped`). Cada línea tocada queda
 * `edited` — es un dato fiscal que el usuario revisó.
 */
export async function bulkSetDeducible(input: {
  importId: string;
  lineIds: string[];
  deducible: boolean;
}): Promise<BulkSetDeducibleResult> {
  let session;
  try {
    session = await requireHouseholdSession();
  } catch (err) {
    if (err instanceof SessionError) return { ok: false, error: 'session' };
    throw err;
  }

  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'invalid_input' };

  const db = getDb();

  const [imp] = await db
    .select({ id: imports.id })
    .from(imports)
    .where(
      and(eq(imports.id, parsed.data.importId), eq(imports.householdId, session.householdId)),
    )
    .limit(1);
  if (!imp) return { ok: false, error: 'not_found' };

  try {
    const updated = await db
      .update(importLines)
      .set({
        parsedData: sql`jsonb_set(${importLines.parsedData}, '{deducibleGanancias}', ${parsed.data.deducible ? sql`'true'::jsonb` : sql`'false'::jsonb`})`,
        status: 'edited',
      })
      .where(
        and(
          eq(importLines.importId, parsed.data.importId),
          inArray(importLines.id, parsed.data.lineIds),
          // Solo gastos no-transfer (regla de negocio: deducible es de gastos).
          sql`${importLines.parsedData} ->> 'kind' = 'expense'`,
          sql`coalesce((${importLines.parsedData} ->> 'isTransfer')::boolean, false) = false`,
        ),
      )
      .returning({ id: importLines.id });
    revalidatePath(`/imports/${parsed.data.importId}`);
    return {
      ok: true,
      updated: updated.length,
      skipped: parsed.data.lineIds.length - updated.length,
    };
  } catch (err) {
    console.error('[imports] bulk-set-deducible failed', {
      code: (err as { code?: string }).code,
    });
    return { ok: false, error: 'unknown' };
  }
}
