import { eq, sql } from 'drizzle-orm';
import {
  computeLedger,
  toMoneyString,
  type CreditNoteDeclaration,
  type DeclarationOption,
  type EligibleRecord,
  type LedgerRow,
  type LedgerSummary,
  type Paginated,
} from '@gs/shared';
import type { Request } from 'express';
import type { z } from 'zod';
import type { ledgerInputSchema } from '@gs/shared';
import { db, type DbOrTx } from '../../db/client';
import {
  accountingRecords,
  clients,
  customsDeclarations,
  settings,
  shipments,
} from '../../db/schema';
import { audit } from '../../lib/audit';
import { issueDateFor } from '../../lib/issueDate';
import { businessRule, conflict, notFound } from '../../lib/errors';
import {
  likePattern,
  orderBy,
  paginate,
  queryRows,
  toPaginated,
  whereAll,
} from '../../lib/listing';
import { clientCondition } from '../../lib/clientScope';
import { resequence } from './numbers';

type LedgerInput = z.output<typeof ledgerInputSchema>;

/** USD→KHR in force on a date: latest exchange_rates row on/before it, else the workspace base rate. */
export async function rateOn(tx: DbOrTx, date: string): Promise<string> {
  const [r] = await queryRows<{ rate: string }>(
    tx,
    sql`
    SELECT usd_to_khr::text AS rate FROM exchange_rates WHERE effective_date <= ${date}::date ORDER BY effective_date DESC LIMIT 1`,
  );
  if (r) return r.rate;
  const [base] = await tx.select().from(settings).where(eq(settings.key, 'baseExchangeRate'));
  return base ? String(base.value) : '4026';
}

const SELECT = sql`
  SELECT a.id, a.declaration_id AS "declarationId", d.declare_no AS "declareNo", to_char(d.declare_date, 'YYYY-MM-DD') AS "declareDate",
         s.id AS "shipmentId", s.reference AS "shipmentReference", s.direction,
         c.id AS "clientId", c.code AS "clientCode", c.name AS "clientName", p.code AS "portCode", p.customs_port_no AS "portNo", p.short_name AS "portName",
         a.inv_no AS "invNo", a.dis_no AS "disNo", a.dn_no AS "dnNo", to_char(a.inv_date, 'YYYY-MM-DD') AS "invDate",
         a.exchange_rate::text AS "exchangeRate", a.clear_fee::text AS "clearFee", a.thc::text AS thc, a.other_pay::text AS "otherPay",
         a.commission::text AS commission, a.inv_revenue::text AS "invRevenue", a.dis_total::text AS "disTotal", a.vat::text AS vat,
         a.dn_total::text AS "dnTotal", a.net_profit::text AS "netProfit", a.chea_status AS "cheaStatus", a.mark,
         (SELECT coalesce(json_agg(x ORDER BY x.type), '[]'::json) FROM (
            SELECT 'tax-invoices' AS type, id, invoice_no AS number, status::text AS status FROM tax_invoices WHERE accounting_record_id = a.id
            UNION ALL SELECT 'disbursements', id, dis_no, status::text FROM disbursements WHERE accounting_record_id = a.id
            UNION ALL SELECT 'debit-notes', id, dn_no, status::text FROM debit_notes WHERE accounting_record_id = a.id
            UNION ALL SELECT 'credit-notes', id, cn_no, status::text FROM credit_notes WHERE accounting_record_id = a.id
            UNION ALL SELECT 'record-summaries', id, NULL, status::text FROM record_summaries WHERE accounting_record_id = a.id
         ) x) AS documents`;
const FROM = sql`
  FROM accounting_records a
  JOIN customs_declarations d ON d.id = a.declaration_id
  JOIN shipments s ON s.id = d.shipment_id
  JOIN clients c ON c.id = a.client_id
  LEFT JOIN ports p ON p.id = a.port_id`;

interface ListParams {
  page: number;
  pageSize: number;
  sort?: string | undefined;
  q?: string | undefined;
  month?: string | undefined;
  year?: string | undefined;
  clientId?: string | undefined;
  /** Per-user client access; undefined = every client. */
  clientIds?: string[] | undefined;
  cheaStatus?: string | undefined;
}

function where(p: ListParams) {
  const c = [sql`true`];
  if (p.month)
    c.push(
      sql`a.inv_date >= ${`${p.month}-01`}::date AND a.inv_date < (${`${p.month}-01`}::date + interval '1 month')`,
    );
  else if (p.year)
    c.push(
      sql`a.inv_date >= ${`${p.year}-01-01`}::date AND a.inv_date < (${`${p.year}-01-01`}::date + interval '1 year')`,
    );
  if (p.clientId) c.push(sql`a.client_id = ${p.clientId}`);
  const scoped = clientCondition(sql`a.client_id`, p.clientIds);
  if (scoped) c.push(scoped);
  if (p.cheaStatus) c.push(sql`a.chea_status = ${p.cheaStatus}`);
  if (p.q) {
    const like = likePattern(p.q);
    c.push(
      sql`(d.declare_no ILIKE ${like} OR a.inv_no ILIKE ${like} OR a.dis_no ILIKE ${like} OR a.dn_no ILIKE ${like} OR s.reference ILIKE ${like} OR c.code ILIKE ${like})`,
    );
  }
  return whereAll(c);
}

export async function listLedger(
  p: ListParams,
): Promise<Paginated<LedgerRow> & { totals: LedgerSummary }> {
  const rows = await queryRows<LedgerRow & { total_count: string }>(
    db,
    sql`
    ${SELECT}, count(*) OVER () AS total_count ${FROM} ${where(p)}
    ${orderBy(p.sort, { invDate: sql`a.inv_date`, declareNo: sql`d.declare_no`, client: sql`c.code`, netProfit: sql`a.net_profit` }, sql`date_trunc('month', a.inv_date), a.inv_no NULLS LAST, a.dis_no NULLS LAST, a.dn_no NULLS LAST, d.declare_no`)}
    ${paginate(p.page, p.pageSize)}`,
  );
  const [totals] = await queryRows<LedgerSummary>(
    db,
    sql`
    SELECT count(*)::int AS rows,
           coalesce(sum(a.clear_fee), 0)::text AS "clearFee", coalesce(sum(a.thc), 0)::text AS thc, coalesce(sum(a.other_pay), 0)::text AS "otherPay",
           coalesce(sum(a.commission), 0)::text AS commission, coalesce(sum(a.inv_revenue), 0)::text AS "invRevenue",
           coalesce(sum(a.dis_total), 0)::text AS "disTotal", coalesce(sum(a.vat), 0)::text AS vat, coalesce(sum(a.dn_total), 0)::text AS "dnTotal",
           coalesce(sum(a.net_profit), 0)::text AS "netProfit", (count(*) FILTER (WHERE a.chea_status = 'UNPAID'))::int AS unpaid
    ${FROM} ${where(p)}`,
  );
  return { ...toPaginated(rows, p.page, p.pageSize), totals: totals! };
}

export async function getLedger(id: string): Promise<LedgerRow> {
  const [row] = await queryRows<LedgerRow>(db, sql`${SELECT} ${FROM} WHERE a.id = ${id}`);
  if (!row) throw notFound('Ledger entry');
  return row;
}

/** Declarations that don't have a ledger row yet (for "New ledger entry"). */
export async function declarationOptions(
  q: string | undefined,
  clientIds?: string[],
): Promise<DeclarationOption[]> {
  const like = q ? likePattern(q) : null;
  const scoped = clientCondition(sql`s.client_id`, clientIds);
  return queryRows<DeclarationOption>(
    db,
    sql`
    SELECT d.id, d.declare_no AS "declareNo", to_char(d.declare_date, 'YYYY-MM-DD') AS "declareDate", s.reference AS "shipmentReference",
           c.id AS "clientId", c.code AS "clientCode", s.direction
    FROM customs_declarations d JOIN shipments s ON s.id = d.shipment_id AND s.deleted_at IS NULL JOIN clients c ON c.id = s.client_id
    LEFT JOIN accounting_records a ON a.declaration_id = d.id
    WHERE a.id IS NULL AND d.declare_no IS NOT NULL ${scoped ? sql`AND ${scoped}` : sql``} ${like ? sql`AND (d.declare_no ILIKE ${like} OR s.reference ILIKE ${like} OR c.code ILIKE ${like})` : sql``}
    ORDER BY d.declare_date DESC, d.declare_no LIMIT 30`,
  );
}

/**
 * Declarations a Credit Noted can start from: all of them (ledger row or not), newest first,
 * flagged when a live (non-void) credit note already exists for the declare no.
 */
export async function creditNoteDeclarations(
  q: string | undefined,
  clientIds?: string[],
): Promise<CreditNoteDeclaration[]> {
  const like = q ? likePattern(q) : null;
  const scoped = clientCondition(sql`s.client_id`, clientIds);
  return queryRows(
    db,
    sql`
    SELECT d.id, d.declare_no AS "declareNo", to_char(d.declare_date, 'YYYY-MM-DD') AS "declareDate", s.reference AS "shipmentReference",
           c.id AS "clientId", c.code AS "clientCode", c.name AS "clientName", s.direction,
           s.transport_mode AS "transportMode", s.load_type AS "loadType", p.short_name AS "portName", s.hbl_no AS "hblNo",
           (SELECT container_no FROM containers WHERE shipment_id = s.id ORDER BY sort_order LIMIT 1) AS "containerNo",
           (SELECT count(*)::int FROM containers WHERE shipment_id = s.id) AS "containerCount",
           (SELECT size::text FROM containers WHERE shipment_id = s.id ORDER BY sort_order LIMIT 1) AS "containerSize",
           coalesce((SELECT sum(l.gross_weight_kg) FROM cargo_invoice_lines l JOIN cargo_invoices ci ON ci.id = l.invoice_id WHERE ci.shipment_id = s.id), 0)::text AS "grossWeightKg",
           coalesce((SELECT sum(l.cbm) FROM cargo_invoice_lines l JOIN cargo_invoices ci ON ci.id = l.invoice_id WHERE ci.shipment_id = s.id), 0)::text AS cbm,
           (SELECT cn.cn_no FROM credit_notes cn WHERE upper(cn.declare_no) = upper(d.declare_no) AND cn.status <> 'VOID' LIMIT 1) AS "creditNoteNo"
    FROM customs_declarations d JOIN shipments s ON s.id = d.shipment_id AND s.deleted_at IS NULL JOIN clients c ON c.id = s.client_id
    LEFT JOIN ports p ON p.id = coalesce(d.port_id, s.clearance_port_id)
    WHERE d.declare_no IS NOT NULL ${scoped ? sql`AND ${scoped}` : sql``} ${like ? sql`AND (d.declare_no ILIKE ${like} OR s.reference ILIKE ${like} OR c.code ILIKE ${like} OR c.name ILIKE ${like} OR s.hbl_no ILIKE ${like})` : sql``}
    ORDER BY d.declare_date DESC, d.declare_no LIMIT 40`,
  );
}

/** The client a declaration belongs to (through its shipment), for access checks. */
export async function declarationClientId(declarationId: string): Promise<string | null> {
  const [r] = await db
    .select({ clientId: shipments.clientId })
    .from(customsDeclarations)
    .innerJoin(shipments, eq(shipments.id, customsDeclarations.shipmentId))
    .where(eq(customsDeclarations.id, declarationId));
  return r?.clientId ?? null;
}

/** Recalculate VAT and net profit from the row's stored amounts (used after any change). */
export async function recompute(tx: DbOrTx, id: string): Promise<void> {
  const [r] = await tx.select().from(accountingRecords).where(eq(accountingRecords.id, id));
  if (!r) return;
  const t = computeLedger({
    clearFee: r.clearFee,
    thc: r.thc,
    otherPay: r.otherPay,
    commission: r.commission,
    invRevenue: r.invRevenue,
    disTotal: r.disTotal,
    dnTotal: r.dnTotal,
  });
  await tx
    .update(accountingRecords)
    .set({ vat: toMoneyString(t.vat), netProfit: toMoneyString(t.netProfit) })
    .where(eq(accountingRecords.id, id));
}

export async function createLedger(input: LedgerInput, req: Request): Promise<string> {
  return db.transaction((tx) => insertLedger(tx, input, req));
}

/** Creates a ledger row for a declaration inside an existing transaction. */
export async function insertLedger(tx: DbOrTx, input: LedgerInput, req: Request): Promise<string> {
  {
    const [d] = await tx
      .select({ d: customsDeclarations, s: shipments, c: clients })
      .from(customsDeclarations)
      .innerJoin(shipments, eq(shipments.id, customsDeclarations.shipmentId))
      .innerJoin(clients, eq(clients.id, shipments.clientId))
      .where(eq(customsDeclarations.id, input.declarationId));
    if (!d || d.s.deletedAt) throw businessRule('The declaration does not exist');
    if (!d.d.declareNo)
      throw businessRule('The declaration no. is still pending: enter it on the shipment first');
    const [exists] = await tx
      .select({ id: accountingRecords.id })
      .from(accountingRecords)
      .where(eq(accountingRecords.declarationId, input.declarationId));
    if (exists) throw conflict(`Declaration ${d.d.declareNo} already has a ledger entry`);
    // Issue date: next working day after the declaration (clearance) date, past holidays.
    const invDate = input.invDate ?? (await issueDateFor(tx, d.d.declareDate));
    const [row] = await tx
      .insert(accountingRecords)
      .values({
        declarationId: input.declarationId,
        clientId: d.c.id,
        portId: d.d.portId ?? d.s.clearancePortId,
        invNo: input.invNo,
        disNo: input.disNo,
        dnNo: input.dnNo,
        invDate,
        exchangeRate: input.exchangeRate ?? (await rateOn(tx, invDate)),
        clearFee: input.clearFee,
        thc: input.thc,
        otherPay: input.otherPay,
        commission: input.commission ?? d.c.commissionUsd,
        invRevenue: input.invRevenue,
        disTotal: input.disTotal,
        dnTotal: input.dnTotal,
        cheaStatus: input.cheaStatus,
        mark: input.mark,
        createdById: req.auth!.userId,
        updatedById: req.auth!.userId,
      })
      .returning({ id: accountingRecords.id });
    await recompute(tx, row!.id);
    const [after] = await tx
      .select()
      .from(accountingRecords)
      .where(eq(accountingRecords.id, row!.id));
    await audit(
      tx,
      { action: 'CREATE', entity: 'accounting_record', entityId: row!.id, after },
      req,
    );
    return row!.id;
  }
}

export async function updateLedger(
  id: string,
  patch: Partial<LedgerInput>,
  req: Request,
): Promise<void> {
  await db.transaction(async (tx) => {
    const [before] = await tx
      .select()
      .from(accountingRecords)
      .where(eq(accountingRecords.id, id))
      .for('update');
    if (!before) throw notFound('Ledger entry');
    const values = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined));
    // INV / DIS / DN numbers are given on approval and released by deleting the invoice.
    for (const k of ['invNo', 'disNo', 'dnNo'] as const)
      if (k in values && (values[k] ?? null) !== before[k])
        throw businessRule(
          'Invoice numbers are given automatically when the Chea payment is checked. Delete the invoice to release them.',
        );
    // Clearing optional computed fields restores their defaults.
    if (values.commission === null) {
      const [c] = await tx
        .select({ cm: clients.commissionUsd })
        .from(clients)
        .where(eq(clients.id, before.clientId));
      values.commission = c!.cm;
    }
    if (values.exchangeRate === null)
      values.exchangeRate = await rateOn(
        tx,
        (values.invDate as string | undefined) ?? before.invDate,
      );
    if (values.invDate === null) {
      const [d] = await tx
        .select({ dd: customsDeclarations.declareDate })
        .from(customsDeclarations)
        .where(eq(customsDeclarations.id, before.declarationId));
      values.invDate = await issueDateFor(tx, d!.dd);
    }
    await tx
      .update(accountingRecords)
      .set({ ...values, updatedById: req.auth!.userId })
      .where(eq(accountingRecords.id, id));
    await recompute(tx, id);
    if (values.invDate !== undefined && values.invDate !== before.invDate)
      await resequence(tx, req);
    const [after] = await tx.select().from(accountingRecords).where(eq(accountingRecords.id, id));
    await audit(
      tx,
      { action: 'UPDATE', entity: 'accounting_record', entityId: id, before, after },
      req,
    );
  });
}

export async function deleteLedger(id: string, req: Request): Promise<void> {
  await db.transaction(async (tx) => {
    const [before] = await tx
      .select()
      .from(accountingRecords)
      .where(eq(accountingRecords.id, id))
      .for('update');
    if (!before) throw notFound('Ledger entry');
    const [issued] = await queryRows<{ n: number }>(
      tx,
      sql`
      SELECT ((SELECT count(*) FROM tax_invoices WHERE accounting_record_id = ${id} AND status = 'ISSUED')
            + (SELECT count(*) FROM disbursements WHERE accounting_record_id = ${id} AND status = 'ISSUED')
            + (SELECT count(*) FROM debit_notes WHERE accounting_record_id = ${id} AND status = 'ISSUED')
            + (SELECT count(*) FROM credit_notes WHERE accounting_record_id = ${id} AND status = 'ISSUED')
            + (SELECT count(*) FROM record_summaries WHERE accounting_record_id = ${id} AND status = 'ISSUED'))::int AS n`,
    );
    if (issued!.n) throw conflict('This ledger entry has issued documents. Cancel them first.');
    await tx.delete(accountingRecords).where(eq(accountingRecords.id, id));
    await audit(tx, { action: 'DELETE', entity: 'accounting_record', entityId: id, before }, req);
  });
}

const ELIGIBLE: Record<
  'tax-invoices' | 'disbursements' | 'debit-notes' | 'record-summaries',
  { table: string; col: string; numbered: boolean }
> = {
  'tax-invoices': { table: 'tax_invoices', col: 'inv_no', numbered: true },
  disbursements: { table: 'disbursements', col: 'dis_no', numbered: true },
  'debit-notes': { table: 'debit_notes', col: 'dn_no', numbered: true },
  // A record summary can start before approval: its INV / DIS / DN appear (live from the
  // ledger) once the accountant checks the Chea payment.
  'record-summaries': { table: 'record_summaries', col: 'inv_no', numbered: false },
};

/**
 * Shipments a tax invoice, DIS or debit note can be made for (approved: they have that
 * number) or a record summary (any ledger row), with no live document of the type yet, in
 * clearance-date order.
 */
export async function eligibleRecords(
  type: keyof typeof ELIGIBLE,
  clientIds?: string[],
): Promise<EligibleRecord[]> {
  const t = ELIGIBLE[type];
  const scoped = clientCondition(sql`a.client_id`, clientIds);
  return queryRows<EligibleRecord>(
    db,
    sql`
    SELECT a.id AS "recordId", d.declare_no AS "declareNo", to_char(d.declare_date, 'YYYY-MM-DD') AS "declareDate",
           to_char(a.inv_date, 'YYYY-MM-DD') AS "invDate", c.id AS "clientId", c.code AS "clientCode",
           a.${sql.raw(t.col)} AS number, s.direction, s.hbl_no AS hbl
    FROM accounting_records a JOIN customs_declarations d ON d.id = a.declaration_id
    JOIN shipments s ON s.id = d.shipment_id JOIN clients c ON c.id = a.client_id
    WHERE ${t.numbered ? sql`a.${sql.raw(t.col)} IS NOT NULL` : sql`true`}
      AND NOT EXISTS (SELECT 1 FROM ${sql.raw(t.table)} x WHERE x.accounting_record_id = a.id AND x.status <> 'VOID')
      ${scoped ? sql`AND ${scoped}` : sql``}
    ORDER BY d.declare_date, d.declare_no LIMIT 500`,
  );
}
