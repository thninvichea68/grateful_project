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
 * The next number is the highest one in use (ledger + documents) + 1. A debit note number
 * released by deleting an issued invoice set is handed out first, lowest first, so a client's
 * month has no gaps. INV and DIS never reuse one: a freed number stays a gap so the year's run
 * keeps date order (GS26-017 must not turn up in October between January's invoices).
 * Everything here runs under one transaction-scoped lock, so two people approving at the same
 * moment can't take the same number.
 */

export type NumberKind = InvoiceNumberKind;
export const NUMBER_KINDS: NumberKind[] = ['INV', 'DIS', 'DN'];
/** Kinds whose released numbers are handed out again. */
const REUSED_KINDS: NumberKind[] = ['DN'];
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
 * The next number of a kind for a document dated `date`: the lowest released one (debit notes
 * only), else the highest in use + 1. `forDeclareNo` is recorded when a released number is reused.
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
  if (!REUSED_KINDS.includes(kind)) return { number: p.format(highest + 1), reused: false };
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
 * Gives a number back after it was taken off its shipment and documents. A debit note number
 * is kept for the next shipment unless it was the highest of its run (then the run just
 * continues from it); INV and DIS numbers are never kept. Returns whether it was kept.
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
  if (!REUSED_KINDS.includes(kind)) return false;
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
  declareDate: string;
  invDate: string;
  code: string;
  invNo: string | null;
  disNo: string | null;
  dnNo: string | null;
}
const LEDGER_NUMBERS = sql`
  SELECT a.id, d.declare_no AS "declareNo", to_char(d.declare_date, 'YYYY-MM-DD') AS "declareDate",
         to_char(a.inv_date, 'YYYY-MM-DD') AS "invDate", c.code,
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

/** The documents carrying each kind's number, renumbered with their ledger entry. */
const DOC_NUMBER_COL = {
  INV: { table: 'tax_invoices', col: 'invoice_no' },
  DIS: { table: 'disbursements', col: 'dis_no' },
  DN: { table: 'debit_notes', col: 'dn_no' },
} as const;

export interface Renumbered {
  recordId: string;
  declareNo: string;
  kind: NumberKind;
  from: string;
  to: string;
}

/**
 * Keeps every run in INV-date order. A shipment approved late with an earlier INV date takes
 * its slot and the later ones move down: each run's numbers (INV per year, DIS per year, DN
 * per client and month) are handed out again in order of INV date, then declare date, then
 * the number held now. Only the numbers already in the run are reused, so gaps and the
 * numbers of cancelled documents stay where they are. Draft and issued documents and record
 * summaries take their entry's new number.
 */
export async function resequence(tx: Tx, req: Request): Promise<Renumbered[]> {
  await lockNumbering(tx);
  const rows = await queryRows<LedgerNumbers>(tx, LEDGER_NUMBERS);
  const changes: Renumbered[] = [];
  for (const kind of NUMBER_KINDS) {
    const runs = new Map<string, { p: Period; entries: { r: LedgerNumbers; seq: number }[] }>();
    for (const r of rows) {
      const number = r[FIELD[kind]];
      if (!number) continue;
      const p = periodOf(kind, r.invDate, r.code);
      const seq = seqOf(p, number);
      if (seq === null) continue; // typed in another format, or not of its date's period
      const run = runs.get(p.key) ?? { p, entries: [] };
      run.entries.push({ r, seq });
      runs.set(p.key, run);
    }
    for (const { p, entries } of runs.values()) {
      const slots = entries.map((e) => e.seq).sort((a, b) => a - b);
      entries.sort(
        (a, b) =>
          a.r.invDate.localeCompare(b.r.invDate) ||
          a.r.declareDate.localeCompare(b.r.declareDate) ||
          a.seq - b.seq ||
          a.r.declareNo.localeCompare(b.r.declareNo),
      );
      entries.forEach(({ r, seq }, i) => {
        if (slots[i] !== seq)
          changes.push({
            recordId: r.id,
            declareNo: r.declareNo,
            kind,
            from: r[FIELD[kind]]!,
            to: p.format(slots[i]!),
          });
      });
    }
  }
  if (!changes.length) return changes;
  // Two passes, so numbers trading places never meet a unique index.
  for (const c of changes) {
    const d = DOC_NUMBER_COL[c.kind];
    await tx.execute(sql`
      UPDATE accounting_records SET ${sql.raw(LEDGER_NUMBER_COL[c.kind])} = NULL WHERE id = ${c.recordId}`);
    await tx.execute(sql`
      UPDATE ${sql.raw(d.table)} SET ${sql.raw(d.col)} = '~' || id::text
      WHERE accounting_record_id = ${c.recordId} AND ${sql.raw(d.col)} = ${c.from} AND status <> 'VOID'`);
    await tx.execute(sql`
      UPDATE record_summaries SET ${sql.raw(LEDGER_NUMBER_COL[c.kind])} = ${c.to}
      WHERE accounting_record_id = ${c.recordId} AND ${sql.raw(LEDGER_NUMBER_COL[c.kind])} = ${c.from}
        AND status <> 'VOID'`);
  }
  for (const c of changes) {
    const d = DOC_NUMBER_COL[c.kind];
    await tx.execute(sql`
      UPDATE accounting_records SET ${sql.raw(LEDGER_NUMBER_COL[c.kind])} = ${c.to},
        updated_by_id = ${req.auth?.userId ?? null}
      WHERE id = ${c.recordId}`);
    await tx.execute(sql`
      UPDATE ${sql.raw(d.table)} SET ${sql.raw(d.col)} = ${c.to}
      WHERE accounting_record_id = ${c.recordId} AND ${sql.raw(d.col)} = '~' || id::text`);
  }
  const byRecord = new Map<string, Renumbered[]>();
  for (const c of changes) byRecord.set(c.recordId, [...(byRecord.get(c.recordId) ?? []), c]);
  for (const [recordId, cs] of byRecord)
    await audit(
      tx,
      {
        action: 'UPDATE',
        entity: 'accounting_record',
        entityId: recordId,
        before: Object.fromEntries(cs.map((c) => [FIELD[c.kind], c.from])),
        after: Object.fromEntries(cs.map((c) => [FIELD[c.kind], c.to])),
        reason: `Renumbered ${cs[0]!.declareNo} to keep INV-date order`,
      },
      req,
    );
  return changes;
}

/**
 * Numbers every shipment that is approved (its Chea payment is Checked) but not invoiced yet,
 * in clearance-date order, so released numbers go to the earliest one waiting. Then every run
 * is put back in INV-date order.
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
  if (!out.length) return out;
  // Report the numbers each shipment ends up with.
  for (const c of await resequence(tx, req))
    for (const n of out.find((a) => a.recordId === c.recordId)?.numbers ?? [])
      if (n.kind === c.kind) n.number = c.to;
  return out;
}
