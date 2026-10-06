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

describe('billing documents', () => {
  async function ledgerRow(clientId = b.jr.id, declareNo = 'I 122050', date = '2026-08-21') {
    const res = await request(app)
      .post('/api/v1/accounting/ledger')
      .set(await as('ACCOUNTANT'))
      .send({ declarationId: await declaration(clientId, declareNo, date), ...I122050 });
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
    expect(led.documents).toEqual([
      { type: 'tax-invoices', id, number: 'GS26-001', status: 'ISSUED' },
    ]);

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
    expect(led).toMatchObject({ invNo: null, invRevenue: '0.00', netProfit: '17.80' });

    const next = await request(app).post('/api/v1/accounting/docs/tax-invoices').set(h).send(pre);
    expect(next.body.number).toBe('GS26-002'); // numbers are never reused
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

  it('debit notes are numbered per client and month; credit notes and record summaries prefill from the ledger', async () => {
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
      (await request(app).post('/api/v1/accounting/docs/debit-notes').set(h).send(dnPre)).body
        .number,
    ).toBe('JR2608002');

    const cnPre = (
      await request(app)
        .get('/api/v1/accounting/docs/credit-notes/prefill')
        .query({ recordId: rec.id })
        .set(h)
    ).body;
    expect(
      cnPre.lines.map((l: { description: string; unitPrice: string }) => [
        l.description,
        l.unitPrice,
      ]),
    ).toEqual([
      ['CLEAR FEE', '982.45'],
      ['THC FEE', '355'],
    ]);
    const cn = await request(app).post('/api/v1/accounting/docs/credit-notes').set(h).send(cnPre);
    expect(cn.body).toMatchObject({ number: 'CN26-001' });
    expect(cn.body.totals.total).toBe('1337.45');

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
  });

  it('refuses a duplicate typed number and a ledger row from another client', async () => {
    const h = await as('ACCOUNTANT');
    const rec = await ledgerRow();
    const pre = (
      await request(app)
        .get('/api/v1/accounting/docs/tax-invoices/prefill')
        .query({ recordId: rec.id })
        .set(h)
    ).body;
    await request(app)
      .post('/api/v1/accounting/docs/tax-invoices')
      .set(h)
      .send({ ...pre, invoiceNo: 'gs26-212' });
    const dup = await request(app)
      .post('/api/v1/accounting/docs/tax-invoices')
      .set(h)
      .send({ ...pre, invoiceNo: 'GS26-212' });
    expect(dup.status).toBe(409);
    expect(dup.body.error.message).toContain('GS26-212');
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
