CREATE TYPE "public"."card_brand" AS ENUM('visa', 'master', 'amex');--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "card_brand" "card_brand";