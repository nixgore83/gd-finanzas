-- Meses marcados como "sin movimientos" por cuenta. Aditiva + idempotente.
-- (Aplicada a prod vía Supabase MCP; el journal de Drizzle no la registra, como 0013–0016.)
CREATE TABLE IF NOT EXISTS "account_skipped_months" (
  "household_id" uuid NOT NULL,
  "account_id" uuid NOT NULL,
  "year_month" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "created_by" uuid,
  CONSTRAINT "account_skipped_months_account_id_year_month_pk" PRIMARY KEY ("account_id", "year_month")
);

DO $$ BEGIN
  ALTER TABLE "account_skipped_months" ADD CONSTRAINT "account_skipped_months_household_id_households_id_fk"
    FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "account_skipped_months" ADD CONSTRAINT "account_skipped_months_account_id_accounts_id_fk"
    FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "account_skipped_months" ADD CONSTRAINT "account_skipped_months_created_by_users_id_fk"
    FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id") ON DELETE set null;
EXCEPTION WHEN duplicate_object THEN null; END $$;

CREATE INDEX IF NOT EXISTS "account_skipped_months_household_idx"
  ON "account_skipped_months" ("household_id");

-- RLS household-scoped (mismo patrón que el resto de las tablas con datos del usuario)
ALTER TABLE "account_skipped_months" ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "account_skipped_months_select" ON "account_skipped_months"
    FOR SELECT USING (household_id = current_household_id());
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE POLICY "account_skipped_months_insert" ON "account_skipped_months"
    FOR INSERT WITH CHECK (household_id = current_household_id());
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE POLICY "account_skipped_months_update" ON "account_skipped_months"
    FOR UPDATE USING (household_id = current_household_id())
    WITH CHECK (household_id = current_household_id());
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE POLICY "account_skipped_months_delete" ON "account_skipped_months"
    FOR DELETE USING (household_id = current_household_id());
EXCEPTION WHEN duplicate_object THEN null; END $$;
