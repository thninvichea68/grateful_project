ALTER TABLE "record_summaries" ADD COLUMN "ref_type" "credit_note_ref_type";--> statement-breakpoint
-- Existing summaries: an air shipment's number is its HAWB no., any other's its BL no.
UPDATE "record_summaries" SET "ref_type" = CASE WHEN "transport_mode" = 'AIR' THEN 'HAWB_NO'::"credit_note_ref_type" ELSE 'BILL_NO'::"credit_note_ref_type" END;
