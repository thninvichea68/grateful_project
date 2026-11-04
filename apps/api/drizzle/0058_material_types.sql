-- Import / export types: the old list (Fabric, Trims & Accessories…) is hidden, not deleted,
-- so Settings can bring one back; shipments keep the type they were saved with.
UPDATE "lookup_values" SET "is_active" = false, "updated_at" = now()
WHERE "type" = 'MATERIAL' AND "value" IN ('Fabric', 'Trims & Accessories', 'Machinery', 'Packing Material', 'Garments');
--> statement-breakpoint
INSERT INTO "lookup_values" ("type", "value", "label", "sort_order") VALUES
  ('MATERIAL', 'Garments & Apparel', 'Garments & Apparel', 0),
  ('MATERIAL', 'Footwear', 'Footwear', 1),
  ('MATERIAL', 'Textiles & Fabrics', 'Textiles & Fabrics', 2),
  ('MATERIAL', 'Vehicles & Automotive', 'Vehicles & Automotive', 3),
  ('MATERIAL', 'Machinery & Equipment', 'Machinery & Equipment', 4),
  ('MATERIAL', 'Electronics & Electrical Goods', 'Electronics & Electrical Goods', 5),
  ('MATERIAL', 'Food & Beverages', 'Food & Beverages', 6),
  ('MATERIAL', 'Agricultural Products', 'Agricultural Products', 7),
  ('MATERIAL', 'Chemicals', 'Chemicals', 8),
  ('MATERIAL', 'Pharmaceuticals & Medical Supplies', 'Pharmaceuticals & Medical Supplies', 9)
ON CONFLICT ("type", "value") DO UPDATE
  SET "label" = EXCLUDED."label", "sort_order" = EXCLUDED."sort_order", "is_active" = true, "updated_at" = now();
