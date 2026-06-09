'use server';

import { revalidatePath } from 'next/cache';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { getDb } from '@/lib/db/client';
import { categories, imports, importLines } from '@/db/schema';
import { requireHouseholdSession, SessionError } from '@/lib/auth/session';
import { parsedTxLineSchema } from '@/lib/imports/parsers/types';
import { computeImportPeriod } from '@/lib/imports/period';

const updateLineSchema = z.object({
  lineId: z.string().uuid(),
  importId: z.string().uuid(),
  parsed: parsedTxLineSchema,
  proposedCategoryId: z.string().uuid().nullable(),
});

export type UpdateImportLineResult =
  | { ok: true }
  | { ok: false; error: 'session' | 'invalid_input' | 'not_found' | 'category_mismatch' | 'unknown' };

export async function updateImportLine(input: {
  lineId: string;
  importId: string;
  parsed: z.infer<typeof parsedTxLineSchema>;
  proposedCategoryId: string | null;
}): Promise<UpdateImportLineResult> {
  let session;
  try {
    session = await requireHouseholdSession();
  } catch (err) {
    if (err instanceof SessionError) return { ok: false, error: 'session' };
    throw err;
  }

  const parsed = updateLineSchema.safeParse(input);
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

  // Asignar categoría implica NO transferencia: si la línea venía marcada como
  // transfer pero se eligió una categoría, la desmarcamos y limpiamos la contraparte
  // (categoría y "cuenta contraparte" son mutuamente excluyentes).
  if (parsed.data.proposedCategoryId && parsed.data.parsed.isTransfer) {
    parsed.data.parsed = {
      ...parsed.data.parsed,
      isTransfer: false,
      transferAccountId: undefined,
    };
  }

  // Validar kind de la categoría (ya resuelto si la línea es transfer o no).
  if (parsed.data.proposedCategoryId && !parsed.data.parsed.isTransfer) {
    const [cat] = await db
      .select({ id: categories.id, kind: categories.kind })
      .from(categories)
      .where(
        and(
          eq(categories.id, parsed.data.proposedCategoryId),
          eq(categories.householdId, session.householdId),
        ),
      )
      .limit(1);
    if (!cat) return { ok: false, error: 'not_found' };
    if (cat.kind !== parsed.data.parsed.kind) {
      return { ok: false, error: 'category_mismatch' };
    }
  }

  // Si sigue siendo transfer (no se eligió categoría), no lleva categoría.
  if (parsed.data.parsed.isTransfer) {
    parsed.data.proposedCategoryId = null;
  }

  try {
    const updated = await db
      .update(importLines)
      .set({
        parsedData: parsed.data.parsed,
        proposedCategoryId: parsed.data.proposedCategoryId,
        status: 'edited',
      })
      .where(
        and(
          eq(importLines.id, parsed.data.lineId),
          eq(importLines.importId, parsed.data.importId),
        ),
      )
      .returning({ id: importLines.id });
    if (updated.length === 0) return { ok: false, error: 'not_found' };

    // La edición pudo cambiar la fecha de la línea → recomputar período del import.
    await computeImportPeriod(db, parsed.data.importId);

    revalidatePath(`/imports/${parsed.data.importId}`);
    return { ok: true };
  } catch (err) {
    console.error('[imports] update-line failed', {
      code: (err as { code?: string }).code,
    });
    return { ok: false, error: 'unknown' };
  }
}
