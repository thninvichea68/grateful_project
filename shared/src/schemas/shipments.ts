import { z } from 'zod';
import {
  CLEARANCE_STATUSES,
  CONTAINER_SIZES,
  DIRECTIONS,
  LOAD_TYPES,
  SHIPMENT_STATUSES,
  TRANSPORT_MODES,
  type ClearanceStatus,
  type ContainerSize,
  type Direction,
  type LoadType,
  type ShipmentStatus,
  type TransportMode,
} from '../enums';
import { paginationQuerySchema } from './common';
import { decimal, multi, optDate, optDateTime, optText, optUuid } from './fields';

/** ISO 6346 shape: 4 letters + 7 digits. Spaces/dashes are stripped. */
export const containerNo = z
  .string()
  .transform((v) => v.toUpperCase().replace(/[\s-]/g, ''))
  .refine(
    (v) => /^[A-Z]{4}\d{7}$/.test(v),
    'Container no. must be 4 letters + 7 digits, e.g. MRKU8974303',
  );

export const containerInputSchema = z.object({
  containerNo,
  size: z
    .enum(CONTAINER_SIZES)
    .nullish()
    .transform((v) => v ?? null),
  linerSeal: optText(40),
  customsSeal: optText(40),
});

export const cargoLineInputSchema = z.object({
  poNo: optText(60),
  styleNo: optText(60),
  htsCode: optText(20),
  /** Imports: CDC group (e.g. RAW MATERIAL), item no. on the CDC master list and its unit. */
  material: optText(60),
  cdcNo: optText(20),
  unit: optText(20),
  pcs: decimal(3, { min: 0 }).transform((v) => v ?? '0'),
  ctns: decimal(3, { min: 0 }).transform((v) => v ?? '0'),
  cbm: decimal(3, { min: 0 }).transform((v) => v ?? '0'),
  netWeightKg: decimal(3, { min: 0 }).transform((v) => v ?? '0'),
  grossWeightKg: decimal(3, { min: 0 }).transform((v) => v ?? '0'),
  fobUnitPrice: decimal(4, { min: 0 }).transform((v) => v ?? '0'),
  description: optText(300),
  /** Imports: required (with cutstock:override) when this item would push the balance below zero. */
  overrideReason: optText(300),
});

/** The distinct, non-empty HTS codes used on an invoice's lines. */
export const invoiceHtsCodes = (lines: { htsCode?: string | null }[]) => [
  ...new Set(lines.map((l) => l.htsCode?.trim().toUpperCase()).filter((c): c is string => !!c)),
];

/** One invoice = one HTS code: lines may not differ, and blank lines take the invoice's code. */
export const cargoInvoiceInputSchema = z
  .object({
    invoiceNo: z.string().trim().toUpperCase().min(1, 'Enter the invoice no.').max(40),
    invoiceDate: optDate,
    description: optText(300),
    /** Imports: packages on the invoice (QTY PKGS). */
    packages: decimal(3, { min: 0 }),
    lines: z.array(cargoLineInputSchema).min(1, 'Add at least one line'),
  })
  .superRefine((inv, ctx) => {
    const codes = invoiceHtsCodes(inv.lines);
    if (codes.length > 1)
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['htsCode'],
        message: `One invoice uses one HTS code; this one has ${codes.join(', ')}`,
      });
  })
  .transform((inv) => {
    const [code = null] = invoiceHtsCodes(inv.lines);
    return { ...inv, lines: inv.lines.map((l) => ({ ...l, htsCode: code })) };
  });

export const declarationInputSchema = z.object({
  /** Present when editing an existing declaration (keeps its ledger link). */
  id: optUuid,
  declareNo: z.string().trim().toUpperCase().min(2, 'Enter the declaration no.').max(30),
  declareDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Enter the declaration date'),
  portId: optUuid,
  notes: optText(300),
});

/** A declaration row left completely blank: the form always offers one to fill in later. */
function blankDeclarationRow(d: unknown): boolean {
  if (!d || typeof d !== 'object') return false;
  const x = d as Record<string, unknown>;
  const text = (v: unknown) => String(v ?? '').trim();
  return !text(x.id) && !text(x.declareNo) && !text(x.declareDate) && !text(x.notes);
}
/** A container row with nothing typed in (the form always offers one; its size is preset). */
function blankContainerRow(c: unknown): boolean {
  if (!c || typeof c !== 'object') return false;
  const x = c as Record<string, unknown>;
  const text = (v: unknown) => String(v ?? '').trim();
  return !text(x.containerNo) && !text(x.linerSeal) && !text(x.customsSeal);
}
/** An invoice row nothing was typed into (the form always offers one; its date may be preset). */
function blankInvoiceRow(i: unknown): boolean {
  if (!i || typeof i !== 'object') return false;
  const x = i as Record<string, unknown>;
  const text = (v: unknown) => String(v ?? '').trim();
  const blankLine = (l: unknown) =>
    !!l && typeof l === 'object' && Object.values(l).every((v) => !text(v));
  return (
    !text(x.invoiceNo) &&
    !text(x.description) &&
    !text(x.packages) &&
    (!Array.isArray(x.lines) || x.lines.every(blankLine))
  );
}
const invoiceArray = z.array(cargoInvoiceInputSchema).default([]);
/** Cargo invoices are optional: an untouched row is dropped before validation. */
const invoiceRows = z.preprocess(
  (v) => (Array.isArray(v) ? v.filter((i) => !blankInvoiceRow(i)) : v),
  invoiceArray,
) as unknown as typeof invoiceArray;

const containerArray = z.array(containerInputSchema).default([]);
/** Blank rows are dropped before validation, so the ready-made empty row never blocks saving. */
const containerRows = z.preprocess(
  (v) => (Array.isArray(v) ? v.filter((c) => !blankContainerRow(c)) : v),
  containerArray,
) as unknown as typeof containerArray;

const declarationArray = z.array(declarationInputSchema).default([]);
/** Blank rows are dropped before validation, so an untouched one never blocks saving. */
const declarationRows = z.preprocess(
  (v) => (Array.isArray(v) ? v.filter((d) => !blankDeclarationRow(d)) : v),
  declarationArray,
  // zod 3 types a preprocess input as `unknown`; keep the array's own input type for forms.
) as unknown as typeof declarationArray;

/**
 * A shipment's status, worked out from its data:
 * Completed — an import has its ETA Factory date, an export its ATD;
 * In Progress — not completed, but a customs declaration is recorded;
 * Pending — otherwise.
 */
export function shipmentStatusOf(s: {
  direction: Direction;
  atd?: string | null | undefined;
  arriveFty?: string | null | undefined;
  declarations?: { declareNo?: string | null | undefined }[] | undefined;
}): ShipmentStatus {
  if (s.direction === 'IMPORT' ? s.arriveFty : s.atd) return 'COMPLETED';
  if (s.declarations?.some((d) => d.declareNo?.trim())) return 'IN_PROGRESS';
  return 'PENDING';
}

/**
 * A shipment's clearance status, worked out from its declarations:
 * Customs Cleared — a declaration has both its number and date;
 * In Progress — a declaration number is in, its date not yet;
 * Pending Review — otherwise.
 */
export function clearanceStatusOf(s: {
  declarations?:
    | { declareNo?: string | null | undefined; declareDate?: string | null | undefined }[]
    | undefined;
}): ClearanceStatus {
  const numbered = s.declarations?.filter((d) => d.declareNo?.trim()) ?? [];
  if (numbered.some((d) => d.declareDate?.trim())) return 'CLEARED';
  if (numbered.length) return 'IN_PROGRESS';
  return 'PENDING';
}

/** An import permit's progress; Not Required and Approved both clear the Permit stage. */
export const PERMIT_STATUSES = [
  'NOT_REQUIRED',
  'PENDING',
  'SUBMITTED',
  'APPROVED',
  'REJECTED',
] as const;
export type PermitStatus = (typeof PERMIT_STATUSES)[number];
export const PERMIT_STATUS_LABEL: Record<PermitStatus, string> = {
  NOT_REQUIRED: 'Not Required',
  PENDING: 'Pending',
  SUBMITTED: 'Submitted',
  APPROVED: 'Approved',
  REJECTED: 'Rejected',
};

export const shipmentInputSchema = z
  .object({
    clientId: z.string().uuid('Choose a client'),
    direction: z.enum(DIRECTIONS),
    transportMode: z.enum(TRANSPORT_MODES),
    loadType: z.enum(LOAD_TYPES),
    clearanceStatus: z.enum(CLEARANCE_STATUSES).default('PENDING'),
    assignedToId: optUuid,
    isUrgent: z.boolean().default(false),
    shipperName: optText(200),
    consigneeId: optUuid,
    forwarderId: optUuid,
    broker: optText(120),
    clearancePortId: optUuid,
    originCountryIso2: optText(2),
    destinationCountryIso2: optText(2),
    etdPort: optText(120),
    quantity: decimal(3, { min: 0 }),
    quantityUnit: optText(20),
    material: optText(60),
    bookingNo: optText(60),
    hblNo: optText(60),
    vesselName: optText(80),
    voyageNo: optText(30),
    crd: optDate,
    /** Air export: when the cargo must be at the airline (local date and time). */
    cutOffAt: optDateTime,
    etd: optDate,
    atd: optDate,
    eta: optDate,
    ata: optDate,
    arriveFty: optDate,
    thcHblNo: optText(60),
    thcHblDate: optDate,
    thcHblAmount: decimal(2, { min: 0 }),
    permitNo: optText(60),
    permitDate: optDate,
    permitStatus: z
      .enum(PERMIT_STATUSES)
      .nullish()
      .or(z.literal(''))
      .transform((v) => (v ? v : null)),
    arrivalNoticeNo: optText(60),
    arrivalNoticeDate: optDate,
    doNo: optText(60),
    doDate: optDate,
    authorizeNo: optText(60),
    authorizeDate: optDate,
    truckNo: optText(30),
    driverName: optText(80),
    driverPhone: optText(30),
    podReceived: z.boolean().default(false),
    coForm: optText(30),
    coNumber: optText(60),
    coStatus: optText(30),
    remark: optText(1000),
    containers: containerRows,
    invoices: invoiceRows,
    declarations: declarationRows,
  })
  .superRefine((s, ctx) => {
    if (s.transportMode === 'AIR' && s.loadType !== 'NONE')
      ctx.addIssue({
        code: 'custom',
        path: ['loadType'],
        message: 'Air freight has no CY/CY or LCL load type',
      });
    if (s.loadType !== 'FCL' && s.containers.length)
      ctx.addIssue({
        code: 'custom',
        path: ['containers'],
        message: 'Containers are only recorded for CY/CY (FCL) shipments',
      });
    if (s.etd && s.eta && s.etd > s.eta)
      ctx.addIssue({ code: 'custom', path: ['eta'], message: 'ETA cannot be before ETD' });
    if (s.eta && s.arriveFty && s.arriveFty < s.eta)
      ctx.addIssue({
        code: 'custom',
        path: ['arriveFty'],
        message: 'Arrive FTY cannot be before ETA',
      });
    const dup = <T>(items: T[], key: (t: T) => string, path: string, label: string) => {
      const seen = new Set<string>();
      items.forEach((it, i) => {
        const k = key(it);
        if (seen.has(k))
          ctx.addIssue({ code: 'custom', path: [path, i], message: `${label} ${k} appears twice` });
        seen.add(k);
      });
    };
    dup(s.containers, (c) => c.containerNo, 'containers', 'Container');
    dup(s.invoices, (i) => i.invoiceNo, 'invoices', 'Invoice');
    dup(s.declarations, (d) => d.declareNo, 'declarations', 'Declaration');
  })
  // The statuses are never entered: they follow from the dates and declarations.
  .transform((s) => ({ ...s, status: shipmentStatusOf(s), clearanceStatus: clearanceStatusOf(s) }));
export type ShipmentInput = z.input<typeof shipmentInputSchema>;
export type ShipmentInputParsed = z.output<typeof shipmentInputSchema>;

export const SHIPMENT_SORT_FIELDS = [
  'eta',
  'reference',
  'status',
  'client',
  'createdAt',
  'arriveFty',
] as const;

/**
 * Shipping Plans watch filters (the summary tiles). The shipment's date is an import's ETA or an
 * export's ETD, compared with today in the business time zone.
 * DUE_SOON: not completed, date within the next 7 days.
 * ATTENTION: not completed and the date has passed, a customs exception, or completed while
 * customs is not cleared.
 */
export const SHIPMENT_WATCHES = ['DUE_SOON', 'ATTENTION'] as const;
export type ShipmentWatch = (typeof SHIPMENT_WATCHES)[number];

const colSearch = z.string().trim().max(60).optional();

/** The Shipping Plans columns that can be searched from their header. */
export const SHIPMENT_COLUMN_SEARCHES = [
  'hbl',
  'invoice',
  'qty',
  'fwd',
  'eta',
  'etd',
  'clearanceDate',
  'arriveFty',
  'atd',
] as const;
export type ShipmentColumnSearch = (typeof SHIPMENT_COLUMN_SEARCHES)[number];

export const shipmentListQuerySchema = paginationQuerySchema.extend({
  clientId: multi(z.string().uuid()),
  direction: z.enum(DIRECTIONS).optional(),
  status: multi(z.enum(SHIPMENT_STATUSES)),
  transportMode: z.enum(TRANSPORT_MODES).optional(),
  loadType: z.enum(LOAD_TYPES).optional(),
  from: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  to: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  /** Declaration month (YYYY-MM): the shipment's first declare date falls in it. */
  month: z
    .string()
    .regex(/^\d{4}-\d{2}$/, 'Use YYYY-MM')
    .optional(),
  watch: z.enum(SHIPMENT_WATCHES).optional(),
  /** "My shipments": the ones assigned to this user. */
  assignedToId: z.string().uuid().optional(),
  // Shipping Plans column searches (the box under each header): text the cell contains.
  f_hbl: colSearch,
  f_invoice: colSearch,
  f_qty: colSearch,
  f_fwd: colSearch,
  f_eta: colSearch,
  f_etd: colSearch,
  f_clearanceDate: colSearch,
  f_arriveFty: colSearch,
  f_atd: colSearch,
});
export type ShipmentListQuery = z.input<typeof shipmentListQuerySchema>;

/** One row of the Shipping Plans table (all "Expand All" columns included). */
export interface ShipmentListItem {
  id: string;
  reference: string;
  clientId: string;
  clientCode: string;
  clientName: string;
  direction: Direction;
  transportMode: TransportMode;
  loadType: LoadType;
  status: ShipmentStatus;
  clearanceStatus: ClearanceStatus;
  assignedToId: string | null;
  assignedToName: string | null;
  isUrgent: boolean;
  invoiceNos: string[];
  invoiceDate: string | null;
  quantity: string | null;
  quantityUnit: string | null;
  eta: string | null;
  ata: string | null;
  etd: string | null;
  atd: string | null;
  crd: string | null;
  /** Air export cut-off, local "YYYY-MM-DDTHH:mm". */
  cutOffAt: string | null;
  arriveFty: string | null;
  forwarderName: string | null;
  clearancePortName: string | null;
  etdPort: string | null;
  hblNo: string | null;
  bookingNo: string | null;
  containers: {
    containerNo: string;
    size: ContainerSize | null;
    linerSeal: string | null;
    customsSeal: string | null;
  }[];
  consigneeName: string | null;
  countryName: string | null;
  vesselName: string | null;
  voyageNo: string | null;
  coForm: string | null;
  coNumber: string | null;
  coStatus: string | null;
  thcHblNo: string | null;
  thcHblDate: string | null;
  thcHblAmount: string | null;
  declarations: { declareNo: string; declareDate: string }[];
  totals: {
    pcs: string;
    ctns: string;
    cbm: string;
    netWeightKg: string;
    grossWeightKg: string;
    fob: string;
  };
  firstLine: {
    poNo: string | null;
    styleNo: string | null;
    htsCode: string | null;
    fobUnitPrice: string | null;
    description: string | null;
  } | null;
  remark: string | null;
}

/** Counts for the Shipping Plans tiles: every filter applied except status and watch. */
export interface ShipmentListSummary {
  /** Today in the business time zone (YYYY-MM-DD), for "in 3d" / "5d late" hints. */
  today: string;
  total: number;
  pending: number;
  inProgress: number;
  completed: number;
  dueSoon: number;
  attention: number;
}

export interface ShipmentDetail {
  id: string;
  reference: string;
  clientId: string;
  clientCode: string;
  clientName: string;
  direction: Direction;
  transportMode: TransportMode;
  loadType: LoadType;
  status: ShipmentStatus;
  clearanceStatus: ClearanceStatus;
  shipperName: string | null;
  consigneeId: string | null;
  forwarderId: string | null;
  broker: string | null;
  clearancePortId: string | null;
  originCountryIso2: string | null;
  destinationCountryIso2: string | null;
  etdPort: string | null;
  quantity: string | null;
  quantityUnit: string | null;
  material: string | null;
  bookingNo: string | null;
  hblNo: string | null;
  vesselName: string | null;
  voyageNo: string | null;
  crd: string | null;
  /** Air export cut-off, local "YYYY-MM-DDTHH:mm". */
  cutOffAt: string | null;
  etd: string | null;
  atd: string | null;
  eta: string | null;
  ata: string | null;
  arriveFty: string | null;
  thcHblNo: string | null;
  thcHblDate: string | null;
  thcHblAmount: string | null;
  permitNo: string | null;
  permitDate: string | null;
  arrivalNoticeNo: string | null;
  arrivalNoticeDate: string | null;
  doNo: string | null;
  doDate: string | null;
  authorizeNo: string | null;
  authorizeDate: string | null;
  permitStatus: PermitStatus | null;
  truckNo: string | null;
  driverName: string | null;
  driverPhone: string | null;
  podReceived: boolean;
  assignedToId: string | null;
  assignedToName: string | null;
  isUrgent: boolean;
  coForm: string | null;
  coNumber: string | null;
  coStatus: string | null;
  remark: string | null;
  containers: {
    id: string;
    containerNo: string;
    size: ContainerSize | null;
    linerSeal: string | null;
    customsSeal: string | null;
  }[];
  invoices: {
    id: string;
    invoiceNo: string;
    invoiceDate: string | null;
    description: string | null;
    packages: string | null;
    lines: {
      id: string;
      poNo: string | null;
      styleNo: string | null;
      htsCode: string | null;
      material: string | null;
      cdcNo: string | null;
      unit: string | null;
      pcs: string;
      ctns: string;
      cbm: string;
      netWeightKg: string;
      grossWeightKg: string;
      fobUnitPrice: string;
      fobAmount: string;
      description: string | null;
      /** Imports: the master-list item this line draws down, and any approved overdraw. */
      cutStockItemId: string | null;
      overrideReason: string | null;
    }[];
  }[];
  declarations: {
    id: string;
    declareNo: string;
    declareDate: string;
    portId: string | null;
    notes: string | null;
    hasLedgerEntry: boolean;
  }[];
  createdAt: string;
  updatedAt: string;
}

/** Result of parsing an Export Template workbook into cargo invoices. */
export interface CargoExcelParseResult {
  invoices: {
    invoiceNo: string;
    invoiceDate: string | null;
    description: string | null;
    lines: {
      poNo: string | null;
      styleNo: string | null;
      htsCode: string | null;
      pcs: string;
      ctns: string;
      cbm: string;
      netWeightKg: string;
      grossWeightKg: string;
      fobUnitPrice: string;
      description: string | null;
    }[];
  }[];
  warnings: { row: number | null; message: string }[];
  rowsRead: number;
}

/** Result of parsing an import cargo workbook (import schedule layout) into invoices. */
export interface ImportCargoExcelParseResult {
  invoices: {
    invoiceNo: string;
    invoiceDate: string | null;
    lines: {
      /** CDC no., material and unit come from the client's CDC master list (found by ITEM). */
      cdcNo: string | null;
      description: string | null;
      material: string | null;
      unit: string | null;
      pcs: string;
      netWeightKg: string;
      grossWeightKg: string;
      fobUnitPrice: string;
    }[];
  }[];
  warnings: { row: number | null; message: string }[];
  /** Rows that do not match the CDC master list (or the template). With any, `invoices` is empty. */
  errors: { row: number | null; message: string }[];
  rowsRead: number;
}

/** Details of a CDC line that would over-import (422 BUSINESS_RULE, rule CUT_STOCK_OVER_IMPORT). */
export interface OverImportViolation {
  cutStockItemId: string;
  itemName: string;
  declareRef: string;
  balance: string;
  requested: string;
}

/**
 * Shipping Plan → Import from Excel: what an uploaded template would create (a check run) or
 * did create. Problems are listed per sheet and row; nothing is saved while there are any.
 */
export interface PlanImportResult {
  /** True when the file was saved (not a check run). */
  saved: boolean;
  shipments: {
    ref: string;
    clientCode: string;
    direction: Direction;
    transport: string;
    hblNo: string | null;
    date: string | null;
    containers: number;
    invoices: number;
    declarations: number;
    /** The new shipment reference, once saved (SHP-26-0001). */
    reference?: string;
    id?: string;
  }[];
  errors: { sheet: string; row: number | null; message: string }[];
  /** Forwarders and consignees not in the system yet; created with the shipments. */
  newForwarders: string[];
  newConsignees: { name: string; clientCode: string }[];
}

/**
 * The import transfer of rights (លិខិតផ្ទេរសិទ្ធិ) from the owner of the goods to us as
 * customs broker, ready to print: every line is already worded and dated in Khmer.
 */
export interface AuthorizeLetter {
  /** File name for the saved PDF, e.g. "AUTHORIZE EVM26-0395". */
  title: string;
  owner: { name: string; idNo: string; company: string; vattin: string; phone: string };
  broker: {
    company: string;
    vattin: string;
    grantee: { name: string; idNo: string; phone: string };
    agent: { name: string; idNo: string; phone: string };
    cardNo: string;
    /** "31 ខែ មីនា ឆ្នាំ 2028" */
    cardExpiry: string;
  };
  /** The customs office the goods clear at, e.g. "សាខាគយនិងរដ្ឋាករកំពង់ផែអន្តរជាតិក្រុងព្រះសីហនុ". */
  office: string;
  /** Invoice, packing list and bill: number and "17 ខែ 10 ឆ្នាំ 2026". */
  documents: { label: string; no: string; date: string }[];
  /** "ថ្ងៃចន្ទ ១៥កើត ខែអស្សុជ ឆ្នាំមមី អដ្ឋស័ក ព.ស. ២៥៧០" */
  lunarDate: string;
  /** "ធ្វើនៅភ្នំពេញថ្ងៃទី២៦ ខែតុលាឆ្នាំ២០២៦" */
  madeAt: string;
}

/** What GET /shipments/:id/authorize-letter answers: the letter, or what is still missing. */
export interface AuthorizeLetterResponse {
  missing: string[];
  letter: AuthorizeLetter | null;
}

/* ---------------- Import permit application set (Invoice / PL tab) ---------------- */

/** One commercial invoice with its packing list, as on JR's INVOICE sheet. */
export interface PermitInvoice {
  supplier: string;
  supplierAddress: string[];
  invoiceNo: string;
  invoiceDate: string | null;
  consignee: { company: string; address: [string, string]; attn: string; vat: string };
  origin: string;
  /** "CIF SIHANOUKVILLE" */
  terms: string;
  /** "Rolls" */
  unit: string;
  lines: {
    no: number;
    description: string;
    cdcRef: string;
    qty: number;
    cdcUnit: string;
    unitPrice: number;
    amount: number;
    packages: number;
    nw: number;
    gw: number;
  }[];
  totals: { qty: number; amount: number; packages: number; nw: number; gw: number };
  /** "ZCSU7954124 / A4250250303 / 40'HQ" */
  containers: string[];
}

/** The letter to the Director General of Customs asking to import the goods ("Cover"). */
export interface PermitCover {
  company: string;
  address: [string, string];
  vattin: string;
  /** "ថ្ងៃ…" lunar and solar dates the letter is signed on (today). */
  lunarDate: string;
  solarDate: string;
  items: number;
  /** "635 Rolls" */
  packages: string;
  gw: number;
  amount: number;
  /** The clearance port, in Khmer. */
  port: string;
  extensionLetterNo: string;
  cdcNo: string;
  cdcIssueDate: string;
  customsNoteDate: string;
  invoiceNos: string;
  invoiceDate: string | null;
  hblNo: string;
  hblDate: string | null;
  signatory: { name: string; title: string; titleKm: string };
}

/** GET /shipments/:id/permit-set: each document, or what it still needs. */
export interface PermitSetResponse {
  cover: { missing: string[]; data: PermitCover | null };
  invoices: { missing: string[]; data: PermitInvoice[] };
  authorize: AuthorizeLetterResponse;
}
