import { eq, sql } from 'drizzle-orm';
import { imports, importLines } from '@/db/schema';
import type { DB } from '@/lib/db/client';

export type ImportPeriod = { start: string | null; end: string | null };

/**
 * Computa el período cubierto por un import (min/max de las fechas de sus
 * `import_lines.parsedData->>'date'`) y lo persiste en `imports.period_start` /
 * `imports.period_end`. Centraliza la derivación que antes hacía la página de
 * imports en runtime. Idempotente.
 *
 * Acepta un `DB` o un tx de Drizzle (mismo tipo de cliente).
 */
export async function computeImportPeriod(
  db: DB,
  importId: string,
): Promise<ImportPeriod> {
  const [agg] = await db
    .select({
      start: sql<string | null>`min(${importLines.parsedData}->>'date')`,
      end: sql<string | null>`max(${importLines.parsedData}->>'date')`,
    })
    .from(importLines)
    .where(eq(importLines.importId, importId));

  const start = agg?.start ?? null;
  const end = agg?.end ?? null;

  await db
    .update(imports)
    .set({ periodStart: start, periodEnd: end })
    .where(eq(imports.id, importId));

  return { start, end };
}
