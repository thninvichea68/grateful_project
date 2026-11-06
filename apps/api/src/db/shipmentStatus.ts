import { sql, type SQL } from 'drizzle-orm';
import { DEFAULT_COMPLETION } from '@gs/shared';
import type { db as Db, Tx } from './client';

const defaultRule = (direction: 'IMPORT' | 'EXPORT') =>
  sql`ARRAY[${sql.join(
    DEFAULT_COMPLETION[direction].map((m) => sql`${m}`),
    sql`, `,
  )}]::text[]`;

/**
 * The shipment status rule (shipmentStatusOf in @gs/shared), in SQL: Exception when its
 * clearance status was set to Exception by hand; Completed once every milestone of the client's
 * rule for that direction is in (without one: an import's ETA Factory date, an export's ATD);
 * In Progress once a declaration is recorded; otherwise Pending.
 */
export const shipmentStatusSql = sql`CASE
    WHEN s.clearance_status = 'EXCEPTION' THEN 'EXCEPTION'
    WHEN NOT EXISTS (
      SELECT 1 FROM unnest(COALESCE(
        (SELECT NULLIF(CASE WHEN s.direction = 'IMPORT' THEN c.import_complete_on
                            ELSE c.export_complete_on END, '{}')
           FROM clients c WHERE c.id = s.client_id),
        CASE WHEN s.direction = 'IMPORT' THEN ${defaultRule('IMPORT')} ELSE ${defaultRule('EXPORT')} END
      )) AS m(k)
      WHERE NOT CASE m.k
        WHEN 'ATD' THEN s.atd IS NOT NULL
        WHEN 'ATA' THEN s.ata IS NOT NULL
        WHEN 'ARRIVE_FTY' THEN s.arrive_fty IS NOT NULL
        WHEN 'DO_DATE' THEN s.do_date IS NOT NULL
        WHEN 'DOCS_RECEIVED' THEN s.received_document_date IS NOT NULL
        WHEN 'CLEARED' THEN EXISTS (
          SELECT 1 FROM customs_declarations d
           WHERE d.shipment_id = s.id AND btrim(coalesce(d.declare_no, '')) <> '')
        ELSE false
      END
    ) THEN 'COMPLETED'
    WHEN EXISTS (SELECT 1 FROM customs_declarations d WHERE d.shipment_id = s.id) THEN 'IN_PROGRESS'
    ELSE 'PENDING'
  END::shipment_status`;

/** Brings every shipment's stored status (or one client's) in line with the rule. */
export async function recomputeShipmentStatuses(tx: Tx | typeof Db, clientId?: string) {
  const where: SQL = clientId ? sql`WHERE s.client_id = ${clientId}` : sql``;
  await tx.execute(sql`UPDATE shipments s SET status = ${shipmentStatusSql} ${where}`);
}
