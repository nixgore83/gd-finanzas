import { z } from 'zod';

/** Modelo de extracción por default (lo que usa procesar.py hoy). El microservicio
 *  lo puede sobreescribir vía env var LICITACIONES_MODEL; este es el fallback que
 *  registramos cuando la respuesta no informa cuál usó. */
export const DEFAULT_LICITACIONES_MODEL = 'claude-sonnet-4-5';

/** Bucket de Storage del módulo. Constante client-safe (la usa el form para la
 *  subida directa con signed URLs). */
export const LICITACIONES_BUCKET_NAME = 'licitaciones';

/** Máximo de PDFs por job (un set semanal típico es < 20). */
export const MAX_LICITACIONES_PDF_COUNT = 20;

/** Límite por archivo individual (los avisos son chicos, pero damos margen). */
export const MAX_LICITACIONES_FILE_BYTES = 20 * 1024 * 1024; // 20 MB

/** Límite total del batch (suma de todos los PDFs). */
export const MAX_LICITACIONES_TOTAL_BYTES = 50 * 1024 * 1024; // 50 MB

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Valida el override de la fecha del lunes (equivale al flag `--lunes`).
 * Acepta YYYY-MM-DD que sea una fecha real. Devuelve el string o null.
 */
export function parseLunesOverride(value: FormDataEntryValue | null): string | null {
  if (typeof value !== 'string' || value.trim() === '') return null;
  const v = value.trim();
  if (!ISO_DATE_RE.test(v)) return null;
  const d = new Date(`${v}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return null;
  // Re-serializar para descartar fechas tipo 2026-02-31 que Date "corrige".
  return d.toISOString().slice(0, 10) === v ? v : null;
}

/** Schema del override de lunes, para validación estricta cuando viene presente. */
export const lunesOverrideSchema = z
  .string()
  .regex(ISO_DATE_RE, 'Fecha inválida (usá YYYY-MM-DD)')
  .refine((v) => !Number.isNaN(new Date(`${v}T00:00:00Z`).getTime()), 'Fecha inexistente');

export function isPdfFilename(filename: string): boolean {
  return filename.toLowerCase().endsWith('.pdf');
}

export const LICITACIONES_PDF_CONTENT_TYPE = 'application/pdf';
export const LICITACIONES_XLSX_CONTENT_TYPE =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
