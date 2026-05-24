CREATE TYPE "public"."asset_type" AS ENUM('stock', 'etf', 'bond', 'cedear', 'fci', 'crypto', 'other');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "account_balances" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"snapshot_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"balance" numeric(18, 2) NOT NULL,
	"currency" "currency" NOT NULL,
	"balance_usd" numeric(18, 2) NOT NULL,
	"fx_rate_used" numeric(18, 6),
	"fx_rate_source" text,
	CONSTRAINT "account_balances_snapshot_account_uq" UNIQUE("snapshot_id","account_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "holdings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"snapshot_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"ticker" text NOT NULL,
	"name" text NOT NULL,
	"asset_type" "asset_type" NOT NULL,
	"quantity" numeric(18, 6) NOT NULL,
	"price_per_unit" numeric(18, 6) NOT NULL,
	"currency" "currency" NOT NULL,
	"total_value" numeric(18, 2) NOT NULL,
	"total_value_usd" numeric(18, 2) NOT NULL,
	"fx_rate_used" numeric(18, 6),
	"fx_rate_source" text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "net_worth_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"date" date NOT NULL,
	"total_usd" numeric(18, 2) NOT NULL,
	"notes" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "net_worth_snapshots_household_date_uq" UNIQUE("household_id","date")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "account_balances" ADD CONSTRAINT "account_balances_snapshot_id_net_worth_snapshots_id_fk" FOREIGN KEY ("snapshot_id") REFERENCES "public"."net_worth_snapshots"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "account_balances" ADD CONSTRAINT "account_balances_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "holdings" ADD CONSTRAINT "holdings_snapshot_id_net_worth_snapshots_id_fk" FOREIGN KEY ("snapshot_id") REFERENCES "public"."net_worth_snapshots"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "holdings" ADD CONSTRAINT "holdings_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "net_worth_snapshots" ADD CONSTRAINT "net_worth_snapshots_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "net_worth_snapshots" ADD CONSTRAINT "net_worth_snapshots_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "holdings_snapshot_idx" ON "holdings" USING btree ("snapshot_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "net_worth_snapshots_household_idx" ON "net_worth_snapshots" USING btree ("household_id");