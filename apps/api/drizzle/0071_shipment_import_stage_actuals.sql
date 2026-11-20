ALTER TABLE "shipments" ADD COLUMN "permit_date" date;--> statement-breakpoint
ALTER TABLE "shipments" ADD COLUMN "authorize_date" date;--> statement-breakpoint
UPDATE "shipments" AS s
SET "permit_date" = (f."actual_at" AT TIME ZONE 'Asia/Phnom_Penh')::date
FROM "follow_ups" AS f
JOIN "milestone_rules" AS mr ON mr."id" = f."milestone_rule_id"
WHERE f."shipment_id" = s."id"
  AND f."deleted_at" IS NULL
  AND f."actual_at" IS NOT NULL
  AND mr."code" IN ('PERMIT_APPROVED', 'PERMIT_READY');--> statement-breakpoint
UPDATE "shipments" AS s
SET "authorize_date" = (f."actual_at" AT TIME ZONE 'Asia/Phnom_Penh')::date
FROM "follow_ups" AS f
JOIN "milestone_rules" AS mr ON mr."id" = f."milestone_rule_id"
WHERE f."shipment_id" = s."id"
  AND f."deleted_at" IS NULL
  AND f."actual_at" IS NOT NULL
  AND mr."code" = 'CUSTOMER_SIGNING_DONE';--> statement-breakpoint
UPDATE "milestone_rules"
SET "completion_field" = 'PERMIT_DATE'
WHERE ("mode", "code") IN (
  ('SEA_IMPORT', 'PERMIT_APPROVED'),
  ('AIR_IMPORT', 'PERMIT_READY')
);--> statement-breakpoint
UPDATE "milestone_rules"
SET "completion_field" = 'AUTHORIZE_DATE'
WHERE "mode" = 'SEA_IMPORT' AND "code" = 'CUSTOMER_SIGNING_DONE';