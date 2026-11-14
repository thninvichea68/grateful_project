import { sql, type SQL } from 'drizzle-orm';
import type { Request } from 'express';
import type { DbOrTx } from '../db/client';
import { audit } from './audit';
import { queryRows } from './listing';

/**
 * A shipment's CBM: as typed on the shipping plan, else its invoice lines' CBM total.
 * The plan list and every bill to the client use this one number.
 */
export const shipmentCbm = (alias = 's'): SQL => {
  const s = sql.raw(alias);
  return sql`coalesce(${s}.cbm, (SELECT sum(l.cbm) FROM cargo_invoice_lines l JOIN cargo_invoices ci ON ci.id = l.invoice_id WHERE ci.shipment_id = ${s}.id), 0)`;
};

/** 12.430 → "12.43", as the bills store and print it. */
const plain = (v: string) => String(Number(v));

/** The bill tables and their CBM column (a record summary keeps it as text: "NON" by air). */
const BILLS = [
  { table: 'tax_invoices', column: 'volume_cbm', field: 'volumeCbm' },
  { table: 'disbursements', column: 'volume_cbm', field: 'volumeCbm' },
  { table: 'debit_notes', column: 'volume_cbm', field: 'volumeCbm' },
  { table: 'credit_notes', column: 'cbm', field: 'cbm' },
] as const;

/**
 * The CBM a bill takes from its shipping plan, found through its ledger entry (a record summary
 * not in the ledger yet: through its declaration). Null when it has no shipment.
 */
export async function planCbm(
  tx: DbOrTx,
  accountingRecordId: string | null | undefined,
  recordSummary?: { clientId: string; declareNo: string | null | undefined },
): Promise<string | null> {
  const declareNo = String(recordSummary?.declareNo ?? '').trim();
  const where = accountingRecordId
    ? sql`d.id = (SELECT declaration_id FROM accounting_records WHERE id = ${accountingRecordId})`
    : recordSummary && declareNo
      ? sql`s.client_id = ${recordSummary.clientId} AND upper(d.declare_no) = upper(${declareNo})`
      : null;
  if (!where) return null;
  const [r] = await queryRows<{ cbm: string }>(
    tx,
    sql`SELECT ${shipmentCbm()}::text AS cbm FROM customs_declarations d JOIN shipments s ON s.id = d.shipment_id
        WHERE ${where} AND s.deleted_at IS NULL LIMIT 1`,
  );
  return r ? plain(r.cbm) : null;
}

/**
 * The shipping plan's CBM changed (typed, or its invoice lines): its bills (not cancelled ones)
 * take it, so the plan and the bills to the client always show the same CBM.
 */
export async function syncBillCbm(tx: DbOrTx, shipmentId: string, req?: Request): Promise<void> {
  const [ship] = await queryRows<{ cbm: string }>(
    tx,
    sql`SELECT ${shipmentCbm()}::text AS cbm FROM shipments s WHERE s.id = ${shipmentId}`,
  );
  if (!ship) return;
  const cbm = plain(ship.cbm);
  const records = sql`(SELECT a.id FROM accounting_records a JOIN customs_declarations d ON d.id = a.declaration_id WHERE d.shipment_id = ${shipmentId})`;
  const changed: { table: string; id: string; field: string; value: string }[] = [];
  for (const b of BILLS) {
    const col = sql.raw(b.column);
    const rows = await queryRows<{ id: string }>(
      tx,
      sql`UPDATE ${sql.raw(b.table)} SET ${col} = ${cbm}::numeric
          WHERE accounting_record_id IN ${records} AND status <> 'VOID' AND ${col} IS DISTINCT FROM ${cbm}::numeric
          RETURNING id`,
    );
    for (const r of rows) changed.push({ table: b.table, id: r.id, field: b.field, value: cbm });
  }
  // A record summary by air shows "NON"; one not in the ledger yet goes by its declaration.
  const summaries = await queryRows<{ id: string; cbm: string }>(
    tx,
    sql`UPDATE record_summaries r SET cbm = CASE WHEN r.transport_mode = 'AIR' THEN 'NON' ELSE ${cbm} END
        WHERE r.status <> 'VOID'
          AND (r.accounting_record_id IN ${records}
               OR (r.accounting_record_id IS NULL AND EXISTS (
                     SELECT 1 FROM customs_declarations d JOIN shipments s ON s.id = d.shipment_id
                     WHERE d.shipment_id = ${shipmentId} AND s.client_id = r.client_id
                       AND upper(d.declare_no) = upper(r.declare_no))))
          AND r.cbm IS DISTINCT FROM (CASE WHEN r.transport_mode = 'AIR' THEN 'NON' ELSE ${cbm} END)
        RETURNING r.id, r.cbm`,
  );
  for (const r of summaries)
    changed.push({ table: 'record_summaries', id: r.id, field: 'cbm', value: r.cbm });
  for (const c of changed)
    await audit(
      tx,
      {
        action: 'UPDATE',
        entity: c.table,
        entityId: c.id,
        after: { [c.field]: c.value },
        reason: 'CBM from the shipping plan',
      },
      req,
    );
}
