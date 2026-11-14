DROP INDEX IF EXISTS "cargo_invoices_invoice_no_unique";--> statement-breakpoint
ALTER TABLE "cargo_invoices" ADD COLUMN "client_id" uuid;--> statement-breakpoint
UPDATE "cargo_invoices" ci SET "client_id" = s."client_id" FROM "shipments" s WHERE s."id" = ci."shipment_id";--> statement-breakpoint
ALTER TABLE "cargo_invoices" ALTER COLUMN "client_id" SET NOT NULL;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "cargo_invoices" ADD CONSTRAINT "cargo_invoices_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "cargo_invoices_client_invoice_no_unique" ON "cargo_invoices" USING btree ("client_id",upper("invoice_no"));--> statement-breakpoint
-- An invoice's client is always its shipment's client (also fills rows restored from a snapshot).
CREATE OR REPLACE FUNCTION cargo_invoices_set_client() RETURNS trigger AS $$
BEGIN
  SELECT client_id INTO NEW.client_id FROM shipments WHERE id = NEW.shipment_id;
  RETURN NEW;
END $$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER cargo_invoices_set_client BEFORE INSERT OR UPDATE OF shipment_id, client_id ON cargo_invoices
  FOR EACH ROW EXECUTE FUNCTION cargo_invoices_set_client();--> statement-breakpoint
CREATE OR REPLACE FUNCTION shipments_sync_invoice_client() RETURNS trigger AS $$
BEGIN
  UPDATE cargo_invoices SET client_id = NEW.client_id WHERE shipment_id = NEW.id;
  RETURN NULL;
END $$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER shipments_sync_invoice_client AFTER UPDATE OF client_id ON shipments
  FOR EACH ROW WHEN (OLD.client_id IS DISTINCT FROM NEW.client_id)
  EXECUTE FUNCTION shipments_sync_invoice_client();
