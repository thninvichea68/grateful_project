ALTER TABLE "accounting_records" DROP CONSTRAINT "accounting_records_declaration_id_unique";--> statement-breakpoint
ALTER TABLE "accounting_records" ADD COLUMN "kind" text DEFAULT 'SERVICE' NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "accounting_records_declaration_kind_unique" ON "accounting_records" USING btree ("declaration_id","kind");--> statement-breakpoint
ALTER TABLE "accounting_records" ADD CONSTRAINT "accounting_records_kind" CHECK ("accounting_records"."kind" IN ('SERVICE', 'AGENCY'));