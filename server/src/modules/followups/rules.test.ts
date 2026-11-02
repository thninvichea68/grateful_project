import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { and, eq, isNull } from 'drizzle-orm';
import { FOLLOW_UP_RULES, type FollowUpRuleCode, type NavCounts } from '@gs/shared';
import { createApp } from '../../app';
import { db, pool } from '../../db/client';
import {
  cargoInvoices,
  containerSealPlans,
  containers,
  customsDeclarations,
  cutStockItems,
  followUps,
  shipments,
} from '../../db/schema';
import { createUser, resetDb, seedBasics, TEST_PASSWORD } from '../../test/helpers';
import { runFollowUpRules } from './rules';

const app = createApp();
let basics: Awaited<ReturnType<typeof seedBasics>>;
let operatorId: string;
let seq = 0;

/** The business date (Phnom Penh) `n` days from today, as YYYY-MM-DD. */
const day = (n: number) => {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Phnom_Penh' }).format(
    new Date(),
  );
  return new Date(Date.parse(today) + n * 86_400_000).toISOString().slice(0, 10);
};

type Ship = typeof shipments.$inferInsert;
async function ship(v: Partial<Ship> & Pick<Ship, 'direction'>) {
  const [s] = await db
    .insert(shipments)
    .values({
      reference: `SHP-T-${++seq}`,
      clientId: basics.jr.id,
      transportMode: 'SEA',
      loadType: 'LCL',
      hblNo: 'HBL1',
      bookingNo: 'BKG1',
      thcHblNo: 'THC1',
      createdById: operatorId,
      ...v,
    })
    .returning();
  return s!;
}
const declare = (shipmentId: string, declareDate: string, declareNo = `D-${++seq}`) =>
  db.insert(customsDeclarations).values({ shipmentId, declareNo, declareDate });
const invoice = (shipmentId: string) =>
  db.insert(cargoInvoices).values({ shipmentId, invoiceNo: `INV-${++seq}` });

/** Live follow-ups (open or dismissed, not closed by a check) of one rule. */
const live = (rule: FollowUpRuleCode) =>
  db
    .select()
    .from(followUps)
    .where(and(eq(followUps.rule, rule), isNull(followUps.autoResolvedAt)));

beforeEach(async () => {
  await resetDb();
  basics = await seedBasics();
  operatorId = (await createUser('OPERATOR')).id;
});
afterAll(async () => {
  await pool.end();
});

describe('follow-up checks', () => {
  it('raises each case for a matching record and leaves near misses alone', async () => {
    // IMPORT_ARRIVING: ETA in 2 days, undeclared (in 5 days is too early).
    const arriving = await ship({ direction: 'IMPORT', eta: day(2) });
    await invoice(arriving.id);
    const later = await ship({ direction: 'IMPORT', eta: day(5) });
    await invoice(later.id);
    // IMPORT_NOT_CLEARED: arrived 4 days ago; its declaration has no Declare No. yet.
    const stuck = await ship({ direction: 'IMPORT', eta: day(-4) });
    await declare(stuck.id, day(-1), '');
    // IMPORT_NOT_DELIVERED: cleared 5 days ago, no factory date.
    const undelivered = await ship({ direction: 'IMPORT', eta: day(-6) });
    await declare(undelivered.id, day(-5));
    // IMPORT_DOCS_MISSING: ETA in 6 days, no BL and no invoice.
    await ship({ direction: 'IMPORT', eta: day(6), hblNo: null });
    // EXPORT_BOOKING_MISSING: ETD in 5 days, no booking.
    const noBooking = await ship({ direction: 'EXPORT', etd: day(5), bookingNo: '' });
    await declare(noBooking.id, day(0));
    // EXPORT_NOT_DECLARED: ETD tomorrow, no declaration.
    await ship({ direction: 'EXPORT', etd: day(1) });
    // EXPORT_DEPARTURE_UNCONFIRMED: ETD 2 days ago, no ATD.
    const late = await ship({ direction: 'EXPORT', etd: day(-2) });
    await declare(late.id, day(-3));
    // EXPORT_DEPARTED_UNDECLARED: departed, never declared.
    await ship({ direction: 'EXPORT', etd: day(-20), atd: day(-20) });
    // EXPORT_CO_PENDING: departed 10 days ago, CO still pending (an approved one is fine).
    const coPending = await ship({
      direction: 'EXPORT',
      etd: day(-10),
      atd: day(-10),
      coForm: 'FORM D',
      coStatus: 'Pending',
    });
    await declare(coPending.id, day(-11));
    const coOk = await ship({
      direction: 'EXPORT',
      etd: day(-10),
      atd: day(-10),
      coForm: 'FORM D',
      coStatus: 'Approved',
    });
    await declare(coOk.id, day(-11));
    // CONTAINERS_MISSING: CY / CY sea import due in 4 days, no containers (one with a container is fine).
    const fcl = await ship({ direction: 'IMPORT', eta: day(4), loadType: 'FCL' });
    await invoice(fcl.id);
    const fclOk = await ship({ direction: 'IMPORT', eta: day(4), loadType: 'FCL' });
    await invoice(fclOk.id);
    await db.insert(containers).values({ shipmentId: fclOk.id, containerNo: 'MRKU8974303' });
    // THC_INVOICE_MISSING: sea import cleared 10 days ago and delivered, no THC no.
    const noThc = await ship({
      direction: 'IMPORT',
      eta: day(-11),
      arriveFty: day(-9),
      thcHblNo: null,
    });
    await declare(noThc.id, day(-10));
    // Seal Plan checks: export containers.
    const container = async (
      etdIn: number,
      seals: boolean,
      plan?: Partial<typeof containerSealPlans.$inferInsert>,
    ) => {
      const s = await ship({ direction: 'EXPORT', etd: day(etdIn), loadType: 'FCL' });
      const containerNo = `TEST${String(++seq).padStart(7, '0')}`;
      await db.insert(containers).values({
        shipmentId: s.id,
        containerNo,
        linerSeal: seals ? 'LS-1' : null,
        customsSeal: seals ? 'CS-1' : null,
      });
      if (plan)
        await db.insert(containerSealPlans).values({ shipmentId: s.id, containerNo, ...plan });
    };
    // SEAL_PLAN_NOT_SCHEDULED: ETD in 6 days, no loading date.
    await container(6, true);
    // SEAL_PLAN_SEALS_MISSING: loading in 2 days without seals.
    await container(4, false, {
      loadingDate: day(2),
      truckBy: 'GS Trucking',
      tareWeightKg: '3800',
    });
    // SEAL_PLAN_TRUCK_MISSING: loading tomorrow, no truck.
    await container(10, true, { loadingDate: day(1), tareWeightKg: '3800' });
    // SEAL_PLAN_TARE_MISSING: ETD in 5 days, loading planned, no tare weight.
    await container(5, true, { loadingDate: day(3), truckNo: '3A-1234' });
    // A ready container raises nothing.
    await container(5, true, { loadingDate: day(3), truckNo: '3A-5678', tareWeightKg: '3800' });
    // AIR_CUT_OFF: air export whose cut-off is tomorrow morning; one a week out waits.
    const air = await ship({
      direction: 'EXPORT',
      transportMode: 'AIR',
      loadType: 'NONE',
      cutOffAt: `${day(1)} 10:00`,
    });
    await ship({
      direction: 'EXPORT',
      transportMode: 'AIR',
      loadType: 'NONE',
      cutOffAt: `${day(7)} 10:00`,
    });
    // CDC_OVER_IMPORTED: opening imports above the licensed quantity.
    await db.insert(cutStockItems).values({
      clientId: basics.jr.id,
      lineNo: 1,
      declareRef: 'CDC-1',
      category: 'RAW_MATERIAL',
      name: 'Cotton fabric',
      unit: 'M',
      qty: '100',
      openingImportedQty: '120',
    });

    const run = await runFollowUpRules();
    const created = Object.fromEntries(run.rules.map((r) => [r.code, r.created]));
    for (const rule of FOLLOW_UP_RULES) expect(created[rule.code], rule.code).toBe(1);

    const [arrivingFu] = await live('IMPORT_ARRIVING');
    expect(arrivingFu).toMatchObject({
      shipmentId: arriving.id,
      clientId: basics.jr.id,
      assigneeId: operatorId,
      priority: 'MEDIUM',
      status: 'OPEN',
    });
    expect(arrivingFu!.subject).toContain('SHP-T-1 (JR)');
    // Due at 17:00 Phnom Penh time on the ETA.
    expect(arrivingFu!.dueAt.toISOString()).toBe(new Date(`${day(2)}T10:00:00Z`).toISOString());

    // The air cut-off is due at the cut-off time itself, not at 17:00.
    const [cutOff] = await live('AIR_CUT_OFF');
    expect(cutOff).toMatchObject({ shipmentId: air.id, priority: 'HIGH' });
    expect(cutOff!.dueAt.toISOString()).toBe(new Date(`${day(1)}T10:00:00+07:00`).toISOString());

    // A second run changes nothing.
    const again = await runFollowUpRules();
    expect(again.rules.every((r) => r.created === 0 && r.resolved === 0)).toBe(true);
  });

  it('closes a follow-up once its problem is fixed, and raises a new one if it comes back', async () => {
    const s = await ship({ direction: 'EXPORT', etd: day(1) });
    await runFollowUpRules();
    expect(await live('EXPORT_NOT_DECLARED')).toHaveLength(1);

    await declare(s.id, day(0));
    const run = await runFollowUpRules();
    expect(run.rules.find((r) => r.code === 'EXPORT_NOT_DECLARED')!.resolved).toBe(1);
    const [closed] = await db.select().from(followUps).where(eq(followUps.shipmentId, s.id));
    expect(closed).toMatchObject({ status: 'DONE' });
    expect(closed!.autoResolvedAt).not.toBeNull();

    await db.delete(customsDeclarations).where(eq(customsDeclarations.shipmentId, s.id));
    await runFollowUpRules();
    expect(await live('EXPORT_NOT_DECLARED')).toHaveLength(1);
    const all = await db.select().from(followUps).where(eq(followUps.shipmentId, s.id));
    expect(all).toHaveLength(2);
  });

  it('keeps a dismissed follow-up dismissed while the problem remains', async () => {
    await ship({ direction: 'EXPORT', etd: day(-20), atd: day(-20) });
    await runFollowUpRules();
    const [fu] = await live('EXPORT_DEPARTED_UNDECLARED');
    await db.update(followUps).set({ status: 'DONE' }).where(eq(followUps.id, fu!.id));
    await runFollowUpRules();
    const rows = await db
      .select()
      .from(followUps)
      .where(eq(followUps.rule, 'EXPORT_DEPARTED_UNDECLARED'));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.status).toBe('DONE');
  });

  it('moves the due date when the shipment date changes', async () => {
    const s = await ship({ direction: 'IMPORT', eta: day(3) });
    await invoice(s.id);
    await runFollowUpRules();
    await db
      .update(shipments)
      .set({ eta: day(1) })
      .where(eq(shipments.id, s.id));
    await runFollowUpRules();
    const [fu] = await live('IMPORT_ARRIVING');
    expect(fu!.dueAt.toISOString()).toBe(new Date(`${day(1)}T10:00:00Z`).toISOString());
  });

  it('lists the checks and alerts in the bell until they are seen', async () => {
    await ship({ direction: 'EXPORT', etd: day(-20), atd: day(-20) });
    await runFollowUpRules();
    const admin = await createUser('ADMIN');
    const login = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: admin.email, password: TEST_PASSWORD });
    const auth = { Authorization: `Bearer ${login.body.accessToken as string}` };

    const rules = await request(app).get('/api/v1/follow-ups/rules').set(auth);
    expect(rules.status).toBe(200);
    expect(rules.body).toHaveLength(FOLLOW_UP_RULES.length);
    expect(
      (rules.body as { code: string; open: number }[]).find(
        (r) => r.code === 'EXPORT_DEPARTED_UNDECLARED',
      )!.open,
    ).toBe(1);

    expect(rules.body[0]).toMatchObject({ area: 'IMPORT', code: 'IMPORT_ARRIVING' });

    const auto = await request(app).get('/api/v1/follow-ups?source=AUTO').set(auth);
    expect(auto.body.data[0].rule).toBe('EXPORT_DEPARTED_UNDECLARED');
    // Tab counts: the same filters, every tab (the Done tab shows none here).
    const done = await request(app).get('/api/v1/follow-ups?source=AUTO&status=DONE').set(auth);
    expect(done.body.data).toHaveLength(0);
    expect(done.body.summary).toMatchObject({ open: 1, done: 0, all: 1 });

    const counts = async () =>
      (await request(app).get('/api/v1/meta/nav-counts').set(auth)).body as NavCounts;
    expect((await counts()).unreadNotifications).toBe(1);
    const bell = await request(app).get('/api/v1/meta/notifications').set(auth);
    expect(bell.body).toHaveLength(1);
    expect(bell.body[0]).toMatchObject({ rule: 'EXPORT_DEPARTED_UNDECLARED', unread: true });
    await request(app).post('/api/v1/meta/notifications/seen').set(auth).expect(204);
    expect((await counts()).unreadNotifications).toBe(0);

    // Viewers can't run the checks.
    const viewer = await createUser('VIEWER');
    const vl = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: viewer.email, password: TEST_PASSWORD });
    await request(app)
      .post('/api/v1/follow-ups/rules/run')
      .set({ Authorization: `Bearer ${vl.body.accessToken as string}` })
      .expect(403);
  });
});
