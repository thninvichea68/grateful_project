import { sql, type SQL } from 'drizzle-orm';
import type { InvoiceNumberKind, NumberedShipment } from '@gs/shared';
import type { Request } from 'express';
import type { Tx } from '../../db/client';
import { audit } from '../../lib/audit';
import { queryRows } from '../../lib/listing';
import { formatNumber, highestNumber, regexLiteral } from '../../lib/numbering';

/*
 * The INV / DIS / DN numbers of a shipment (one set per declare no.), read live:
 * - INV  GS26-NNN: one run for every client, per year (GS27-001 in January).
 * - DIS  DISNNN:   one run for every client, restarting at DIS001 each January.
 * - DN   <client><YYMM>NNN: per client, restarting each month.
 * The next number is the highest one in use (ledger + documents) + 1, except that a number
 * released by deleting an issued invoice set is handed out first, lowest first, so the run
 * has no gaps. Everything here runs under one transaction-scoped lock, so two people
 * approving at the same moment can't take the same number.
 */

export type NumberKind = InvoiceNumberKind;
export const NUMBER_KINDS: NumberKind[] = ['INV', 'DIS', 'DN'];
/** The ledger column holding each kind. */
export const LEDGER_NUMBER_COL = { INV: 'inv_no', DIS: 'dis_no', DN: 'dn_no' } as const;

interface Period {
  kind: NumberKind;
  /** '2026', or 'JR:2610' for a debit note. */
  key: string;
  pattern: string;
  used: SQL;
  format: (n: number) => string;
}

/** The numbering period a document dated `date` falls in. */
export function periodOf(kind: NumberKind, date: string, clientCode: string): Period {
  const year = date.slice(0, 4);
  const yy = date.slice(2, 4);
  switch (kind) {
    case 'INV':
      return {
        kind,
        key: year,
        pattern: `^GS${yy}-(\\d{1,9})$`,
        used: sql`SELECT invoice_no FROM tax_invoices UNION ALL SELECT inv_no FROM accounting_records`,
        format: (n) => formatNumber.taxInvoice(yy, n),
      };
    case 'DIS':
      return {
        kind,
        key: year,
        pattern: '^DIS(\\d{1,9})$',
        used: sql`SELECT dis_no FROM disbursements WHERE extract(year FROM dis_date) = ${Number(year)}
                  UNION ALL SELECT dis_no FROM accounting_records WHERE extract(year FROM inv_date) = ${Number(year)}`,
        format: formatNumber.disbursement,
      };
    case 'DN': {
      const code = clientCode.toUpperCase();
      const yymm = yy + date.slice(5, 7);
      return {
        kind,
        key: `${code}:${yymm}`,
        pattern: `^${regexLiteral(code)}${yymm}(\\d{3,9})$`,
        used: sql`SELECT dn_no FROM debit_notes UNION ALL SELECT dn_no FROM accounting_records`,
        format: (n) => formatNumber.debitNote(code, yymm, n),
      };
    }
  }
}

/** One numbering at a time across the company (released when the transaction ends). */
export async function lockNumbering(tx: Tx): Promise<void> {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('gs:billing-numbers'))`);
}

const seqOf = (p: Period, number: string) => {
  const m = new RegExp(p.pattern).exec(number.toUpperCase());
  return m ? Number(m[1]) : null;
};

/** Released numbers at or above the next running number are no longer needed. */
async function dropStale(tx: Tx, p: Period, highest: number) {
  await tx.execute(sql`
    DELETE FROM released_numbers
    WHERE kind = ${p.kind} AND period = ${p.key} AND reassigned_at IS NULL AND seq > ${highest}`);
}

/**
 * The next number of a kind for a document dated `date`: the lowest released one, else the
 * highest in use + 1. `forDeclareNo` is recorded when a released number is reused.
 */
export async function takeNumber(
  tx: Tx,
  kind: NumberKind,
  date: string,
  clientCode: string,
  forDeclareNo: string | null,
): Promise<{ number: string; reused: boolean }> {
  await lockNumbering(tx);
  const p = periodOf(kind, date, clientCode);
  const highest = await highestNumber(tx, p.used, p.pattern);
  await dropStale(tx, p, highest);
  const [free] = await queryRows<{ id: string; number: string }>(
    tx,
    sql`SELECT id, number FROM released_numbers
        WHERE kind = ${kind} AND period = ${p.key} AND reassigned_at IS NULL
        ORDER BY seq LIMIT 1`,
  );
  if (free) {
    await tx.execute(sql`
      UPDATE released_numbers SET reassigned_at = now(), reassigned_to_declare_no = ${forDeclareNo}
      WHERE id = ${free.id}`);
    return { number: free.number, reused: true };
  }
  return { number: p.format(highest + 1), reused: false };
}

/**
 * Gives a number back after it was taken off its shipment and documents. It is kept for the
 * next shipment unless it was the highest of its run (then the run just continues from it).
 * Returns whether it was kept.
 */
export async function releaseNumber(
  tx: Tx,
  kind: NumberKind,
  number: string,
  date: string,
  clientCode: string,
  fromDeclareNo: string | null,
  userId: string | null,
): Promise<boolean> {
  await lockNumbering(tx);
  const p = periodOf(kind, date, clientCode);
  const seq = seqOf(p, number);
  if (seq === null) return false; // not one of ours (e.g. typed in a different format)
  const highest = await highestNumber(tx, p.used, p.pattern);
  await dropStale(tx, p, highest);
  if (seq > highest) return false;
  await tx.execute(sql`
    INSERT INTO released_numbers (kind, period, seq, number, from_declare_no, released_by_id)
    VALUES (${kind}, ${p.key}, ${seq}, ${p.format(seq)}, ${fromDeclareNo}, ${userId})
    ON CONFLICT DO NOTHING`);
  return true;
}

interface LedgerNumbers {
  id: string;
  declareNo: string;
  invDate: string;
  code: string;
  invNo: string | null;
  disNo: string | null;
  dnNo: string | null;
}
const LEDGER_NUMBERS = sql`
  SELECT a.id, d.declare_no AS "declareNo", to_char(a.inv_date, 'YYYY-MM-DD') AS "invDate", c.code,
         a.inv_no AS "invNo", a.dis_no AS "disNo", a.dn_no AS "dnNo"
  FROM accounting_records a JOIN customs_declarations d ON d.id = a.declaration_id
  JOIN clients c ON c.id = a.client_id`;
const FIELD = { INV: 'invNo', DIS: 'disNo', DN: 'dnNo' } as const;

export type AssignedNumbers = NumberedShipment;

/** Gives a Monthly Ledger entry the INV / DIS / DN numbers (of `kinds`) it is still missing. */
export async function assignNumbers(
  tx: Tx,
  recordId: string,
  req: Request,
  kinds: NumberKind[] = NUMBER_KINDS,
): Promise<AssignedNumbers> {
  await lockNumbering(tx);
  const [r] = await queryRows<LedgerNumbers>(tx, sql`${LEDGER_NUMBERS} WHERE a.id = ${recordId}`);
  if (!r) throw new Error(`Ledger entry ${recordId} not found`);
  const numbers: AssignedNumbers['numbers'] = [];
  for (const kind of kinds) {
    if (r[FIELD[kind]]) continue;
    const got = await takeNumber(tx, kind, r.invDate, r.code, r.declareNo);
    await tx.execute(sql`
      UPDATE accounting_records SET ${sql.raw(LEDGER_NUMBER_COL[kind])} = ${got.number}, updated_by_id = ${req.auth?.userId ?? null}
      WHERE id = ${recordId}`);
    numbers.push({ kind, ...got });
  }
  if (numbers.length)
    await audit(
      tx,
      {
        action: 'UPDATE',
        entity: 'accounting_record',
        entityId: recordId,
        before: { invNo: r.invNo, disNo: r.disNo, dnNo: r.dnNo },
        after: Object.fromEntries(numbers.map((n) => [FIELD[n.kind], n.number])),
        reason: `Numbers for ${r.declareNo}${
          numbers.some((n) => n.reused)
            ? ` (reused: ${numbers
                .filter((n) => n.reused)
                .map((n) => n.number)
                .join(', ')})`
            : ''
        }`,
      },
      req,
    );
  return { recordId, declareNo: r.declareNo, numbers };
}

/**
 * Numbers every shipment that is approved (its Chea payment is Checked) but not invoiced yet,
 * in clearance-date order, so released numbers go to the earliest one waiting.
 */
export async function numberEligible(tx: Tx, req: Request): Promise<AssignedNumbers[]> {
  await lockNumbering(tx);
  const waiting = await queryRows<{ id: string }>(
    tx,
    sql`SELECT a.id FROM accounting_records a JOIN customs_declarations d ON d.id = a.declaration_id
        WHERE (a.inv_no IS NULL OR a.dis_no IS NULL OR a.dn_no IS NULL)
          AND EXISTS (SELECT 1 FROM credit_notes cn WHERE cn.accounting_record_id = a.id
                      AND cn.status = 'ISSUED' AND cn.review_status = 'CHECKED')
        ORDER BY d.declare_date, a.inv_date, d.declare_no`,
  );
  const out: AssignedNumbers[] = [];
  for (const w of waiting) {
    const a = await assignNumbers(tx, w.id, req);
    if (a.numbers.length) out.push(a);
  }
  return out;
}
