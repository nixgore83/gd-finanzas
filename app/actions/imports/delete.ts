'use server';

import { revalidatePath } from 'next/cache';
import { and, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import { getDb } from '@/lib/db/client';
import { imports } from '@/db/schema';
import { requireHouseholdSession, SessionError } from '@/lib/auth/session';
import { DELETABLE_STATUSES } from '@/lib/imports/list-filters';

const inputSchema = z.object({
  ids: z.array(z.string().uuid()).min(1).max(200),
});

export type DeleteImportsResult =
  | { ok: true; deleted: number; skipped: number }
  | { ok: false; error: 'session' | 'invalid_input' | 'unknown' };

/**
 * Borra imports en bloque. Solo elimina los que están en estados que nunca
 * crearon transacciones (`DELETABLE_STATUSES`): los `confirmed` / `reviewing`
 * se saltan para no dejar transacciones huérfanas. Las `import_lines` se borran
 * por cascade (FK onDelete: 'cascade').
 */
export async function bulkDeleteImports(input: { ids: string[] }): Promise<DeleteImportsResult> {
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

  try {
    const deleted = await db
      .delete(imports)
      .where(
        and(
          eq(imports.householdId, session.householdId),
          inArray(imports.id, parsed.data.ids),
          inArray(imports.status, [...DELETABLE_STATUSES]),
        ),
      )
      .returning({ id: imports.id });

    revalidatePath('/imports');
    return {
      ok: true,
      deleted: deleted.length,
      skipped: parsed.data.ids.length - deleted.length,
    };
  } catch (err) {
    console.error('[imports] bulk-delete failed', {
      code: (err as { code?: string }).code,
    });
    return { ok: false, error: 'unknown' };
  }
}

/** Borra un único import. Atajo sobre `bulkDeleteImports`. */
export async function deleteImport(input: { id: string }): Promise<DeleteImportsResult> {
  return bulkDeleteImports({ ids: [input.id] });
}
