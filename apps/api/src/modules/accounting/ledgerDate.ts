import { sql } from 'drizzle-orm';

/**
 * The date that puts a Monthly Ledger row (alias a) in its month and year: its declaration
 * (clearance) date, not the INV date. A shipment declared 30 Oct and invoiced 2 Nov belongs to
 * October's ledger, Chea payment month and profit, and takes an October debit note number.
 */
export const LEDGER_DATE = sql`(SELECT ld.declare_date FROM customs_declarations ld WHERE ld.id = a.declaration_id)`;
