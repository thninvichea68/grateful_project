import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type { RoleCode } from '@gs/shared';
import { createApp } from '../../app';
import { db, pool } from '../../db/client';
import { accountingRecords, ports } from '../../db/schema';
import { createUser, resetDb, seedBasics, TEST_PASSWORD } from '../../test/helpers';
import { previousPeriod } from './service';

const app = createApp();
let b: Awaited<ReturnType<typeof seedBasics>>;
let tokens: Partial<Record<RoleCode, string>> = {};
let airport: { id: string };

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

async function ship(o: Record<string, unknown>) {
  const body = {
    clientId: b.jr.id,
    direction: 'IMPORT',
    transportMode: 'SEA',
    loadType: 'FCL',
    status: 'COMPLETED',
    clearanceStatus: 'CLEARED',
    forwarderId: b.fwd.id,
    clearancePortId: b.port.id,
    originCountryIso2: 'CN',
    destinationCountryIso2: 'KH',
    eta: '2026-03-10',
    invoices: [],
    declarations: [],
    ...o,
  };
  const res = await request(app)
    .post('/api/v1/shipments')
    .set(await as('ADMIN'))
    .send(body);
  if (res.status !== 201) throw new Error(JSON.stringify(res.body));
  return res.body as { id: string; declarations: { id: string }[] };
}

const get = async (
  path: string,
  query: Record<string, string | string[]> = {},
  role: RoleCode = 'VIEWER',
) =>
  request(app)
    .get(`/api/v1${path}`)
    .query(query)
    .set(await as(role));

beforeEach(async () => {
  await resetDb();
  tokens = {};
  b = await seedBasics();
  airport = (
    await db
      .insert(ports)
      .values({
        code: 'PNH01',
        customsPortNo: '1',
        name: 'Techo International Airport',
        shortName: 'KTI',
        kind: 'AIR',
      })
      .returning()
  )[0]!;
  // 2026: Mar → 2 imports (JR, one on time), 1 export (JYX, US); Apr → 1 air import (JYX); Dec → 1 planned export
  await ship({ ata: '2026-03-09', arriveFty: '2026-03-12' });
  await ship({
    eta: '2026-03-20',
    ata: '2026-03-25',
    loadType: 'LCL',
    status: 'EXCEPTION',
    clearanceStatus: 'EXCEPTION',
  });
  await ship({
    clientId: b.jyx.id,
    direction: 'EXPORT',
    destinationCountryIso2: 'US',
    originCountryIso2: 'KH',
    eta: '2026-03-28',
    status: 'IN_PROGRESS',
    clearanceStatus: 'IN_PROGRESS',
  });
  await ship({
    clientId: b.jyx.id,
    transportMode: 'AIR',
    loadType: 'NONE',
    clearancePortId: airport.id,
    eta: '2026-04-02',
  });
  await ship({
    direction: 'EXPORT',
    destinationCountryIso2: 'US',
    eta: '2026-12-01',
    status: 'PENDING',
    clearanceStatus: 'PENDING',
  });
});
afterAll(async () => {
  await pool.end();
});

const year = { from: '2026-01-01', to: '2026-12-31' };

describe('analytics endpoints (aggregated in SQL)', () => {
  it('monthly volume is zero-filled and split by direction', async () => {
    const res = await get('/analytics/monthly-volume', year);
    expect(res.body).toHaveLength(12);
    expect(res.body[0]).toEqual({ month: '2026-01', imports: 0, exports: 0, total: 0 });
    expect(res.body[2]).toEqual({ month: '2026-03', imports: 2, exports: 1, total: 3 });
    expect(res.body[3]).toMatchObject({ imports: 1, exports: 0 });
    expect(res.body[11]).toMatchObject({ imports: 0, exports: 1 });
  });

  it('KPIs compare with the previous period of the same length', async () => {
    const res = await get('/analytics/kpis', { from: '2026-04-01', to: '2026-04-30' });
    expect(res.body).toMatchObject({
      total: 1,
      imports: 1,
      exports: 0,
      cleared: 1,
      previousPeriod: { from: '2026-03-01', to: '2026-03-31' },
      previous: { total: 3, imports: 2, exports: 1, cleared: 1 },
    });
  });

  it('every filter narrows the data', async () => {
    expect(
      (await get('/analytics/transport-share', { ...year, clientId: b.jyx.id })).body,
    ).toMatchObject({ imports: 1, exports: 1, total: 2 });
    expect(
      (await get('/analytics/transport-share', { ...year, direction: 'EXPORT' })).body.total,
    ).toBe(2);
    expect(
      (await get('/analytics/transport-share', { ...year, transportMode: 'AIR' })).body.total,
    ).toBe(1);
    expect((await get('/analytics/transport-share', { ...year, loadType: 'LCL' })).body.total).toBe(
      1,
    );
    expect(
      (await get('/analytics/transport-share', { from: '2026-03-01', to: '2026-03-31' })).body
        .total,
    ).toBe(3);
  });

  it('clearance status lists every stage, including empty ones', async () => {
    const res = await get('/analytics/clearance-status', year);
    expect(res.body).toEqual([
      { status: 'CLEARED', count: 2 },
      { status: 'IN_PROGRESS', count: 1 },
      { status: 'PENDING', count: 1 },
      { status: 'EXCEPTION', count: 1 },
    ]);
  });

  it('countries: imports by origin, exports by destination', async () => {
    expect((await get('/analytics/by-country', { ...year, flow: 'import' })).body).toEqual([
      { iso2: 'CN', name: 'China', count: 3, pct: 100 },
    ]);
    expect((await get('/analytics/by-country', { ...year, flow: 'export' })).body).toEqual([
      { iso2: 'US', name: 'United States', count: 2, pct: 100 },
    ]);
  });

  it('forwarder on-time %, delay and factory deliveries', async () => {
    const [f] = (await get('/analytics/forwarders', year)).body;
    expect(f).toMatchObject({
      name: 'Maersk Logistics',
      shipments: 5,
      imports: 3,
      exports: 2,
      factory: 1,
      arrived: 2,
      onTimePct: 50,
      avgDelayDays: 2.5,
      exceptionPct: 20,
      clearedPct: 40,
    });
  });

  it('ports split imports and exports', async () => {
    const res = await get('/analytics/ports', year);
    expect(
      res.body.map((p: { shortName: string; imports: number; exports: number }) => [
        p.shortName,
        p.imports,
        p.exports,
      ]),
    ).toEqual([
      ['SIHANOUKVILLE', 2, 2],
      ['KTI', 1, 0],
    ]);
  });

  it('key accounts: total / CY / LCL / AIR per direction', async () => {
    const res = await get('/analytics/accounts', year);
    expect(res.body[0]).toMatchObject({
      code: 'JR',
      all: { total: 3, cy: 2, lcl: 1, air: 0 },
      import: { total: 2, cy: 1, lcl: 1, air: 0 },
      export: { total: 1, cy: 1, lcl: 0, air: 0 },
    });
    expect(res.body[1]).toMatchObject({ code: 'JYX', all: { total: 2, cy: 1, lcl: 0, air: 1 } });
  });

  it('rejects an inverted date range', async () => {
    const res = await get('/analytics/kpis', { from: '2026-05-01', to: '2026-04-01' });
    expect(res.status).toBe(400);
  });

  it('charts follow the data: create, edit and delete change the numbers', async () => {
    const before = (await get('/analytics/monthly-volume', year)).body[4];
    const s = await ship({ eta: '2026-05-15' });
    expect((await get('/analytics/monthly-volume', year)).body[4].total).toBe(before.total + 1);
    await request(app)
      .put(`/api/v1/shipments/${s.id}`)
      .set(await as('ADMIN'))
      .send({
        clientId: b.jr.id,
        direction: 'EXPORT',
        transportMode: 'SEA',
        loadType: 'FCL',
        destinationCountryIso2: 'US',
        eta: '2026-06-15',
      });
    const after = (await get('/analytics/monthly-volume', year)).body;
    expect(after[4].total).toBe(before.total);
    expect(after[5]).toMatchObject({ exports: 1 });
    await request(app)
      .delete(`/api/v1/shipments/${s.id}`)
      .set(await as('ADMIN'));
    expect((await get('/analytics/monthly-volume', year)).body[5].total).toBe(0);
  });
});

describe('overview and profit', () => {
  async function ledger(
    declarationId: string,
    clientId: string,
    invDate: string,
    netProfit: string,
  ) {
    await db
      .insert(accountingRecords)
      .values({ declarationId, clientId, invDate, exchangeRate: '4026', netProfit });
  }

  it('profit is only for accounting roles, grouped by client and month', async () => {
    const a = await ship({
      eta: '2026-02-10',
      declarations: [{ declareNo: 'I 1', declareDate: '2026-02-10' }],
    });
    const c = await ship({
      clientId: b.jyx.id,
      eta: '2026-02-12',
      declarations: [{ declareNo: 'I 2', declareDate: '2026-02-12' }],
    });
    await ledger(a.declarations[0]!.id, b.jr.id, '2026-02-11', '300.00');
    await ledger(c.declarations[0]!.id, b.jyx.id, '2026-02-13', '-100.00');

    expect((await get('/analytics/profit', { year: '2026' }, 'OPERATOR')).status).toBe(403);
    const res = await get('/analytics/profit', { year: '2026' }, 'ACCOUNTANT');
    expect(res.body.total).toBe('200.00');
    expect(res.body.monthly[1]).toEqual({ month: '2026-02', netProfit: '200.00' });
    expect(
      res.body.byClient.map((r: { code: string; netProfit: string }) => [r.code, r.netProfit]),
    ).toEqual([
      ['JR', '300.00'],
      ['JYX', '-100.00'],
    ]);

    const op = await get('/overview/summary', { year: '2026' }, 'OPERATOR');
    expect(op.body.profit).toBeUndefined();
    expect(op.body.monthly).toHaveLength(12);
    const acc = await get('/overview/summary', { year: '2026' }, 'ACCOUNTANT');
    expect(acc.body.profit.total).toBe('200.00');
    expect(acc.body.kpis.period.from).toMatch(/^\d{4}-\d{2}-01$/);
  });

  it('live consignments put exceptions first', async () => {
    const res = await get('/overview/live-consignments');
    expect(res.body[0]).toMatchObject({ status: 'EXCEPTION', clientCode: 'JR' });
    expect(res.body.every((r: { status: string }) => r.status !== 'COMPLETED')).toBe(true);
  });
});

describe('previousPeriod', () => {
  it.each([
    [
      { from: '2026-03-01', to: '2026-03-31' },
      { from: '2026-02-01', to: '2026-02-28' },
    ],
    [
      { from: '2026-01-01', to: '2026-01-31' },
      { from: '2025-12-01', to: '2025-12-31' },
    ],
    [
      { from: '2026-01-01', to: '2026-12-31' },
      { from: '2025-01-01', to: '2025-12-31' },
    ],
    [
      { from: '2026-03-10', to: '2026-03-19' },
      { from: '2026-02-28', to: '2026-03-09' },
    ],
  ])('%o → %o', (p, expected) => expect(previousPeriod(p)).toEqual(expected));
});
