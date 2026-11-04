ALTER TABLE "public"."credit_notes" ALTER COLUMN "ref_type" SET DATA TYPE text;--> statement-breakpoint
-- "House bill" is gone: an air shipment's credit note refers to its HAWB no., any other to its BL no.
UPDATE "credit_notes" cn SET "ref_type" = CASE WHEN s."transport_mode" = 'AIR' THEN 'HAWB_NO' ELSE 'BILL_NO' END
FROM "credit_notes" x
LEFT JOIN "accounting_records" a ON a."id" = x."accounting_record_id"
LEFT JOIN "customs_declarations" d ON d."id" = a."declaration_id"
  OR (a."id" IS NULL AND upper(d."declare_no") = upper(x."declare_no"))
LEFT JOIN "shipments" s ON s."id" = d."shipment_id"
WHERE cn."id" = x."id" AND cn."ref_type" = 'HOUSE_BILL';--> statement-breakpoint
DROP TYPE "public"."credit_note_ref_type";--> statement-breakpoint
CREATE TYPE "public"."credit_note_ref_type" AS ENUM('BILL_NO', 'HAWB_NO');--> statement-breakpoint
ALTER TABLE "public"."credit_notes" ALTER COLUMN "ref_type" SET DATA TYPE "public"."credit_note_ref_type" USING "ref_type"::"public"."credit_note_ref_type";
