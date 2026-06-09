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
  isTransfer: z.boolean(),
});

export type BulkSetTransferResult =
  | { ok: true; updated: number }
  | { ok: false; error: 'session' | 'invalid_input' | 'not_found' | 'unknown' };

/**
 * Marca/desmarca en bloque `isTransfer` en `parsed_data` para un conjunto de
 * import_lines (caso típico: la detección automática marcó como transferencia
 * pagos a terceros que en realidad son gastos). Cada línea queda con
 * status='edited'.
 *
 * Reglas (consistentes con update-line / bulk-set-category):
 * - Marcar como transferencia limpia la categoría propuesta (las transferencias
 *   no llevan categoría).
 * - Desmarcar limpia la cuenta contraparte (`transferAccountId`) y deja la
 *   categoría como esté (normalmente se asigna después con el bulk de categoría).
 */
export async function bulkSetTransfer(input: {
  importId: string;
  lineIds: string[];
  isTransfer: boolean;
}): Promise<BulkSetTransferResult> {
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

  // Marcar: setear isTransfer=true. Desmarcar: isTransfer=false + quitar la
  // cuenta contraparte para no dejar un valor colgado.
  const newParsed = parsed.data.isTransfer
    ? sql`jsonb_set(${importLines.parsedData}, '{isTransfer}', 'true'::jsonb)`
    : sql`jsonb_set(${importLines.parsedData}, '{isTransfer}', 'false'::jsonb) - 'transferAccountId'`;

  try {
    const updated = await db
      .update(importLines)
      .set({
        parsedData: newParsed,
        // Marcar como transferencia limpia la categoría; desmarcar no la toca.
        ...(parsed.data.isTransfer ? { proposedCategoryId: null } : {}),
        status: 'edited',
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
    console.error('[imports] bulk-set-transfer failed', {
      code: (err as { code?: string }).code,
    });
    return { ok: false, error: 'unknown' };
  }
}
