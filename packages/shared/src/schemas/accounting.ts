import { z } from 'zod';
import {
  BILLING_DOC_STATUSES,
  CHEA_STATUSES,
  CONTAINER_SIZES,
  CREDIT_NOTE_REF_TYPES,
  DIRECTIONS,
  LOAD_TYPES,
  TRANSPORT_MODES,
  type BillingDocStatus,
  type CheaStatus,
} from '../enums';
import { paginationQuerySchema } from './common';
import { decimal, optDate, optText, optUuid } from './fields';

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Enter a date');
const money = (allowEmpty = true) => decimal(2, { min: 0, allowEmpty }).transform((v) => v ?? '0');

/* ------------------------------ Monthly ledger ------------------------------ */

/**
 * A ledger row (Chea payment / Monthly Ledger). VAT, net profit and — unless given —
 * commission, invoice date and exchange rate are computed by the server.
 */
export const ledgerInputSchema = z.object({
  declarationId: z.string().uuid('Choose a customs declaration'),
  invNo: optText(30),
  disNo: optText(30),
  dnNo: optText(30),
  /** Leave empty: next business day after the declaration date. */
  invDate: optDate,
  /** Leave empty: the USD→KHR rate in force on the invoice date. */
  exchangeRate: decimal(4, { min: 1 }),
  clearFee: money(),
  thc: money(),
  otherPay: money(),
  /** Leave empty: the client's commission setting (JR $0, others $50). */
  commission: decimal(2, { min: 0 }),
  invRevenue: money(),
  disTotal: money(),
  dnTotal: money(),
  cheaStatus: z.enum(CHEA_STATUSES).default('UNPAID'),
  mark: optText(200),
});
export type LedgerEntryInput = z.input<typeof ledgerInputSchema>;
export const ledgerUpdateSchema = ledgerInputSchema.omit({ declarationId: true }).partial();

export const ledgerListQuerySchema = paginationQuerySchema.extend({
  month: z
    .string()
    .regex(/^\d{4}-\d{2}$/, 'Use YYYY-MM')
    .optional(),
  /** Whole calendar year (Jan–Dec); used when no month is given. */
  year: z
    .string()
    .regex(/^\d{4}$/, 'Use YYYY')
    .optional(),
  clientId: z.string().uuid().optional(),
  cheaStatus: z.enum(CHEA_STATUSES).optional(),
  pageSize: z.coerce.number().int().min(1).max(500).default(100),
});

export interface LedgerRow {
  id: string;
  declarationId: string;
  declareNo: string;
  declareDate: string;
  shipmentId: string;
  shipmentReference: string;
  direction: 'IMPORT' | 'EXPORT';
  clientId: string;
  clientCode: string;
  clientName: string;
  portCode: string | null;
  invNo: string | null;
  disNo: string | null;
  dnNo: string | null;
  invDate: string;
  exchangeRate: string;
  clearFee: string;
  thc: string;
  otherPay: string;
  commission: string;
  invRevenue: string;
  disTotal: string;
  vat: string;
  dnTotal: string;
  netProfit: string;
  cheaStatus: CheaStatus;
  mark: string | null;
  documents: {
    type: BillingDocType;
    id: string;
    number: string | null;
    status: BillingDocStatus;
  }[];
}

export interface LedgerSummary {
  rows: number;
  clearFee: string;
  thc: string;
  otherPay: string;
  commission: string;
  invRevenue: string;
  disTotal: string;
  vat: string;
  dnTotal: string;
  netProfit: string;
  unpaid: number;
}

export interface DeclarationOption {
  id: string;
  declareNo: string;
  declareDate: string;
  shipmentReference: string;
  clientId: string;
  clientCode: string;
  direction: 'IMPORT' | 'EXPORT';
}

/* ------------------------------ Billing documents ------------------------------ */

export const BILLING_DOC_TYPES = [
  'tax-invoices',
  'disbursements',
  'debit-notes',
  'credit-notes',
  'record-summaries',
] as const;
export type BillingDocType = (typeof BILLING_DOC_TYPES)[number];

export const BILLING_DOC_LABEL: Record<BillingDocType, string> = {
  'tax-invoices': 'Tax Invoice',
  disbursements: 'Disbursement',
  'debit-notes': 'Debit Note',
  'credit-notes': 'Credit Noted',
  'record-summaries': 'Record Summary',
};

export const billingLineInputSchema = z.object({
  description: z.string().trim().min(1, 'Enter a description').max(300),
  qty: decimal(3, { min: 0, allowEmpty: false }),
  unit: optText(20),
  unitPrice: decimal(4, { min: 0, allowEmpty: false }),
  mark: optText(100),
});
export type BillingLineInput = z.input<typeof billingLineInputSchema>;

const docBase = {
  accountingRecordId: optUuid,
  clientId: z.string().uuid('Choose a client'),
  lines: z.array(billingLineInputSchema).min(1, 'Add at least one line'),
};
const shipmentFields = {
  pol: optText(80),
  pod: optText(80),
  containerNo: optText(120),
  volumeCbm: decimal(3, { min: 0 }),
  grossWeightKg: decimal(3, { min: 0 }),
  shipper: optText(200),
  consignee: optText(200),
  hbl: optText(60),
  pkgs: optText(60),
};
const customer = {
  customerNameEn: z.string().trim().min(2, 'Enter the customer name').max(200),
  customerNameKm: optText(200),
  customerAddress: optText(400),
  customerVattin: optText(40),
};

export const taxInvoiceInputSchema = z.object({
  ...docBase,
  ...customer,
  ...shipmentFields,
  invoiceNo: optText(30),
  invoiceDate: isoDate,
  exchangeRate: decimal(4, { min: 1, allowEmpty: false }),
});

export const disbursementInputSchema = z.object({
  ...docBase,
  ...customer,
  ...shipmentFields,
  disNo: optText(30),
  disDate: isoDate,
  exchangeRate: decimal(4, { min: 1, allowEmpty: false }),
  reference: optText(120),
});

export const debitNoteInputSchema = z.object({
  ...docBase,
  ...shipmentFields,
  dnNo: optText(30),
  dnDate: isoDate,
  billTo: z.string().trim().min(2, 'Enter who is billed').max(200),
  address: optText(400),
  reference: optText(120),
});

export const creditNoteInputSchema = z.object({
  ...docBase,
  cnNo: optText(30),
  cnDate: isoDate,
  billTo: z.string().trim().min(2, 'Enter who is billed').max(200),
  address: optText(400),
  shipper: optText(200),
  portId: optUuid,
  containerNo: optText(120),
  refType: z
    .enum(CREDIT_NOTE_REF_TYPES)
    .nullish()
    .transform((v) => v ?? null),
  refNo: optText(60),
  quantityText: optText(60),
  grossWeightKg: decimal(3, { min: 0 }),
  cbm: decimal(3, { min: 0 }),
  declareNo: optText(30),
});

export const recordSummaryInputSchema = z.object({
  ...docBase,
  direction: z.enum(DIRECTIONS),
  transportMode: z.enum(TRANSPORT_MODES),
  loadType: z.enum(LOAD_TYPES),
  invNo: optText(30),
  disNo: optText(30),
  dnNo: optText(30),
  forwarderId: optUuid,
  portId: optUuid,
  declareNo: optText(30),
  summaryDate: isoDate,
  quantityText: optText(60),
  blNo: optText(60),
  containerNo: optText(120),
  containerSize: z
    .enum(CONTAINER_SIZES)
    .nullish()
    .or(z.literal(''))
    .transform((v) => (v ? v : null)),
  grossWeightKg: decimal(3, { min: 0 }),
  cbm: decimal(3, { min: 0 }),
});

export const BILLING_DOC_SCHEMAS = {
  'tax-invoices': taxInvoiceInputSchema,
  disbursements: disbursementInputSchema,
  'debit-notes': debitNoteInputSchema,
  'credit-notes': creditNoteInputSchema,
  'record-summaries': recordSummaryInputSchema,
} as const;
export type BillingDocInput<T extends BillingDocType> = z.input<(typeof BILLING_DOC_SCHEMAS)[T]>;

export const billingDocListQuerySchema = paginationQuerySchema.extend({
  clientId: z.string().uuid().optional(),
  status: z.enum(BILLING_DOC_STATUSES).optional(),
  month: z
    .string()
    .regex(/^\d{4}-\d{2}$/)
    .optional(),
});

/** Header + lines as stored. Field names follow the document type's input schema. */
export interface BillingDoc {
  id: string;
  type: BillingDocType;
  number: string | null;
  date: string;
  status: BillingDocStatus;
  clientId: string;
  clientCode: string;
  clientName: string;
  accountingRecordId: string | null;
  declareNo: string | null;
  header: Record<string, string | null>;
  lines: {
    id: string;
    lineNo: number;
    description: string;
    qty: string;
    unit: string | null;
    unitPrice: string;
    subtotal: string;
    vat?: string;
    amount?: string;
    mark: string | null;
  }[];
  totals: {
    subtotal: string;
    vat: string;
    total: string;
    subtotalKhr?: string;
    vatKhr?: string;
    totalKhr?: string;
  };
  createdAt: string;
  updatedAt: string;
}

export interface BillingDocListItem {
  id: string;
  number: string | null;
  date: string;
  status: BillingDocStatus;
  clientCode: string;
  clientName: string;
  billTo: string | null;
  declareNo: string | null;
  total: string;
}
