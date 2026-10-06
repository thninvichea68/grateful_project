import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type { RoleCode } from '@gs/shared';
import { createApp } from '../app';
import { pool } from '../db/client';
import { createUser, refreshCookieFrom, resetDb, seedBasics, TEST_PASSWORD } from '../test/helpers';

const app = createApp();
let b: Awaited<ReturnType<typeof seedBasics>>;
let tokens: Partial<Record<RoleCode, string>> = {};
let ids: Partial<Record<RoleCode, string>> = {};
async function as(role: RoleCode) {
  if (!tokens[role]) {
    const u = await createUser(role);
    ids[role] = u.id;
    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: u.email, password: TEST_PASSWORD });
    tokens[role] = res.body.accessToken as string;
  }
  return { Authorization: `Bearer ${tokens[role]}` };
}
const api = (m: 'get' | 'post' | 'patch' | 'put' | 'delete', path: string) =>
  request(app)[m](`/api/v1${path}`);

beforeEach(async () => {
  await resetDb();
  tokens = {};
  ids = {};
  b = await seedBasics();
});
afterAll(async () => {
  await pool.end();
});

describe('staff & roles', () => {
  const newStaff = {
    email: 'Sreyneang@GS.local',
    fullName: 'Sreyneang Phal',
    role: 'OPERATOR',
    jobTitle: 'Clearance Officer',
    department: 'Operations',
    password: 'Welcome-2026',
  };

  it('admin adds a staff member who can then sign in; weak passwords and duplicates are refused', async () => {
    const h = await as('ADMIN');
    expect(
      (
        await api('post', '/staff')
          .set(h)
          .send({ ...newStaff, password: 'short' })
      ).status,
    ).toBe(400);
    const res = await api('post', '/staff').set(h).send(newStaff);
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      email: 'sreyneang@gs.local',
      role: 'OPERATOR',
      jobTitle: 'Clearance Officer',
      isActive: true,
    });
    expect(JSON.stringify(res.body)).not.toContain('password');
    expect((await api('post', '/staff').set(h).send(newStaff)).status).toBe(409);
    const login = await api('post', '/auth/login').send({
      email: 'sreyneang@gs.local',
      password: 'Welcome-2026',
    });
    expect(login.body.user.role).toBe('OPERATOR');
  });

  it('managers can view staff but not manage it', async () => {
    expect((await api('get', '/staff').set(await as('MANAGER'))).status).toBe(200);
    expect(
      (
        await api('post', '/staff')
          .set(await as('MANAGER'))
          .send(newStaff)
      ).status,
    ).toBe(403);
    expect((await api('get', '/staff').set(await as('VIEWER'))).status).toBe(403); // Viewers don't see the staff list
  });

  it('deactivating signs the person out everywhere', async () => {
    const h = await as('ADMIN');
    const s = (await api('post', '/staff').set(h).send(newStaff)).body;
    const login = await api('post', '/auth/login').send({
      email: 'sreyneang@gs.local',
      password: 'Welcome-2026',
    });
    const cookie = refreshCookieFrom(login.headers['set-cookie']);
    await api('patch', `/staff/${s.id}`).set(h).send({ status: 'INACTIVE' });
    expect((await api('post', '/auth/refresh').set('Cookie', cookie!)).status).toBe(401);
    expect(
      (
        await api('post', '/auth/login').send({
          email: 'sreyneang@gs.local',
          password: 'Welcome-2026',
        })
      ).status,
    ).toBe(401);
  });

  it('protects against lock-out: own role, own account, last admin', async () => {
    const h = await as('ADMIN');
    expect((await api('patch', `/staff/${ids.ADMIN}`).set(h).send({ role: 'VIEWER' })).status).toBe(
      422,
    );
    expect(
      (await api('patch', `/staff/${ids.ADMIN}`).set(h).send({ status: 'INACTIVE' })).status,
    ).toBe(422);
    expect((await api('delete', `/staff/${ids.ADMIN}`).set(h)).status).toBe(422);
    const other = (
      await api('post', '/staff')
        .set(h)
        .send({ ...newStaff, role: 'ADMIN' })
    ).body;
    expect((await api('patch', `/staff/${other.id}`).set(h).send({ role: 'MANAGER' })).status).toBe(
      200,
    ); // another admin still exists
  });

  it('admin resets a password; role permissions can be edited (not Admin)', async () => {
    const h = await as('ADMIN');
    const s = (await api('post', '/staff').set(h).send(newStaff)).body;
    expect(
      (await api('post', `/staff/${s.id}/reset-password`).set(h).send({ password: 'Another-2026' }))
        .status,
    ).toBe(204);
    expect(
      (
        await api('post', '/auth/login').send({
          email: 'sreyneang@gs.local',
          password: 'Another-2026',
        })
      ).status,
    ).toBe(200);
    expect((await api('put', '/staff/roles/ADMIN').set(h).send({ permissions: [] })).status).toBe(
      422,
    );
    const roles = await api('put', '/staff/roles/VIEWER')
      .set(h)
      .send({ permissions: ['dashboard:read', 'shipments:read', 'not:real'] });
    expect(roles.status).toBe(400);
    const ok = await api('put', '/staff/roles/VIEWER')
      .set(h)
      .send({ permissions: ['dashboard:read', 'shipments:read'] });
    expect(ok.body.find((r: { code: string }) => r.code === 'VIEWER').permissions).toEqual([
      'dashboard:read',
      'shipments:read',
    ]);
  });

  it('everyone can change their own password', async () => {
    const h = await as('VIEWER');
    expect(
      (
        await api('post', '/auth/change-password')
          .set(h)
          .send({ currentPassword: 'wrong', newPassword: 'NewPass-2026' })
      ).status,
    ).toBe(401);
    expect(
      (
        await api('post', '/auth/change-password')
          .set(h)
          .send({ currentPassword: TEST_PASSWORD, newPassword: 'NewPass-2026' })
      ).status,
    ).toBe(204);
    expect(
      (
        await api('post', '/auth/login').send({
          email: 'viewer@test.local',
          password: 'NewPass-2026',
        })
      ).status,
    ).toBe(200);
  });
});

describe('settings', () => {
  it('company details, exchange rates (used by new ledger rows) and lists', async () => {
    const h = await as('ADMIN');
    expect(
      (
        await api('put', '/settings/company')
          .set(h)
          .send({ nameEn: 'GRATEFUL SOLUTIONS (CAMBODIA) CO., LTD.', phone: '098 484 414' })
      ).status,
    ).toBe(200);
    expect((await api('get', '/meta/company').set(await as('VIEWER'))).body.phone).toBe(
      '098 484 414',
    );
    await api('post', '/settings/exchange-rates')
      .set(h)
      .send({ effectiveDate: '2026-10-01', usdToKhr: '4019' });
    await api('post', '/settings/exchange-rates')
      .set(h)
      .send({ effectiveDate: '2026-10-01', usdToKhr: '4021' }); // same date → updates
    const all = await api('get', '/settings').set(h);
    expect(all.body.exchangeRates).toEqual([
      expect.objectContaining({ effectiveDate: '2026-10-01', usdToKhr: '4021.0000' }),
    ]);
    expect(
      (
        await api('post', '/settings/ports').set(h).send({
          code: 'pnh19',
          customsPortNo: '19',
          name: 'Tecsrun Dry Port',
          shortName: 'tecsrun',
          kind: 'DRY',
        })
      ).body,
    ).toMatchObject({ code: 'PNH19', shortName: 'TECSRUN' });
    const fw = (await api('post', '/settings/forwarders').set(h).send({ name: 'Hippo Logistics' }))
      .body;
    expect(
      (await api('patch', `/settings/forwarders/${fw.id}`).set(h).send({ isActive: false })).body
        .isActive,
    ).toBe(false);
    const lv = (
      await api('post', '/settings/lookups').set(h).send({ type: 'QUANTITY_UNIT', value: 'DRUMS' })
    ).body;
    expect(lv).toMatchObject({ value: 'DRUMS', label: 'DRUMS' });
    expect((await api('get', '/lookups').set(h)).body.values.QUANTITY_UNIT).toEqual([
      { value: 'DRUMS', label: 'DRUMS' },
    ]);
    expect(
      (await api('get', '/lookups').set(h)).body.forwarders.map((f: { name: string }) => f.name),
    ).not.toContain('Hippo Logistics');
  });

  it('only admins manage settings', async () => {
    expect((await api('get', '/settings').set(await as('MANAGER'))).status).toBe(200);
    expect(
      (
        await api('put', '/settings/company')
          .set(await as('MANAGER'))
          .send({ nameEn: 'X Co' })
      ).status,
    ).toBe(403);
  });
});

describe('follow-ups', () => {
  it('creates with a reference, flags overdue, completes and filters', async () => {
    const h = await as('OPERATOR');
    const late = (
      await api('post', '/follow-ups').set(h).send({
        subject: 'Customs duty verification',
        clientId: b.jr.id,
        dueAt: '2026-01-05T17:00',
        priority: 'HIGH',
      })
    ).body;
    const soon = (
      await api('post', '/follow-ups').set(h).send({ subject: 'Confirm ATA', dueAt: '2099-01-01' })
    ).body;
    expect(late).toMatchObject({
      reference: 'FLW-0001',
      clientName: 'JR Apparel Corp',
      overdue: true,
      status: 'OPEN',
      dueAt: '2026-01-05T10:00:00.000Z',
    });
    expect(soon).toMatchObject({ reference: 'FLW-0002', overdue: false });
    expect(
      (await api('get', '/follow-ups').query({ overdue: 'true' }).set(h)).body.data.map(
        (f: { reference: string }) => f.reference,
      ),
    ).toEqual(['FLW-0001']);
    expect((await api('get', '/meta/nav-counts').set(h)).body).toMatchObject({
      openFollowUps: 2,
      overdueFollowUps: 1,
    });
    const done = (await api('patch', `/follow-ups/${late.id}`).set(h).send({ status: 'DONE' }))
      .body;
    expect(done).toMatchObject({ status: 'DONE', overdue: false, completedAt: expect.any(String) });
    expect(
      (await api('get', '/follow-ups').query({ status: 'ACTIVE' }).set(h)).body.meta.total,
    ).toBe(1);
    expect(
      (
        await api('post', '/follow-ups')
          .set(await as('VIEWER'))
          .send({ subject: 'x x x', dueAt: '2026-01-01' })
      ).status,
    ).toBe(403);
  });
});

describe('documents', () => {
  it('uploads, lists, downloads and soft-deletes; rejects unsafe files', async () => {
    const h = await as('OPERATOR');
    const pdf = Buffer.from('%PDF-1.4\n% test document\n');
    const up = await api('post', '/documents')
      .set(h)
      .field('title', 'BL — SHP test')
      .field('category', 'BILL_OF_LADING')
      .field('clientId', b.jr.id)
      .attach('file', pdf, { filename: 'bill of lading.pdf', contentType: 'application/pdf' });
    expect(up.status).toBe(201);
    expect(up.body).toMatchObject({
      title: 'BL — SHP test',
      category: 'BILL_OF_LADING',
      clientName: 'JR Apparel Corp',
      sizeBytes: pdf.length,
      uploadedBy: 'Test OPERATOR',
    });
    const bad = await api('post', '/documents').set(h).attach('file', Buffer.from('MZ...'), {
      filename: 'invoice.exe',
      contentType: 'application/octet-stream',
    });
    expect(bad.status).toBe(400);
    expect(
      (
        await api('get', '/documents')
          .query({ category: 'BILL_OF_LADING' })
          .set(await as('VIEWER'))
      ).body.meta.total,
    ).toBe(1);
    const dl = await api('get', `/documents/${up.body.id}/download`)
      .set(await as('VIEWER'))
      .buffer(true)
      .parse((r, cb) => {
        const c: Buffer[] = [];
        r.on('data', (x: Buffer) => c.push(x));
        r.on('end', () => cb(null, Buffer.concat(c)));
      });
    expect(dl.status).toBe(200);
    expect(dl.headers['content-disposition']).toBe(
      "attachment; filename*=UTF-8''bill%20of%20lading.pdf",
    );
    expect(dl.headers['x-content-type-options']).toBe('nosniff');
    expect((dl.body as Buffer).equals(pdf)).toBe(true);
    expect((await api('delete', `/documents/${up.body.id}`).set(await as('VIEWER'))).status).toBe(
      403,
    );
    expect((await api('delete', `/documents/${up.body.id}`).set(h)).status).toBe(204);
    expect((await api('get', `/documents/${up.body.id}/download`).set(h)).status).toBe(404);
  });
});

describe('quotations', () => {
  const body = (templateKey: string) => ({
    templateKey,
    clientId: null,
    toName: 'Sportline Apparel (Cambodia)',
    attn: 'Ms. Dara',
    quoteDate: '2026-10-06',
    paymentTermDays: 7,
    latePenaltyPctPerDay: '0.5',
    lines: [
      { c0: 'IMPORT PROCESSING FEE', c1: 'USD', c2: '180', c3: '200', c4: '150', c5: '' },
      { c0: 'LOLO AT PORT', c1: 'USD', c2: 'As per receipt', c3: '', c4: '', c5: '' },
    ],
  });

  it('templates come from quotation-system.html; drafts → sent → revise → v2, v1 superseded', async () => {
    const h = await as('ACCOUNTANT');
    const { db } = await import('../db/client');
    const { quotationTemplates } = await import('../db/schema');
    await db.insert(quotationTemplates).values({
      key: 'import_sih',
      label: 'Import SIH port & dry port',
      docTitle: 'QUOTATION — IMPORT',
      sortOrder: 0,
      notes: null,
      defaultRows: [],
      columns: [
        { key: 'c0', label: 'Description', type: 'wide' },
        { key: 'c1', label: 'Cur', type: 'text' },
        { key: 'c2', label: "20'GP", type: 'num' },
        { key: 'c3', label: "40'H", type: 'num' },
        { key: 'c4', label: 'LCL', type: 'num' },
        { key: 'c5', label: 'Remark', type: 'remark' },
      ],
    });
    expect((await api('get', '/quotations/templates').set(h)).body[0].columns).toHaveLength(6);
    const q = (await api('post', '/quotations').set(h).send(body('import_sih'))).body;
    expect(q).toMatchObject({
      quoteNo: 'Q26-001',
      version: 1,
      status: 'DRAFT',
      docTitle: 'QUOTATION — IMPORT',
    });
    expect(q.lines[1].c2).toBe('As per receipt');
    expect((await api('post', `/quotations/${q.id}/revise`).set(h)).status).toBe(409); // drafts are edited, not revised
    await api('post', `/quotations/${q.id}/status`).set(h).send({ status: 'SENT' });
    expect((await api('put', `/quotations/${q.id}`).set(h).send(body('import_sih'))).status).toBe(
      409,
    );
    const v2 = (await api('post', `/quotations/${q.id}/revise`).set(h)).body;
    expect(v2).toMatchObject({ quoteNo: 'Q26-001', version: 2, status: 'DRAFT' });
    expect(
      v2.versions.map((v: { version: number; status: string }) => [v.version, v.status]),
    ).toEqual([
      [2, 'DRAFT'],
      [1, 'SUPERSEDED'],
    ]);
    const latest = (await api('get', '/quotations').query({ latestOnly: 'true' }).set(h)).body.data;
    expect(latest.map((r: { version: number }) => r.version)).toEqual([2]);
    expect(
      (
        await api('post', '/quotations')
          .set(await as('OPERATOR'))
          .send(body('import_sih'))
      ).status,
    ).toBe(403);
    expect((await api('post', '/quotations').set(h).send(body('nope'))).status).toBe(422);
  });
});

describe('operations', () => {
  it('declaration register with ledger status', async () => {
    const h = await as('ADMIN');
    await api('post', '/shipments')
      .set(h)
      .send({
        clientId: b.jr.id,
        direction: 'IMPORT',
        transportMode: 'SEA',
        loadType: 'LCL',
        eta: '2026-09-01',
        clearancePortId: b.port.id,
        declarations: [{ declareNo: 'I 1001', declareDate: '2026-09-02', portId: b.port.id }],
      });
    const res = await api('get', '/operations/declarations')
      .query({ ledger: 'without' })
      .set(await as('OPERATOR'));
    expect(res.body.data[0]).toMatchObject({
      declareNo: 'I 1001',
      portCode: 'SHV11',
      clientCode: 'JR',
      ledgerId: null,
      documents: 0,
      cdcLines: 0,
    });
    expect(
      (await api('get', '/operations/declarations').query({ ledger: 'with' }).set(h)).body.meta
        .total,
    ).toBe(0);
  });
});
