ALTER TYPE "public"."role_code" ADD VALUE 'SALES_MANAGER';--> statement-breakpoint
ALTER TABLE "quotation_charges" ADD COLUMN "cost" numeric(12, 2);--> statement-breakpoint
ALTER TABLE "quotation_lines" ADD COLUMN "costs" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
-- Quotation costs get their own permission: Admin has every permission, so it gets it too. The
-- new Sales Manager role row (with it) is added after migrating (see db/migrate.ts), because a
-- new enum value can't be used in the transaction that adds it.
UPDATE "roles" SET "permissions" = array_append("permissions", 'quotations:cost')
WHERE "code" = 'ADMIN' AND NOT ('quotations:cost' = ANY("permissions"));
