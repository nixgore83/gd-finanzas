'use server';

import { revalidatePath } from 'next/cache';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import { getDb } from '@/lib/db/client';
import { imports, importLines, tags } from '@/db/schema';
import { requireHouseholdSession, SessionError } from '@/lib/auth/session';

const inputSchema = z.object({
  importId: z.string().uuid(),
  lineIds: z.array(z.string().uuid()).min(1).max(500),
  /** Reemplaza el set completo de tags de cada línea ([] = limpiar). */
  tagIds: z.array(z.string().uuid()).max(20),
});

export type BulkSetTagsResult =
  | { ok: true; updated: number }
  | { ok: false; error: 'session' | 'invalid_input' | 'not_found' | 'unknown' };

/**
 * Setea `parsed_data.tagIds` en bloque (reemplaza el set). Vale para cualquier
 * línea, incluidas transferencias (ahí el tag es el clasificador). Cada línea
 * queda `edited`.
 */
export async function bulkSetTags(input: {
  importId: string;
  lineIds: string[];
  tagIds: string[];
}): Promise<BulkSetTagsResult> {
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

  // Filtrar tagIds contra los tags del household.
  let validTagIds: string[] = [];
  if (parsed.data.tagIds.length > 0) {
    const validTags = await db
      .select({ id: tags.id })
      .from(tags)
      .where(and(eq(tags.householdId, session.householdId), inArray(tags.id, parsed.data.tagIds)));
    validTagIds = validTags.map((t) => t.id);
  }

  try {
    const updated = await db
      .update(importLines)
      .set({
        parsedData: sql`jsonb_set(${importLines.parsedData}, '{tagIds}', ${JSON.stringify(validTagIds)}::jsonb)`,
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
    console.error('[imports] bulk-set-tags failed', {
      code: (err as { code?: string }).code,
    });
    return { ok: false, error: 'unknown' };
  }
}
