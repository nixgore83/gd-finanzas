import { eq, sql } from 'drizzle-orm';
import { imports, importLines } from '@/db/schema';
import type { DB } from '@/lib/db/client';

export type ImportPeriod = { start: string | null; end: string | null };

const MONTHS_ES = [
  'ene', 'feb', 'mar', 'abr', 'may', 'jun',
  'jul', 'ago', 'sep', 'oct', 'nov', 'dic',
] as const;

/**
 * `YYYY-MM-DD` → `9 jun 2026`. Formateo manual y no `Intl`: los períodos son
 * fechas SIN hora, y pasarlas por `new Date()` las corre un día según la zona
 * horaria del server (que en Vercel es UTC, no AR). Devuelve el string crudo si
 * no matchea el formato esperado.
 */
export function formatPeriodDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return iso;
  // Los grupos existen porque el regex matcheó; el `?? ''` es sólo para
  // `noUncheckedIndexedAccess`.
  const year = m[1] ?? '';
  const month = MONTHS_ES[Number.parseInt(m[2] ?? '', 10) - 1];
  const day = Number.parseInt(m[3] ?? '', 10);
  if (!month) return iso;
  return `${day} ${month} ${year}`;
}

/**
 * Rango legible del período de un extracto: `2 ene 2026 – 9 jun 2026`. Si ambos
 * extremos son el mismo día (típico de los resúmenes de TC que colapsan todos
 * los consumos en la fecha de cierre), muestra una sola fecha. `null` en el
 * inicio → guion: un import recién subido todavía no tiene período porque el
 * período se deriva de las líneas parseadas.
 */
export function formatPeriodRange(start: string | null, end: string | null): string {
  if (!start) return end ? formatPeriodDate(end) : '—';
  const a = formatPeriodDate(start);
  const b = end ? formatPeriodDate(end) : a;
  return a === b ? a : `${a} – ${b}`;
}

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
