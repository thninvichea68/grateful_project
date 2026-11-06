-- Older VFL and SAK imports: the shipment's Cargo Quantity was typed, but its items have no Pkgs.
-- Cargo Quantity now follows the items' Pkgs total, so where a shipment has exactly one item, that
-- item takes the typed quantity as its Pkgs. Shipments with several items (none today) or with
-- no invoice are left alone: there is no single item to give the number to.
UPDATE "cargo_invoice_lines" AS l
SET "ctns" = s."quantity", "updated_at" = now()
FROM "cargo_invoices" AS i
JOIN "shipments" AS s ON s."id" = i."shipment_id"
JOIN "clients" AS c ON c."id" = s."client_id"
WHERE l."invoice_id" = i."id"
  AND c."code" IN ('VFL', 'SAK')
  AND s."direction" = 'IMPORT'
  AND s."quantity" > 0
  AND (
    SELECT count(*) FROM "cargo_invoice_lines" l2
    JOIN "cargo_invoices" i2 ON i2."id" = l2."invoice_id"
    WHERE i2."shipment_id" = s."id"
  ) = 1
  AND (
    SELECT coalesce(sum(l2."ctns"), 0) FROM "cargo_invoice_lines" l2
    JOIN "cargo_invoices" i2 ON i2."id" = l2."invoice_id"
    WHERE i2."shipment_id" = s."id"
  ) = 0;
