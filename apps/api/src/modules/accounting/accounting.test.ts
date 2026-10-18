import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type { RoleCode } from '@gs/shared';
import { createApp } from '../../app';
import { db, pool } from '../../db/client';
import { exchangeRates } from '../../db/schema';
import { createUser, resetDb, seedBasics, TEST_PASSWORD } from '../../test/helpers';

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

/** Creates a shipment with one declaration and returns the declaration id. */
async function declaration(
  clientId: string,
  declareNo: string,
  declareDate: string,
  direction = 'EXPORT',
) {
  const res = await request(app)
    .post('/api/v1/shipments')
    .set(await as('ADMIN'))
    .send({
      clientId,
      direction,
      transportMode: 'SEA',
      loadType: 'FCL',
      clearancePortId: b.port.id,
      destinationCountryIso2: 'US',
      originCountryIso2: 'KH',
      hblNo: 'NON',
      eta: declareDate,
      containers: [{ containerNo: 'MRKU8974303', size: '40HQ' }],
      invoices: [
        {
          invoiceNo: `INV-${declareNo.replace(/\D/g, '')}`,
          lines: [{ pcs: 1000, ctns: '978', cbm: '45.5', grossWeightKg: '8800', fobUnitPrice: 2 }],
        },
      ],
      declarations: [{ declareNo, declareDate, portId: b.port.id }],
    });
  if (res.status !== 201) throw new Error(JSON.stringify(res.body));
  return res.body.declarations[0].id as string;
}

// The accounting engine's own example row (I 122050, JR Apparel).
const I122050 = {
  clearFee: '982.45',
  thc: '355',
  otherPay: '0',
  invRevenue: '185',
  disTotal: '21.25',
  dnTotal: '1334',
};

beforeEach(async () => {
  await resetDb();
  tokens = {};
  b = await seedBasics();
  await db.insert(exchangeRates).values([
    { effectiveDate: '2026-08-01', usdToKhr: '4030' },
    { effectiveDate: '2026-09-01', usdToKhr: '4041' },
  ]);
});
afterAll(async () => {
  await pool.end();
});

describe('monthly ledger', () => {
  it('computes invoice date, rate, commission, VAT and net profit on the server', async () => {
    const declId = await declaration(b.jr.id, 'I 122050', '2026-08-21'); // a Friday
    const res = await request(app)
      .post('/api/v1/accounting/ledger')
      .set(await as('ACCOUNTANT'))
      .send({ declarationId: declId, ...I122050 });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      declareNo: 'I 122050',
      clientCode: 'JR',
      invDate: '2026-08-24',
      exchangeRate: '4030.0000',
      commission: '0.00',
      vat: '18.50',
      netProfit: '202.80',
      cheaStatus: 'UNPAID',
      documents: [],
    });
  });

  it('uses the client commission (JYX $50) and recalculates on edit', async () => {
    const declId = await declaration(b.jyx.id, 'I 95925', '2026-09-02');
    const h = await as('ACCOUNTANT');
    const created = (
      await request(app).post('/api/v1/accounting/ledger').set(h).send({
        declarationId: declId,
        clearFee: '285.53',
        invRevenue: '150',
        disTotal: '190.53',
        dnTotal: '347.11',
      })
    ).body;
    expect(created).toMatchObject({
      commission: '50.00',
      netProfit: '352.11',
      exchangeRate: '4041.0000',
      invDate: '2026-09-03',
    });
    const upd = await request(app)
      .patch(`/api/v1/accounting/ledger/${created.id}`)
      .set(h)
      .send({ otherPay: '12.50', commission: '0', cheaStatus: 'PAID' });
    expect(upd.body).toMatchObject({
      otherPay: '12.50',
      commission: '0.00',
      netProfit: '389.61',
      cheaStatus: 'PAID',
    });
    const reset = await request(app)
      .patch(`/api/v1/accounting/ledger/${created.id}`)
      .set(h)
      .send({ commission: null });
    expect(reset.body).toMatchObject({ commission: '50.00', netProfit: '339.61' });
  });

  it('one ledger row per declaration; the picker hides used declarations', async () => {
    const h = await as('ACCOUNTANT');
    const declId = await declaration(b.jr.id, 'I 1', '2026-08-03');
    await declaration(b.jr.id, 'I 2', '2026-08-04');
    await request(app).post('/api/v1/accounting/ledger').set(h).send({ declarationId: declId });
    const dup = await request(app)
      .post('/api/v1/accounting/ledger')
      .set(h)
      .send({ declarationId: declId });
    expect(dup.status).toBe(409);
    const opts = await request(app).get('/api/v1/accounting/declarations').set(h);
    expect(opts.body.map((o: { declareNo: string }) => o.declareNo)).toEqual(['I 2']);
  });

  it('lists a month with totals and exports it', async () => {
    const h = await as('ACCOUNTANT');
    await request(app)
      .post('/api/v1/accounting/ledger')
      .set(h)
      .send({ declarationId: await declaration(b.jr.id, 'I 122050', '2026-08-21'), ...I122050 });
    await request(app)
      .post('/api/v1/accounting/ledger')
      .set(h)
      .send({ declarationId: await declaration(b.jyx.id, 'I 7', '2026-09-10'), invRevenue: '100' });
    const aug = await request(app)
      .get('/api/v1/accounting/ledger')
      .query({ month: '2026-08' })
      .set(h);
    expect(aug.body.meta.total).toBe(1);
    expect(aug.body.totals).toMatchObject({
      rows: 1,
      netProfit: '202.80',
      invRevenue: '185.00',
      unpaid: 1,
    });
    const xlsx = await request(app)
      .get('/api/v1/accounting/ledger/export.xlsx')
      .query({ month: '2026-08' })
      .set(h);
    expect(xlsx.status).toBe(200);
    expect(xlsx.headers['content-disposition']).toContain('monthly-ledger-2026-08');

    // Whole year: both months together; another year has nothing.
    const y2026 = await request(app)
      .get('/api/v1/accounting/ledger')
      .query({ year: '2026' })
      .set(h);
    expect(y2026.body.meta.total).toBe(2);
    expect(y2026.body.totals.rows).toBe(2);
    const y2025 = await request(app)
      .get('/api/v1/accounting/ledger')
      .query({ year: '2025' })
      .set(h);
    expect(y2025.body.meta.total).toBe(0);
    // A month wins over a year when both are sent.
    const both = await request(app)
      .get('/api/v1/accounting/ledger')
      .query({ year: '2026', month: '2026-08' })
      .set(h);
    expect(both.body.meta.total).toBe(1);
    const yx = await request(app)
      .get('/api/v1/accounting/ledger/export.xlsx')
      .query({ year: '2026' })
      .set(h);
    expect(yx.headers['content-disposition']).toContain('yearly-ledger-2026');
  });

  it('roles: operators cannot see accounting; viewers can read but not write', async () => {
    expect(
      (
        await request(app)
          .get('/api/v1/accounting/ledger')
          .set(await as('OPERATOR'))
      ).status,
    ).toBe(403);
    expect(
      (
        await request(app)
          .get('/api/v1/accounting/ledger')
          .set(await as('VIEWER'))
      ).status,
    ).toBe(200);
    const declId = await declaration(b.jr.id, 'I 3', '2026-08-05');
    expect(
      (
        await request(app)
          .post('/api/v1/accounting/ledger')
          .set(await as('VIEWER'))
          .send({ declarationId: declId })
      ).status,
    ).toBe(403);
  });
});

describe('clear fee payments to Chea', () => {
  const URL = '/api/v1/accounting/clear-fee-payments';

  it("pays a month's clear fee in parts and shows the balance (negative = overpaid)", async () => {
    const h = await as('ACCOUNTANT');
    for (const [no, date, fee] of [
      ['I 1', '2026-09-02', '600.25'],
      ['I 2', '2026-09-03', '400'],
    ] as const)
      await request(app)
        .post('/api/v1/accounting/ledger')
        .set(h)
        .send({ declarationId: await declaration(b.jr.id, no, date), clearFee: fee });

    const empty = await request(app).get(URL).query({ month: '2026-09' }).set(h);
    expect(empty.body).toMatchObject({ clearFee: '1000.25', paid: '0.00', balance: '1000.25' });
    expect(empty.body.payments).toEqual([]);

    // Entered out of order: listed by pay date.
    await request(app).post(URL).set(h).send({
      month: '2026-09',
      paidOn: '2026-10-08',
      amount: '600',
      remark: 'Paid for next month',
    });
    const res = await request(app)
      .post(URL)
      .set(h)
      .send({ month: '2026-09', paidOn: '2026-09-20', amount: '1,000.25' });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ clearFee: '1000.25', paid: '1600.25', balance: '-600.00' });
    expect(res.body.payments.map((p: { paidOn: string }) => p.paidOn)).toEqual([
      '2026-09-20',
      '2026-10-08',
    ]);
    expect(res.body.payments[1]).toMatchObject({ amount: '600.00', remark: 'Paid for next month' });

    // Another month is untouched.
    const oct = await request(app).get(URL).query({ month: '2026-10' }).set(h);
    expect(oct.body).toMatchObject({ clearFee: '0.00', paid: '0.00', payments: [] });

    const id = res.body.payments[1].id as string;
    expect(
      (await request(app).patch(`${URL}/${id}`).set(h).send({ amount: '0', remark: null })).status,
    ).toBe(400);
    await request(app).patch(`${URL}/${id}`).set(h).send({ amount: '500', remark: null });
    await request(app).delete(`${URL}/${res.body.payments[0].id}`).set(h);
    const after = await request(app).get(URL).query({ month: '2026-09' }).set(h);
    expect(after.body).toMatchObject({ paid: '500.00', balance: '500.25' });
    expect(after.body.payments).toEqual([
      expect.objectContaining({ paidOn: '2026-10-08', amount: '500.00', remark: null }),
    ]);
  });

  it('needs accounting:write to record a payment', async () => {
    const res = await request(app)
      .post(URL)
      .set(await as('VIEWER'))
      .send({ month: '2026-09', paidOn: '2026-09-20', amount: '100' });
    expect(res.status).toBe(403);
    expect(
      (
        await request(app)
          .get(URL)
          .query({ month: '2026-09' })
          .set(await as('VIEWER'))
      ).status,
    ).toBe(200);
  });
});

describe('billing documents', () => {
  /** The ledger row with the example amounts, approved in Chea Payments (so it has numbers). */
  async function ledgerRow(clientId = b.jr.id, declareNo = 'I 122050', date = '2026-08-21') {
    const h = await as('ACCOUNTANT');
    const declarationId = await declaration(clientId, declareNo, date);
    const res = await request(app)
      .post('/api/v1/accounting/ledger')
      .set(h)
      .send({ declarationId, ...I122050 });
    const pre = (
      await request(app)
        .get('/api/v1/accounting/docs/credit-notes/prefill')
        .query({ declarationId })
        .set(h)
    ).body;
    const cn = await request(app)
      .post('/api/v1/accounting/docs/credit-notes')
      .set(h)
      .send({ ...pre, lines: [{ ...pre.lines[0], unitPrice: I122050.clearFee }] });
    await request(app).post(`/api/v1/accounting/docs/credit-notes/${cn.body.id}/issue`).set(h);
    await request(app)
      .patch(`/api/v1/accounting/docs/credit-notes/${cn.body.id}/review`)
      .set(h)
      .send({ reviewStatus: 'CHECKED' })
      .expect(200);
    return res.body as { id: string };
  }

  it('tax invoice: prefill → create (GS26-001, VAT and KHR) → issue syncs the ledger → void reverses it', async () => {
    const h = await as('ACCOUNTANT');
    const rec = await ledgerRow();
    const pre = (
      await request(app)
        .get('/api/v1/accounting/docs/tax-invoices/prefill')
        .query({ recordId: rec.id })
        .set(h)
    ).body;
    expect(pre).toMatchObject({
      invoiceDate: '2026-08-24',
      exchangeRate: '4030.0000',
      containerNo: 'MRKU8974303',
      pkgs: '978 CTNS',
      grossWeightKg: '8800',
      volumeCbm: '45.5',
      pod: 'United States',
    });
    expect(pre.lines[0]).toMatchObject({
      description: expect.stringContaining('EXPORT PROCESSING FEE'),
      unitPrice: '185',
    });

    const created = await request(app)
      .post('/api/v1/accounting/docs/tax-invoices')
      .set(h)
      .send(pre);
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({
      number: 'GS26-001',
      status: 'DRAFT',
      declareNo: 'I 122050',
    });
    expect(created.body.totals).toEqual({
      subtotal: '185.00',
      vat: '18.50',
      total: '203.50',
      subtotalKhr: '745550',
      vatKhr: '74555',
      totalKhr: '820105',
    });
    expect(created.body.lines[0]).toMatchObject({
      subtotal: '185.00',
      vat: '18.50',
      amount: '203.50',
    });

    // Change the fee while still a draft; then issue.
    const id = created.body.id;
    await request(app)
      .put(`/api/v1/accounting/docs/tax-invoices/${id}`)
      .set(h)
      .send({ ...pre, lines: [{ ...pre.lines[0], unitPrice: '200' }] });
    const issued = await request(app)
      .post(`/api/v1/accounting/docs/tax-invoices/${id}/issue`)
      .set(h);
    expect(issued.body).toMatchObject({ status: 'ISSUED', number: 'GS26-001' });
    let led = (await request(app).get(`/api/v1/accounting/ledger/${rec.id}`).set(h)).body;
    expect(led).toMatchObject({
      invNo: 'GS26-001',
      invRevenue: '200.00',
      vat: '20.00',
      netProfit: '217.80',
    });
    expect(led.documents).toContainEqual({
      type: 'tax-invoices',
      id,
      number: 'GS26-001',
      status: 'ISSUED',
    });

    expect(
      (await request(app).put(`/api/v1/accounting/docs/tax-invoices/${id}`).set(h).send(pre))
        .status,
    ).toBe(409);
    expect(
      (await request(app).delete(`/api/v1/accounting/docs/tax-invoices/${id}`).set(h)).status,
    ).toBe(409);
    expect((await request(app).delete(`/api/v1/accounting/ledger/${rec.id}`).set(h)).status).toBe(
      409,
    );

    const voided = await request(app)
      .post(`/api/v1/accounting/docs/tax-invoices/${id}/void`)
      .set(h)
      .send({ reason: 'Wrong customer' });
    expect(voided.body.status).toBe('VOID');
    led = (await request(app).get(`/api/v1/accounting/ledger/${rec.id}`).set(h)).body;
    // A cancelled number is never reused: the shipment takes the next one.
    expect(led).toMatchObject({ invNo: 'GS26-002', invRevenue: '0.00', netProfit: '17.80' });

    const next = await request(app).post('/api/v1/accounting/docs/tax-invoices').set(h).send(pre);
    expect(next.body.number).toBe('GS26-002');
  });

  it('keeps decimals the prototype dropped (18.75 is not 18)', async () => {
    const h = await as('ACCOUNTANT');
    const rec = await ledgerRow();
    const pre = (
      await request(app)
        .get('/api/v1/accounting/docs/disbursements/prefill')
        .query({ recordId: rec.id })
        .set(h)
    ).body;
    const res = await request(app)
      .post('/api/v1/accounting/docs/disbursements')
      .set(h)
      .send({
        ...pre,
        lines: [
          { description: 'CUSTOMS PROCESSING FEE', qty: 1, unitPrice: '18.75' },
          { description: 'LOLO', qty: '2', unitPrice: '1.25' },
        ],
      });
    expect(res.body).toMatchObject({ number: 'DIS001' });
    expect(res.body.totals).toMatchObject({ total: '21.25', vat: '0.00', totalKhr: '85638' });
  });

  it('debit notes take the ledger number (one per shipment); credit notes and record summaries prefill from the ledger', async () => {
    const h = await as('ACCOUNTANT');
    const rec = await ledgerRow();
    const dnPre = (
      await request(app)
        .get('/api/v1/accounting/docs/debit-notes/prefill')
        .query({ recordId: rec.id })
        .set(h)
    ).body;
    expect(
      (await request(app).post('/api/v1/accounting/docs/debit-notes').set(h).send(dnPre)).body
        .number,
    ).toBe('JR2608001');
    expect(
      (await request(app).post('/api/v1/accounting/docs/debit-notes').set(h).send(dnPre)).status,
    ).toBe(409);

    const cnPre = (
      await request(app)
        .get('/api/v1/accounting/docs/credit-notes/prefill')
        .query({ recordId: rec.id })
        .set(h)
    ).body;
    // The broker's voucher bills Grateful Solutions, with the usual charges to price.
    expect(cnPre.billTo).toMatch(/GRATEFUL SOLUTIONS/);
    expect(cnPre.lines.map((l: { description: string }) => l.description)).toEqual([
      'EXPORT-CLEARANCE',
      'TRUCKING',
      'CUSTOMS ACC',
      'CUSTOM PROCESSING FEE',
      'LOLO',
    ]);
    const prices = ['115', '280', '10', '18.75', '62.70'];
    cnPre.lines.forEach((l: { unitPrice: string }, i: number) => (l.unitPrice = prices[i]!));
    const cn = await request(app).post('/api/v1/accounting/docs/credit-notes').set(h).send(cnPre);
    expect(cn.body).toMatchObject({ number: 'CN26-002' });
    expect(cn.body.totals.total).toBe('486.45');
    // Submitted, then checked: the total becomes the declaration's Clear Fee.
    await request(app)
      .post(`/api/v1/accounting/docs/credit-notes/${cn.body.id}/issue`)
      .set(h)
      .expect(200);
    const fee = async () =>
      (await request(app).get(`/api/v1/accounting/ledger/${rec.id}`).set(h)).body.clearFee;
    expect(await fee()).toBe('982.45');
    await request(app)
      .patch(`/api/v1/accounting/docs/credit-notes/${cn.body.id}/review`)
      .set(h)
      .send({ reviewStatus: 'CHECKED' })
      .expect(200);
    expect(await fee()).toBe('486.45');

    // Checked, so numbered: the shipment waits in the Record Summary picker until it has one.
    const waiting = async () =>
      (await request(app).get('/api/v1/accounting/eligible/record-summaries').set(h)).body.map(
        (r: { recordId: string }) => r.recordId,
      );
    expect(await waiting()).toContain(rec.id);
    const rsPre = (
      await request(app)
        .get('/api/v1/accounting/docs/record-summaries/prefill')
        .query({ recordId: rec.id })
        .set(h)
    ).body;
    const rs = await request(app)
      .post('/api/v1/accounting/docs/record-summaries')
      .set(h)
      .send(rsPre);
    expect(rs.status).toBe(201);
    expect(rs.body.totals.total).toBe('1540.25');
    expect(rs.body.header).toMatchObject({
      direction: 'EXPORT',
      loadType: 'FCL',
      declareNo: 'I 122050',
      containerSize: '40HQ',
    });
    expect(await waiting()).not.toContain(rec.id);
    const list = await request(app).get('/api/v1/accounting/docs/record-summaries').set(h);
    expect(list.body.data[0]).toMatchObject({
      direction: 'EXPORT',
      invNo: rs.body.header.invNo,
      dnNo: rs.body.header.dnNo,
      quantityText: rs.body.header.quantityText,
    });
    // INV / DIS / DN are the ledger's: a typed one is ignored, and a correction there shows.
    const ledgerInv = rs.body.header.invNo;
    expect(ledgerInv).toBeTruthy();
    await request(app)
      .put(`/api/v1/accounting/docs/record-summaries/${rs.body.id}`)
      .set(h)
      .send({ ...rsPre, invNo: 'TYPED-1', disNo: 'TYPED-2', dnNo: 'TYPED-3' })
      .expect(200);
    const rsDoc = async () =>
      (await request(app).get(`/api/v1/accounting/docs/record-summaries/${rs.body.id}`).set(h))
        .body;
    expect((await rsDoc()).header).toMatchObject({
      invNo: ledgerInv,
      disNo: rs.body.header.disNo,
      dnNo: rs.body.header.dnNo,
    });
    await pool.query(`UPDATE accounting_records SET inv_no = 'GS26-999' WHERE id = $1`, [rec.id]);
    expect((await rsDoc()).header.invNo).toBe('GS26-999');
    expect(
      (await request(app).get('/api/v1/accounting/docs/record-summaries').set(h)).body.data[0]
        .invNo,
    ).toBe('GS26-999');
    // Credit-Noted-style filters: shipment, year, month of any year.
    const count = async (query: Record<string, string | number>) =>
      (await request(app).get('/api/v1/accounting/docs/record-summaries').query(query).set(h)).body
        .meta.total;
    const [y, m] = rs.body.date.split('-').map(Number);
    expect(await count({ direction: 'EXPORT', year: y, monthOfYear: m })).toBe(1);
    expect(await count({ direction: 'IMPORT' })).toBe(0);
    expect(await count({ year: y - 1 })).toBe(0);
    expect(await count({ monthOfYear: (m % 12) + 1 })).toBe(0);
  });

  it('ignores a typed number, refuses a second invoice and a ledger row from another client', async () => {
    const h = await as('ACCOUNTANT');
    const rec = await ledgerRow();
    const pre = (
      await request(app)
        .get('/api/v1/accounting/docs/tax-invoices/prefill')
        .query({ recordId: rec.id })
        .set(h)
    ).body;
    const first = await request(app)
      .post('/api/v1/accounting/docs/tax-invoices')
      .set(h)
      .send({ ...pre, invoiceNo: 'gs26-212' });
    expect(first.body.number).toBe('GS26-001');
    const dup = await request(app)
      .post('/api/v1/accounting/docs/tax-invoices')
      .set(h)
      .send({ ...pre, invoiceNo: 'GS26-212' });
    expect(dup.status).toBe(409);
    expect(dup.body.error.message).toContain('GS26-001');
    const wrong = await request(app)
      .post('/api/v1/accounting/docs/tax-invoices')
      .set(h)
      .send({ ...pre, clientId: b.jyx.id });
    expect(wrong.status).toBe(422);
  });

  it('lists documents with filters and exports one to Excel', async () => {
    const h = await as('ACCOUNTANT');
    const rec = await ledgerRow();
    const pre = (
      await request(app)
        .get('/api/v1/accounting/docs/tax-invoices/prefill')
        .query({ recordId: rec.id })
        .set(h)
    ).body;
    const doc = (await request(app).post('/api/v1/accounting/docs/tax-invoices').set(h).send(pre))
      .body;
    const list = await request(app)
      .get('/api/v1/accounting/docs/tax-invoices')
      .query({ month: '2026-08', q: 'GS26' })
      .set(h);
    expect(list.body.data[0]).toMatchObject({
      number: 'GS26-001',
      clientCode: 'JR',
      declareNo: 'I 122050',
      total: '203.50',
      status: 'DRAFT',
    });
    expect(
      (
        await request(app)
          .get('/api/v1/accounting/docs/tax-invoices')
          .query({ status: 'ISSUED' })
          .set(h)
      ).body.meta.total,
    ).toBe(0);
    const x = await request(app)
      .get(`/api/v1/accounting/docs/tax-invoices/${doc.id}/export.xlsx`)
      .set(h);
    expect(x.status).toBe(200);
    expect(x.headers['content-disposition']).toContain('GS26-001');
    expect((await request(app).get('/api/v1/accounting/docs/nope').set(h)).status).toBe(400);
  });
});

describe('credit note charge descriptions', () => {
  it('"+ Add New Item" adds to the Charge list once; viewers cannot', async () => {
    const h = await as('CUSTOMS_BROKER');
    const add = (label: string, who = h) =>
      request(app).post('/api/v1/lookups/charges').set(who).send({ label });
    expect((await add(' Overtime clearance ')).status).toBe(201);
    expect((await add('OVERTIME CLEARANCE')).status).toBe(200); // already there
    const charges = (await request(app).get('/api/v1/lookups').set(h)).body.values.CHARGE;
    expect(charges.filter((c: { label: string }) => c.label === 'OVERTIME CLEARANCE')).toHaveLength(
      1,
    );
    expect((await add('Something', await as('VIEWER'))).status).toBe(403);

    // Units work the same way, into the Charge units list.
    const unit = await request(app)
      .post('/api/v1/lookups/charge-units')
      .set(h)
      .send({ label: 'pallet' });
    expect(unit.status).toBe(201);
    expect(unit.body).toEqual({ value: 'PALLET', label: 'PALLET' });
    const units = (await request(app).get('/api/v1/lookups').set(h)).body.values.CHARGE_UNIT;
    expect(units.map((u: { label: string }) => u.label)).toContain('PALLET');
  });
});

describe('customs broker: Credit Noted only', () => {
  it('drafts and submits credit notes; checking puts them in the ledger; sees no other accounting', async () => {
    const declId = await declaration(b.jr.id, 'I 122050', '2026-08-21', 'IMPORT');
    const h = await as('CUSTOMS_BROKER');
    const acc = await as('ACCOUNTANT');
    const api = (m: 'get' | 'post', path: string) =>
      request(app)[m](`/api/v1/accounting${path}`).set(h);

    // The rest of accounting is closed; shipments are readable.
    expect((await api('get', '/ledger')).status).toBe(403);
    expect((await api('get', '/docs/tax-invoices')).status).toBe(403);
    expect((await request(app).get('/api/v1/shipments').set(h)).status).toBe(200);

    const decls = (await api('get', '/credit-notes/declarations')).body;
    expect(decls.map((d: { declareNo: string }) => d.declareNo)).toEqual(['I 122050']);
    const draft = (await api('get', '/docs/credit-notes/prefill').query({ declarationId: declId }))
      .body;
    expect(draft).toMatchObject({ declareNo: 'I 122050', accountingRecordId: '' });
    expect(draft.lines[0]).toMatchObject({ description: 'IMPORT-CLEARANCE', unit: "40'" });
    draft.lines = [{ description: 'IMPORT-CLEARANCE', qty: '1', unit: "40'", unitPrice: '115' }];
    const cn = await api('post', '/docs/credit-notes').send(draft);
    expect(cn.status).toBe(201);

    // The broker's list shows the draft with its shipment details.
    const mine = async () => (await api('get', '/credit-notes/list')).body.data[0];
    expect(await mine()).toMatchObject({
      declareNo: 'I 122050',
      direction: 'IMPORT',
      clientCode: 'JR',
      total: '115.00',
      status: 'DRAFT',
    });

    // Submitted: it waits for accounting's check before it reaches the Monthly Ledger.
    expect((await api('post', `/docs/credit-notes/${cn.body.id}/issue`)).status).toBe(200);
    expect((await mine()).status).toBe('ISSUED');
    expect(
      (await api('get', '/credit-notes/list').query({ status: 'DRAFT' })).body.data,
    ).toHaveLength(0);
    const ledger = () =>
      request(app).get('/api/v1/accounting/ledger').query({ year: '2026' }).set(acc);

    // Voiding a submitted credit note stays with accounting.
    expect(
      (await api('post', `/docs/credit-notes/${cn.body.id}/void`).send({ reason: 'wrong' })).status,
    ).toBe(403);

    // Accounting checks it; the broker can't see or change that.
    expect((await api('get', '/credit-notes/review')).status).toBe(403);
    const review = () =>
      request(app).get('/api/v1/accounting/credit-notes/review').query({ year: 2026 }).set(acc);
    let list = (await review()).body;
    expect(list.counts).toEqual({ total: 1, checked: 0, unchecked: 1, revised: 0 });
    expect(list.data[0]).toMatchObject({
      declareNo: 'I 122050',
      clientCode: 'JR',
      direction: 'IMPORT',
      total: '115.00',
      reviewStatus: 'UNCHECKED',
    });
    const mark = (who: Record<string, string>) =>
      request(app)
        .patch(`/api/v1/accounting/docs/credit-notes/${cn.body.id}/review`)
        .set(who)
        .send({ reviewStatus: 'CHECKED' });
    expect((await mark(h)).status).toBe(403);
    expect((await ledger()).body.data).toHaveLength(0);
    expect((await mark(acc)).status).toBe(200);
    // Checked: in the Monthly Ledger with the clear fee and its numbers.
    expect((await ledger()).body.data[0]).toMatchObject({
      declareNo: 'I 122050',
      clearFee: '115.00',
      invNo: 'GS26-001',
      disNo: 'DIS001',
      dnNo: 'JR2608001',
    });
    list = (await review()).body;
    expect(list.counts).toMatchObject({ checked: 1, unchecked: 0 });
    expect((await review().query({ review: 'UNCHECKED' })).body.data).toHaveLength(0);
    expect((await review().query({ q: 'I122050', direction: 'IMPORT' })).body.data).toHaveLength(1);

    // "Checked" lands in the broker's inbox.
    const inbox = async () => (await api('get', '/credit-notes/inbox')).body;
    let box = await inbox();
    expect(box.unread).toBe(1);
    expect(box.data[0]).toMatchObject({ kind: 'CHECKED', declareNo: 'I 122050', readAt: null });

    // "Revised" needs a message, sends the note back as a draft and takes the fee out.
    const revise = (body: object) =>
      request(app)
        .patch(`/api/v1/accounting/docs/credit-notes/${cn.body.id}/review`)
        .set(acc)
        .send({ reviewStatus: 'REVISED', ...body });
    expect((await revise({})).status).toBe(400);
    expect((await revise({ message: 'LOLO should be 62.70' })).status).toBe(200);
    expect((await mine()).status).toBe('DRAFT');
    const fee = async () =>
      (await request(app).get('/api/v1/accounting/ledger').query({ year: '2026' }).set(acc)).body
        .data[0].clearFee;
    expect(await fee()).toBe('0.00');
    // Accounting still sees it, as Revised.
    expect((await review()).body.counts).toMatchObject({ total: 1, revised: 1 });

    box = await inbox();
    expect(box.unread).toBe(2);
    expect(box.data[0]).toMatchObject({ kind: 'REVISED', body: 'LOLO should be 62.70' });
    const msgs = (await api('get', `/docs/credit-notes/${cn.body.id}/messages`)).body;
    expect(msgs[0].kind).toBe('REVISED');

    // The broker fixes it and submits again: Unchecked for accounting, then checked again.
    const doc = (await api('get', `/docs/credit-notes/${cn.body.id}`)).body;
    const fixed = await request(app)
      .put(`/api/v1/accounting/docs/credit-notes/${cn.body.id}`)
      .set(h)
      .send({
        ...doc.header,
        clientId: doc.clientId,
        accountingRecordId: doc.accountingRecordId,
        lines: [
          { description: 'IMPORT-CLEARANCE', qty: '1', unit: "40'", unitPrice: '115' },
          { description: 'LOLO', qty: '1', unit: "40'", unitPrice: '62.70' },
        ],
      });
    expect(fixed.status).toBe(200);
    expect((await api('post', `/docs/credit-notes/${cn.body.id}/issue`)).status).toBe(200);
    expect(await fee()).toBe('0.00');
    expect((await review()).body.data[0]).toMatchObject({
      reviewStatus: 'UNCHECKED',
      total: '177.70',
    });
    expect((await mark(acc)).status).toBe(200);
    expect(await fee()).toBe('177.70');
    // Its numbers stay the same.
    expect((await ledger()).body.data[0].invNo).toBe('GS26-001');

    // Reading messages clears the badge.
    // Checked, Revised, Checked again: three messages.
    await api('post', '/credit-notes/inbox/read').send({ messageId: box.data[0].id });
    expect((await inbox()).unread).toBe(2);
    await api('post', '/credit-notes/inbox/read').send({});
    expect((await inbox()).unread).toBe(0);
  });

  it("accounting's remarks reach the broker even when someone else created the note", async () => {
    const declId = await declaration(b.jr.id, 'I 95120', '2026-09-19', 'IMPORT');
    const admin = await as('ADMIN');
    const broker = await as('CUSTOMS_BROKER');
    const draft = (
      await request(app)
        .get('/api/v1/accounting/docs/credit-notes/prefill')
        .query({ declarationId: declId })
        .set(admin)
    ).body;
    draft.lines = [{ description: 'LOLO', qty: '1', unit: 'SHIP', unitPrice: '50' }];
    const cn = await request(app)
      .post('/api/v1/accounting/docs/credit-notes')
      .set(admin)
      .send(draft);
    await request(app).post(`/api/v1/accounting/docs/credit-notes/${cn.body.id}/issue`).set(admin);
    await request(app)
      .patch(`/api/v1/accounting/docs/credit-notes/${cn.body.id}/review`)
      .set(admin)
      .send({ reviewStatus: 'REVISED', message: 'LOLO should be 62.70' });

    const box = (await request(app).get('/api/v1/accounting/credit-notes/inbox').set(broker)).body;
    expect(box.unread).toBe(1);
    expect(box.data[0]).toMatchObject({
      kind: 'REVISED',
      body: 'LOLO should be 62.70',
      declareNo: 'I 95120',
      direction: 'IMPORT',
      clientName: expect.any(String),
      total: '50.00',
      status: 'DRAFT',
    });
    // The sender doesn't message themselves.
    expect(
      (await request(app).get('/api/v1/accounting/credit-notes/inbox').set(admin)).body.unread,
    ).toBe(0);
  });
});
