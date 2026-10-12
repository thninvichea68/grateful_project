import { asc, eq, sql } from 'drizzle-orm';
import type { PgColumn, PgTable } from 'drizzle-orm/pg-core';
import {
  BILLING_DOC_SCHEMAS,
  computeLinesTotal,
  computeTaxDocument,
  computeTaxLine,
  ledgerInputSchema,
  lineAmount,
  toMoneyString,
  usdToKhr,
  type BillingDoc,
  type BillingDocListItem,
  type BillingDocType,
  type CreditNoteMessage,
  type CreditNoteReviewCounts,
  type CreditNoteReviewRow,
  type CreditNoteReviewStatus,
  type Paginated,
} from '@gs/shared';
import type { Request } from 'express';
import type { z } from 'zod';
import { db, type Tx } from '../../db/client';
import {
  accountingRecords,
  clients,
  creditNoteLines,
  creditNotes,
  debitNoteLines,
  debitNotes,
  disbursementLines,
  disbursements,
  recordSummaries,
  recordSummaryLines,
  taxInvoiceLines,
  taxInvoices,
} from '../../db/schema';
import { audit } from '../../lib/audit';
import { businessRule, conflict, notFound } from '../../lib/errors';
import { likePattern, paginate, queryRows, toPaginated, whereAll } from '../../lib/listing';
import { clientCondition } from '../../lib/clientScope';
import {
  formatNumber,
  highestNumber,
  nextNumber,
  nextNumberAtLeast,
  regexLiteral,
} from '../../lib/numbering';
import { insertLedger, recompute } from './ledger';

type Row = Record<string, unknown>;
type Input = z.output<(typeof BILLING_DOC_SCHEMAS)[BillingDocType]> & Row;

interface Config {
  table: PgTable;
  lines: PgTable;
  fk: string;
  /** SQL names, for raw list queries. */
  sqlTable: string;
  numberCol: string | null;
  numberSql: string | null;
  dateCol: string;
  dateSql: string;
  billToSql: string;
  /** Allocate the next number when the user didn't type one. */
  allocate: ((tx: Tx, date: string, clientCode: string) => Promise<string>) | null;
  kind: 'tax' | 'khr' | 'plain';
  /** Issuing writes the number (when the ledger has a column for it) + total into the ledger. */
  ledger: {
    numberCol: 'invNo' | 'disNo' | 'dnNo' | null;
    totalCol: 'invRevenue' | 'disTotal' | 'dnTotal' | 'clearFee';
  } | null;
}

const CONFIG: Record<BillingDocType, Config> = {
  'tax-invoices': {
    table: taxInvoices,
    lines: taxInvoiceLines,
    fk: 'taxInvoiceId',
    sqlTable: 'tax_invoices',
    numberCol: 'invoiceNo',
    numberSql: 'invoice_no',
    dateCol: 'invoiceDate',
    dateSql: 'invoice_date',
    billToSql: 'customer_name_en',
    kind: 'tax',
    allocate: async (tx, date) => {
      const yy = date.slice(2, 4);
      // Past numbers typed into the ledger (from the Excel days) are never handed out again.
      const used = await highestNumber(
        tx,
        sql`SELECT invoice_no FROM tax_invoices UNION ALL SELECT inv_no FROM accounting_records`,
        `^GS${yy}-(\\d{1,9})$`,
      );
      return formatNumber.taxInvoice(
        yy,
        await nextNumberAtLeast(tx, `TAX_INVOICE:${date.slice(0, 4)}`, used + 1),
      );
    },
    ledger: { numberCol: 'invNo', totalCol: 'invRevenue' },
  },
  disbursements: {
    table: disbursements,
    lines: disbursementLines,
    fk: 'disbursementId',
    sqlTable: 'disbursements',
    numberCol: 'disNo',
    numberSql: 'dis_no',
    dateCol: 'disDate',
    dateSql: 'dis_date',
    billToSql: 'customer_name_en',
    kind: 'khr',
    allocate: async (tx) => {
      const used = await highestNumber(
        tx,
        sql`SELECT dis_no FROM disbursements UNION ALL SELECT dis_no FROM accounting_records`,
        '^DIS(\\d{1,9})$',
      );
      return formatNumber.disbursement(await nextNumberAtLeast(tx, 'DISBURSEMENT', used + 1));
    },
    ledger: { numberCol: 'disNo', totalCol: 'disTotal' },
  },
  'debit-notes': {
    table: debitNotes,
    lines: debitNoteLines,
    fk: 'debitNoteId',
    sqlTable: 'debit_notes',
    numberCol: 'dnNo',
    numberSql: 'dn_no',
    dateCol: 'dnDate',
    dateSql: 'dn_date',
    billToSql: 'bill_to',
    kind: 'plain',
    allocate: async (tx, date, code) => {
      const yymm = date.slice(2, 4) + date.slice(5, 7);
      const used = await highestNumber(
        tx,
        sql`SELECT dn_no FROM debit_notes UNION ALL SELECT dn_no FROM accounting_records`,
        `^${regexLiteral(code.toUpperCase())}${yymm}(\\d{3})$`,
      );
      return formatNumber.debitNote(
        code,
        yymm,
        await nextNumberAtLeast(tx, `DEBIT_NOTE:${code}:${yymm}`, used + 1),
      );
    },
    ledger: { numberCol: 'dnNo', totalCol: 'dnTotal' },
  },
  'credit-notes': {
    table: creditNotes,
    lines: creditNoteLines,
    fk: 'creditNoteId',
    sqlTable: 'credit_notes',
    numberCol: 'cnNo',
    numberSql: 'cn_no',
    dateCol: 'cnDate',
    dateSql: 'cn_date',
    billToSql: 'bill_to',
    kind: 'plain',
    allocate: async (tx, date) =>
      `CN${date.slice(2, 4)}-${String(await nextNumber(tx, `CREDIT_NOTE:${date.slice(0, 4)}`)).padStart(3, '0')}`,
    // "Submit to Monthly": the broker's credit note total is that declaration's Clear Fee.
    ledger: { numberCol: null, totalCol: 'clearFee' },
  },
  'record-summaries': {
    table: recordSummaries,
    lines: recordSummaryLines,
    fk: 'recordSummaryId',
    sqlTable: 'record_summaries',
    numberCol: null,
    numberSql: null,
    dateCol: 'summaryDate',
    dateSql: 'summary_date',
    billToSql: 'declare_no',
    kind: 'plain',
    allocate: null,
    ledger: null,
  },
};

const col = (t: PgTable, name: string) => (t as unknown as Record<string, PgColumn>)[name]!;

/** Compute stored totals and line amounts with the shared formulas. */
function totals(kind: Config['kind'], lines: Input['lines'], rate: string | null) {
  if (kind === 'tax') {
    const t = computeTaxDocument(
      lines.map((l) => ({ qty: l.qty, unitPrice: l.unitPrice })),
      rate,
    );
    return {
      header: {
        subtotal: toMoneyString(t.subtotal),
        vat: toMoneyString(t.vat),
        total: toMoneyString(t.total),
        subtotalKhr: String(t.subtotalKhr),
        vatKhr: String(t.vatKhr),
        totalKhr: String(t.totalKhr),
      },
      lines: lines.map((l) => {
        const lt = computeTaxLine({ qty: l.qty, unitPrice: l.unitPrice });
        return {
          subtotal: toMoneyString(lt.subtotal),
          vat: toMoneyString(lt.vat),
          amount: toMoneyString(lt.amount),
        };
      }),
      ledgerTotal: toMoneyString(t.subtotal),
    };
  }
  const total = computeLinesTotal(lines.map((l) => ({ qty: l.qty, unitPrice: l.unitPrice })));
  return {
    header:
      kind === 'khr'
        ? { total: toMoneyString(total), totalKhr: String(usdToKhr(total, rate)) }
        : { total: toMoneyString(total) },
    lines: lines.map((l) => ({ subtotal: toMoneyString(lineAmount(l.qty, l.unitPrice)) })),
    ledgerTotal: toMoneyString(total),
  };
}

function friendlyUnique(err: unknown, type: BillingDocType): never {
  const c =
    (err as { cause?: { code?: string; detail?: string } }).cause ??
    (err as { code?: string; detail?: string });
  if (c?.code === '23505') {
    const v = /\)=\((.*)\)/.exec(c.detail ?? '')?.[1];
    throw conflict(
      `Number ${v ?? ''} is already used by another ${type.replace(/-/g, ' ').replace(/s$/, '')}`.replace(
        '  ',
        ' ',
      ),
    );
  }
  throw err;
}

async function loadClient(tx: Tx, clientId: string) {
  const [c] = await tx.select().from(clients).where(eq(clients.id, clientId));
  if (!c || c.deletedAt) throw businessRule('The selected client does not exist');
  return c;
}

async function assertRecord(tx: Tx, recordId: string | null, clientId: string) {
  if (!recordId) return;
  const [r] = await tx
    .select({ clientId: accountingRecords.clientId })
    .from(accountingRecords)
    .where(eq(accountingRecords.id, recordId));
  if (!r) throw businessRule('The linked ledger entry does not exist');
  if (r.clientId !== clientId) throw businessRule('The ledger entry belongs to a different client');
}

function headerValues(type: BillingDocType, input: Input) {
  const { lines: _l, ...rest } = input;
  const numberCol = CONFIG[type].numberCol;
  // An empty number means "allocate one"; a typed number is stored upper-case.
  return Object.fromEntries(
    Object.entries(rest)
      .filter(([k, v]) => !(k === numberCol && !v))
      .map(([k, v]) => [k, k === numberCol && typeof v === 'string' ? v.toUpperCase() : v]),
  ) as Row;
}

async function writeLines(
  tx: Tx,
  type: BillingDocType,
  docId: string,
  input: Input,
  lineTotals: Row[],
) {
  const cfg = CONFIG[type];
  await tx.insert(cfg.lines).values(
    input.lines.map((l, i) => ({
      [cfg.fk]: docId,
      lineNo: i + 1,
      description: l.description,
      qty: l.qty,
      unit: l.unit,
      unitPrice: l.unitPrice,
      mark: l.mark,
      ...lineTotals[i],
    })) as never,
  );
}

export async function createDoc(type: BillingDocType, input: Input, req: Request): Promise<string> {
  const cfg = CONFIG[type];
  try {
    return await db.transaction(async (tx) => {
      const client = await loadClient(tx, input.clientId);
      await assertRecord(tx, input.accountingRecordId ?? null, input.clientId);
      const values = headerValues(type, input);
      const date = values[cfg.dateCol] as string;
      if (cfg.numberCol && !values[cfg.numberCol] && cfg.allocate)
        values[cfg.numberCol] = await cfg.allocate(tx, date, client.code);
      const t = totals(cfg.kind, input.lines, (values.exchangeRate as string | undefined) ?? null);
      const [row] = (await tx
        .insert(cfg.table)
        .values({ ...values, ...t.header, status: 'DRAFT', createdById: req.auth!.userId } as never)
        .returning()) as Row[];
      await writeLines(tx, type, row!.id as string, input, t.lines);
      await audit(
        tx,
        {
          action: 'CREATE',
          entity: cfg.sqlTable,
          entityId: row!.id as string,
          after: { ...row, lines: input.lines },
        },
        req,
      );
      return row!.id as string;
    });
  } catch (err) {
    return friendlyUnique(err, type);
  }
}

async function lockDoc(tx: Tx, type: BillingDocType, id: string): Promise<Row> {
  const cfg = CONFIG[type];
  const [row] = (await tx
    .select()
    .from(cfg.table)
    .where(eq(col(cfg.table, 'id'), id))
    .for('update')) as Row[];
  if (!row) throw notFound(BILLING_LABEL[type]);
  return row;
}

const BILLING_LABEL: Record<BillingDocType, string> = {
  'tax-invoices': 'Tax invoice',
  disbursements: 'Disbursement',
  'debit-notes': 'Debit note',
  'credit-notes': 'Credit note',
  'record-summaries': 'Record summary',
};

export async function updateDoc(
  type: BillingDocType,
  id: string,
  input: Input,
  req: Request,
): Promise<void> {
  const cfg = CONFIG[type];
  try {
    await db.transaction(async (tx) => {
      const before = await lockDoc(tx, type, id);
      if (before.status !== 'DRAFT')
        throw conflict(
          `${BILLING_LABEL[type]} is ${before.status === 'VOID' ? 'cancelled' : String(before.status).toLowerCase()} and can no longer be edited. Cancel it and create a new one.`,
        );
      await loadClient(tx, input.clientId);
      await assertRecord(tx, input.accountingRecordId ?? null, input.clientId);
      const values = headerValues(type, input);
      if (cfg.numberCol && !values[cfg.numberCol]) values[cfg.numberCol] = before[cfg.numberCol]; // keep the allocated number
      const t = totals(cfg.kind, input.lines, (values.exchangeRate as string | undefined) ?? null);
      await tx
        .update(cfg.table)
        .set({ ...values, ...t.header } as never)
        .where(eq(col(cfg.table, 'id'), id));
      await tx.delete(cfg.lines).where(eq(col(cfg.lines, cfg.fk), id));
      await writeLines(tx, type, id, input, t.lines);
      await audit(
        tx,
        { action: 'UPDATE', entity: cfg.sqlTable, entityId: id, before, after: input },
        req,
      );
    });
  } catch (err) {
    friendlyUnique(err, type);
  }
}

/**
 * Issue: the document becomes final. For tax invoices, disbursements and debit notes the
 * linked ledger row takes this document's number and total, and net profit is recalculated.
 */
export async function issueDoc(type: BillingDocType, id: string, req: Request): Promise<void> {
  const cfg = CONFIG[type];
  await db.transaction(async (tx) => {
    const doc = await lockDoc(tx, type, id);
    if (doc.status !== 'DRAFT')
      throw conflict(
        `Only drafts can be issued; this one is ${doc.status === 'VOID' ? 'cancelled' : String(doc.status).toLowerCase()}`,
      );
    await tx
      .update(cfg.table)
      // A credit note accounting sent back comes back to them as Unchecked.
      .set(
        (type === 'credit-notes'
          ? { status: 'ISSUED', reviewStatus: 'UNCHECKED' }
          : { status: 'ISSUED' }) as never,
      )
      .where(eq(col(cfg.table, 'id'), id));
    if (type === 'credit-notes' && !doc.accountingRecordId) {
      doc.accountingRecordId = await ledgerRowForCreditNote(tx, doc, req);
      await tx
        .update(cfg.table)
        .set({ accountingRecordId: doc.accountingRecordId } as never)
        .where(eq(col(cfg.table, 'id'), id));
    }
    if (cfg.ledger && doc.accountingRecordId) {
      const total = cfg.kind === 'tax' ? doc.subtotal : doc.total;
      await tx
        .update(accountingRecords)
        .set({
          ...(cfg.ledger.numberCol
            ? { [cfg.ledger.numberCol]: cfg.numberCol ? doc[cfg.numberCol] : null }
            : {}),
          [cfg.ledger.totalCol]: total,
          updatedById: req.auth!.userId,
        } as never)
        .where(eq(accountingRecords.id, doc.accountingRecordId as string));
      await recompute(tx, doc.accountingRecordId as string);
    }
    await audit(
      tx,
      {
        action: 'UPDATE',
        entity: cfg.sqlTable,
        entityId: id,
        before: { status: doc.status },
        after: { status: 'ISSUED' },
      },
      req,
    );
  });
}

/**
 * The Monthly Ledger row a credit note belongs to, found through its declare no. When the
 * declaration has no ledger row yet, one is created (amounts 0) so the clear fee has a home.
 */
async function ledgerRowForCreditNote(tx: Tx, doc: Row, req: Request): Promise<string> {
  const declareNo = String(doc.declareNo ?? '').trim();
  if (!declareNo)
    throw businessRule('Enter the declare no. so the credit note can go into the Monthly Ledger');
  const [d] = await queryRows<{ id: string; clientId: string; recordId: string | null }>(
    tx,
    sql`
    SELECT d.id, s.client_id AS "clientId", a.id AS "recordId"
    FROM customs_declarations d JOIN shipments s ON s.id = d.shipment_id AND s.deleted_at IS NULL
    LEFT JOIN accounting_records a ON a.declaration_id = d.id
    WHERE upper(d.declare_no) = upper(${declareNo})
    ORDER BY d.declare_date DESC LIMIT 1`,
  );
  if (!d) throw businessRule(`Declaration ${declareNo} was not found on any shipment`);
  if (d.clientId !== doc.clientId)
    throw businessRule(`Declaration ${declareNo} belongs to a different client`);
  return d.recordId ?? insertLedger(tx, ledgerInputSchema.parse({ declarationId: d.id }), req);
}

/** Undo what issuing wrote into the Monthly Ledger row (if that row still shows this document). */
async function takeOutOfLedger(tx: Tx, cfg: Config, doc: Row): Promise<void> {
  if (!cfg.ledger || !doc.accountingRecordId) return;
  const [r] = await tx
    .select()
    .from(accountingRecords)
    .where(eq(accountingRecords.id, doc.accountingRecordId as string));
  const numberCol = cfg.ledger.numberCol;
  const stillOurs = numberCol
    ? !!cfg.numberCol && r?.[numberCol] === doc[cfg.numberCol]
    : Number(r?.[cfg.ledger.totalCol]) === Number(doc.total);
  if (!r || !stillOurs) return;
  await tx
    .update(accountingRecords)
    .set({ ...(numberCol ? { [numberCol]: null } : {}), [cfg.ledger.totalCol]: '0' } as never)
    .where(eq(accountingRecords.id, r.id));
  await recompute(tx, r.id);
}

/** Void: keeps the record (numbers are never reused) and takes it back out of the ledger. */
export async function voidDoc(
  type: BillingDocType,
  id: string,
  reason: string,
  req: Request,
): Promise<void> {
  const cfg = CONFIG[type];
  await db.transaction(async (tx) => {
    const doc = await lockDoc(tx, type, id);
    if (doc.status === 'VOID') throw conflict('Already cancelled');
    await tx
      .update(cfg.table)
      .set({ status: 'VOID' } as never)
      .where(eq(col(cfg.table, 'id'), id));
    if (doc.status === 'ISSUED') await takeOutOfLedger(tx, cfg, doc);
    await audit(
      tx,
      {
        action: 'UPDATE',
        entity: cfg.sqlTable,
        entityId: id,
        before: { status: doc.status },
        after: { status: 'VOID' },
        reason,
      },
      req,
    );
  });
}

export async function deleteDoc(type: BillingDocType, id: string, req: Request): Promise<void> {
  const cfg = CONFIG[type];
  await db.transaction(async (tx) => {
    const doc = await lockDoc(tx, type, id);
    if (doc.status !== 'DRAFT')
      throw conflict('Only drafts can be deleted. Cancel an issued document instead.');
    await tx.delete(cfg.table).where(eq(col(cfg.table, 'id'), id));
    await audit(tx, { action: 'DELETE', entity: cfg.sqlTable, entityId: id, before: doc }, req);
  });
}

export async function getDoc(type: BillingDocType, id: string): Promise<BillingDoc> {
  const cfg = CONFIG[type];
  const [doc] = (await db
    .select()
    .from(cfg.table)
    .where(eq(col(cfg.table, 'id'), id))) as Row[];
  if (!doc) throw notFound(BILLING_LABEL[type]);
  const [client] = await db
    .select({ code: clients.code, name: clients.name })
    .from(clients)
    .where(eq(clients.id, doc.clientId as string));
  const lines = (await db
    .select()
    .from(cfg.lines)
    .where(eq(col(cfg.lines, cfg.fk), id))
    .orderBy(asc(col(cfg.lines, 'lineNo')))) as Row[];
  const [rec] = doc.accountingRecordId
    ? await queryRows<{ declareNo: string }>(
        db,
        sql`SELECT d.declare_no AS "declareNo" FROM accounting_records a JOIN customs_declarations d ON d.id = a.declaration_id WHERE a.id = ${doc.accountingRecordId as string}`,
      )
    : [];
  const skip = new Set([
    'id',
    'clientId',
    'accountingRecordId',
    'status',
    'createdById',
    'createdAt',
    'updatedAt',
    'subtotal',
    'vat',
    'total',
    'subtotalKhr',
    'vatKhr',
    'totalKhr',
  ]);
  const header = Object.fromEntries(
    Object.entries(doc)
      .filter(([k]) => !skip.has(k))
      .map(([k, v]) => [k, v === null || v === undefined ? null : String(v)]),
  );
  const s = (v: unknown) => (v === null || v === undefined ? undefined : String(v));
  return {
    id,
    type,
    number: cfg.numberCol ? ((doc[cfg.numberCol] as string | null) ?? null) : null,
    date: doc[cfg.dateCol] as string,
    status: doc.status as BillingDoc['status'],
    clientId: doc.clientId as string,
    clientCode: client!.code,
    clientName: client!.name,
    accountingRecordId: (doc.accountingRecordId as string | null) ?? null,
    declareNo: rec?.declareNo ?? (doc.declareNo as string | null) ?? null,
    header,
    lines: lines.map((l) => ({
      id: l.id as string,
      lineNo: l.lineNo as number,
      description: l.description as string,
      qty: l.qty as string,
      unit: (l.unit as string | null) ?? null,
      unitPrice: l.unitPrice as string,
      subtotal: l.subtotal as string,
      mark: (l.mark as string | null) ?? null,
      ...(cfg.kind === 'tax' ? { vat: l.vat as string, amount: l.amount as string } : {}),
    })),
    totals: {
      subtotal: s(doc.subtotal) ?? s(doc.total) ?? '0',
      vat: s(doc.vat) ?? '0.00',
      total: s(doc.total) ?? '0',
      ...(cfg.kind !== 'plain' ? { totalKhr: s(doc.totalKhr) } : {}),
      ...(cfg.kind === 'tax' ? { subtotalKhr: s(doc.subtotalKhr), vatKhr: s(doc.vatKhr) } : {}),
    },
    createdAt: (doc.createdAt as Date).toISOString(),
    updatedAt: (doc.updatedAt as Date).toISOString(),
  };
}

export async function listDocs(
  type: BillingDocType,
  p: {
    page: number;
    pageSize: number;
    q?: string | undefined;
    clientId?: string | undefined;
    /** Per-user client access; undefined = every client. */
    clientIds?: string[] | undefined;
    status?: string | undefined;
    month?: string | undefined;
  },
): Promise<Paginated<BillingDocListItem>> {
  const cfg = CONFIG[type];
  const t = sql.raw(cfg.sqlTable);
  const dateCol = sql.raw(`t.${cfg.dateSql}`);
  const numCol = cfg.numberSql ? sql.raw(`t.${cfg.numberSql}`) : sql`NULL`;
  const c = [sql`true`];
  if (p.clientId) c.push(sql`t.client_id = ${p.clientId}`);
  const scoped = clientCondition(sql`t.client_id`, p.clientIds);
  if (scoped) c.push(scoped);
  if (p.status) c.push(sql`t.status = ${p.status}`);
  if (p.month)
    c.push(
      sql`${dateCol} >= ${`${p.month}-01`}::date AND ${dateCol} < (${`${p.month}-01`}::date + interval '1 month')`,
    );
  if (p.q) {
    const like = likePattern(p.q);
    c.push(
      sql`(${numCol} ILIKE ${like} OR ${sql.raw(`t.${cfg.billToSql}`)} ILIKE ${like} OR d.declare_no ILIKE ${like} OR cl.code ILIKE ${like})`,
    );
  }
  const rows = await queryRows<BillingDocListItem & { total_count: string }>(
    db,
    sql`
    SELECT t.id, ${numCol} AS number, to_char(${dateCol}, 'YYYY-MM-DD') AS date, t.status, cl.code AS "clientCode", cl.name AS "clientName",
           ${sql.raw(`t.${cfg.billToSql}`)} AS "billTo", d.declare_no AS "declareNo", t.total::text AS total, count(*) OVER () AS total_count
    FROM ${t} t JOIN clients cl ON cl.id = t.client_id
    LEFT JOIN accounting_records a ON a.id = t.accounting_record_id LEFT JOIN customs_declarations d ON d.id = a.declaration_id
    ${whereAll(c)} ORDER BY ${dateCol} DESC, t.created_at DESC ${paginate(p.page, p.pageSize)}`,
  );
  return toPaginated(rows, p.page, p.pageSize);
}

/* ---------- Accounting's check of submitted credit notes ---------- */

/**
 * Submitted (issued) credit notes for Accounting → Credit Noted, with the shipment's
 * direction and mode, plus Checked / Unchecked / Revised counts for the same filters.
 */
export async function listCreditNoteReview(p: {
  page: number;
  pageSize: number;
  q?: string | undefined;
  clientId?: string | undefined;
  clientIds?: string[] | undefined;
  direction?: string | undefined;
  month?: number | undefined;
  year?: number | undefined;
  review?: string | undefined;
  /** The broker's own list (sidebar → Credit Noted): drafts and void too, optionally one status. */
  allStatuses?: boolean;
  status?: string | undefined;
}): Promise<Paginated<CreditNoteReviewRow> & { counts: CreditNoteReviewCounts }> {
  const c = p.allStatuses
    ? [p.status ? sql`t.status = ${p.status}` : sql`true`]
    : // Submitted ones, plus those sent back to the broker that are still being revised.
      [sql`(t.status = 'ISSUED' OR (t.status = 'DRAFT' AND t.review_status = 'REVISED'))`];
  if (p.clientId) c.push(sql`t.client_id = ${p.clientId}`);
  const scoped = clientCondition(sql`t.client_id`, p.clientIds);
  if (scoped) c.push(scoped);
  if (p.direction) c.push(sql`x.direction = ${p.direction}`);
  if (p.year) c.push(sql`extract(year FROM t.cn_date) = ${p.year}`);
  if (p.month) c.push(sql`extract(month FROM t.cn_date) = ${p.month}`);
  if (p.q) {
    const like = likePattern(p.q.replace(/\s+/g, ''));
    c.push(sql`(replace(t.declare_no, ' ', '') ILIKE ${like} OR t.cn_no ILIKE ${like})`);
  }
  const from = sql`
    FROM credit_notes t JOIN clients cl ON cl.id = t.client_id
    LEFT JOIN ports po ON po.id = t.port_id
    LEFT JOIN accounting_records a ON a.id = t.accounting_record_id
    LEFT JOIN LATERAL (
      SELECT s.direction, s.transport_mode
      FROM customs_declarations d JOIN shipments s ON s.id = d.shipment_id
      WHERE d.id = a.declaration_id
         OR (a.declaration_id IS NULL AND lower(d.declare_no) = lower(t.declare_no))
      ORDER BY d.created_at DESC LIMIT 1
    ) x ON true`;
  const [counts] = await queryRows<CreditNoteReviewCounts>(
    db,
    sql`SELECT count(*)::int AS total,
          (count(*) FILTER (WHERE t.review_status = 'CHECKED'))::int AS checked,
          (count(*) FILTER (WHERE t.review_status = 'UNCHECKED'))::int AS unchecked,
          (count(*) FILTER (WHERE t.review_status = 'REVISED'))::int AS revised
        ${from} ${whereAll(c)}`,
  );
  if (p.review) c.push(sql`t.review_status = ${p.review}`);
  const rows = await queryRows<CreditNoteReviewRow & { total_count: string }>(
    db,
    sql`SELECT t.id, t.cn_no AS number, to_char(t.cn_date, 'YYYY-MM-DD') AS date,
          cl.id AS "clientId", cl.code AS "clientCode", cl.name AS "clientName",
          x.direction, x.transport_mode AS "transportMode", t.declare_no AS "declareNo",
          t.quantity_text AS "quantityText", po.short_name AS port, t.total::text AS total,
          t.status, t.review_status AS "reviewStatus", count(*) OVER () AS total_count
        ${from} ${whereAll(c)}
        ORDER BY t.cn_date DESC, t.created_at DESC ${paginate(p.page, p.pageSize)}`,
  );
  return { ...toPaginated(rows, p.page, p.pageSize), counts: counts! };
}

/**
 * Accounting's check of a submitted credit note.
 * - CHECKED: the broker gets a "Checked" message (with an optional note).
 * - REVISED: the note goes back to the broker as an editable draft, its Clear Fee comes out of
 *   the Monthly Ledger until it is submitted again, and the broker gets the message saying
 *   what to change.
 */
export async function setCreditNoteReview(
  id: string,
  reviewStatus: CreditNoteReviewStatus,
  message: string | undefined,
  req: Request,
): Promise<void> {
  await db.transaction(async (tx) => {
    const doc = await lockDoc(tx, 'credit-notes', id);
    if (doc.status !== 'ISSUED')
      throw businessRule(
        doc.status === 'DRAFT' && doc.reviewStatus === 'REVISED'
          ? 'This credit note is with the broker for revision; it comes back when they submit it again'
          : 'Only a credit note submitted to the Monthly Ledger can be checked',
      );
    if (reviewStatus === 'REVISED') {
      await tx.update(creditNotes).set({ status: 'DRAFT' }).where(eq(creditNotes.id, id));
      await takeOutOfLedger(tx, CONFIG['credit-notes'], doc);
    }
    await tx
      .update(creditNotes)
      .set({ reviewStatus, reviewedBy: req.auth?.userId ?? null, reviewedAt: new Date() })
      .where(eq(creditNotes.id, id));
    if (reviewStatus !== 'UNCHECKED')
      await tx.execute(sql`
        INSERT INTO credit_note_messages (credit_note_id, recipient_id, sender_id, kind, body)
        SELECT ${id}::uuid, u.id, ${req.auth?.userId ?? null}::uuid, ${reviewStatus}::credit_note_review, ${message ?? ''}
        FROM ${creditNoteRecipients(id, doc.createdById as string | null)} u
        WHERE u.id IS DISTINCT FROM ${req.auth?.userId ?? null}::uuid`);
    await audit(
      tx,
      {
        action: 'UPDATE',
        entity: 'credit_note',
        entityId: id,
        before: { status: doc.status, reviewStatus: doc.reviewStatus },
        after: {
          status: reviewStatus === 'REVISED' ? 'DRAFT' : doc.status,
          reviewStatus,
          message,
        },
      },
      req,
    );
  });
}

/**
 * Who hears about a credit note: every active customs broker who can see its client, plus
 * whoever created it (an accountant or admin may have drafted it for the broker).
 */
function creditNoteRecipients(creditNoteId: string, createdById: string | null) {
  return sql`(
    SELECT u.id FROM users u JOIN roles r ON r.id = u.role_id
    JOIN credit_notes t ON t.id = ${creditNoteId}::uuid
    WHERE r.code = 'CUSTOMS_BROKER' AND u.is_active AND u.deleted_at IS NULL
      AND (u.client_ids IS NULL OR t.client_id = ANY(u.client_ids))
    UNION
    SELECT id FROM users WHERE id = ${createdById}::uuid AND deleted_at IS NULL
  )`;
}

/* ---------- The broker's inbox ---------- */

const MESSAGE_COLUMNS = sql`m.id, m.credit_note_id AS "creditNoteId", t.cn_no AS number,
  t.declare_no AS "declareNo", cl.code AS "clientCode", cl.name AS "clientName", m.kind, m.body,
  u.full_name AS "senderName", m.created_at AS "createdAt", m.read_at AS "readAt",
  to_char(t.cn_date, 'YYYY-MM-DD') AS date, t.status, x.direction, x.transport_mode AS "transportMode",
  t.quantity_text AS "quantityText", po.short_name AS port, t.total::text AS total`;
const MESSAGE_FROM = sql`FROM credit_note_messages m
  JOIN credit_notes t ON t.id = m.credit_note_id JOIN clients cl ON cl.id = t.client_id
  LEFT JOIN users u ON u.id = m.sender_id
  LEFT JOIN ports po ON po.id = t.port_id
  LEFT JOIN accounting_records a ON a.id = t.accounting_record_id
  LEFT JOIN LATERAL (
    SELECT s.direction, s.transport_mode
    FROM customs_declarations d JOIN shipments s ON s.id = d.shipment_id
    WHERE d.id = a.declaration_id
       OR (a.declaration_id IS NULL AND lower(d.declare_no) = lower(t.declare_no))
    ORDER BY d.created_at DESC LIMIT 1
  ) x ON true`;

export async function creditNoteInbox(
  userId: string,
): Promise<{ data: CreditNoteMessage[]; unread: number }> {
  const data = await queryRows<CreditNoteMessage>(
    db,
    sql`SELECT ${MESSAGE_COLUMNS} ${MESSAGE_FROM}
        WHERE m.recipient_id = ${userId} ORDER BY m.created_at DESC LIMIT 50`,
  );
  const [r] = await queryRows<{ n: number }>(
    db,
    sql`SELECT count(*)::int AS n FROM credit_note_messages
        WHERE recipient_id = ${userId} AND read_at IS NULL`,
  );
  return { data, unread: r?.n ?? 0 };
}

/** Marks my messages read: one, or all when no id is given. */
export async function markCreditNoteMessagesRead(userId: string, id?: string): Promise<void> {
  await db.execute(
    sql`UPDATE credit_note_messages SET read_at = now()
        WHERE recipient_id = ${userId} AND read_at IS NULL ${id ? sql`AND id = ${id}` : sql``}`,
  );
}

/** Accounting's messages about one credit note, newest first (the editor's banner). */
export async function creditNoteMessagesFor(id: string): Promise<CreditNoteMessage[]> {
  return queryRows<CreditNoteMessage>(
    db,
    sql`SELECT ${MESSAGE_COLUMNS} ${MESSAGE_FROM}
        WHERE m.credit_note_id = ${id} ORDER BY m.created_at DESC LIMIT 20`,
  );
}
