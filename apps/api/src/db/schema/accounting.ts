import {
  pgTable,
  text,
  uuid,
  date,
  integer,
  index,
  check,
  uniqueIndex,
  timestamp,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import {
  id,
  timestamps,
  money,
  rate,
  qty,
  khr,
  cheaStatusEnum,
  billingDocStatusEnum,
  directionEnum,
  transportModeEnum,
  loadTypeEnum,
  containerSizeEnum,
  creditNoteRefTypeEnum,
  creditNoteReviewEnum,
  statementKindEnum,
  paymentMethodEnum,
} from './_common';
import { users } from './auth';
import { clients, ports, forwarders } from './reference';
import { customsDeclarations } from './shipments';

/**
 * Monthly ledger / Chea payment row: one per customs declaration. All computed
 * columns (vat, commission, net_profit, inv_date) are written by the API using
 * @gs/shared `computeLedger` / `nextBusinessDay`, never by the browser.
 */
export const accountingRecords = pgTable(
  'accounting_records',
  {
    id: id(),
    declarationId: uuid('declaration_id')
      .notNull()
      .unique()
      .references(() => customsDeclarations.id, { onDelete: 'restrict' }),
    clientId: uuid('client_id')
      .notNull()
      .references(() => clients.id, { onDelete: 'restrict' }),
    portId: uuid('port_id').references(() => ports.id, { onDelete: 'restrict' }),
    invNo: text('inv_no'),
    disNo: text('dis_no'),
    dnNo: text('dn_no'),
    invDate: date('inv_date').notNull(),
    exchangeRate: rate('exchange_rate').notNull(),
    clearFee: money('clear_fee').notNull().default('0'),
    thc: money('thc').notNull().default('0'),
    otherPay: money('other_pay').notNull().default('0'),
    commission: money('commission').notNull().default('0'),
    invRevenue: money('inv_revenue').notNull().default('0'),
    disTotal: money('dis_total').notNull().default('0'),
    vat: money('vat').notNull().default('0'),
    dnTotal: money('dn_total').notNull().default('0'),
    netProfit: money('net_profit').notNull().default('0'),
    cheaStatus: cheaStatusEnum('chea_status').notNull().default('UNPAID'),
    mark: text('mark'),
    createdById: uuid('created_by_id').references(() => users.id, { onDelete: 'set null' }),
    updatedById: uuid('updated_by_id').references(() => users.id, { onDelete: 'set null' }),
    ...timestamps,
  },
  (t) => [
    index('accounting_records_client_date_idx').on(t.clientId, t.invDate),
    index('accounting_records_inv_date_idx').on(t.invDate),
    uniqueIndex('accounting_records_inv_no_unique')
      .on(t.invNo)
      .where(sql`${t.invNo} IS NOT NULL`),
  ],
);

/* Shared columns for billing document line items. */
const lineColumns = () => ({
  id: id(),
  lineNo: integer('line_no').notNull(),
  description: text('description').notNull(),
  qty: qty('qty').notNull().default('1'),
  unit: text('unit'),
  unitPrice: rate('unit_price').notNull().default('0'),
  subtotal: money('subtotal').notNull().default('0'),
  mark: text('mark'),
});

const docHeader = () => ({
  id: id(),
  accountingRecordId: uuid('accounting_record_id').references(() => accountingRecords.id, {
    onDelete: 'set null',
  }),
  clientId: uuid('client_id')
    .notNull()
    .references(() => clients.id, { onDelete: 'restrict' }),
  status: billingDocStatusEnum('status').notNull().default('DRAFT'),
  createdById: uuid('created_by_id').references(() => users.id, { onDelete: 'set null' }),
  ...timestamps,
});

/** Bilingual Khmer/English tax invoice, VAT 10%. */
export const taxInvoices = pgTable('tax_invoices', {
  ...docHeader(),
  invoiceNo: text('invoice_no').notNull().unique(),
  invoiceDate: date('invoice_date').notNull(),
  exchangeRate: rate('exchange_rate').notNull(),
  customerNameEn: text('customer_name_en').notNull(),
  customerNameKm: text('customer_name_km'),
  customerAddress: text('customer_address'),
  customerVattin: text('customer_vattin'),
  pol: text('pol'),
  pod: text('pod'),
  containerNo: text('container_no'),
  volumeCbm: qty('volume_cbm'),
  grossWeightKg: qty('gross_weight_kg'),
  shipper: text('shipper'),
  consignee: text('consignee'),
  hbl: text('hbl'),
  pkgs: text('pkgs'),
  subtotal: money('subtotal').notNull().default('0'),
  vat: money('vat').notNull().default('0'),
  total: money('total').notNull().default('0'),
  subtotalKhr: khr('subtotal_khr').notNull().default('0'),
  vatKhr: khr('vat_khr').notNull().default('0'),
  totalKhr: khr('total_khr').notNull().default('0'),
});

export const taxInvoiceLines = pgTable(
  'tax_invoice_lines',
  {
    ...lineColumns(),
    taxInvoiceId: uuid('tax_invoice_id')
      .notNull()
      .references(() => taxInvoices.id, { onDelete: 'cascade' }),
    vat: money('vat').notNull().default('0'),
    amount: money('amount').notNull().default('0'),
  },
  (t) => [index('tax_invoice_lines_doc_idx').on(t.taxInvoiceId)],
);

/** Disbursement voucher — VAT 0%. */
export const disbursements = pgTable('disbursements', {
  ...docHeader(),
  disNo: text('dis_no').notNull().unique(),
  disDate: date('dis_date').notNull(),
  exchangeRate: rate('exchange_rate').notNull(),
  customerNameEn: text('customer_name_en').notNull(),
  customerNameKm: text('customer_name_km'),
  customerAddress: text('customer_address'),
  customerVattin: text('customer_vattin'),
  reference: text('reference'),
  pol: text('pol'),
  pod: text('pod'),
  containerNo: text('container_no'),
  volumeCbm: qty('volume_cbm'),
  grossWeightKg: qty('gross_weight_kg'),
  shipper: text('shipper'),
  consignee: text('consignee'),
  hbl: text('hbl'),
  pkgs: text('pkgs'),
  total: money('total').notNull().default('0'),
  totalKhr: khr('total_khr').notNull().default('0'),
});

export const disbursementLines = pgTable(
  'disbursement_lines',
  {
    ...lineColumns(),
    disbursementId: uuid('disbursement_id')
      .notNull()
      .references(() => disbursements.id, { onDelete: 'cascade' }),
  },
  (t) => [index('disbursement_lines_doc_idx').on(t.disbursementId)],
);

export const debitNotes = pgTable('debit_notes', {
  ...docHeader(),
  dnNo: text('dn_no').notNull().unique(),
  dnDate: date('dn_date').notNull(),
  billTo: text('bill_to').notNull(),
  address: text('address'),
  reference: text('reference'),
  pol: text('pol'),
  pod: text('pod'),
  containerNo: text('container_no'),
  volumeCbm: qty('volume_cbm'),
  grossWeightKg: qty('gross_weight_kg'),
  shipper: text('shipper'),
  consignee: text('consignee'),
  hbl: text('hbl'),
  pkgs: text('pkgs'),
  total: money('total').notNull().default('0'),
});

export const debitNoteLines = pgTable(
  'debit_note_lines',
  {
    ...lineColumns(),
    debitNoteId: uuid('debit_note_id')
      .notNull()
      .references(() => debitNotes.id, { onDelete: 'cascade' }),
  },
  (t) => [index('debit_note_lines_doc_idx').on(t.debitNoteId)],
);

/** "Credit Noted" — the Chea payment voucher. */
export const creditNotes = pgTable('credit_notes', {
  ...docHeader(),
  cnNo: text('cn_no').notNull().unique(),
  cnDate: date('cn_date').notNull(),
  billTo: text('bill_to').notNull(),
  address: text('address'),
  shipper: text('shipper'),
  portId: uuid('port_id').references(() => ports.id, { onDelete: 'restrict' }),
  containerNo: text('container_no'),
  refType: creditNoteRefTypeEnum('ref_type'),
  refNo: text('ref_no'),
  quantityText: text('quantity_text'),
  grossWeightKg: qty('gross_weight_kg'),
  cbm: qty('cbm'),
  declareNo: text('declare_no'),
  total: money('total').notNull().default('0'),
  /** Accounting's check of the submitted note (Accounting → Credit Noted). */
  reviewStatus: creditNoteReviewEnum('review_status').notNull().default('UNCHECKED'),
  reviewedBy: uuid('reviewed_by').references(() => users.id, { onDelete: 'set null' }),
  reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
});

export const creditNoteLines = pgTable(
  'credit_note_lines',
  {
    ...lineColumns(),
    creditNoteId: uuid('credit_note_id')
      .notNull()
      .references(() => creditNotes.id, { onDelete: 'cascade' }),
  },
  (t) => [index('credit_note_lines_doc_idx').on(t.creditNoteId)],
);

export const recordSummaries = pgTable('record_summaries', {
  ...docHeader(),
  direction: directionEnum('direction').notNull(),
  transportMode: transportModeEnum('transport_mode').notNull(),
  loadType: loadTypeEnum('load_type').notNull(),
  invNo: text('inv_no'),
  disNo: text('dis_no'),
  dnNo: text('dn_no'),
  forwarderId: uuid('forwarder_id').references(() => forwarders.id, { onDelete: 'set null' }),
  portId: uuid('port_id').references(() => ports.id, { onDelete: 'restrict' }),
  declareNo: text('declare_no'),
  summaryDate: date('summary_date').notNull(),
  quantityText: text('quantity_text'),
  blNo: text('bl_no'),
  containerNo: text('container_no'),
  containerSize: containerSizeEnum('container_size'),
  grossWeightKg: qty('gross_weight_kg'),
  cbm: qty('cbm'),
  total: money('total').notNull().default('0'),
});

export const recordSummaryLines = pgTable(
  'record_summary_lines',
  {
    ...lineColumns(),
    recordSummaryId: uuid('record_summary_id')
      .notNull()
      .references(() => recordSummaries.id, { onDelete: 'cascade' }),
  },
  (t) => [
    index('record_summary_lines_doc_idx').on(t.recordSummaryId),
    check('record_summary_lines_qty', sql`qty >= 0`),
  ],
);

/**
 * Official receipt: a client's payment against one of its monthly account statements
 * (tax invoices + disbursements, or debit notes). Issued when saved; void keeps the number.
 * The statements themselves are not stored: they are read from the month's documents.
 */
export const officialReceipts = pgTable(
  'official_receipts',
  {
    id: id(),
    receiptNo: text('receipt_no').notNull().unique(),
    clientId: uuid('client_id')
      .notNull()
      .references(() => clients.id, { onDelete: 'restrict' }),
    /** First day of the statement month the payment is for. */
    periodMonth: date('period_month').notNull(),
    kind: statementKindEnum('kind').notNull(),
    receiptDate: date('receipt_date').notNull(),
    amount: money('amount').notNull(),
    paymentMethod: paymentMethodEnum('payment_method').notNull(),
    paymentRef: text('payment_ref'),
    note: text('note'),
    status: billingDocStatusEnum('status').notNull().default('ISSUED'),
    createdById: uuid('created_by_id').references(() => users.id, { onDelete: 'set null' }),
    ...timestamps,
  },
  (t) => [
    index('official_receipts_client_period_idx').on(t.clientId, t.periodMonth),
    index('official_receipts_date_idx').on(t.receiptDate),
    check('official_receipts_amount_positive', sql`amount > 0`),
  ],
);

/**
 * Accounting → broker messages about a credit note ("Checked", or "Revised" with what to fix).
 * Shown in the broker's Credit Noted inbox.
 */
export const creditNoteMessages = pgTable(
  'credit_note_messages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    creditNoteId: uuid('credit_note_id')
      .notNull()
      .references(() => creditNotes.id, { onDelete: 'cascade' }),
    recipientId: uuid('recipient_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    senderId: uuid('sender_id').references(() => users.id, { onDelete: 'set null' }),
    kind: creditNoteReviewEnum('kind').notNull(),
    body: text('body').notNull().default(''),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    readAt: timestamp('read_at', { withTimezone: true }),
  },
  (t) => [
    index('credit_note_messages_recipient_idx').on(t.recipientId, t.createdAt),
    index('credit_note_messages_note_idx').on(t.creditNoteId),
  ],
);
