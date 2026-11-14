ALTER TABLE "debit_notes" ADD COLUMN "revised_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "disbursements" ADD COLUMN "revised_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "tax_invoices" ADD COLUMN "revised_at" timestamp with time zone;