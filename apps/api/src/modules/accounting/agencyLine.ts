import { and, eq, sql } from 'drizzle-orm';
import { toMoneyString, type AgencyCandidate } from '@gs/shared';
import type { Request } from 'express';
import type { DbOrTx, Tx } from '../../db/client';
import { accountingRecords } from '../../db/schema';
import { audit } from '../../lib/audit';
import { businessRule, conflict } from '../../lib/errors';
import { issueDateFor } from '../../lib/issueDate';
import { queryRows } from '../../lib/listing';
import { rateOn, recompute, vatRateOn } from './ledger';
import { DECLARE_MONTH_FROM } from './ledgerDate';
import { assignNumbers, resequence } from './numbers';

/*
 * Billing policy: the agency invoice / THC is billed to the client in the month it was paid
 * (the shipping plan's Invoice / THC Date); the tax invoice, the other disbursements and the
 * debit note follow the declare date. When the two months differ the shipment is charged
 * twice, with two DIS numbers: its THC goes on an AGENCY ledger row of its own (a DIS of the
 * THC alone, dated the day it was paid), the rest stays on the SERVICE row. A client set to
 * "billed with the services" (clients.thc_billed_apart false) is always billed in one go in the
 * declare month. Shipments declared before DECLARE_MONTH_FROM keep the workbook as it was.
 */

interface Shipment {
  declarationId: string;
  clientId: string;
  portId: string | null;
  declareNo: string;
  declareDate: string;
  thcDate: string | null;
  /** The client's setting: false = always billed with the services in the declare month. */
  thcBilledApart: boolean;
  agencyId: string | null;
  agencyDate: string | null;
  agencyDisNo: string | null;
}

/** Whether a THC paid on `thcDate` is billed apart from a shipment declared on `declareDate`. */
export const billedApart = (declareDate: string, thcDate: string | null): thcDate is string =>
  !!thcDate &&
  declareDate >= DECLARE_MONTH_FROM &&
  thcDate >= DECLARE_MONTH_FROM &&
  thcDate.slice(0, 7) !== declareDate.slice(0, 7);

/** Whether the SERVICE ledger row's THC is billed on an agency row of its own. */
export async function thcBilledApart(tx: Tx, serviceId: string): Promise<boolean> {
  const s = await shipmentOf(tx, serviceId);
  return !!s && s.thcBilledApart && billedApart(s.declareDate, s.thcDate);
}

async function shipmentOf(tx: Tx, serviceId: string): Promise<Shipment | undefined> {
  const [s] = await queryRows<Shipment>(
    tx,
    sql`SELECT a.declaration_id AS "declarationId", a.client_id AS "clientId", a.port_id AS "portId",
               d.declare_no AS "declareNo", to_char(d.declare_date, 'YYYY-MM-DD') AS "declareDate",
               to_char(s.thc_hbl_date, 'YYYY-MM-DD') AS "thcDate", c.thc_billed_apart AS "thcBilledApart",
               g.id AS "agencyId", to_char(g.inv_date, 'YYYY-MM-DD') AS "agencyDate", g.dis_no AS "agencyDisNo"
        FROM accounting_records a JOIN customs_declarations d ON d.id = a.declaration_id
        JOIN shipments s ON s.id = d.shipment_id JOIN clients c ON c.id = a.client_id
        LEFT JOIN accounting_records g ON g.declaration_id = a.declaration_id AND g.kind = 'AGENCY'
        WHERE a.id = ${serviceId} AND a.kind = 'SERVICE'`,
  );
  return s;
}

/**
 * Brings a shipment's agency row in line with its checked record summary's THC (`thc`, the
 * THC / HBL fee lines): billed apart, the row holds that THC as both its cost and its DIS, is
 * dated the day it was paid and takes a DIS number in that month's order; otherwise any agency
 * row goes (unless its DIS was issued). Returns whether the THC is billed apart, so the
 * SERVICE row leaves it out.
 */
export async function syncAgencyLine(
  tx: Tx,
  serviceId: string,
  thc: number,
  req: Request,
): Promise<boolean> {
  const s = await shipmentOf(tx, serviceId);
  if (!s) return false;
  // Its DIS already went out in the paid month ("+ Invoice/THC DIS"): it stays as issued,
  // and the services leave the THC out.
  if (s.agencyId && (await issuedDisOf(tx, s.agencyId))) return true;
  // Dated by the shipping plan's Invoice / THC Date; one opened by hand keeps its own date.
  const date = s.thcBilledApart && billedApart(s.declareDate, s.thcDate) ? s.thcDate : s.agencyDate;
  const apart = thc > 0 && s.thcBilledApart && billedApart(s.declareDate, date);
  const userId = req.auth?.userId ?? null;
  if (!apart || !date) {
    if (s.agencyId) await removeAgencyLine(tx, s, req);
    return false;
  }
  const amount = toMoneyString(thc);
  const dated = {
    invDate: date,
    exchangeRate: await rateOn(tx, date),
    vatRate: await vatRateOn(tx, date),
  };
  let id = s.agencyId;
  if (id) {
    await tx
      .update(accountingRecords)
      .set({ ...dated, thc: amount, disTotal: amount, updatedById: userId })
      .where(eq(accountingRecords.id, id));
  } else {
    const [row] = await tx
      .insert(accountingRecords)
      .values({
        declarationId: s.declarationId,
        kind: 'AGENCY',
        clientId: s.clientId,
        portId: s.portId,
        ...dated,
        thc: amount,
        disTotal: amount,
        commission: '0',
        mark: 'Agency invoice / THC',
        createdById: userId,
        updatedById: userId,
      })
      .returning({ id: accountingRecords.id });
    id = row!.id;
  }
  await recompute(tx, id);
  const [after] = await tx.select().from(accountingRecords).where(eq(accountingRecords.id, id));
  await audit(
    tx,
    {
      action: s.agencyId ? 'UPDATE' : 'CREATE',
      entity: 'accounting_record',
      entityId: id,
      after,
      reason: `Agency invoice / THC of ${s.declareNo} billed in the month it was paid (${date})`,
    },
    req,
  );
  if (!s.agencyDisNo) await assignNumbers(tx, id, req, ['DIS']);
  // A new or moved paid date puts the DIS elsewhere in its month's order.
  if (!s.agencyDisNo || s.agencyDate !== date) await resequence(tx, req);
  return true;
}

/** The THC is billed with the services again: the agency row and its draft DIS go. */
async function removeAgencyLine(tx: Tx, s: Shipment, req: Request): Promise<void> {
  const id = s.agencyId!;
  const [issued] = await queryRows<{ no: string }>(
    tx,
    sql`SELECT dis_no AS no FROM disbursements WHERE accounting_record_id = ${id} AND status = 'ISSUED' LIMIT 1`,
  );
  if (issued)
    throw businessRule(
      `The agency invoice DIS ${issued.no} of ${s.declareNo} is issued. Cancel it first, or keep the Invoice / THC Date in a month apart from the declare date.`,
    );
  await tx.execute(
    sql`DELETE FROM disbursements WHERE accounting_record_id = ${id} AND status = 'DRAFT'`,
  );
  const [before] = await tx
    .delete(accountingRecords)
    .where(and(eq(accountingRecords.id, id), eq(accountingRecords.kind, 'AGENCY')))
    .returning();
  await audit(
    tx,
    {
      action: 'DELETE',
      entity: 'accounting_record',
      entityId: id,
      before,
      reason: `Agency invoice / THC of ${s.declareNo} billed with its services again`,
    },
    req,
  );
  if (s.agencyDisNo) await resequence(tx, req);
}

/** The agency row's issued DIS number, if its DIS went out. */
async function issuedDisOf(tx: Tx, agencyId: string): Promise<string | null> {
  const [r] = await queryRows<{ no: string }>(
    tx,
    sql`SELECT dis_no AS no FROM disbursements WHERE accounting_record_id = ${agencyId} AND status = 'ISSUED' LIMIT 1`,
  );
  return r?.no ?? null;
}

/**
 * The client's declarations that "+ Invoice/THC DIS" can bill in `month` (YYYY-MM): declared
 * in a later month (from DECLARE_MONTH_FROM on), with no agency row yet.
 */
export async function agencyCandidates(
  tx: DbOrTx,
  clientId: string,
  month: string,
): Promise<AgencyCandidate[]> {
  return queryRows<AgencyCandidate>(
    tx,
    sql`SELECT d.id AS "declarationId", d.declare_no AS "declareNo",
               to_char(d.declare_date, 'YYYY-MM-DD') AS "declareDate", s.reference AS "shipmentReference",
               s.hbl_no AS hbl, to_char(s.thc_hbl_date, 'YYYY-MM-DD') AS "thcDate"
        FROM customs_declarations d JOIN shipments s ON s.id = d.shipment_id AND s.deleted_at IS NULL
        JOIN clients c ON c.id = s.client_id AND c.thc_billed_apart
        WHERE s.client_id = ${clientId} AND d.declare_no IS NOT NULL
          AND d.declare_date >= ${DECLARE_MONTH_FROM}::date
          AND to_char(d.declare_date, 'YYYY-MM') > ${month}
          AND NOT EXISTS (SELECT 1 FROM accounting_records g WHERE g.declaration_id = d.id AND g.kind = 'AGENCY')
        ORDER BY d.declare_date, d.declare_no
        LIMIT 200`,
  );
}

/**
 * "+ Invoice/THC DIS": bills a shipment's agency invoice / THC in an earlier month than its
 * declaration, before the services. Opens its AGENCY ledger row dated `date`, with a DIS number
 * in that month's order; its DIS is then made and issued like any other. The record summary,
 * checked later, leaves the THC off the services' DIS and keeps an issued agency DIS as it is.
 */
export async function openAgencyLine(
  tx: Tx,
  clientId: string,
  input: { declarationId: string; date: string },
  req: Request,
): Promise<string> {
  const [d] = await queryRows<{
    clientId: string;
    portId: string | null;
    declareNo: string | null;
    declareDate: string;
    thcBilledApart: boolean;
    agencyDisNo: string | null;
    agencyId: string | null;
    serviceDisIssued: string | null;
  }>(
    tx,
    sql`SELECT s.client_id AS "clientId", coalesce(d.port_id, s.clearance_port_id) AS "portId",
               d.declare_no AS "declareNo", to_char(d.declare_date, 'YYYY-MM-DD') AS "declareDate",
               c.thc_billed_apart AS "thcBilledApart", g.id AS "agencyId", g.dis_no AS "agencyDisNo",
               (SELECT t.dis_no FROM accounting_records a JOIN disbursements t ON t.accounting_record_id = a.id
                 WHERE a.declaration_id = d.id AND a.kind = 'SERVICE' AND t.status = 'ISSUED' LIMIT 1) AS "serviceDisIssued"
        FROM customs_declarations d JOIN shipments s ON s.id = d.shipment_id AND s.deleted_at IS NULL
        JOIN clients c ON c.id = s.client_id
        LEFT JOIN accounting_records g ON g.declaration_id = d.id AND g.kind = 'AGENCY'
        WHERE d.id = ${input.declarationId}`,
  );
  if (!d || d.clientId !== clientId)
    throw businessRule('The declaration was not found for this client');
  if (!d.declareNo)
    throw businessRule('The declaration no. is still pending: enter it on the shipment first');
  if (d.agencyId)
    throw conflict(
      `${d.declareNo} already has its Invoice/THC DIS${d.agencyDisNo ? ` (${d.agencyDisNo})` : ''}`,
    );
  if (!d.thcBilledApart)
    throw businessRule(
      "This client's THC is billed with the services in the declare month (client setting)",
    );
  if (input.date < DECLARE_MONTH_FROM || input.date.slice(0, 7) >= d.declareDate.slice(0, 7))
    throw businessRule(
      `The Invoice/THC DIS date must be in a month before ${d.declareNo}'s declare date (${d.declareDate})`,
    );
  if (d.serviceDisIssued)
    throw businessRule(
      `${d.serviceDisIssued} of ${d.declareNo} is issued already and may hold its THC. Cancel it first.`,
    );
  const userId = req.auth?.userId ?? null;
  const [row] = await tx
    .insert(accountingRecords)
    .values({
      declarationId: input.declarationId,
      kind: 'AGENCY',
      clientId,
      portId: d.portId,
      invDate: input.date,
      exchangeRate: await rateOn(tx, input.date),
      vatRate: await vatRateOn(tx, input.date),
      commission: '0',
      mark: 'Agency invoice / THC',
      createdById: userId,
      updatedById: userId,
    })
    .returning();
  await recompute(tx, row!.id);
  await audit(
    tx,
    {
      action: 'CREATE',
      entity: 'accounting_record',
      entityId: row!.id,
      after: row,
      reason: `Agency invoice / THC of ${d.declareNo} billed on ${input.date}, before its declaration (${d.declareDate})`,
    },
    req,
  );
  await assignNumbers(tx, row!.id, req, ['DIS']);
  await resequence(tx, req);
  return row!.id;
}

/**
 * "Separate Invoice/THC DIS": a shipment whose DIS was issued for the agency invoice / THC in
 * an earlier month than its declaration (before "+ Invoice/THC DIS" existed). The issued DIS
 * moves, number, date and amount unchanged, to an AGENCY row of its own in that month; the
 * shipment's row keeps its tax invoice and debit note, which follow the declare month: an
 * issue date before that month moves to the working day after clearance, and the INV / DN
 * numbers are put in that month's order. Returns the agency row.
 */
export async function separateAgencyDis(tx: Tx, serviceId: string, req: Request): Promise<string> {
  const s = await shipmentOf(tx, serviceId);
  if (!s) throw businessRule("Only a shipment's own ledger row can be separated");
  if (s.agencyId)
    throw conflict(
      `${s.declareNo} already has its Invoice/THC DIS${s.agencyDisNo ? ` (${s.agencyDisNo})` : ''}`,
    );
  const issued = await queryRows<{
    id: string;
    no: string;
    date: string;
    total: string;
    rate: string;
  }>(
    tx,
    sql`SELECT id, dis_no AS no, to_char(dis_date, 'YYYY-MM-DD') AS date, total::text AS total,
               exchange_rate::text AS rate
        FROM disbursements WHERE accounting_record_id = ${serviceId} AND status = 'ISSUED'`,
  );
  if (issued.length !== 1)
    throw businessRule(
      issued.length
        ? `${s.declareNo} has ${issued.length} issued DIS: separate it by hand`
        : `${s.declareNo} has no issued DIS to separate`,
    );
  const dis = issued[0]!;
  if (dis.date < DECLARE_MONTH_FROM || dis.date.slice(0, 7) >= s.declareDate.slice(0, 7))
    throw businessRule(
      `${dis.no} is dated ${dis.date}, not in a month before ${s.declareNo}'s declare date (${s.declareDate})`,
    );
  const [svc] = await tx
    .select()
    .from(accountingRecords)
    .where(eq(accountingRecords.id, serviceId));
  const userId = req.auth?.userId ?? null;
  const cents = (v: string) => Math.round(Number(v) * 100);
  const moved = svc!.invDate.slice(0, 7) < s.declareDate.slice(0, 7);
  const invDate = moved ? await issueDateFor(tx, s.declareDate) : svc!.invDate;
  const rate = moved ? await rateOn(tx, invDate) : svc!.exchangeRate;

  // The shipment's row: its DIS number and the THC go to the agency row.
  await tx
    .update(accountingRecords)
    .set({
      disNo: null,
      thc: toMoneyString(Math.max(0, cents(svc!.thc) - cents(dis.total)) / 100),
      // Its one DIS goes; any other disbursement comes on a new DIS (or record summary).
      disTotal: '0',
      invDate,
      exchangeRate: rate,
      vatRate: moved ? await vatRateOn(tx, invDate) : svc!.vatRate,
      updatedById: userId,
    })
    .where(eq(accountingRecords.id, serviceId));
  // Its drafts are dated with it.
  if (moved) {
    await tx.execute(sql`UPDATE tax_invoices SET invoice_date = ${invDate}, exchange_rate = ${rate}
      WHERE accounting_record_id = ${serviceId} AND status = 'DRAFT'`);
    await tx.execute(sql`UPDATE debit_notes SET dn_date = ${invDate}
      WHERE accounting_record_id = ${serviceId} AND status = 'DRAFT'`);
  }
  const [row] = await tx
    .insert(accountingRecords)
    .values({
      declarationId: s.declarationId,
      kind: 'AGENCY',
      clientId: s.clientId,
      portId: s.portId,
      disNo: dis.no,
      invDate: dis.date,
      exchangeRate: dis.rate,
      vatRate: await vatRateOn(tx, dis.date),
      thc: dis.total,
      disTotal: dis.total,
      commission: '0',
      mark: 'Agency invoice / THC',
      createdById: userId,
      updatedById: userId,
    })
    .returning();
  await tx.execute(
    sql`UPDATE disbursements SET accounting_record_id = ${row!.id} WHERE id = ${dis.id}`,
  );
  await recompute(tx, row!.id);
  await recompute(tx, serviceId);
  const [after] = await tx
    .select()
    .from(accountingRecords)
    .where(eq(accountingRecords.id, serviceId));
  await audit(
    tx,
    {
      action: 'CREATE',
      entity: 'accounting_record',
      entityId: row!.id,
      after: row,
      reason: `${dis.no} of ${s.declareNo} (agency invoice / THC, ${dis.date}) separated from its services`,
    },
    req,
  );
  await audit(
    tx,
    {
      action: 'UPDATE',
      entity: 'accounting_record',
      entityId: serviceId,
      before: svc,
      after,
      reason: `${dis.no} separated as the agency invoice / THC; the services follow the declare month (${s.declareDate})`,
    },
    req,
  );
  await resequence(tx, req);
  return row!.id;
}
