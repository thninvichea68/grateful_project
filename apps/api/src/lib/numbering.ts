import { sql } from 'drizzle-orm';
import type { DbOrTx } from '../db/client';

/**
 * Atomically allocate the next number for a sequence key and return it.
 * Call inside the transaction that creates the document so a rollback does not
 * leave a gap… except under concurrency, where PostgreSQL row locks serialize callers.
 */
export async function nextNumber(tx: DbOrTx, key: string, startAt = 1): Promise<number> {
  const res = await tx.execute<{ value: number }>(sql`
    INSERT INTO number_sequences (key, next_value) VALUES (${key}, ${startAt + 1})
    ON CONFLICT (key) DO UPDATE SET next_value = number_sequences.next_value + 1, updated_at = now()
    RETURNING next_value - 1 AS value
  `);
  const value = res.rows[0]?.value;
  if (value === undefined) throw new Error(`Could not allocate number for ${key}`);
  return Number(value);
}

/** Formats used by the prototype. */
export const formatNumber = {
  /** SHP-26-0001 */
  shipment: (yy: string, n: number) => `SHP-${yy}-${String(n).padStart(4, '0')}`,
  /** GS26-212 */
  taxInvoice: (yy: string, n: number) => `GS${yy}-${String(n).padStart(3, '0')}`,
  /** DIS232 */
  disbursement: (n: number) => `DIS${String(n).padStart(3, '0')}`,
  /** JR2606001 — client code + YYMM + 3-digit sequence */
  debitNote: (clientCode: string, yymm: string, n: number) =>
    `${clientCode}${yymm}${String(n).padStart(3, '0')}`,
  /** FLW-0091 */
  followUp: (n: number) => `FLW-${String(n).padStart(4, '0')}`,
};
