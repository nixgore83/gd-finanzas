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
  label: z.string().trim().min(1).max(120),
});

export type BulkSetCounterpartyLabelResult =
  | { ok: true; updated: number }
  | { ok: false; error: 'session' | 'invalid_input' | 'not_found' | 'unknown' };

/**
 * Setea la etiqueta amigable (`parsed_data.counterparty.label`) en bloque.
 * Callers: la propagación intra-import (tras etiquetar una línea, aplicar a las
 * hermanas con la misma contraparte) y el bulk "Contraparte" de la barra de
 * selección. Si la línea no tiene counterparty crea `{label}` — sin inventar
 * identificadores: un counterparty solo-label no tiene identidad y no participa
 * del matching ni de las sugerencias (ver counterparty-identity.ts). No cambia
 * el status (es metadata de display, no requiere re-revisión).
 */
export async function bulkSetCounterpartyLabel(input: {
  importId: string;
  lineIds: string[];
  label: string;
}): Promise<BulkSetCounterpartyLabelResult> {
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
        parsedData: sql`jsonb_set(
          ${importLines.parsedData},
          '{counterparty}',
          coalesce(${importLines.parsedData} -> 'counterparty', '{}'::jsonb)
            || jsonb_build_object('label', ${parsed.data.label}::text)
        )`,
      })
      .where(
        and(
          eq(importLines.importId, parsed.data.importId),
          inArray(importLines.id, parsed.data.lineIds),
        ),
      )
      .returning({ id: importLines.id });
    revalidatePath(`/imports/${parsed.data.importId}`);
    return { ok: true, updated: updated.length };
  } catch (err) {
    console.error('[imports] bulk-set-counterparty-label failed', {
      code: (err as { code?: string }).code,
    });
    return { ok: false, error: 'unknown' };
  }
}
