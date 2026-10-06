import { asc, eq, sql } from 'drizzle-orm';
import type { PgColumn, PgTable } from 'drizzle-orm/pg-core';
import {
  BILLING_DOC_SCHEMAS,
  computeLinesTotal,
  computeTaxDocument,
  computeTaxLine,
  lineAmount,
  toMoneyString,
  usdToKhr,
  type BillingDoc,
  type BillingDocListItem,
  type BillingDocType,
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
import { formatNumber, nextNumber } from '../../lib/numbering';
import { recompute } from './ledger';

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
  /** Issuing writes the number + total into these ledger columns. */
  ledger: {
    numberCol: 'invNo' | 'disNo' | 'dnNo';
    totalCol: 'invRevenue' | 'disTotal' | 'dnTotal';
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
    allocate: async (tx, date) =>
      formatNumber.taxInvoice(
        date.slice(2, 4),
        await nextNumber(tx, `TAX_INVOICE:${date.slice(0, 4)}`),
      ),
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
    allocate: async (tx) => formatNumber.disbursement(await nextNumber(tx, 'DISBURSEMENT')),
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
      return formatNumber.debitNote(code, yymm, await nextNumber(tx, `DEBIT_NOTE:${code}:${yymm}`));
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
    ledger: null,
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
          `${BILLING_LABEL[type]} is ${String(before.status).toLowerCase()} and can no longer be edited. Void it and create a new one.`,
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
      throw conflict(`Only drafts can be issued; this one is ${String(doc.status).toLowerCase()}`);
    await tx
      .update(cfg.table)
      .set({ status: 'ISSUED' } as never)
      .where(eq(col(cfg.table, 'id'), id));
    if (cfg.ledger && doc.accountingRecordId) {
      const total = cfg.kind === 'tax' ? doc.subtotal : doc.total;
      await tx
        .update(accountingRecords)
        .set({
          [cfg.ledger.numberCol]: cfg.numberCol ? doc[cfg.numberCol] : null,
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
    if (doc.status === 'VOID') throw conflict('Already void');
    await tx
      .update(cfg.table)
      .set({ status: 'VOID' } as never)
      .where(eq(col(cfg.table, 'id'), id));
    if (cfg.ledger && doc.status === 'ISSUED' && doc.accountingRecordId) {
      const [r] = await tx
        .select()
        .from(accountingRecords)
        .where(eq(accountingRecords.id, doc.accountingRecordId as string));
      if (r && cfg.numberCol && r[cfg.ledger.numberCol] === doc[cfg.numberCol]) {
        await tx
          .update(accountingRecords)
          .set({ [cfg.ledger.numberCol]: null, [cfg.ledger.totalCol]: '0' } as never)
          .where(eq(accountingRecords.id, r.id));
        await recompute(tx, r.id);
      }
    }
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
      throw conflict('Only drafts can be deleted. Void an issued document instead.');
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
