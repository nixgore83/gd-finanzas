-- Jobs del módulo Calendario de Licitaciones. Máquina de estados en DB +
-- processing_started_at para el reaper. Patrón idéntico a imports.
-- Aditiva + idempotente (aplicada a prod vía Supabase MCP, como 0013–0017).

DO $$ BEGIN
  CREATE TYPE "licitaciones_job_status" AS ENUM ('uploaded','processing','done','error');
EXCEPTION WHEN duplicate_object THEN null; END $$;

CREATE TABLE IF NOT EXISTS "licitaciones_jobs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "household_id" uuid NOT NULL,
  "status" "licitaciones_job_status" DEFAULT 'uploaded' NOT NULL,
  "input_file_paths" text[] NOT NULL,
  "output_file_path" text,
  "pdf_count" integer NOT NULL,
  "modelo" text NOT NULL,
  "lunes_override" date,
  "error_message" text,
  "processing_started_at" timestamp with time zone,
  "completed_at" timestamp with time zone,
  "created_by" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

DO $$ BEGIN
  ALTER TABLE "licitaciones_jobs" ADD CONSTRAINT "licitaciones_jobs_household_id_households_id_fk"
    FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "licitaciones_jobs" ADD CONSTRAINT "licitaciones_jobs_created_by_users_id_fk"
    FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id") ON DELETE set null;
EXCEPTION WHEN duplicate_object THEN null; END $$;

CREATE INDEX IF NOT EXISTS "licitaciones_jobs_household_idx"
  ON "licitaciones_jobs" ("household_id");

-- RLS household-scoped (mismo patrón que el resto de las tablas con datos del usuario)
ALTER TABLE "licitaciones_jobs" ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "licitaciones_jobs_select" ON "licitaciones_jobs"
    FOR SELECT USING (household_id = current_household_id());
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE POLICY "licitaciones_jobs_insert" ON "licitaciones_jobs"
    FOR INSERT WITH CHECK (household_id = current_household_id());
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE POLICY "licitaciones_jobs_update" ON "licitaciones_jobs"
    FOR UPDATE USING (household_id = current_household_id())
    WITH CHECK (household_id = current_household_id());
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE POLICY "licitaciones_jobs_delete" ON "licitaciones_jobs"
    FOR DELETE USING (household_id = current_household_id());
EXCEPTION WHEN duplicate_object THEN null; END $$;
