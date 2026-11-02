ALTER TABLE "clients" ADD COLUMN "signatory_name" text;--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "signatory_id_no" text;--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "signatory_title" text;--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "signatory_title_km" text;--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "letter_phone" text;--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "cdc_extension_letter_no" text;--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "customs_note_date" date;--> statement-breakpoint
-- Carry over the signatories that were written into the code (JR's INV + PL letters, VFL's transfer of rights).
UPDATE "clients" SET
  "signatory_name" = coalesce("signatory_name", 'LIN LEE BI JEN'),
  "signatory_id_no" = coalesce("signatory_id_no", '353387543'),
  "signatory_title" = coalesce("signatory_title", 'GENERAL MANAGER'),
  "signatory_title_km" = coalesce("signatory_title_km", 'ជ.នាយកក្រុមហ៊ុន JR APPAREL'),
  "letter_phone" = coalesce("letter_phone", '077 777 469'),
  "cdc_extension_letter_no" = coalesce("cdc_extension_letter_no", '1343/26'),
  "customs_note_date" = coalesce("customs_note_date", '2026-05-22')
WHERE "code" = 'JR';--> statement-breakpoint
UPDATE "clients" SET
  "signatory_name" = coalesce("signatory_name", 'YANG HUI CHEN'),
  "signatory_id_no" = coalesce("signatory_id_no", '366480666'),
  "letter_phone" = coalesce("letter_phone", '096 650 4646'),
  "vattin" = coalesce("vattin", 'L001-100182895')
WHERE "code" = 'VFL';
