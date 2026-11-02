ALTER TABLE "shipments" ADD COLUMN "assigned_to_id" uuid;--> statement-breakpoint
ALTER TABLE "shipments" ADD COLUMN "is_urgent" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "shipments" ADD COLUMN "permit_status" text;--> statement-breakpoint
ALTER TABLE "shipments" ADD COLUMN "truck_no" text;--> statement-breakpoint
ALTER TABLE "shipments" ADD COLUMN "driver_name" text;--> statement-breakpoint
ALTER TABLE "shipments" ADD COLUMN "driver_phone" text;--> statement-breakpoint
ALTER TABLE "shipments" ADD COLUMN "pod_received" boolean DEFAULT false NOT NULL;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "shipments" ADD CONSTRAINT "shipments_assigned_to_id_users_id_fk" FOREIGN KEY ("assigned_to_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
