import {
  pgTable,
  text,
  uuid,
  date,
  integer,
  index,
  uniqueIndex,
  jsonb,
  numeric,
  timestamp,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import { id, timestamps, softDelete, quotationStatusEnum } from './_common';
import { users } from './auth';
import { clients } from './reference';

export interface QuotationColumnDef {
  key: string;
  label: string;
  type: 'wide' | 'text' | 'num' | 'remark';
}

/** Service categories from quotation-system.html (Import SIH port & dry port, …). */
export const quotationTemplates = pgTable('quotation_templates', {
  key: text('key').primaryKey(),
  label: text('label').notNull(),
  docTitle: text('doc_title').notNull(),
  columns: jsonb('columns').$type<QuotationColumnDef[]>().notNull(),
  defaultRows: jsonb('default_rows').$type<string[][]>().notNull(),
  notes: text('notes'),
  sortOrder: integer('sort_order').notNull().default(0),
  ...timestamps,
});

export const quotations = pgTable(
  'quotations',
  {
    id: id(),
    quoteNo: text('quote_no').notNull(),
    version: integer('version').notNull().default(1),
    previousVersionId: uuid('previous_version_id').references((): AnyPgColumn => quotations.id, {
      onDelete: 'set null',
    }),
    templateKey: text('template_key')
      .notNull()
      .references(() => quotationTemplates.key),
    clientId: uuid('client_id').references(() => clients.id, { onDelete: 'set null' }),
    toName: text('to_name').notNull(),
    attn: text('attn'),
    quoteDate: date('quote_date').notNull(),
    paymentTermDays: integer('payment_term_days'),
    latePenaltyPctPerDay: numeric('late_penalty_pct_per_day', { precision: 6, scale: 3 }),
    notes: text('notes'),
    status: quotationStatusEnum('status').notNull().default('DRAFT'),
    createdById: uuid('created_by_id').references(() => users.id, { onDelete: 'set null' }),
    ...timestamps,
    ...softDelete,
  },
  (t) => [
    uniqueIndex('quotations_no_version_unique').on(t.quoteNo, t.version),
    index('quotations_client_idx').on(t.clientId),
  ],
);

/**
 * Price cells can be text ("As per receipt", "5/10/15"), so each line stores the
 * displayed text per column in `cells`, plus `amounts` with the numeric value when
 * the cell is a plain number (for search and totals).
 */
export const quotationLines = pgTable(
  'quotation_lines',
  {
    id: id(),
    quotationId: uuid('quotation_id')
      .notNull()
      .references(() => quotations.id, { onDelete: 'cascade' }),
    lineNo: integer('line_no').notNull(),
    cells: jsonb('cells').$type<Record<string, string>>().notNull(),
    amounts: jsonb('amounts').$type<Record<string, number>>().notNull().default({}),
    /** Our cost per column (what we pay); seen and set only with quotations:cost. */
    costs: jsonb('costs').$type<Record<string, string>>().notNull().default({}),
    ...timestamps,
  },
  (t) => [index('quotation_lines_quotation_idx').on(t.quotationId)],
);

/**
 * A quotation's extra charges, listed under its rates ("Red signal · 45 USD / Shipment"): once
 * the free-text notes, now one row each so bills and record summaries can pick them by name.
 */
export const quotationCharges = pgTable(
  'quotation_charges',
  {
    id: id(),
    quotationId: uuid('quotation_id')
      .notNull()
      .references(() => quotations.id, { onDelete: 'cascade' }),
    lineNo: integer('line_no').notNull(),
    description: text('description').notNull(),
    /** USD; null when the charge has no fixed price ("as per receipt"). */
    amount: numeric('amount', { precision: 12, scale: 2 }),
    unit: text('unit'),
    remark: text('remark'),
    /** Our cost (quotations:cost only). */
    cost: numeric('cost', { precision: 12, scale: 2 }),
    ...timestamps,
  },
  (t) => [index('quotation_charges_quotation_idx').on(t.quotationId)],
);

/**
 * The text quotations had before they were made English only (and their notes before they became
 * extra charges), kept once so nothing typed is lost: kind = quotation | line | template.
 */
export const quotationTextBackup = pgTable('quotation_text_backup', {
  id: id(),
  kind: text('kind').notNull(),
  ref: text('ref').notNull(),
  data: jsonb('data').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
