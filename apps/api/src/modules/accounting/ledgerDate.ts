import { sql } from 'drizzle-orm';

/**
 * Shipments declared from this date follow the billing policy below; earlier ones keep the
 * month of their INV (issue) date, as in the accountant's workbook (Jan–Sep 2026, frozen).
 */
export const DECLARE_MONTH_FROM = '2026-10-01';

/**
 * The date that puts a Monthly Ledger row (alias a) in its month and year:
 * - an AGENCY row (the agency invoice / THC's own DIS): the date the THC was paid, its inv_date;
 * - a SERVICE row (INV, DIS, DN) declared from DECLARE_MONTH_FROM: the declare date. A shipment
 *   cleared 31 Oct belongs to October's ledger, statement, Chea month and profit, and takes an
 *   October debit note number, even with an INV dated 2 Nov;
 * - an older SERVICE row: its INV date.
 * So a shipment whose THC was paid in October but cleared in November is billed twice: the
 * THC in October, the services in November.
 */
export const LEDGER_DATE = sql`(CASE WHEN a.kind = 'AGENCY' THEN a.inv_date
  ELSE coalesce((SELECT ld.declare_date FROM customs_declarations ld
                 WHERE ld.id = a.declaration_id AND ld.declare_date >= ${sql.raw(`'${DECLARE_MONTH_FROM}'`)}::date),
                a.inv_date) END)`;

/** LEDGER_DATE of a SERVICE row, worked out in code (YYYY-MM-DD strings). */
export const serviceLedgerDate = (declareDate: string, invDate: string): string =>
  declareDate >= DECLARE_MONTH_FROM ? declareDate : invDate;
