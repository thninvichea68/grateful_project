import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import type { RoleCode } from '@gs/shared';
import { createApp } from '../../app';
import { db, pool } from '../../db/client';
import { exchangeRates, publicHolidays } from '../../db/schema';
import { queryRows } from '../../lib/listing';
import { createUser, resetDb, seedBasics, TEST_PASSWORD } from '../../test/helpers';

/*
 * Document numbers and issue dates (the company's rules, checked against 260902-LIST I & E):
 * - Tax invoice GS26-361: one sequence per year, after the numbers already used.
 * - Disbursement DIS404: one company-wide sequence (every client), restarting each January.
 * - Debit note JR2610001: client code + YYMM + 001, per client, restarting each month.
 * - Issue date: the next working day after the declaration (clearance) date, past weekends
 *   and the public holidays in Settings → Public holidays.
 */

const app = createApp();
let b: Awaited<ReturnType<typeof seedBasics>>;
let tokens: Partial<Record<RoleCode, string>> = {};
async function as(role: RoleCode) {
  if (!tokens[role]) {
    await createUser(role);
    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: `${role.toLowerCase()}@test.local`, password: TEST_PASSWORD });
    tokens[role] = res.body.accessToken as string;
  }
  return { Authorization: `Bearer ${tokens[role]}` };
}
async function acc(
  m: 'get' | 'post' | 'put' | 'patch',
  path: string,
  o: { body?: object; query?: Record<string, string>; role?: RoleCode } = {},
) {
  const req = request(app)
    [m](`/api/v1/accounting${path}`)
    .set(await as(o.role ?? 'ACCOUNTANT'));
  if (o.query) void req.query(o.query);
  return o.body ? req.send(o.body) : req;
}

/**
 * A shipment with one declaration. Unless `approve` is false, the broker submits its Credit
 * Noted and accounting checks it in Chea Payments: that puts it in the Monthly Ledger and
 * gives it its INV / DIS / DN numbers.
 */
async function shipment(
  clientId: string,
  declareNo: string,
  declareDate: string,
  { approve = true }: { approve?: boolean } = {},
) {
  const payload = {
    clientId,
    direction: 'EXPORT',
    transportMode: 'SEA',
    loadType: 'FCL',
    clearancePortId: b.port.id,
    destinationCountryIso2: 'US',
    etd: declareDate,
    containers: [
      { containerNo: `CXDU${declareNo.replace(/\D/g, '').padStart(7, '0')}`, size: '45HQ' },
    ],
    declarations: [{ declareNo, declareDate, portId: b.port.id }],
  };
  const ship = await request(app)
    .post('/api/v1/shipments')
    .set(await as('ADMIN'))
    .send(payload);
  if (ship.status !== 201) throw new Error(JSON.stringify(ship.body));
  const declarationId = ship.body.declarations[0].id as string;
  const pre = (await acc('get', '/docs/credit-notes/prefill', { query: { declarationId } })).body;
  const cn = await acc('post', '/docs/credit-notes', {
    body: { ...pre, lines: [{ ...pre.lines[0], unitPrice: '500' }] },
  });
  if (cn.status !== 201) throw new Error(JSON.stringify(cn.body));
  const creditNoteId = cn.body.id as string;
  await acc('post', `/docs/credit-notes/${creditNoteId}/issue`);
  const check = async () => {
    const res = await acc('patch', `/docs/credit-notes/${creditNoteId}/review`, {
      body: { reviewStatus: 'CHECKED' },
    });
    if (res.status !== 200) throw new Error(JSON.stringify(res.body));
    return res.body.numbered as { declareNo: string; numbers: { number: string }[] }[];
  };
  if (approve) await check();
  const recordId = async () =>
    (await acc('get', `/docs/credit-notes/${creditNoteId}`)).body.accountingRecordId as string;
  const row = async () => ledgerRow(await recordId());
  return {
    declarationId,
    creditNoteId,
    check,
    recordId: approve ? await recordId() : '',
    row,
    invDate: approve ? ((await row()).invDate as string) : '',
    /** Saves the shipment again with a new declaration date. */
    redate: async (date: string) => {
      const res = await request(app)
        .put(`/api/v1/shipments/${ship.body.id}`)
        .set(await as('ADMIN'))
        .send({
          ...payload,
          declarations: [{ id: declarationId, declareNo, declareDate: date, portId: b.port.id }],
        });
      if (res.status !== 200) throw new Error(JSON.stringify(res.body));
    },
  };
}
/** A Monthly Ledger row with numbers typed in (the Excel history), straight from the API. */
async function history(clientId: string, declareNo: string, declareDate: string, numbers: object) {
  const s = await shipment(clientId, declareNo, declareDate, { approve: false });
  const rec = await acc('post', '/ledger', {
    body: { declarationId: s.declarationId, ...numbers },
  });
  if (rec.status !== 201) throw new Error(JSON.stringify(rec.body));
  return rec.body as { id: string };
}
const numbersOf = async (s: { row: () => Promise<Record<string, string>> }) => {
  const r = await s.row();
  return [r.invNo, r.disNo, r.dnNo];
};
const deleteInvoice = (recordId: string, reason = 'Wrong client billed') =>
  acc('post', `/ledger/${recordId}/delete-invoice`, { body: { reason } });

type DocType = 'tax-invoices' | 'disbursements' | 'debit-notes';
const LINES = [{ description: 'SERVICE', qty: '1', unit: 'SHIP', unitPrice: '100', mark: '' }];
/** A draft filled from the ledger row (number allocated by the server unless given). */
async function draft(type: DocType, recordId: string, extra: object = {}) {
  const pre = (await acc('get', `/docs/${type}/prefill`, { query: { recordId } })).body;
  const res = await acc('post', `/docs/${type}`, { body: { ...pre, lines: LINES, ...extra } });
  if (res.status !== 201) throw new Error(JSON.stringify(res.body));
  return res.body as { id: string; number: string; date: string };
}
const doc = async (type: DocType, id: string) =>
  (await acc('get', `/docs/${type}/${id}`)).body as {
    number: string;
    date: string;
    status: string;
  };
const ledgerRow = async (id: string) => (await acc('get', `/ledger/${id}`)).body;

beforeEach(async () => {
  await resetDb();
  tokens = {};
  b = await seedBasics();
  await db.insert(exchangeRates).values({ effectiveDate: '2026-01-01', usdToKhr: '4047' });
  // Part of the 2026 calendar (Sub-Decree No. 167) and New Year 2027.
  await db.insert(publicHolidays).values(
    [
      ['2026-10-10', 'Pchum Ben Festival'],
      ['2026-10-11', 'Pchum Ben Festival'],
      ['2026-10-12', 'Pchum Ben Festival'],
      ['2026-10-15', 'Commemoration Day of King Father Norodom Sihanouk'],
      ['2026-12-29', 'Peace Day'],
      ['2027-01-01', "International New Year's Day"],
    ].map(([holidayDate, name]) => ({ holidayDate: holidayDate!, name: name! })),
  );
});
afterAll(async () => {
  await pool.end();
});

describe('issue date: the next working day after the declaration date', () => {
  it('skips weekends and public holidays, also across the year end', async () => {
    // Wed → Thu
    expect((await shipment(b.jr.id, 'E 1', '2026-10-07')).invDate).toBe('2026-10-08');
    // Fri, then Pchum Ben Sat–Mon → Tue
    expect((await shipment(b.jr.id, 'E 2', '2026-10-09')).invDate).toBe('2026-10-13');
    // Sat → Mon
    expect((await shipment(b.jr.id, 'E 3', '2026-08-22')).invDate).toBe('2026-08-24');
    // Wed before the holiday Thu 15 Oct → Fri 16 Oct
    expect((await shipment(b.jr.id, 'E 4', '2026-10-14')).invDate).toBe('2026-10-16');
    // Mon 28 Dec, Peace Day Tue 29 → Wed 30 Dec
    expect((await shipment(b.jr.id, 'E 5', '2026-12-28')).invDate).toBe('2026-12-30');
    // Thu 31 Dec, New Year Fri 1 Jan, weekend → Mon 4 Jan 2027
    expect((await shipment(b.jr.id, 'E 6', '2026-12-31')).invDate).toBe('2027-01-04');
  });

  it('documents take the ledger row’s issue date', async () => {
    const s = await shipment(b.jr.id, 'E 7', '2026-10-09');
    for (const type of ['tax-invoices', 'disbursements', 'debit-notes'] as const)
      expect((await draft(type, s.recordId)).date).toBe('2026-10-13');
  });
});

describe('document lists', () => {
  it('show each document’s declare date, quantity and the shipment’s freight', async () => {
    const s = await shipment(b.jr.id, 'E 8', '2026-10-07');
    for (const type of ['tax-invoices', 'disbursements', 'debit-notes'] as const) {
      await draft(type, s.recordId, { pkgs: '616', pkgsUnit: 'CTNS' });
      const [row] = (await acc('get', `/docs/${type}`)).body.data;
      expect(row).toMatchObject({
        declareDate: '2026-10-07',
        quantityText: '616 CTNS',
        transportMode: 'SEA',
      });
    }
  });

  it('filter and sort from the headers, as in Excel', async () => {
    const jr = await shipment(b.jr.id, 'E 21', '2026-10-07');
    const jyx = await shipment(b.jyx.id, 'E 22', '2026-10-08');
    const jr2 = await shipment(b.jr.id, 'E 23', '2026-10-09');
    await draft('disbursements', jr.recordId, { pkgs: '10', pkgsUnit: 'CTNS' });
    await draft('disbursements', jyx.recordId, { pkgs: '5', pkgsUnit: 'PKGS' });
    await draft('disbursements', jr2.recordId, { pkgs: null, pkgsUnit: null });
    const list = async (query: Record<string, string>) =>
      (await acc('get', '/docs/disbursements', { query })).body.data.map(
        (r: { declareNo: string }) => r.declareNo,
      );
    const values = async (column: string, query: Record<string, string> = {}) =>
      (await acc('get', '/docs/disbursements/values', { query: { column, ...query } })).body;

    // Kept values, '' for blanks; a column with no value kept shows nothing.
    expect(await list({ filters: JSON.stringify({ client: ['JR'] }) })).toEqual(['E 23', 'E 21']);
    expect(await list({ filters: JSON.stringify({ quantity: ['', '5 PKGS'] }) })).toEqual([
      'E 23',
      'E 22',
    ]);
    expect(await list({ filters: JSON.stringify({ client: [] }) })).toEqual([]);
    // Sorted by a column, blanks last.
    expect(await list({ sort: 'quantity', dir: 'asc' })).toEqual(['E 21', 'E 22', 'E 23']);
    expect(await list({ sort: 'declareDate', dir: 'asc' })).toEqual(['E 21', 'E 22', 'E 23']);

    // A column offers the values the other filters leave, not its own filter's.
    expect(await values('client')).toEqual(['JR', 'JYX']);
    const onlyJr = { filters: JSON.stringify({ client: ['JR'] }) };
    expect(await values('client', onlyJr)).toEqual(['JR', 'JYX']);
    expect(await values('quantity', onlyJr)).toEqual(['10 CTNS', '']);
    expect(await values('declareDate', onlyJr)).toEqual(['2026-10-07', '2026-10-09']);

    const bad = await acc('get', '/docs/disbursements', { query: { filters: '{oops' } });
    expect(bad.status).toBe(400);
  });
});

describe('numbers on approval', () => {
  it('Checked in Chea Payments: into the Monthly Ledger with INV, DIS and DN numbers', async () => {
    const s = await shipment(b.jr.id, 'E 10', '2026-10-07', { approve: false });
    // Submitted but not approved: not in the ledger yet.
    expect((await acc('get', '/ledger')).body.data).toHaveLength(0);
    const numbered = await s.check();
    expect(numbered).toMatchObject([
      {
        declareNo: 'E 10',
        numbers: [{ number: 'GS26-001' }, { number: 'DIS001' }, { number: 'JR2610001' }],
      },
    ]);
    const row = await s.row();
    expect(row).toMatchObject({
      invNo: 'GS26-001',
      disNo: 'DIS001',
      dnNo: 'JR2610001',
      invDate: '2026-10-08',
      clearFee: '500.00',
      exchangeRate: '4047.0000',
    });
    // Nobody types numbers.
    const typed = await acc('patch', `/ledger/${row.id}`, { body: { invNo: 'GS26-999' } });
    expect(typed.status).toBe(422);
  });

  it('continues after the numbers already used; GS27 and DIS restart in January', async () => {
    await history(b.jr.id, 'E 20', '2026-09-02', {
      invNo: 'GS26-001',
      disNo: 'DIS001',
      dnNo: 'JR2609001',
    });
    const a = await shipment(b.jyx.id, 'E 21', '2026-10-07');
    const c = await shipment(b.jr.id, 'E 22', '2026-10-07');
    expect(await numbersOf(a)).toEqual(['GS26-002', 'DIS002', 'JYX2610001']);
    expect(await numbersOf(c)).toEqual(['GS26-003', 'DIS003', 'JR2610001']);
    const next = await shipment(b.jr.id, 'E 23', '2027-01-05');
    expect(await numbersOf(next)).toEqual(['GS27-001', 'DIS001', 'JR2701001']);
  });

  it('debit notes run per client and restart each month', async () => {
    const jr1 = await shipment(b.jr.id, 'E 30', '2026-10-07');
    const jr2 = await shipment(b.jr.id, 'E 31', '2026-10-07');
    const jyx = await shipment(b.jyx.id, 'E 32', '2026-10-07');
    const jrNov = await shipment(b.jr.id, 'E 33', '2026-11-03');
    const jrNov2 = await shipment(b.jr.id, 'E 35', '2026-11-04');
    expect((await jr1.row()).dnNo).toBe('JR2610001');
    expect((await jr2.row()).dnNo).toBe('JR2610002');
    expect((await jyx.row()).dnNo).toBe('JYX2610001');
    expect((await jrNov.row()).dnNo).toBe('JR2611001');
    expect((await jrNov2.row()).dnNo).toBe('JR2611002');
  });

  it('a shipment belongs to the month of its INV date, not its clearance date', async () => {
    // Fri 30 Oct → INV date Mon 2 Nov: November's ledger and a November debit note.
    const s = await shipment(b.jr.id, 'E 34', '2026-10-30');
    expect(s.invDate).toBe('2026-11-02');
    expect(await numbersOf(s)).toEqual(['GS26-001', 'DIS001', 'JR2611001']);
    const inMonth = async (month: string) =>
      (await acc('get', '/ledger', { query: { month } })).body.data.map(
        (r: { declareNo: string }) => r.declareNo,
      );
    expect(await inMonth('2026-10')).toEqual([]);
    expect(await inMonth('2026-11')).toEqual(['E 34']);
    // Billed in October after all: its issue date corrected to 30 Oct moves it, with an
    // October debit note number.
    const dis = await draft('disbursements', s.recordId);
    expect((await acc('post', `/docs/disbursements/${dis.id}/issue`)).status).toBe(200);
    const ok = await acc('post', `/docs/disbursements/${dis.id}/correct`, {
      body: { date: '2026-10-30', reason: 'Billed in October' },
    });
    expect(ok.status).toBe(200);
    expect(await numbersOf(s)).toEqual(['GS26-001', 'DIS001', 'JR2610001']);
    expect(await inMonth('2026-10')).toEqual(['E 34']);
    expect(await inMonth('2026-11')).toEqual([]);
  });

  it('documents take the ledger number, date and rate; one of each type per shipment', async () => {
    const s = await shipment(b.jr.id, 'E 7', '2026-10-09');
    const expected = {
      'tax-invoices': 'GS26-001',
      disbursements: 'DIS001',
      'debit-notes': 'JR2610001',
    } as const;
    for (const type of ['tax-invoices', 'disbursements', 'debit-notes'] as const) {
      // A typed number is ignored.
      const d = await draft(type, s.recordId, { invoiceNo: 'GS26-777', disNo: 'DIS777' });
      expect(d.date).toBe('2026-10-13');
      expect(d.number).toBe(expected[type]);
    }
    const pre = (
      await acc('get', '/docs/tax-invoices/prefill', { query: { recordId: s.recordId } })
    ).body;
    const again = await acc('post', '/docs/tax-invoices', { body: { ...pre, lines: LINES } });
    expect(again.status).toBe(409);
    expect(again.body.error.message).toContain('already has tax invoice GS26-001');
    // Not approved: no number, so no document.
    const rec = await history(b.jr.id, 'E 9', '2026-10-09', {});
    const pre2 = (await acc('get', '/docs/tax-invoices/prefill', { query: { recordId: rec.id } }))
      .body;
    const none = await acc('post', '/docs/tax-invoices', { body: { ...pre2, lines: LINES } });
    expect(none.status).toBe(422);
  });

  it('never gives the same number twice when shipments are approved at the same time', async () => {
    const rows = [];
    for (let i = 0; i < 6; i++)
      rows.push(
        await shipment(i % 2 ? b.jr.id : b.jyx.id, `E 4${i}`, '2026-10-07', { approve: false }),
      );
    await Promise.all(rows.map((r) => r.check()));
    const all = await Promise.all(rows.map(numbersOf));
    expect(all.map((n) => n[0]).sort()).toEqual([
      'GS26-001',
      'GS26-002',
      'GS26-003',
      'GS26-004',
      'GS26-005',
      'GS26-006',
    ]);
    expect(new Set(all.map((n) => n[1])).size).toBe(6);
    expect(all.map((n) => n[2]).sort()).toEqual([
      'JR2610001',
      'JR2610002',
      'JR2610003',
      'JYX2610001',
      'JYX2610002',
      'JYX2610003',
    ]);
  });
});

describe('deleting an issued invoice', () => {
  it('closes the gap it leaves: the later numbers move up, so no number is skipped', async () => {
    const a = await shipment(b.jr.id, 'E 70', '2026-10-05');
    const c = await shipment(b.jr.id, 'E 71', '2026-10-06');
    const inv = await draft('tax-invoices', a.recordId);
    expect((await acc('post', `/docs/tax-invoices/${inv.id}/issue`)).status).toBe(200);
    expect(await numbersOf(c)).toEqual(['GS26-002', 'DIS002', 'JR2610002']);

    // Only accounting can, and with a reason.
    expect((await deleteInvoice(a.recordId, '')).status).toBe(400);
    const viewer = await acc('post', `/ledger/${a.recordId}/delete-invoice`, {
      body: { reason: 'Wrong client' },
      role: 'VIEWER',
    });
    expect(viewer.status).toBe(403);

    const del = await deleteInvoice(a.recordId);
    expect(del.status).toBe(200);
    expect(del.body.released).toEqual([
      { kind: 'INV', number: 'GS26-001', kept: false },
      { kind: 'DIS', number: 'DIS001', kept: false },
      { kind: 'DN', number: 'JR2610001', kept: true },
    ]);
    // Not invoiced again: no numbers, no documents, Chea payment back to Unchecked.
    expect(await a.row()).toMatchObject({
      invNo: null,
      disNo: null,
      dnNo: null,
      invRevenue: '0.00',
    });
    expect((await acc('get', `/docs/tax-invoices/${inv.id}`)).status).toBe(404);
    const review = (await acc('get', '/credit-notes/review', { query: { review: 'UNCHECKED' } }))
      .body.data;
    expect(review.map((r: { declareNo: string }) => r.declareNo)).toEqual(['E 70']);

    // E 71 moved up into the freed numbers; the next approved shipment follows on.
    expect(await numbersOf(c)).toEqual(['GS26-001', 'DIS001', 'JR2610001']);
    const d = await shipment(b.jr.id, 'E 72', '2026-10-07');
    expect(await numbersOf(d)).toEqual(['GS26-002', 'DIS002', 'JR2610002']);
    expect(await numbersOf(c)).toEqual(['GS26-001', 'DIS001', 'JR2610001']);
    expect((await d.row()).invDate).toBe('2026-10-08');
    // Re-approved, the first one takes the first slot again and the others move down.
    await a.check();
    expect(await numbersOf(a)).toEqual(['GS26-001', 'DIS001', 'JR2610001']);
    expect(await numbersOf(c)).toEqual(['GS26-002', 'DIS002', 'JR2610002']);
    expect(await numbersOf(d)).toEqual(['GS26-003', 'DIS003', 'JR2610003']);

    const [log] = await queryRows<{ reason: string; after: { released: unknown[] } }>(
      db,
      sql`SELECT reason, after FROM audit_log WHERE entity = 'accounting_record' AND entity_id = ${a.recordId}
          AND reason LIKE 'Invoice deleted%' LIMIT 1`,
    );
    expect(log!.reason).toBe('Invoice deleted for E 70: Wrong client billed');
    expect(log!.after.released).toHaveLength(3);
    // The gap was closed at once, so no number is left waiting to be handed out again.
    const waiting = await queryRows<{ number: string }>(
      db,
      sql`SELECT number FROM released_numbers WHERE reassigned_at IS NULL`,
    );
    expect(waiting).toEqual([]);
  });

  it('the latest numbers are not held: the run simply continues from them', async () => {
    await shipment(b.jr.id, 'E 80', '2026-10-05');
    const c = await shipment(b.jr.id, 'E 81', '2026-10-06');
    const del = await deleteInvoice(c.recordId);
    expect(del.body.released.map((r: { kept: boolean }) => r.kept)).toEqual([false, false, false]);
    await c.check();
    expect(await numbersOf(c)).toEqual(['GS26-002', 'DIS002', 'JR2610002']);
  });
});

describe('a shipment approved late with an earlier INV date', () => {
  it('takes its slot; the later ones move down, issued documents included', async () => {
    const e1 = await shipment(b.jr.id, 'E 90', '2026-10-01'); // → Fri 2 Oct
    const e2 = await shipment(b.jr.id, 'E 91', '2026-10-02'); // → Mon 5 Oct
    const e3 = await shipment(b.jr.id, 'E 92', '2026-10-09'); // → Tue 13 Oct (Pchum Ben)
    expect(await numbersOf(e3)).toEqual(['GS26-003', 'DIS003', 'JR2610003']);
    const inv = await draft('tax-invoices', e3.recordId);
    expect((await acc('post', `/docs/tax-invoices/${inv.id}/issue`)).status).toBe(200);
    const dis = await draft('disbursements', e3.recordId);

    // Another client, declared 7 Oct (→ 8 Oct): before E 92. INV and DIS move; DN runs per
    // client, so E 92 keeps JR2610003.
    const late = await shipment(b.jyx.id, 'E 93', '2026-10-07', { approve: false });
    expect(await late.check()).toMatchObject([
      {
        declareNo: 'E 93',
        numbers: [{ number: 'GS26-003' }, { number: 'DIS003' }, { number: 'JYX2610001' }],
      },
    ]);
    expect(await numbersOf(e3)).toEqual(['GS26-004', 'DIS004', 'JR2610003']);
    expect(await doc('tax-invoices', inv.id)).toMatchObject({
      number: 'GS26-004',
      status: 'ISSUED',
    });
    expect((await doc('disbursements', dis.id)).number).toBe('DIS004');
    expect(await numbersOf(e1)).toEqual(['GS26-001', 'DIS001', 'JR2610001']);
    expect(await numbersOf(e2)).toEqual(['GS26-002', 'DIS002', 'JR2610002']);

    // The same client, declared 6 Oct: its DN moves E 92 down too.
    const jr = await shipment(b.jr.id, 'E 94', '2026-10-06');
    expect(await numbersOf(jr)).toEqual(['GS26-003', 'DIS003', 'JR2610003']);
    expect(await numbersOf(late)).toEqual(['GS26-004', 'DIS004', 'JYX2610001']);
    expect(await numbersOf(e3)).toEqual(['GS26-005', 'DIS005', 'JR2610004']);

    const [log] = await queryRows<{ reason: string; before: unknown; after: unknown }>(
      db,
      sql`SELECT reason, before, after FROM audit_log WHERE entity = 'accounting_record'
          AND entity_id = ${e3.recordId} AND reason LIKE 'Renumbered%' ORDER BY id DESC LIMIT 1`,
    );
    expect(log).toEqual({
      reason: 'Renumbered E 92 to keep INV-date order',
      before: { invNo: 'GS26-004', disNo: 'DIS004', dnNo: 'JR2610003' },
      after: { invNo: 'GS26-005', disNo: 'DIS005', dnNo: 'JR2610004' },
    });
  });

  it('a DIS of no shipment counts by its own date, even when made later', async () => {
    const oct = await shipment(b.jr.id, 'E 97', '2026-10-27'); // → Wed 28 Oct
    const nov = await shipment(b.jr.id, 'E 98', '2026-10-30'); // → Mon 2 Nov
    const novDis = await draft('disbursements', nov.recordId);
    expect((await acc('post', `/docs/disbursements/${novDis.id}/issue`)).status).toBe(200);
    expect((await nov.row()).disNo).toBe('DIS002');

    // Made on 2 Nov for October's monthly fee, dated 31 Oct: it takes DIS002, and the
    // November shipment (its issued document included) moves to DIS003.
    const pre = (
      await acc('get', '/docs/disbursements/prefill', {
        query: { clientId: b.jr.id, date: '2026-10-31' },
      })
    ).body;
    const fee = await acc('post', '/docs/disbursements', { body: { ...pre, lines: LINES } });
    expect(fee.status).toBe(201);
    expect((await doc('disbursements', fee.body.id)).number).toBe('DIS002');
    expect((await nov.row()).disNo).toBe('DIS003');
    expect(await doc('disbursements', novDis.id)).toMatchObject({
      number: 'DIS003',
      status: 'ISSUED',
    });
    expect((await oct.row()).disNo).toBe('DIS001');
  });

  it('a corrected issue date moves the shipment in its runs', async () => {
    const a = await shipment(b.jr.id, 'E 70', '2026-10-27'); // → 28 Oct
    const c = await shipment(b.jyx.id, 'E 71', '2026-10-28'); // → 29 Oct
    const dis = await draft('disbursements', c.recordId);
    expect((await acc('post', `/docs/disbursements/${dis.id}/issue`)).status).toBe(200);
    expect((await c.row()).disNo).toBe('DIS002');

    // Its real date was 27 Oct: the ledger follows, and it goes before E 70.
    const ok = await acc('post', `/docs/disbursements/${dis.id}/correct`, {
      body: { date: '2026-10-27', reason: 'Date issued in error' },
    });
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({ number: 'DIS001', date: '2026-10-27' });
    expect(await c.row()).toMatchObject({ invDate: '2026-10-27', disNo: 'DIS001' });
    expect((await a.row()).disNo).toBe('DIS002');
  });

  it('a late October shipment moves November’s INV and DIS numbers', async () => {
    const nov = await shipment(b.jr.id, 'E 95', '2026-11-04');
    const oct = await shipment(b.jr.id, 'E 96', '2026-10-27');
    expect(await numbersOf(oct)).toEqual(['GS26-001', 'DIS001', 'JR2610001']);
    expect(await numbersOf(nov)).toEqual(['GS26-002', 'DIS002', 'JR2611001']);
  });

  it('numbers dated before GAPLESS_FROM stay as they are, gaps included', async () => {
    // September from the workbook, with a gap (DIS002 was deleted there).
    await history(b.jr.id, 'E 97', '2026-09-02', { invNo: 'GS26-001', disNo: 'DIS001' });
    await history(b.jr.id, 'E 98', '2026-09-03', { invNo: 'GS26-002', disNo: 'DIS003' });
    const oct = await shipment(b.jr.id, 'E 99', '2026-10-07');
    expect(await numbersOf(oct)).toEqual(['GS26-003', 'DIS004', 'JR2610001']);
  });
});

describe('a changed declaration date', () => {
  it('re-dates the ledger row and drafts; a debit note moving month takes the new month’s number', async () => {
    const s = await shipment(b.jr.id, 'E 50', '2026-09-28'); // Mon → Tue 29 Sep
    expect(s.invDate).toBe('2026-09-29');
    const dn = await draft('debit-notes', s.recordId);
    const inv = await draft('tax-invoices', s.recordId);
    expect(dn.number).toBe('JR2609001');
    expect(inv.number).toBe('GS26-001');

    await s.redate('2026-10-01'); // Thu → Fri 2 Oct
    expect(await ledgerRow(s.recordId)).toMatchObject({ invDate: '2026-10-02', dnNo: 'JR2610001' });
    expect(await doc('debit-notes', dn.id)).toMatchObject({
      number: 'JR2610001',
      date: '2026-10-02',
    });
    // Same year: the tax invoice keeps its number, only the date moves.
    expect(await doc('tax-invoices', inv.id)).toMatchObject({
      number: inv.number,
      date: '2026-10-02',
    });
  });

  it('changes nothing once a document is issued', async () => {
    const s = await shipment(b.jr.id, 'E 51', '2026-09-28');
    const dn = await draft('debit-notes', s.recordId);
    expect((await acc('post', `/docs/debit-notes/${dn.id}/issue`)).status).toBe(200);
    await s.redate('2026-10-01');
    expect((await ledgerRow(s.recordId)).invDate).toBe('2026-09-29');
    expect(await doc('debit-notes', dn.id)).toMatchObject({
      number: 'JR2609001',
      date: '2026-09-29',
    });
  });
});

describe('authorised correction of an issued document', () => {
  it('needs accounting write access and a reason, and keeps the history', async () => {
    const s = await shipment(b.jr.id, 'E 60', '2026-10-07');
    const inv = await draft('tax-invoices', s.recordId);
    expect((await acc('post', `/docs/tax-invoices/${inv.id}/issue`)).status).toBe(200);
    expect((await ledgerRow(s.recordId)).invNo).toBe(inv.number);

    const body = { number: 'GS26-500', date: '2026-10-09', reason: 'Typed on the wrong form' };
    // Without accounting write access (Operations), no correction.
    const op = await acc('post', `/docs/tax-invoices/${inv.id}/correct`, {
      body,
      role: 'OPERATOR',
    });
    expect(op.status).toBe(403);
    const noReason = await acc('post', `/docs/tax-invoices/${inv.id}/correct`, {
      body: { number: 'GS26-500' },
    });
    expect(noReason.status).toBe(400);

    const ok = await acc('post', `/docs/tax-invoices/${inv.id}/correct`, { body });
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({ number: 'GS26-500', date: '2026-10-09', status: 'ISSUED' });
    // The Monthly Ledger shows the corrected number.
    expect((await ledgerRow(s.recordId)).invNo).toBe('GS26-500');
    const [log] = await queryRows<{ reason: string; before: unknown; after: unknown }>(
      db,
      sql`SELECT reason, before, after FROM audit_log WHERE entity = 'tax_invoices' AND entity_id = ${inv.id}
          AND reason IS NOT NULL ORDER BY id DESC LIMIT 1`,
    );
    expect(log).toMatchObject({
      reason: 'Typed on the wrong form',
      before: { number: inv.number, date: '2026-10-08' },
      after: { number: 'GS26-500', date: '2026-10-09', correction: true },
    });

    // A number already used by another invoice is refused. (E 61, dated 8 Oct, goes before
    // the corrected 9 Oct invoice in the run, so the two may have traded numbers.)
    const other = await shipment(b.jyx.id, 'E 61', '2026-10-07');
    const inv2 = await draft('tax-invoices', other.recordId);
    expect((await acc('post', `/docs/tax-invoices/${inv2.id}/issue`)).status).toBe(200);
    const dup = await acc('post', `/docs/tax-invoices/${inv2.id}/correct`, {
      body: { number: (await doc('tax-invoices', inv.id)).number, reason: 'Test' },
    });
    expect(dup.status).toBe(409);
    // A draft is changed in the editor, not corrected.
    const s3 = await shipment(b.jr.id, 'E 62', '2026-10-07');
    const d3 = await draft('tax-invoices', s3.recordId);
    expect(
      (
        await acc('post', `/docs/tax-invoices/${d3.id}/correct`, {
          body: { number: 'GS26-600', reason: 'x y z' },
        })
      ).status,
    ).toBe(409);
  });
});

describe('a shipment without a tax invoice', () => {
  /** Operations submit a record summary for the shipment and accounting checks it. */
  async function checkSummary(recordId: string, processingFee: string, documentFee = '25') {
    const pre = (await acc('get', '/docs/record-summaries/prefill', { query: { recordId } })).body;
    const line = (description: string, unitPrice: string, mark = '') => ({
      description,
      qty: '1',
      unit: 'SHIP',
      unitPrice,
      mark,
    });
    const rs = await acc('post', '/docs/record-summaries', {
      body: {
        ...pre,
        lines: [
          line('EXPORT PROCESSING FEE', processingFee, 'VAT 10%'),
          line('HBL FEE', '6445.72', 'Receipt'),
          line('DOCUMENT FEE', documentFee),
        ],
      },
    });
    if (rs.status !== 201) throw new Error(JSON.stringify(rs.body));
    await acc('post', `/docs/record-summaries/${rs.body.id}/issue`);
    const res = await acc('patch', `/docs/record-summaries/${rs.body.id}/review`, {
      body: { reviewStatus: 'CHECKED' },
    });
    if (res.status !== 200) throw new Error(JSON.stringify(res.body));
  }

  it('gets its numbers when its record summary is approved, without a credit note', async () => {
    const rec = await history(b.jr.id, 'E 300', '2026-10-30', {});
    expect(await numbersOf({ row: () => ledgerRow(rec.id) })).toEqual([null, null, null]);
    await checkSummary(rec.id, '140');
    expect(await ledgerRow(rec.id)).toMatchObject({
      invNo: 'GS26-001',
      disNo: 'DIS001',
      dnNo: 'JR2611001', // declared 30 Oct, issued Mon 2 Nov
      clearFee: '0.00',
    });
  });

  it('has no INV number when its record summary has no processing fee; the next ones follow on', async () => {
    const a = await shipment(b.jr.id, 'E 301', '2026-10-01');
    const none = await shipment(b.jr.id, 'E 302', '2026-10-05');
    const c = await shipment(b.jr.id, 'E 303', '2026-10-06');
    expect(await numbersOf(none)).toEqual(['GS26-002', 'DIS002', 'JR2610002']);

    await checkSummary(none.recordId, '0');
    // Like the monthly sheets: INV left blank, DIS and DN kept, and no gap in the INV run.
    expect(await numbersOf(none)).toEqual([null, 'DIS002', 'JR2610002']);
    expect(await numbersOf(a)).toEqual(['GS26-001', 'DIS001', 'JR2610001']);
    expect(await numbersOf(c)).toEqual(['GS26-002', 'DIS003', 'JR2610003']);
    const docs = await acc('get', '/docs/tax-invoices', { query: { recordId: none.recordId } });
    expect(
      docs.body.data.filter(
        (d: { accountingRecordId: string }) => d.accountingRecordId === none.recordId,
      ),
    ).toEqual([]);

    // Approving the next shipment doesn't hand it an INV number again.
    const d = await shipment(b.jr.id, 'E 304', '2026-10-07');
    expect(await numbersOf(d)).toEqual(['GS26-003', 'DIS004', 'JR2610004']);
    expect((await none.row()).invNo).toBeNull();
  });

  it('has no DN number when its record summary has no debit note charges; the next ones move up', async () => {
    const a = await shipment(b.jr.id, 'E 311', '2026-10-01');
    const thc = await shipment(b.jr.id, 'E 312', '2026-10-05');
    const c = await shipment(b.jr.id, 'E 313', '2026-10-06');
    expect(await numbersOf(thc)).toEqual(['GS26-002', 'DIS002', 'JR2610002']);

    // A THC billed on its DIS only: no processing fee, no debit note charges.
    await checkSummary(thc.recordId, '0', '0');
    expect(await numbersOf(thc)).toEqual([null, 'DIS002', null]);
    expect(await numbersOf(a)).toEqual(['GS26-001', 'DIS001', 'JR2610001']);
    expect(await numbersOf(c)).toEqual(['GS26-002', 'DIS003', 'JR2610002']);

    // The client month shows nothing to bill there, and no draft is made for it.
    const m = (await acc('get', `/billing/${b.jr.id}`, { query: { month: '2026-10' } })).body;
    const row = m.rows.find((r: { recordId: string }) => r.recordId === thc.recordId);
    expect(row.none).toEqual({ 'tax-invoices': true, disbursements: false, 'debit-notes': true });

    // The next shipment doesn't give it a DN number again.
    const d = await shipment(b.jr.id, 'E 314', '2026-10-07');
    expect(await numbersOf(d)).toEqual(['GS26-003', 'DIS004', 'JR2610003']);
    expect((await thc.row()).dnNo).toBeNull();
  });
});
