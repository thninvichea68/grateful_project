CREATE TABLE IF NOT EXISTS "milestone_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"mode" text NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"sequence" integer NOT NULL,
	"anchor_code" text NOT NULL,
	"offset_value" integer DEFAULT 0 NOT NULL,
	"offset_unit" text DEFAULT 'DAYS' NOT NULL,
	"owner_role" text NOT NULL,
	"completion_field" text,
	"remind_before" integer DEFAULT 0 NOT NULL,
	"escalate_after" integer DEFAULT 1 NOT NULL,
	"skip_when_cleared_by_other" boolean DEFAULT false NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "milestone_rules_mode_check" CHECK ("milestone_rules"."mode" IN ('SEA_IMPORT', 'SEA_EXPORT', 'AIR_IMPORT', 'AIR_EXPORT')),
	CONSTRAINT "milestone_rules_offset_unit_check" CHECK ("milestone_rules"."offset_unit" IN ('DAYS', 'HOURS'))
);
--> statement-breakpoint
ALTER TABLE "shipments" ADD COLUMN "cleared_by" text DEFAULT 'GS' NOT NULL;--> statement-breakpoint
ALTER TABLE "shipments" ADD COLUMN "air_cutoff_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "shipments" ADD COLUMN "cy_cutoff_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "shipments" ADD COLUMN "si_cutoff_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "shipments" ADD COLUMN "vgm_cutoff_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "shipments" ADD COLUMN "stuffing_date" date;--> statement-breakpoint
ALTER TABLE "follow_ups" ADD COLUMN "milestone_rule_id" uuid;--> statement-breakpoint
ALTER TABLE "follow_ups" ADD COLUMN "planned_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "follow_ups" ADD COLUMN "actual_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "follow_ups" ADD COLUMN "completed_by_id" uuid;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "milestone_rules_mode_code_unique" ON "milestone_rules" USING btree ("mode","code");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "milestone_rules_mode_sequence_idx" ON "milestone_rules" USING btree ("mode","sequence");--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "follow_ups" ADD CONSTRAINT "follow_ups_milestone_rule_id_milestone_rules_id_fk" FOREIGN KEY ("milestone_rule_id") REFERENCES "public"."milestone_rules"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "follow_ups" ADD CONSTRAINT "follow_ups_completed_by_id_users_id_fk" FOREIGN KEY ("completed_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "follow_ups_shipment_milestone_unique" ON "follow_ups" USING btree ("shipment_id","milestone_rule_id") WHERE "follow_ups"."milestone_rule_id" IS NOT NULL AND "follow_ups"."shipment_id" IS NOT NULL;
--> statement-breakpoint
UPDATE "follow_ups" SET "actual_at" = "completed_at" WHERE "status" = 'DONE' AND "actual_at" IS NULL;
--> statement-breakpoint
INSERT INTO "milestone_rules" (
	"mode", "code", "name", "sequence", "anchor_code", "offset_value", "offset_unit",
	"owner_role", "completion_field", "remind_before", "escalate_after", "skip_when_cleared_by_other"
) VALUES
	('SEA_IMPORT', 'PRE_ALERT_RECEIVED', 'Pre-alert received (B/L, INV, PL)', 1, 'CREATED_AT', 0, 'DAYS', 'Operator', 'CREATED_AT', 0, 1, false),
	('SEA_IMPORT', 'DOCUMENT_CHECK', 'Document check (INV/PL vs CDC master list)', 2, 'MILESTONE:PRE_ALERT_RECEIVED', 1, 'DAYS', 'Operator', null, 0, 1, false),
	('SEA_IMPORT', 'NSW_PERMIT_SUBMITTED', 'NSW permit package submitted', 3, 'ETA', -3, 'DAYS', 'Operator', null, 48, 1, false),
	('SEA_IMPORT', 'CUSTOMER_SIGNING_DONE', 'Customer signing done', 4, 'ETA', -2, 'DAYS', 'Operator / CS', null, 24, 1, false),
	('SEA_IMPORT', 'PERMIT_APPROVED', 'Permit approved', 5, 'ETA', -1, 'DAYS', 'Ops Manager', null, 24, 0, false),
	('SEA_IMPORT', 'ETA', 'ETA', 6, 'ETA', 0, 'DAYS', 'Operator', null, 72, 1, false),
	('SEA_IMPORT', 'ATA', 'ATA (port arrived)', 7, 'ETA', 0, 'DAYS', 'Operator', 'ATA', 0, 1, false),
	('SEA_IMPORT', 'DO_COLLECTED', 'DO collected, local charges paid', 8, 'ATA', 0, 'DAYS', 'Accountant / Operator', 'DO_DATE', 0, 1, false),
	('SEA_IMPORT', 'CUSTOMS_CLEARANCE', 'Customs clearance (released)', 9, 'ATA', 1, 'DAYS', 'Ops Manager', null, 0, 0, false),
	('SEA_IMPORT', 'UNSTUFF', 'Unstuff', 10, 'ATA', 2, 'DAYS', 'Operator', null, 24, 1, false),
	('SEA_IMPORT', 'DELIVERED_EMPTY_RETURN', 'Delivered to factory, empty container returned', 11, 'MILESTONE:UNSTUFF', 0, 'DAYS', 'Operator', null, 48, 1, false),
	('SEA_IMPORT', 'JOB_CLOSED', 'Job closed (record summary, billing)', 12, 'MILESTONE:DELIVERED_EMPTY_RETURN', 2, 'DAYS', 'Operator / Accountant', null, 0, 1, false),
	('SEA_EXPORT', 'BOOKING_CONFIRMED', 'Booking confirmed (ETD, CY/SI/VGM cut-offs)', 1, 'CREATED_AT', 0, 'DAYS', 'Operator', 'CREATED_AT', 0, 1, false),
	('SEA_EXPORT', 'FINAL_INV_PL', 'Final INV/PL from client', 2, 'CY_CUTOFF', -3, 'DAYS', 'Operator / CS', null, 24, 1, false),
	('SEA_EXPORT', 'STUFFING_LOADING', 'Stuffing / loading at factory', 3, 'STUFFING_DATE', 0, 'DAYS', 'Operator', 'STUFFING_DATE', 24, 1, false),
	('SEA_EXPORT', 'EXPORT_DECL_RELEASED', 'Export declaration released', 4, 'CY_CUTOFF', -1, 'DAYS', 'Ops Manager', null, 0, 1, true),
	('SEA_EXPORT', 'SI_SUBMITTED', 'Shipping instructions submitted', 5, 'SI_CUTOFF', 0, 'HOURS', 'Operator', null, 24, 1, false),
	('SEA_EXPORT', 'VGM_SUBMITTED', 'VGM submitted', 6, 'VGM_CUTOFF', 0, 'HOURS', 'Operator', null, 24, 1, false),
	('SEA_EXPORT', 'CONTAINER_GATE_IN', 'Container gate-in at port', 7, 'CY_CUTOFF', 0, 'HOURS', 'Operator', null, 0, 0, false),
	('SEA_EXPORT', 'ETD_ATD', 'ETD / ATD', 8, 'ETD', 0, 'DAYS', 'Operator', 'ATD', 0, 1, false),
	('SEA_EXPORT', 'BL_ISSUED', 'B/L draft confirmed, B/L issued', 9, 'MILESTONE:ETD_ATD', 1, 'DAYS', 'Operator', null, 0, 1, false),
	('SEA_EXPORT', 'CO_DOCS_SENT', 'CO issued, docs sent to client', 10, 'MILESTONE:ETD_ATD', 2, 'DAYS', 'Operator', null, 0, 1, false),
	('SEA_EXPORT', 'JOB_CLOSED', 'Job closed', 11, 'MILESTONE:ETD_ATD', 3, 'DAYS', 'Operator / Accountant', null, 0, 1, false),
	('AIR_IMPORT', 'PRE_ALERT_RECEIVED', 'Pre-alert received (MAWB/HAWB, flight no., INV, PL)', 1, 'CREATED_AT', 0, 'DAYS', 'Operator', 'CREATED_AT', 0, 1, false),
	('AIR_IMPORT', 'DOCUMENT_CHECK', 'Document check', 2, 'MILESTONE:PRE_ALERT_RECEIVED', 0, 'DAYS', 'Operator', null, 0, 1, false),
	('AIR_IMPORT', 'PERMIT_READY', 'Permit package ready and signed', 3, 'ETA', -1, 'DAYS', 'Operator / Ops Manager', null, 24, 0, false),
	('AIR_IMPORT', 'ETA', 'ETA (flight)', 4, 'ETA', 0, 'DAYS', 'Operator', null, 12, 1, false),
	('AIR_IMPORT', 'ATA', 'ATA (flight arrived)', 5, 'ETA', 0, 'DAYS', 'Operator', 'ATA', 0, 1, false),
	('AIR_IMPORT', 'CUSTOMS_CLEARANCE', 'Customs clearance', 6, 'ATA', 1, 'DAYS', 'Ops Manager', null, 0, 0, false),
	('AIR_IMPORT', 'DELIVERED', 'Delivered to client', 7, 'MILESTONE:CUSTOMS_CLEARANCE', 0, 'DAYS', 'Operator', null, 0, 1, false),
	('AIR_IMPORT', 'JOB_CLOSED', 'Job closed', 8, 'MILESTONE:DELIVERED', 2, 'DAYS', 'Operator / Accountant', null, 0, 1, false),
	('AIR_EXPORT', 'BOOKING_CONFIRMED', 'Booking confirmed (flight no., flight date, check-in, cut-off)', 1, 'CREATED_AT', 0, 'DAYS', 'Operator', 'CREATED_AT', 0, 1, false),
	('AIR_EXPORT', 'FINAL_INV_PL', 'Final INV/PL from client', 2, 'CHECKIN', -2, 'DAYS', 'Operator / CS', null, 24, 1, false),
	('AIR_EXPORT', 'EXPORT_DECL_RELEASED', 'Export declaration released', 3, 'CHECKIN', -1, 'DAYS', 'Ops Manager', null, 0, 1, true),
	('AIR_EXPORT', 'CARGO_CHECKED_IN', 'Cargo checked in at terminal', 4, 'AIR_CUTOFF', 0, 'HOURS', 'Operator', null, 6, 0, false),
	('AIR_EXPORT', 'FLIGHT_DEPARTED', 'Flight departed (ATD)', 5, 'ETD', 0, 'DAYS', 'Operator', 'ATD', 0, 1, false),
	('AIR_EXPORT', 'AWB_ISSUED', 'AWB issued, pre-alert sent to consignee', 6, 'ETD', 0, 'DAYS', 'Operator', null, 0, 1, false),
	('AIR_EXPORT', 'JOB_CLOSED', 'Job closed', 7, 'ETD', 2, 'DAYS', 'Operator / Accountant', null, 0, 1, false)
ON CONFLICT ("mode", "code") DO NOTHING;