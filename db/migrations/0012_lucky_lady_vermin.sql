ALTER TABLE "imports" ADD COLUMN "period_start" date;--> statement-breakpoint
ALTER TABLE "imports" ADD COLUMN "period_end" date;--> statement-breakpoint
-- Backfill: derivar período de los imports existentes desde las fechas de sus import_lines.
UPDATE "imports" i SET
  "period_start" = sub.min_date,
  "period_end" = sub.max_date
FROM (
  SELECT
    "import_id",
    MIN(("parsed_data"->>'date'))::date AS min_date,
    MAX(("parsed_data"->>'date'))::date AS max_date
  FROM "import_lines"
  WHERE ("parsed_data"->>'date') ~ '^\d{4}-\d{2}-\d{2}'
  GROUP BY "import_id"
) sub
WHERE i."id" = sub."import_id";