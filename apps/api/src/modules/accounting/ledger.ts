import { eq, sql } from 'drizzle-orm';
import {
  computeLedger,
  nextBusinessDay,
  toMoneyString,
  type DeclarationOption,
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
import { businessRule, conflict, notFound } from '../../lib/errors';
import {
  likePattern,
  orderBy,
  paginate,
  queryRows,
  toPaginated,
  whereAll,
} from '../../lib/listing';

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
         c.id AS "clientId", c.code AS "clientCode", c.name AS "clientName", p.code AS "portCode",
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
  clientId?: string | undefined;
  cheaStatus?: string | undefined;
}

function where(p: ListParams) {
  const c = [sql`true`];
  if (p.month)
    c.push(
      sql`a.inv_date >= ${`${p.month}-01`}::date AND a.inv_date < (${`${p.month}-01`}::date + interval '1 month')`,
    );
  if (p.clientId) c.push(sql`a.client_id = ${p.clientId}`);
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
    ${orderBy(p.sort, { invDate: sql`a.inv_date`, declareNo: sql`d.declare_no`, client: sql`c.code`, netProfit: sql`a.net_profit` }, sql`a.inv_date, d.declare_no`)}
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
export async function declarationOptions(q: string | undefined): Promise<DeclarationOption[]> {
  const like = q ? likePattern(q) : null;
  return queryRows<DeclarationOption>(
    db,
    sql`
    SELECT d.id, d.declare_no AS "declareNo", to_char(d.declare_date, 'YYYY-MM-DD') AS "declareDate", s.reference AS "shipmentReference",
           c.id AS "clientId", c.code AS "clientCode", s.direction
    FROM customs_declarations d JOIN shipments s ON s.id = d.shipment_id AND s.deleted_at IS NULL JOIN clients c ON c.id = s.client_id
    LEFT JOIN accounting_records a ON a.declaration_id = d.id
    WHERE a.id IS NULL ${like ? sql`AND (d.declare_no ILIKE ${like} OR s.reference ILIKE ${like} OR c.code ILIKE ${like})` : sql``}
    ORDER BY d.declare_date DESC, d.declare_no LIMIT 30`,
  );
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
  return db.transaction(async (tx) => {
    const [d] = await tx
      .select({ d: customsDeclarations, s: shipments, c: clients })
      .from(customsDeclarations)
      .innerJoin(shipments, eq(shipments.id, customsDeclarations.shipmentId))
      .innerJoin(clients, eq(clients.id, shipments.clientId))
      .where(eq(customsDeclarations.id, input.declarationId));
    if (!d || d.s.deletedAt) throw businessRule('The declaration does not exist');
    const [exists] = await tx
      .select({ id: accountingRecords.id })
      .from(accountingRecords)
      .where(eq(accountingRecords.declarationId, input.declarationId));
    if (exists) throw conflict(`Declaration ${d.d.declareNo} already has a ledger entry`);
    const invDate = input.invDate ?? nextBusinessDay(d.d.declareDate).date;
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
  });
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
      values.invDate = nextBusinessDay(d!.dd).date;
    }
    await tx
      .update(accountingRecords)
      .set({ ...values, updatedById: req.auth!.userId })
      .where(eq(accountingRecords.id, id));
    await recompute(tx, id);
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
    if (issued!.n) throw conflict('This ledger entry has issued documents. Void them first.');
    await tx.delete(accountingRecords).where(eq(accountingRecords.id, id));
    await audit(tx, { action: 'DELETE', entity: 'accounting_record', entityId: id, before }, req);
  });
}
