ALTER TABLE "accounts" ADD COLUMN IF NOT EXISTS "account_number" text;--> statement-breakpoint
ALTER TABLE "imports" ADD COLUMN IF NOT EXISTS "statement_account_ref" text;