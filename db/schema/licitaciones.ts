import { pgTable, uuid, text, integer, date, timestamp, index, jsonb } from 'drizzle-orm/pg-core';
import { households } from './households';
import { authUsers } from './auth';
import { licitacionesJobStatusEnum } from './enums';

/**
 * Jobs del módulo Calendario de Licitaciones. Pau sube PDFs de avisos de
 * suscripción/colocación/complementarios, un microservicio Python (wrapper de
 * `procesar.py`) los extrae con Claude y arma el Excel semanal; este registro
 * es la máquina de estados de ese procesamiento.
 *
 * Patrón idéntico a `imports`: estado en DB + `processing_started_at` para que
 * el reaper detecte jobs cortados (el trabajo corre async con `after()`, no es
 * durable). Dominio ajeno a finanzas — autocontenido y extraíble a futuro.
 */
/**
 * Un PDF de la tanda que el microservicio no pudo procesar, con el motivo. El
 * nombre es el sintético con el que viaja al micro (`input_N.pdf`, mismo índice
 * que `input_file_paths`): no guardamos el nombre original del archivo.
 */
export type LicitacionPdfError = { pdf: string; error: string };

export const licitacionesJobs = pgTable(
  'licitaciones_jobs',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    householdId: uuid('household_id')
      .notNull()
      .references(() => households.id, { onDelete: 'cascade' }),
    status: licitacionesJobStatusEnum('status').notNull().default('uploaded'),
    // Paths de los PDFs de entrada en Supabase Storage (bucket `licitaciones`).
    inputFilePaths: text('input_file_paths').array().notNull(),
    // Path del Excel resultante en Storage. Null hasta completar.
    outputFilePath: text('output_file_path'),
    pdfCount: integer('pdf_count').notNull(),
    // Cuántos de esos PDFs pudo procesar el micro. Puede ser < pdfCount: un PDF
    // que rompe no aborta la tanda, el Excel sale con el resto. Null en jobs
    // viejos (o si el micro desplegado todavía no reporta el detalle).
    pdfsOk: integer('pdfs_ok'),
    // Los que fallaron y por qué. Null/[] = ninguno. Los motivos vienen del
    // header X-Warnings del micro (ASCII, truncados); nunca traen signed URLs.
    pdfErrors: jsonb('pdf_errors').$type<LicitacionPdfError[]>(),
    // Modelo usado por el microservicio (lo reporta en la respuesta). Default de
    // negocio: claude-sonnet-4-5 (ver lib/schemas/licitaciones).
    modelo: text('modelo').notNull(),
    // Override de la fecha del lunes objetivo (equivale al flag --lunes del
    // script). Null = próximo lunes calculado por el microservicio.
    lunesOverride: date('lunes_override'),
    errorMessage: text('error_message'),
    // Momento en que arrancó el procesamiento (status='processing'); permite al
    // reaper detectar jobs colgados.
    processingStartedAt: timestamp('processing_started_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    createdBy: uuid('created_by').references(() => authUsers.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index('licitaciones_jobs_household_idx').on(table.householdId)],
);
