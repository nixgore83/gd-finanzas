'use server';

import { revalidatePath } from 'next/cache';
import { and, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import { getDb } from '@/lib/db/client';
import { categories, imports, importLines } from '@/db/schema';
import { requireHouseholdSession, SessionError } from '@/lib/auth/session';
import { parsedTxLineSchema, type ParsedTxLine } from '@/lib/imports/parsers/types';

const inputSchema = z.object({
  importId: z.string().uuid(),
  lineIds: z.array(z.string().uuid()).min(1).max(500),
  categoryId: z.string().uuid(),
});

export type BulkSetCategoryResult =
  | { ok: true; updated: number; skipped: number; skippedReason?: string }
  | {
      ok: false;
      error:
        | 'session'
        | 'invalid_input'
        | 'not_found'
        | 'category_mismatch_all'
        | 'unknown';
    };

/**
 * Asigna `categoryId` a un conjunto de import_lines en bloque. Cada línea
 * actualizada queda con status='edited'. Las líneas cuyo `parsed_data.kind` no
 * matchee `categories.kind` se saltan (no rompen el batch); se reporta
 * `skipped`.
 */
export async function bulkSetCategory(input: {
  importId: string;
  lineIds: string[];
  categoryId: string;
}): Promise<BulkSetCategoryResult> {
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

  const [cat] = await db
    .select({ id: categories.id, kind: categories.kind })
    .from(categories)
    .where(
      and(
        eq(categories.id, parsed.data.categoryId),
        eq(categories.householdId, session.householdId),
      ),
    )
    .limit(1);
  if (!cat) return { ok: false, error: 'not_found' };

  // Filtrar las líneas cuyo kind matchea la cat.kind.
  const rows = await db
    .select({
      id: importLines.id,
      parsedData: importLines.parsedData,
    })
    .from(importLines)
    .where(
      and(
        eq(importLines.importId, parsed.data.importId),
        inArray(importLines.id, parsed.data.lineIds),
      ),
    );

  const targetIds: string[] = [];
  // Asignar categoría implica NO transferencia: las líneas target que sean transfer
  // se desmarcan y se les limpia la contraparte.
  const transferTargets: Array<{ id: string; parsed: ParsedTxLine }> = [];
  let skipped = 0;
  for (const r of rows) {
    const pd = parsedTxLineSchema.safeParse(r.parsedData);
    if (!pd.success) {
      skipped += 1;
      continue;
    }
    if (pd.data.kind !== cat.kind) {
      skipped += 1;
      continue;
    }
    targetIds.push(r.id);
    if (pd.data.isTransfer) {
      transferTargets.push({
        id: r.id,
        parsed: { ...pd.data, isTransfer: false, transferAccountId: undefined },
      });
    }
  }

  if (targetIds.length === 0) {
    return { ok: false, error: 'category_mismatch_all' };
  }

  try {
    const updated = await db
      .update(importLines)
      .set({ proposedCategoryId: parsed.data.categoryId, status: 'edited' })
      .where(
        and(
          eq(importLines.importId, parsed.data.importId),
          inArray(importLines.id, targetIds),
        ),
      )
      .returning({ id: importLines.id });

    // Persistir el desmarcado de transfer en las líneas que lo eran.
    for (const t of transferTargets) {
      await db
        .update(importLines)
        .set({ parsedData: t.parsed })
        .where(
          and(
            eq(importLines.importId, parsed.data.importId),
            eq(importLines.id, t.id),
          ),
        );
    }

    revalidatePath(`/imports/${parsed.data.importId}`);
    return {
      ok: true,
      updated: updated.length,
      skipped,
      skippedReason: skipped > 0 ? 'kind no coincide con la categoría' : undefined,
    };
  } catch (err) {
    console.error('[imports] bulk-set-category failed', {
      code: (err as { code?: string }).code,
    });
    return { ok: false, error: 'unknown' };
  }
}
