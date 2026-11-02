ALTER TABLE "shipments" ADD COLUMN "permit_no" text;--> statement-breakpoint
ALTER TABLE "shipments" ADD COLUMN "permit_date" date;--> statement-breakpoint
ALTER TABLE "shipments" ADD COLUMN "arrival_notice_no" text;--> statement-breakpoint
ALTER TABLE "shipments" ADD COLUMN "arrival_notice_date" date;--> statement-breakpoint
ALTER TABLE "shipments" ADD COLUMN "do_no" text;--> statement-breakpoint
ALTER TABLE "shipments" ADD COLUMN "do_date" date;--> statement-breakpoint
ALTER TABLE "shipments" ADD COLUMN "authorize_no" text;--> statement-breakpoint
ALTER TABLE "shipments" ADD COLUMN "authorize_date" date;