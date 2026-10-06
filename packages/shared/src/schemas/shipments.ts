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
import { decimal, multi, optDate, optText, optUuid } from './fields';

/** ISO 6346 shape: 4 letters + 7 digits. Spaces/dashes are stripped. */
const containerNo = z
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
  pcs: decimal(3, { min: 0 }).transform((v) => v ?? '0'),
  ctns: decimal(3, { min: 0 }).transform((v) => v ?? '0'),
  cbm: decimal(3, { min: 0 }).transform((v) => v ?? '0'),
  netWeightKg: decimal(3, { min: 0 }).transform((v) => v ?? '0'),
  grossWeightKg: decimal(3, { min: 0 }).transform((v) => v ?? '0'),
  fobUnitPrice: decimal(4, { min: 0 }).transform((v) => v ?? '0'),
  description: optText(300),
});

export const cargoInvoiceInputSchema = z.object({
  invoiceNo: z.string().trim().toUpperCase().min(1, 'Enter the invoice no.').max(40),
  invoiceDate: optDate,
  description: optText(300),
  lines: z.array(cargoLineInputSchema).min(1, 'Add at least one line'),
});

export const cdcLineInputSchema = z.object({
  cutStockItemId: z.string().uuid('Choose an item from the master list'),
  qty: decimal(3, { min: 0.001, allowEmpty: false }),
  unitPrice: decimal(4, { min: 0 }).transform((v) => v ?? '0'),
  netWeightKg: decimal(3, { min: 0 }).transform((v) => v ?? '0'),
  /** Required (with cutstock:override) when this line would push the balance below zero. */
  overrideReason: optText(300),
});

export const declarationInputSchema = z.object({
  /** Present when editing an existing declaration (keeps its ledger link). */
  id: optUuid,
  declareNo: z.string().trim().toUpperCase().min(2, 'Enter the declaration no.').max(30),
  declareDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Enter the declaration date'),
  portId: optUuid,
  notes: optText(300),
  cdcLines: z.array(cdcLineInputSchema).default([]),
});

export const shipmentInputSchema = z
  .object({
    clientId: z.string().uuid('Choose a client'),
    direction: z.enum(DIRECTIONS),
    transportMode: z.enum(TRANSPORT_MODES),
    loadType: z.enum(LOAD_TYPES),
    status: z.enum(SHIPMENT_STATUSES).default('PENDING'),
    clearanceStatus: z.enum(CLEARANCE_STATUSES).default('PENDING'),
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
    etd: optDate,
    atd: optDate,
    eta: optDate,
    ata: optDate,
    arriveFty: optDate,
    thcHblNo: optText(60),
    thcHblDate: optDate,
    thcHblAmount: decimal(2, { min: 0 }),
    coForm: optText(30),
    coNumber: optText(60),
    coStatus: optText(30),
    remark: optText(1000),
    containers: z.array(containerInputSchema).default([]),
    invoices: z.array(cargoInvoiceInputSchema).default([]),
    declarations: z.array(declarationInputSchema).default([]),
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
    if (s.direction === 'EXPORT' && s.declarations.some((d) => d.cdcLines.length))
      ctx.addIssue({
        code: 'custom',
        path: ['declarations'],
        message: 'CDC lines are only used on import declarations',
      });
  });
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
  invoiceNos: string[];
  invoiceDate: string | null;
  quantity: string | null;
  quantityUnit: string | null;
  eta: string | null;
  ata: string | null;
  etd: string | null;
  atd: string | null;
  crd: string | null;
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
  etd: string | null;
  atd: string | null;
  eta: string | null;
  ata: string | null;
  arriveFty: string | null;
  thcHblNo: string | null;
  thcHblDate: string | null;
  thcHblAmount: string | null;
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
    lines: {
      id: string;
      poNo: string | null;
      styleNo: string | null;
      htsCode: string | null;
      pcs: string;
      ctns: string;
      cbm: string;
      netWeightKg: string;
      grossWeightKg: string;
      fobUnitPrice: string;
      fobAmount: string;
      description: string | null;
    }[];
  }[];
  declarations: {
    id: string;
    declareNo: string;
    declareDate: string;
    portId: string | null;
    notes: string | null;
    hasLedgerEntry: boolean;
    cdcLines: {
      id: string;
      cutStockItemId: string;
      itemName: string;
      declareRef: string;
      unit: string;
      qty: string;
      unitPrice: string;
      netWeightKg: string;
      overrideReason: string | null;
    }[];
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

/** Details of a CDC line that would over-import (422 BUSINESS_RULE, rule CUT_STOCK_OVER_IMPORT). */
export interface OverImportViolation {
  cutStockItemId: string;
  itemName: string;
  declareRef: string;
  balance: string;
  requested: string;
}
