import {
  pgTable,
  text,
  uuid,
  char,
  date,
  integer,
  index,
  uniqueIndex,
  check,
  pgView,
  numeric,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import {
  id,
  timestamps,
  softDelete,
  money,
  rate,
  qty,
  directionEnum,
  transportModeEnum,
  loadTypeEnum,
  shipmentStatusEnum,
  clearanceStatusEnum,
  containerSizeEnum,
  cutStockCategoryEnum,
} from './_common';
import { users } from './auth';
import { clients, consignees, forwarders, ports, countries } from './reference';

/** The Shipping Plan record. */
export const shipments = pgTable(
  'shipments',
  {
    id: id(),
    /** Human reference, e.g. SHP-26-0001 (allocated from number_sequences). */
    reference: text('reference').notNull().unique(),
    clientId: uuid('client_id')
      .notNull()
      .references(() => clients.id, { onDelete: 'restrict' }),
    direction: directionEnum('direction').notNull(),
    transportMode: transportModeEnum('transport_mode').notNull(),
    loadType: loadTypeEnum('load_type').notNull(),
    status: shipmentStatusEnum('status').notNull().default('PENDING'),
    clearanceStatus: clearanceStatusEnum('clearance_status').notNull().default('PENDING'),

    // Parties
    shipperName: text('shipper_name'),
    consigneeId: uuid('consignee_id').references(() => consignees.id, { onDelete: 'set null' }),
    forwarderId: uuid('forwarder_id').references(() => forwarders.id, { onDelete: 'set null' }),
    broker: text('broker'),

    // Routing
    clearancePortId: uuid('clearance_port_id').references(() => ports.id, { onDelete: 'restrict' }),
    /** Import: country of origin. Export: destination country. */
    originCountryIso2: char('origin_country_iso2', { length: 2 }).references(() => countries.iso2),
    destinationCountryIso2: char('destination_country_iso2', { length: 2 }).references(
      () => countries.iso2,
    ),
    etdPort: text('etd_port'),

    // Cargo summary
    quantity: qty('quantity'),
    quantityUnit: text('quantity_unit'), // ROLLS, PKGS, CTNS…
    material: text('material'),

    // Booking / BL / vessel
    bookingNo: text('booking_no'),
    hblNo: text('hbl_no'),
    vesselName: text('vessel_name'),
    voyageNo: text('voyage_no'),

    // Dates (calendar dates; no time zone)
    crd: date('crd'),
    etd: date('etd'),
    atd: date('atd'),
    eta: date('eta'),
    /** Actual arrival — used for forwarder on-time %. */
    ata: date('ata'),
    arriveFty: date('arrive_fty'),

    // THC / HBL
    thcHblNo: text('thc_hbl_no'),
    thcHblDate: date('thc_hbl_date'),
    thcHblAmount: money('thc_hbl_amount'),

    // Certificate of origin
    coForm: text('co_form'),
    coNumber: text('co_number'),
    coStatus: text('co_status'),

    remark: text('remark'),
    createdById: uuid('created_by_id').references(() => users.id, { onDelete: 'set null' }),
    updatedById: uuid('updated_by_id').references(() => users.id, { onDelete: 'set null' }),
    ...timestamps,
    ...softDelete,
  },
  (t) => [
    index('shipments_client_status_eta_dir_idx').on(t.clientId, t.status, t.eta, t.direction),
    index('shipments_eta_idx').on(t.eta),
    index('shipments_status_idx').on(t.status),
    index('shipments_direction_eta_idx').on(t.direction, t.eta),
    index('shipments_forwarder_idx').on(t.forwarderId),
    index('shipments_clearance_port_idx').on(t.clearancePortId),
    index('shipments_hbl_idx').on(t.hblNo),
    index('shipments_active_idx')
      .on(t.eta)
      .where(sql`${t.deletedAt} IS NULL`),
  ],
);

export const containers = pgTable(
  'containers',
  {
    id: id(),
    shipmentId: uuid('shipment_id')
      .notNull()
      .references(() => shipments.id, { onDelete: 'cascade' }),
    containerNo: text('container_no').notNull(),
    size: containerSizeEnum('size'),
    linerSeal: text('liner_seal'),
    customsSeal: text('customs_seal'),
    sortOrder: integer('sort_order').notNull().default(0),
    ...timestamps,
  },
  (t) => [
    index('containers_shipment_idx').on(t.shipmentId),
    index('containers_no_idx').on(t.containerNo),
    uniqueIndex('containers_shipment_no_unique').on(t.shipmentId, t.containerNo),
  ],
);

/** Commercial (cargo) invoices of a shipment — the "Cargo, Pricing & FOB" section. */
export const cargoInvoices = pgTable(
  'cargo_invoices',
  {
    id: id(),
    shipmentId: uuid('shipment_id')
      .notNull()
      .references(() => shipments.id, { onDelete: 'cascade' }),
    invoiceNo: text('invoice_no').notNull(),
    invoiceDate: date('invoice_date'),
    description: text('description'),
    currency: char('currency', { length: 3 }).notNull().default('USD'),
    sortOrder: integer('sort_order').notNull().default(0),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('cargo_invoices_invoice_no_unique').on(sql`upper(${t.invoiceNo})`),
    index('cargo_invoices_shipment_idx').on(t.shipmentId),
  ],
);

export const cargoInvoiceLines = pgTable(
  'cargo_invoice_lines',
  {
    id: id(),
    invoiceId: uuid('invoice_id')
      .notNull()
      .references(() => cargoInvoices.id, { onDelete: 'cascade' }),
    lineNo: integer('line_no').notNull(),
    poNo: text('po_no'),
    styleNo: text('style_no'),
    htsCode: text('hts_code'),
    pcs: qty('pcs').notNull().default('0'),
    ctns: qty('ctns').notNull().default('0'),
    cbm: qty('cbm').notNull().default('0'),
    netWeightKg: qty('net_weight_kg').notNull().default('0'),
    grossWeightKg: qty('gross_weight_kg').notNull().default('0'),
    fobUnitPrice: rate('fob_unit_price').notNull().default('0'),
    /** PCS × FOB price, rounded to cents — computed by PostgreSQL. */
    fobAmount: numeric('fob_amount', { precision: 16, scale: 2 }).generatedAlwaysAs(
      sql`round(pcs * fob_unit_price, 2)`,
    ),
    description: text('description'),
    ...timestamps,
  },
  (t) => [
    index('cargo_invoice_lines_invoice_idx').on(t.invoiceId),
    uniqueIndex('cargo_invoice_lines_invoice_line_unique').on(t.invoiceId, t.lineNo),
    check(
      'cargo_invoice_lines_non_negative',
      sql`pcs >= 0 AND ctns >= 0 AND cbm >= 0 AND fob_unit_price >= 0`,
    ),
  ],
);

/** A customs declaration (e.g. "I 122050"). One shipment can have several. */
export const customsDeclarations = pgTable(
  'customs_declarations',
  {
    id: id(),
    shipmentId: uuid('shipment_id')
      .notNull()
      .references(() => shipments.id, { onDelete: 'cascade' }),
    declareNo: text('declare_no').notNull().unique(),
    declareDate: date('declare_date').notNull(),
    portId: uuid('port_id').references(() => ports.id, { onDelete: 'restrict' }),
    notes: text('notes'),
    createdById: uuid('created_by_id').references(() => users.id, { onDelete: 'set null' }),
    ...timestamps,
  },
  (t) => [
    index('customs_declarations_shipment_idx').on(t.shipmentId),
    index('customs_declarations_date_idx').on(t.declareDate),
  ],
);

/** CDC master list item (one list per client). */
export const cutStockItems = pgTable(
  'cut_stock_items',
  {
    id: id(),
    clientId: uuid('client_id')
      .notNull()
      .references(() => clients.id, { onDelete: 'restrict' }),
    lineNo: integer('line_no').notNull(),
    /** "Declare" column of the master list, e.g. I-1, III-195. */
    declareRef: text('declare_ref').notNull(),
    category: cutStockCategoryEnum('category').notNull(),
    name: text('name').notNull(),
    newOrUsed: text('new_or_used'),
    unit: text('unit').notNull(),
    qty: qty('qty').notNull(),
    unitPrice: rate('unit_price').notNull().default('0'),
    remarks: text('remarks'),
    /** Imported quantity/value/N.W brought over from the spreadsheet (before this system). */
    openingImportedQty: qty('opening_imported_qty').notNull().default('0'),
    openingImportedValue: money('opening_imported_value').notNull().default('0'),
    openingImportedNw: qty('opening_imported_nw').notNull().default('0'),
    ...timestamps,
    ...softDelete,
  },
  (t) => [
    uniqueIndex('cut_stock_items_client_ref_unique').on(t.clientId, t.declareRef),
    uniqueIndex('cut_stock_items_client_name_unique').on(t.clientId, sql`upper(${t.name})`),
    index('cut_stock_items_client_idx').on(t.clientId),
    check('cut_stock_items_qty_non_negative', sql`qty >= 0`),
  ],
);

/** Declares a quantity of a cut-stock item on a customs declaration. Reduces the balance. */
export const cdcLines = pgTable(
  'cdc_lines',
  {
    id: id(),
    declarationId: uuid('declaration_id')
      .notNull()
      .references(() => customsDeclarations.id, { onDelete: 'cascade' }),
    cutStockItemId: uuid('cut_stock_item_id')
      .notNull()
      .references(() => cutStockItems.id, { onDelete: 'restrict' }),
    qty: qty('qty').notNull(),
    unitPrice: rate('unit_price').notNull().default('0'),
    netWeightKg: qty('net_weight_kg').notNull().default('0'),
    /** Set when a Manager/Admin allowed this line to push the balance below zero. */
    overrideReason: text('override_reason'),
    overrideById: uuid('override_by_id').references(() => users.id, { onDelete: 'set null' }),
    createdById: uuid('created_by_id').references(() => users.id, { onDelete: 'set null' }),
    ...timestamps,
  },
  (t) => [
    index('cdc_lines_declaration_idx').on(t.declarationId),
    index('cdc_lines_item_idx').on(t.cutStockItemId),
    check('cdc_lines_qty_positive', sql`qty > 0`),
    check('cdc_lines_override_complete', sql`(override_reason IS NULL) = (override_by_id IS NULL)`),
  ],
);

/**
 * Live balance per item (created by a hand-written migration):
 *   imported = opening + Σ cdc_lines.qty ; balance = qty − imported ;
 *   condition = CHECK when balance / qty < 50% (or qty = 0).
 */
export const cutStockBalances = pgView('cut_stock_balances', {
  itemId: uuid('item_id').notNull(),
  clientId: uuid('client_id').notNull(),
  importedQty: qty('imported_qty').notNull(),
  importedValue: money('imported_value').notNull(),
  importedNw: qty('imported_nw').notNull(),
  balance: qty('balance').notNull(),
  balancePct: numeric('balance_pct'),
  condition: text('condition').notNull(),
}).existing();
