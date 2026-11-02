import { sql } from 'drizzle-orm';
import type { db as Db, Tx } from './client';

/**
 * The shipment status rule (shipmentStatusOf in @gs/shared), in SQL: Completed once an import
 * has its ETA Factory date or an export its ATD; In Progress once a declaration is recorded;
 * otherwise Pending. Used by the seed; migration 0014 applies the same rule to existing rows.
 */
export const shipmentStatusSql = sql`CASE
    WHEN (s.direction = 'IMPORT' AND s.arrive_fty IS NOT NULL)
      OR (s.direction = 'EXPORT' AND s.atd IS NOT NULL) THEN 'COMPLETED'
    WHEN EXISTS (SELECT 1 FROM customs_declarations d WHERE d.shipment_id = s.id) THEN 'IN_PROGRESS'
    ELSE 'PENDING'
  END::shipment_status`;

/**
 * The clearance status rule (clearanceStatusOf in @gs/shared), in SQL: Customs Cleared once a
 * declaration has its number and date; In Progress once a number is in; otherwise Pending.
 */
export const clearanceStatusSql = sql`CASE
    WHEN EXISTS (SELECT 1 FROM customs_declarations d WHERE d.shipment_id = s.id
                 AND btrim(coalesce(d.declare_no, '')) <> '' AND d.declare_date IS NOT NULL) THEN 'CLEARED'
    WHEN EXISTS (SELECT 1 FROM customs_declarations d WHERE d.shipment_id = s.id
                 AND btrim(coalesce(d.declare_no, '')) <> '') THEN 'IN_PROGRESS'
    ELSE 'PENDING'
  END::clearance_status`;

/** Brings every shipment's stored status and clearance status in line with the rules. */
export async function recomputeShipmentStatuses(tx: Tx | typeof Db) {
  await tx.execute(
    sql`UPDATE shipments s SET status = ${shipmentStatusSql}, clearance_status = ${clearanceStatusSql}`,
  );
}
