ALTER TABLE "users" ADD COLUMN "alerts_seen_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "follow_ups" ADD COLUMN "rule" text;--> statement-breakpoint
ALTER TABLE "follow_ups" ADD COLUMN "rule_key" text;--> statement-breakpoint
ALTER TABLE "follow_ups" ADD COLUMN "auto_resolved_at" timestamp with time zone;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "follow_ups_rule_key_live_unique" ON "follow_ups" USING btree ("rule_key") WHERE "follow_ups"."auto_resolved_at" IS NULL;