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
 * - DN   <client><YYMM>NNN: per client, restarting each month: the month of the issue (INV)
 *   date, which is the shipment's Monthly Ledger month, not of the clearance date.
 * The next number is the highest one in use (ledger + documents) + 1. No run ever skips a
 * number: when one is freed (a revise, a deleted draft) the later ones close up, and every run
 * stays in INV-date order (see resequence), so GS26-017 never turns up in October.
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

/**
 * The date a shipment's number of a kind is counted by: its issue (INV) date, which is also its
 * ledger month, whatever the clearance date. A debit note billed 30 Oct for a shipment cleared
 * 2 Nov takes an October number; a tax invoice dated January takes the new year's number.
 */
export const periodDate = (_kind: NumberKind, r: { invDate: string; declareDate: string }) =>
  r.invDate;

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

/**
 * No tax invoice: the shipment's checked record summary has no Import / Export Processing Fee,
 * so the ledger's INV revenue is 0. Such a shipment takes no INV number (DIS and DN as usual),
 * as in the accountant's monthly sheets.
 */
async function notInvoiced(tx: Tx, recordId: string): Promise<boolean> {
  const [r] = await queryRows<{ yes: boolean }>(
    tx,
    sql`SELECT a.inv_revenue = 0 AND EXISTS (
          SELECT 1 FROM record_summaries s WHERE s.accounting_record_id = a.id
            AND s.status = 'ISSUED' AND s.review_status IN ('CHECKED', 'REVISION_REQUESTED')) AS yes
        FROM accounting_records a WHERE a.id = ${recordId}`,
  );
  return !!r?.yes;
}

/**
 * No debit note: the shipment's checked record summary has no debit note charges (e.g. a THC
 * billed on its DIS only), so the ledger's DN total is 0. Such a shipment takes no DN number.
 */
async function noDebitNote(tx: Tx, recordId: string): Promise<boolean> {
  const [r] = await queryRows<{ yes: boolean }>(
    tx,
    sql`SELECT a.dn_total = 0 AND EXISTS (
          SELECT 1 FROM record_summaries s WHERE s.accounting_record_id = a.id
            AND s.status = 'ISSUED' AND s.review_status IN ('CHECKED', 'REVISION_REQUESTED')) AS yes
        FROM accounting_records a WHERE a.id = ${recordId}`,
  );
  return !!r?.yes;
}

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
    if (kind === 'INV' && (await notInvoiced(tx, recordId))) continue;
    if (kind === 'DN' && (await noDebitNote(tx, recordId))) continue;
    const got = await takeNumber(tx, kind, periodDate(kind, r), r.code, r.declareNo);
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
  /** The ledger entry renumbered, or null for a document made without a shipment… */
  recordId: string | null;
  /** …which is then this document (a tax invoice or DIS of its own). */
  docId?: string;
  declareNo: string;
  kind: NumberKind;
  from: string;
  to: string;
}

/** Live tax invoices and DIS made without a shipment: they share the company-wide runs. */
interface LooseDoc {
  id: string;
  kind: 'INV' | 'DIS';
  number: string;
  date: string;
  code: string;
}
const LOOSE_DOCS = sql`
  SELECT t.id, 'INV' AS kind, t.invoice_no AS number, to_char(t.invoice_date, 'YYYY-MM-DD') AS date, c.code
  FROM tax_invoices t JOIN clients c ON c.id = t.client_id
  WHERE t.accounting_record_id IS NULL AND t.status <> 'VOID' AND t.invoice_no IS NOT NULL
  UNION ALL
  SELECT x.id, 'DIS', x.dis_no, to_char(x.dis_date, 'YYYY-MM-DD'), c.code
  FROM disbursements x JOIN clients c ON c.id = x.client_id
  WHERE x.accounting_record_id IS NULL AND x.status <> 'VOID' AND x.dis_no IS NOT NULL`;

/**
 * Runs are gapless from this INV date on. Numbers before it stay as the accountant's workbook
 * had them (Jan–Sep 2026, gaps included, as already sent to clients); later ones follow on.
 */
export const GAPLESS_FROM = '2026-10-01';

/** Every number in use, by anything (cancelled documents too); a DIS with its year. */
interface HeldNumber {
  kind: NumberKind;
  number: string;
  year: number | null;
}
const HELD_NUMBERS = sql`
  SELECT 'INV' AS kind, invoice_no AS number, NULL::int AS year FROM tax_invoices
  UNION ALL SELECT 'INV', inv_no, NULL FROM accounting_records WHERE inv_no IS NOT NULL
  UNION ALL SELECT 'DIS', dis_no, extract(year FROM dis_date)::int FROM disbursements WHERE dis_no IS NOT NULL
  UNION ALL SELECT 'DIS', dis_no, extract(year FROM inv_date)::int FROM accounting_records WHERE dis_no IS NOT NULL
  UNION ALL SELECT 'DN', dn_no, NULL FROM debit_notes WHERE dn_no IS NOT NULL
  UNION ALL SELECT 'DN', dn_no, NULL FROM accounting_records WHERE dn_no IS NOT NULL`;

/**
 * Keeps every run in date order. A shipment approved late with an earlier INV date takes its
 * slot and the later ones move down: each run's numbers (INV per year, DIS per year, DN per
 * client and month) are handed out again in order of date, then the number held now (same-day
 * shipments keep the order they were numbered in, as in the accountant's monthly sheets). A
 * tax invoice or DIS made without a shipment (a monthly fee) counts by its own date, so one
 * dated 31 Oct but made on 2 Nov still falls before November's. A run never skips a number
 * (from GAPLESS_FROM on): it is numbered again one after another, stepping only over numbers
 * kept by something outside it (a cancelled document), so a number freed by a revise or a
 * deleted draft is closed up at once.
 * Draft and issued documents and record summaries take their entry's new number.
 */
export async function resequence(tx: Tx, req: Request): Promise<Renumbered[]> {
  await lockNumbering(tx);
  let rows = await queryRows<LedgerNumbers>(tx, LEDGER_NUMBERS);
  const moved = await moveDebitNotesToInvMonth(tx, rows, req);
  if (moved.length) rows = await queryRows<LedgerNumbers>(tx, LEDGER_NUMBERS);
  const loose = await queryRows<LooseDoc>(tx, LOOSE_DOCS);
  const held = await queryRows<HeldNumber>(tx, HELD_NUMBERS);
  const changes: Renumbered[] = [];
  type Entry = Omit<Renumbered, 'to' | 'kind'> & { date: string; seq: number };
  for (const kind of NUMBER_KINDS) {
    const runs = new Map<string, { p: Period; entries: Entry[] }>();
    const add = (p: Period, number: string, e: Omit<Entry, 'seq' | 'from'>) => {
      const seq = seqOf(p, number);
      if (seq === null) return; // typed in another format, or not of its date's period
      const run = runs.get(p.key) ?? { p, entries: [] };
      run.entries.push({ ...e, seq, from: number });
      runs.set(p.key, run);
    };
    for (const r of rows) {
      const number = r[FIELD[kind]];
      if (number)
        add(periodOf(kind, periodDate(kind, r), r.code), number, {
          recordId: r.id,
          declareNo: r.declareNo,
          date: r.invDate,
        });
    }
    for (const d of loose)
      if (d.kind === kind)
        add(periodOf(kind, d.date, d.code), d.number, {
          recordId: null,
          docId: d.id,
          declareNo: d.number,
          date: d.date,
        });
    for (const { p, entries: all } of runs.values()) {
      // Numbers of the run held by something that isn't one of its entries stay put, and so
      // do the entries from before GAPLESS_FROM; the rest follow on from them without a gap.
      const mine = new Set(all.map((e) => e.seq));
      const kept = new Set<number>();
      for (const h of held)
        if (h.kind === kind && (kind !== 'DIS' || String(h.year) === p.key)) {
          const seq = seqOf(p, h.number);
          if (seq !== null && !mine.has(seq)) kept.add(seq);
        }
      const entries = all.filter((e) => e.date >= GAPLESS_FROM);
      let base = 0;
      for (const e of all)
        if (e.date < GAPLESS_FROM) {
          kept.add(e.seq);
          base = Math.max(base, e.seq);
        }
      const slots: number[] = [];
      for (let n = base + 1; slots.length < entries.length; n++) if (!kept.has(n)) slots.push(n);
      entries.sort(
        (a, b) =>
          a.date.localeCompare(b.date) || a.seq - b.seq || a.declareNo.localeCompare(b.declareNo),
      );
      entries.forEach(({ date: _d, seq, ...e }, i) => {
        if (slots[i] !== seq) changes.push({ ...e, kind, to: p.format(slots[i]!) });
      });
    }
  }
  await renumber(tx, changes, req, (declareNo) => `Renumbered ${declareNo} to keep INV-date order`);
  // No run has a gap now, so no debit note number is waiting to be handed out again.
  await tx.execute(sql`DELETE FROM released_numbers WHERE reassigned_at IS NULL`);
  // A record summary shows its shipment's numbers.
  await tx.execute(sql`
    UPDATE record_summaries r SET inv_no = a.inv_no, dis_no = a.dis_no, dn_no = a.dn_no
    FROM accounting_records a
    WHERE r.accounting_record_id = a.id AND r.status <> 'VOID'
      AND (r.inv_no IS DISTINCT FROM a.inv_no OR r.dis_no IS DISTINCT FROM a.dis_no
        OR r.dn_no IS DISTINCT FROM a.dn_no)`);
  return [...moved, ...changes];
}

/**
 * A debit note numbered for another month than its entry's INV date (the issue date was moved,
 * e.g. a shipment cleared 2 Nov but billed in October) takes the next number of the INV month's
 * run, and the old one is given back. A number typed in another format is left as typed.
 */
async function moveDebitNotesToInvMonth(
  tx: Tx,
  rows: LedgerNumbers[],
  req: Request,
): Promise<Renumbered[]> {
  const moved: Renumbered[] = [];
  for (const r of rows) {
    if (!r.dnNo || seqOf(periodOf('DN', r.invDate, r.code), r.dnNo) !== null) continue;
    const m = new RegExp(`^${regexLiteral(r.code.toUpperCase())}(\\d{2})(\\d{2})\\d{3,9}$`).exec(
      r.dnNo.toUpperCase(),
    );
    if (!m) continue;
    const { number } = await takeNumber(tx, 'DN', r.invDate, r.code, r.declareNo);
    const change: Renumbered = {
      recordId: r.id,
      declareNo: r.declareNo,
      kind: 'DN',
      from: r.dnNo,
      to: number,
    };
    // One at a time, so the next entry moving to the same month sees this number taken.
    await renumber(tx, [change], req, (declareNo) => `Moved ${declareNo} to its INV month`);
    await releaseNumber(
      tx,
      'DN',
      r.dnNo,
      `20${m[1]}-${m[2]}-01`,
      r.code,
      r.declareNo,
      req.auth?.userId ?? null,
    );
    moved.push(change);
  }
  return moved;
}

/**
 * Moves ledger entries to new numbers; their draft and issued documents and record summaries
 * follow. A change `to: null` takes the number away. Each entry's change is audited.
 */
async function renumber(
  tx: Tx,
  changes: (Omit<Renumbered, 'to'> & { to: string | null })[],
  req: Request,
  reason: (declareNo: string) => string,
): Promise<void> {
  if (!changes.length) return;
  // Two passes, so numbers trading places never meet a unique index.
  for (const c of changes) {
    const d = DOC_NUMBER_COL[c.kind];
    if (!c.recordId) {
      await tx.execute(sql`
        UPDATE ${sql.raw(d.table)} SET ${sql.raw(d.col)} = '~' || id::text WHERE id = ${c.docId!}`);
      continue;
    }
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
    if (!c.recordId) {
      await tx.execute(sql`
        UPDATE ${sql.raw(d.table)} SET ${sql.raw(d.col)} = ${c.to} WHERE id = ${c.docId!}`);
      continue;
    }
    await tx.execute(sql`
      UPDATE accounting_records SET ${sql.raw(LEDGER_NUMBER_COL[c.kind])} = ${c.to},
        updated_by_id = ${req.auth?.userId ?? null}
      WHERE id = ${c.recordId}`);
    await tx.execute(sql`
      UPDATE ${sql.raw(d.table)} SET ${sql.raw(d.col)} = ${c.to}
      WHERE accounting_record_id = ${c.recordId} AND ${sql.raw(d.col)} = '~' || id::text`);
  }
  // A document of its own is audited on itself; a shipment's change on its ledger entry.
  for (const c of changes)
    if (!c.recordId)
      await audit(
        tx,
        {
          action: 'UPDATE',
          entity: DOC_NUMBER_COL[c.kind].table,
          entityId: c.docId!,
          before: { number: c.from },
          after: { number: c.to },
          reason: reason(c.declareNo),
        },
        req,
      );
  const byRecord = new Map<string, typeof changes>();
  for (const c of changes)
    if (c.recordId) byRecord.set(c.recordId, [...(byRecord.get(c.recordId) ?? []), c]);
  for (const [recordId, cs] of byRecord)
    await audit(
      tx,
      {
        action: 'UPDATE',
        entity: 'accounting_record',
        entityId: recordId,
        before: Object.fromEntries(cs.map((c) => [FIELD[c.kind], c.from])),
        after: Object.fromEntries(cs.map((c) => [FIELD[c.kind], c.to])),
        reason: reason(cs[0]!.declareNo),
      },
      req,
    );
}

/**
 * Brings a shipment's INV number in line with its checked record summary: one without a
 * processing fee has no tax invoice, so its INV number is taken away and the later INV
 * numbers of the year move down one to close the gap (as in the monthly sheets: the next
 * shipment's INV just follows on). A number on a live tax invoice is left alone. A summary
 * that has a fee again gets a number back, put in INV-date order.
 */
export async function syncInvoiceNumber(tx: Tx, recordId: string, req: Request): Promise<void> {
  await lockNumbering(tx);
  const [r] = await queryRows<LedgerNumbers>(tx, sql`${LEDGER_NUMBERS} WHERE a.id = ${recordId}`);
  if (!r) return;
  if (!(await notInvoiced(tx, recordId))) {
    // Numbered already (DIS / DN) but without INV: the summary has a fee now.
    if (!r.invNo && (r.disNo || r.dnNo)) {
      await assignNumbers(tx, recordId, req, ['INV']);
      await resequence(tx, req);
    }
    return;
  }
  if (!r.invNo) return;
  const [live] = await queryRows<{ id: string }>(
    tx,
    sql`SELECT id FROM tax_invoices WHERE accounting_record_id = ${recordId}
          AND invoice_no = ${r.invNo} AND status <> 'VOID' LIMIT 1`,
  );
  if (live) return;
  const p = periodOf('INV', r.invDate, r.code);
  const gone = seqOf(p, r.invNo);
  const changes: Parameters<typeof renumber>[1] = [
    { recordId, declareNo: r.declareNo, kind: 'INV', from: r.invNo, to: null },
  ];
  if (gone !== null) {
    const later = (await queryRows<LedgerNumbers>(tx, LEDGER_NUMBERS))
      .map((e) => ({ e, seq: e.invNo ? seqOf(periodOf('INV', e.invDate, e.code), e.invNo) : null }))
      .filter((x): x is { e: LedgerNumbers; seq: number } => x.seq !== null && x.seq > gone)
      .filter((x) => periodOf('INV', x.e.invDate, x.e.code).key === p.key)
      .sort((a, b) => a.seq - b.seq);
    // Each takes the slot below it; numbers not on the ledger (cancelled invoices) stay put.
    const slots = [gone, ...later.map((x) => x.seq)];
    later.forEach(({ e }, i) =>
      changes.push({
        recordId: e.id,
        declareNo: e.declareNo,
        kind: 'INV',
        from: e.invNo!,
        to: p.format(slots[i]!),
      }),
    );
  }
  await renumber(tx, changes, req, (declareNo) =>
    declareNo === r.declareNo
      ? `No tax invoice for ${declareNo} (no processing fee on its record summary): INV number taken away`
      : `Renumbered ${declareNo} to close the gap left by ${r.invNo}`,
  );
}

/**
 * Brings a shipment's DN number in line with its checked record summary: one without debit
 * note charges has no debit note, so its DN number is taken away and the client's later ones
 * that month move up (resequence). A number on a live debit note is left alone. A summary that
 * has charges again gets a number back.
 */
export async function syncDebitNoteNumber(tx: Tx, recordId: string, req: Request): Promise<void> {
  await lockNumbering(tx);
  const [r] = await queryRows<LedgerNumbers>(tx, sql`${LEDGER_NUMBERS} WHERE a.id = ${recordId}`);
  if (!r) return;
  if (!(await noDebitNote(tx, recordId))) {
    if (!r.dnNo && (r.invNo || r.disNo)) {
      await assignNumbers(tx, recordId, req, ['DN']);
      await resequence(tx, req);
    }
    return;
  }
  // Before GAPLESS_FROM the workbook's numbers stay as they are.
  if (!r.dnNo || r.invDate < GAPLESS_FROM) return;
  const [live] = await queryRows<{ id: string }>(
    tx,
    sql`SELECT id FROM debit_notes WHERE accounting_record_id = ${recordId}
          AND dn_no = ${r.dnNo} AND status <> 'VOID' LIMIT 1`,
  );
  if (live) return;
  await renumber(
    tx,
    [{ recordId, declareNo: r.declareNo, kind: 'DN', from: r.dnNo, to: null }],
    req,
    (declareNo) =>
      `No debit note for ${declareNo} (no debit note charges on its record summary): DN number taken away`,
  );
  await resequence(tx, req);
}

/**
 * Numbers every shipment that is approved (its record summary or its Chea payment is Checked)
 * but not invoiced yet, in clearance-date order, so released numbers go to the earliest one
 * waiting. Then every run is put back in INV-date order, closing any gap a released number
 * left even when no shipment was waiting.
 */
export async function numberEligible(tx: Tx, req: Request): Promise<AssignedNumbers[]> {
  await lockNumbering(tx);
  // A revision waiting for approval (Request Revise) was approved before.
  const approved = (table: string) =>
    sql`EXISTS (SELECT 1 FROM ${sql.raw(table)} x WHERE x.accounting_record_id = a.id
          AND x.status = 'ISSUED' AND x.review_status IN ('CHECKED', 'REVISION_REQUESTED'))`;
  const waiting = await queryRows<{ id: string }>(
    tx,
    sql`SELECT a.id FROM accounting_records a JOIN customs_declarations d ON d.id = a.declaration_id
        WHERE (a.inv_no IS NULL OR a.dis_no IS NULL OR a.dn_no IS NULL)
          AND (${approved('record_summaries')} OR ${approved('credit_notes')})
        ORDER BY d.declare_date, a.inv_date, d.declare_no`,
  );
  const out: AssignedNumbers[] = [];
  for (const w of waiting) {
    const a = await assignNumbers(tx, w.id, req);
    if (a.numbers.length) out.push(a);
  }
  // Report the numbers each shipment ends up with.
  for (const c of await resequence(tx, req))
    for (const n of out.find((a) => a.recordId === c.recordId)?.numbers ?? [])
      if (n.kind === c.kind) n.number = c.to;
  return out;
}
