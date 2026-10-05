import {
  pgTable,
  text,
  boolean,
  integer,
  uuid,
  char,
  index,
  uniqueIndex,
  date,
  jsonb,
  doublePrecision,
  timestamp,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import {
  id,
  timestamps,
  softDelete,
  money,
  portKindEnum,
  clientStatusEnum,
  lookupTypeEnum,
  rate,
} from './_common';
import { users } from './auth';

export const countries = pgTable('countries', {
  iso2: char('iso2', { length: 2 }).primaryKey(),
  name: text('name').notNull().unique(),
  /** Approximate centroid, for map markers. */
  lat: doublePrecision('lat'),
  lng: doublePrecision('lng'),
});

/**
 * Merges the prototype's two port lists: the customs directory from the accounting
 * engine (port no. + code) and the "Add New" port names used in shipping plans.
 */
export const ports = pgTable(
  'ports',
  {
    id: id(),
    code: text('code').notNull().unique(), // customs code, e.g. SHV11
    customsPortNo: text('customs_port_no'), // e.g. "11", "11+"
    name: text('name').notNull(), // e.g. "Sihanoukville Port"
    shortName: text('short_name').notNull(), // chart label, e.g. "SIHANOUKVILLE"
    kind: portKindEnum('kind').notNull(),
    countryIso2: char('country_iso2', { length: 2 })
      .notNull()
      .default('KH')
      .references(() => countries.iso2),
    isActive: boolean('is_active').notNull().default(true),
    ...timestamps,
  },
  (t) => [uniqueIndex('ports_name_unique').on(sql`lower(${t.name})`)],
);

export const forwarders = pgTable(
  'forwarders',
  {
    id: id(),
    code: text('code').notNull().unique(),
    name: text('name').notNull(),
    contactEmail: text('contact_email'),
    isActive: boolean('is_active').notNull().default(true),
    ...timestamps,
  },
  (t) => [uniqueIndex('forwarders_name_unique').on(sql`lower(${t.name})`)],
);

export const clients = pgTable(
  'clients',
  {
    id: id(),
    /** Short code used in debit note numbers and filters: JR, JYX, VFL, SAK. */
    code: text('code').notNull().unique(),
    name: text('name').notNull(),
    legalName: text('legal_name'),
    legalNameKm: text('legal_name_km'),
    countryIso2: char('country_iso2', { length: 2 })
      .notNull()
      .references(() => countries.iso2),
    address: text('address'),
    vattin: text('vattin'),
    contactName: text('contact_name'),
    contactEmail: text('contact_email'),
    contactPhone: text('contact_phone'),
    /** "CM" deducted in the monthly ledger. Prototype rule: JR = 0, others = 50. */
    commissionUsd: money('commission_usd').notNull().default('50.00'),
    status: clientStatusEnum('status').notNull().default('ACTIVE'),
    ...timestamps,
    ...softDelete,
  },
  (t) => [uniqueIndex('clients_name_unique').on(sql`lower(${t.name})`)],
);

export const consignees = pgTable(
  'consignees',
  {
    id: id(),
    clientId: uuid('client_id').references(() => clients.id, { onDelete: 'set null' }),
    name: text('name').notNull(),
    address: text('address'),
    countryIso2: char('country_iso2', { length: 2 }).references(() => countries.iso2),
    isActive: boolean('is_active').notNull().default(true),
    ...timestamps,
  },
  (t) => [
    index('consignees_client_idx').on(t.clientId),
    uniqueIndex('consignees_name_unique').on(sql`lower(${t.name})`),
  ],
);

/** Replaces the prototype's localStorage "Add New" lists for simple dropdowns. */
export const lookupValues = pgTable(
  'lookup_values',
  {
    id: id(),
    type: lookupTypeEnum('type').notNull(),
    value: text('value').notNull(),
    label: text('label').notNull(),
    sortOrder: integer('sort_order').notNull().default(0),
    isActive: boolean('is_active').notNull().default(true),
    ...timestamps,
  },
  (t) => [uniqueIndex('lookup_values_type_value_unique').on(t.type, t.value)],
);

export const exchangeRates = pgTable('exchange_rates', {
  id: id(),
  effectiveDate: date('effective_date').notNull().unique(),
  usdToKhr: rate('usd_to_khr').notNull(),
  createdById: uuid('created_by_id').references(() => users.id, { onDelete: 'set null' }),
  ...timestamps,
});

/** Workspace settings as key → JSON value (default clearing port, company details…). */
export const settings = pgTable('settings', {
  key: text('key').primaryKey(),
  value: jsonb('value').notNull(),
  updatedById: uuid('updated_by_id').references(() => users.id, { onDelete: 'set null' }),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Gap-free document numbering, allocated with UPDATE … RETURNING inside the
 * transaction that creates the document. Key examples: "TAX_INVOICE:2026",
 * "DEBIT_NOTE:JR:2606".
 */
export const numberSequences = pgTable('number_sequences', {
  key: text('key').primaryKey(),
  nextValue: integer('next_value').notNull().default(1),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
