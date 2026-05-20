/**
 * CSV serializer simple, UTF-8 con BOM (Excel-friendly).
 *
 * - Comillas dobles solo si el valor contiene `,`, `"`, `\n` o `\r`.
 * - Comillas dobles internas se escapan duplicándolas.
 * - `null` / `undefined` → string vacío.
 * - Booleans → "true"/"false".
 * - Numbers se serializan con `String()` (sin transform de locale).
 *
 * Función pura, sin DB ni I/O.
 */

const UTF8_BOM = '﻿';

function escapeCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  let s: string;
  if (typeof value === 'string') s = value;
  else if (typeof value === 'number' || typeof value === 'bigint') s = String(value);
  else if (typeof value === 'boolean') s = value ? 'true' : 'false';
  else s = String(value);
  if (/[",\n\r]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

export function toCsv<T extends Record<string, unknown>>(
  rows: readonly T[],
  headers: readonly { key: keyof T & string; label: string }[],
): string {
  const headerLine = headers.map((h) => escapeCell(h.label)).join(',');
  const dataLines = rows.map((row) =>
    headers.map((h) => escapeCell(row[h.key])).join(','),
  );
  return UTF8_BOM + [headerLine, ...dataLines].join('\r\n') + '\r\n';
}
