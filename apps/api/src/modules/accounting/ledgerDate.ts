import { sql } from 'drizzle-orm';

/**
 * The date that puts a Monthly Ledger row (alias a) in its month and year: its INV (issue)
 * date, not the declaration (clearance) date. A shipment cleared 2 Nov but billed on 30 Oct
 * belongs to October's ledger, statement, Chea payment month and profit, and takes an October
 * debit note number. Moving the issue date moves the shipment.
 */
export const LEDGER_DATE = sql`a.inv_date`;
