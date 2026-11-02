import { eq, sql, type SQL } from 'drizzle-orm';
import {
  FOLLOW_UP_RULES,
  type FollowUpRuleCode,
  type FollowUpRuleRun,
  type FollowUpRuleStatus,
} from '@gs/shared';
import { env, isTest } from '../../config/env';
import { db } from '../../db/client';
import { followUps } from '../../db/schema';
import { SEAL_PLAN_ROWS } from '../sealPlans/service';
import { isoTs, queryRows } from '../../lib/listing';
import { logger } from '../../lib/logger';
import { formatNumber, nextNumber } from '../../lib/numbering';

const EVERY_MS = 15 * 60 * 1000;

/** One record a check matched: the follow-up it should have. */
interface Match {
  entityId: string;
  clientId: string | null;
  shipmentId: string | null;
  subject: string;
  notes: string | null;
  /**
   * The deadline from the record's own dates: a day (due 17:00) or a local date and time
   * ("2026-11-03T14:00"); null = two days after it is raised, then fixed.
   */
  dueDate: string | null;
  assigneeId: string | null;
}

const today = sql`(now() AT TIME ZONE ${env.BUSINESS_TIMEZONE})::date`;
/** "13-OCT-26", the app's date style. */
const d = (col: SQL) => sql`upper(to_char(${col}, 'DD-Mon-YY'))`;
const numbered = sql`btrim(coalesce(x.declare_no, '')) <> ''`;
const declared = sql`EXISTS (SELECT 1 FROM customs_declarations x WHERE x.shipment_id = s.id AND ${numbered})`;
const cleared = sql`EXISTS (SELECT 1 FROM customs_declarations x WHERE x.shipment_id = s.id AND ${numbered} AND x.declare_date IS NOT NULL)`;
const firstCleared = sql`(SELECT min(x.declare_date) FROM customs_declarations x WHERE x.shipment_id = s.id AND ${numbered})`;
const blank = (col: SQL) => sql`btrim(coalesce(${col}, '')) = ''`;
/** An import by its ETA, an export by its ETD. */
const shipDate = sql`(CASE WHEN s.direction = 'EXPORT' THEN coalesce(s.etd, s.eta) ELSE coalesce(s.eta, s.etd) END)`;
const label = sql`s.reference || ' (' || c.code || ')'`;

/** The shipment checks share their columns; each adds its condition, subject and due date. */
const shipmentCheck = (where: SQL, subject: SQL, notes: SQL, due: SQL): SQL => sql`
  SELECT s.id AS "entityId", s.client_id AS "clientId", s.id AS "shipmentId",
         ${subject} AS subject, ${notes} AS notes, to_char(${due}, 'YYYY-MM-DD') AS "dueDate",
         s.created_by_id AS "assigneeId"
  FROM shipments s JOIN clients c ON c.id = s.client_id
  WHERE s.deleted_at IS NULL AND ${where}`;

/** The Seal Plan checks read the Seal Plan rows: one per export container (or plan started blank). */
const sealPlanCheck = (where: SQL, subject: SQL, notes: SQL, due: SQL): SQL => sql`
  SELECT coalesce(r."shipmentId", r.id)::text || ':' || r."containerNo" AS "entityId",
         r."clientId", r."shipmentId", ${subject} AS subject, ${notes} AS notes,
         to_char(${due}, 'YYYY-MM-DD') AS "dueDate", r."createdById" AS "assigneeId"
  FROM ${SEAL_PLAN_ROWS} r WHERE r.atd IS NULL AND ${where}`;
const ctr = sql`r."containerNo" || ' (' || r."clientCode" || ')'`;
const etd = sql`r.etd::date`;
const loading = sql`r."loadingDate"::date`;

/** Now as a local (Phnom Penh) date and time, to compare with the air cut-off. */
const nowLocal = sql`(now() AT TIME ZONE ${env.BUSINESS_TIMEZONE})`;

const CHECKS: Record<FollowUpRuleCode, SQL> = {
  // Due at the cut-off itself, so it sorts and goes overdue by the hour.
  AIR_CUT_OFF: sql`
    SELECT s.id AS "entityId", s.client_id AS "clientId", s.id AS "shipmentId",
           'Air cut-off ' || to_char(s.cut_off_at, 'DD-Mon HH24:MI') || ': ' || ${label} AS subject,
           'Deliver the cargo to the airline before the cut-off' ||
             coalesce(' (' || nullif(btrim(s.booking_no), '') || ')', '') || '.' AS notes,
           to_char(s.cut_off_at, 'YYYY-MM-DD"T"HH24:MI') AS "dueDate",
           s.created_by_id AS "assigneeId"
    FROM shipments s JOIN clients c ON c.id = s.client_id
    WHERE s.deleted_at IS NULL AND s.direction = 'EXPORT' AND s.transport_mode = 'AIR'
      AND s.atd IS NULL AND s.cut_off_at IS NOT NULL
      AND s.cut_off_at BETWEEN ${nowLocal} - interval '1 day' AND ${nowLocal} + interval '48 hours'`,
  IMPORT_ARRIVING: shipmentCheck(
    sql`s.direction = 'IMPORT' AND s.arrive_fty IS NULL AND s.eta BETWEEN ${today} AND ${today} + 3 AND NOT ${declared}`,
    sql`'Prepare customs declaration: ' || ${label} || ' arrives ' || ${d(sql`s.eta`)}`,
    sql`'ETA ' || ${d(sql`s.eta`)} || ' and no Declare No. yet. Prepare the declaration so the cargo clears on arrival.'`,
    sql`s.eta`,
  ),
  IMPORT_NOT_CLEARED: shipmentCheck(
    sql`s.direction = 'IMPORT' AND s.arrive_fty IS NULL AND s.eta < ${today} AND NOT ${cleared}`,
    sql`'Customs not cleared: ' || ${label} || ' arrived ' || ${d(sql`s.eta`)}`,
    sql`'ETA was ' || ${d(sql`s.eta`)} || ' (' || (${today} - s.eta) || ' days ago). Add the Declare No. and Declare Date once cleared.'`,
    sql`s.eta + 2`,
  ),
  IMPORT_NOT_DELIVERED: shipmentCheck(
    sql`s.direction = 'IMPORT' AND s.arrive_fty IS NULL AND ${cleared} AND ${firstCleared} <= ${today} - 3`,
    sql`'Delivery to factory not recorded: ' || ${label}`,
    sql`'Cleared on ' || ${d(firstCleared)} || '. Enter the ETA Factory date when the cargo is delivered.'`,
    sql`${firstCleared} + 3`,
  ),
  IMPORT_DOCS_MISSING: shipmentCheck(
    sql`s.direction = 'IMPORT' AND s.arrive_fty IS NULL AND s.eta BETWEEN ${today} AND ${today} + 7
        AND (${blank(sql`s.hbl_no`)} OR NOT EXISTS (SELECT 1 FROM cargo_invoices i WHERE i.shipment_id = s.id))`,
    sql`'Documents missing: ' || ${label}`,
    sql`'Missing: ' || concat_ws(', ',
          CASE WHEN ${blank(sql`s.hbl_no`)} THEN 'BL / AWB number' END,
          CASE WHEN NOT EXISTS (SELECT 1 FROM cargo_invoices i WHERE i.shipment_id = s.id) THEN 'cargo invoice' END)
        || '. ETA ' || ${d(sql`s.eta`)} || '.'`,
    sql`s.eta - 2`,
  ),
  EXPORT_BOOKING_MISSING: shipmentCheck(
    sql`s.direction = 'EXPORT' AND s.atd IS NULL AND s.etd BETWEEN ${today} AND ${today} + 7 AND ${blank(sql`s.booking_no`)}`,
    sql`'Booking / SO missing: ' || ${label} || ' ETD ' || ${d(sql`s.etd`)}`,
    sql`'Confirm the booking with the forwarder and enter the Booking / SO No.'`,
    sql`s.etd - 3`,
  ),
  EXPORT_NOT_DECLARED: shipmentCheck(
    sql`s.direction = 'EXPORT' AND s.atd IS NULL AND s.etd BETWEEN ${today} AND ${today} + 3 AND NOT ${declared}`,
    sql`'Export declaration needed: ' || ${label} || ' ETD ' || ${d(sql`s.etd`)}`,
    sql`'The cargo leaves on ' || ${d(sql`s.etd`)} || ' and has no Declare No. yet.'`,
    sql`s.etd - 1`,
  ),
  EXPORT_DEPARTURE_UNCONFIRMED: shipmentCheck(
    sql`s.direction = 'EXPORT' AND s.atd IS NULL AND s.etd < ${today}`,
    sql`'Confirm departure: ' || ${label} || ' ETD was ' || ${d(sql`s.etd`)}`,
    sql`'Ask the forwarder for the actual departure and enter the ATD.'`,
    sql`s.etd + 1`,
  ),
  EXPORT_DEPARTED_UNDECLARED: shipmentCheck(
    sql`s.direction = 'EXPORT' AND s.atd IS NOT NULL AND NOT ${cleared}`,
    sql`'Departed without customs clearance: ' || ${label}`,
    sql`'Departed ' || ${d(sql`s.atd`)} || '. Enter the Declare No. and Declare Date.'`,
    sql`s.atd + 1`,
  ),
  EXPORT_CO_PENDING: shipmentCheck(
    sql`s.direction = 'EXPORT' AND s.atd IS NOT NULL AND s.atd >= ${today} - 60
        AND NOT ${blank(sql`s.co_form`)} AND lower(coalesce(s.co_status, '')) NOT IN ('approved', 'active')`,
    sql`'CO not approved: ' || ${label} || ' (' || s.co_form || ')'`,
    sql`'CO status is ' || coalesce(nullif(btrim(s.co_status), ''), 'not set') || '. Follow up the Certificate of Origin.'`,
    sql`s.atd + 7`,
  ),
  CONTAINERS_MISSING: shipmentCheck(
    sql`s.load_type = 'FCL' AND s.transport_mode IN ('SEA', 'ROAD') AND s.status <> 'COMPLETED'
        AND ${shipDate} BETWEEN ${today} AND ${today} + 7
        AND NOT EXISTS (SELECT 1 FROM containers k WHERE k.shipment_id = s.id)`,
    sql`'Container numbers missing: ' || ${label}`,
    sql`'CY / CY shipment due ' || ${d(shipDate)} || ' with no container recorded.'`,
    sql`${shipDate} - 2`,
  ),
  THC_INVOICE_MISSING: shipmentCheck(
    sql`s.direction = 'IMPORT' AND s.transport_mode = 'SEA' AND ${cleared} AND ${blank(sql`s.thc_hbl_no`)}
        AND ${firstCleared} BETWEEN ${today} - 30 AND ${today} - 7`,
    sql`'THC invoice missing: ' || ${label}`,
    sql`'Cleared ' || ${d(firstCleared)} || '. Ask the forwarder for the THC invoice and enter it.'`,
    sql`${firstCleared} + 10`,
  ),
  SEAL_PLAN_NOT_SCHEDULED: sealPlanCheck(
    sql`${etd} BETWEEN ${today} AND ${today} + 7 AND r."loadingDate" IS NULL`,
    sql`'Schedule container loading: ' || ${ctr} || ' ETD ' || ${d(etd)}`,
    sql`'No loading date in the Seal Plan. Book the empty container and the truck to the factory.'`,
    sql`${etd} - 3`,
  ),
  SEAL_PLAN_SEALS_MISSING: sealPlanCheck(
    sql`${loading} BETWEEN ${today} - 14 AND ${today} + 3
        AND (${blank(sql`r."linerSeal"`)} OR ${blank(sql`r."customsSeal"`)})`,
    sql`'Seals missing: ' || ${ctr} || ' loading ' || ${d(loading)}`,
    sql`'Missing: ' || concat_ws(', ',
          CASE WHEN ${blank(sql`r."linerSeal"`)} THEN 'carrier seal' END,
          CASE WHEN ${blank(sql`r."customsSeal"`)} THEN 'customs seal' END) || '.'`,
    sql`${loading} - 1`,
  ),
  SEAL_PLAN_TRUCK_MISSING: sealPlanCheck(
    sql`${loading} BETWEEN ${today} AND ${today} + 2
        AND ${blank(sql`r."truckBy"`)} AND ${blank(sql`r."truckNo"`)}`,
    sql`'Arrange truck: ' || ${ctr} || ' loading ' || ${d(loading)}`,
    sql`'No trucking company or truck no. in the Seal Plan.'`,
    sql`${loading} - 1`,
  ),
  SEAL_PLAN_TARE_MISSING: sealPlanCheck(
    sql`${etd} BETWEEN ${today} AND ${today} + 5 AND r."loadingDate" IS NOT NULL AND r."tareWeightKg" IS NULL`,
    sql`'Tare weight missing: ' || ${ctr} || ' ETD ' || ${d(etd)}`,
    sql`'Enter the container tare weight so the VGM can be sent to the carrier.'`,
    sql`${etd} - 2`,
  ),
  CDC_OVER_IMPORTED: sql`
    SELECT i.id AS "entityId", i.client_id AS "clientId", NULL::uuid AS "shipmentId",
           'CDC over-imported: ' || i.declare_ref || ' ' || i.name || ' (' || c.code || ')' AS subject,
           'Imported ' || b.imported_qty::text || ' ' || coalesce(i.unit, '') || ' of ' || i.qty::text
             || ' licensed (balance ' || b.balance::text || '). Check the CDC amendment.' AS notes,
           NULL AS "dueDate", NULL::uuid AS "assigneeId"
    FROM cut_stock_items i JOIN cut_stock_balances b ON b.item_id = i.id JOIN clients c ON c.id = i.client_id
    WHERE i.deleted_at IS NULL AND b.balance < 0`,
};

/** Due at 17:00 Phnom Penh time on the given date (as follow-ups added by hand default to). */
const dueAt = (date: string) =>
  new Date(date.length > 10 ? `${date}:00+07:00` : `${date}T17:00:00+07:00`);
/** Two business-calendar days from today, for a check whose record has no date of its own. */
const inTwoDays = () => {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: env.BUSINESS_TIMEZONE }).format(
    new Date(),
  );
  return new Date(Date.parse(today) + 2 * 86_400_000).toISOString().slice(0, 10);
};

/**
 * Run every check: raise a follow-up for each new match, keep open ones in step with the data
 * (subject, notes, due date), and close those whose problem is fixed. A follow-up marked done
 * or deleted by hand while its problem remains is not raised again; once a check has closed
 * one, the same problem coming back raises a new one.
 */
export async function runFollowUpRules(): Promise<FollowUpRuleRun> {
  const rules: FollowUpRuleRun['rules'] = [];
  await db.transaction(async (tx) => {
    // One run at a time (the timer and a save can meet); a second caller just skips.
    const [lock] = await queryRows<{ ok: boolean }>(
      tx,
      sql`SELECT pg_try_advisory_xact_lock(hashtext('follow_up_rules')) AS ok`,
    );
    if (!lock?.ok) return;
    for (const rule of FOLLOW_UP_RULES) {
      const matches = await queryRows<Match>(tx, CHECKS[rule.code]);
      const keyOf = (m: Match) => `${rule.code}:${m.entityId}`;
      const existing = await queryRows<{
        id: string;
        ruleKey: string;
        status: string;
        subject: string;
        notes: string | null;
        dueAt: string;
      }>(
        tx,
        sql`SELECT id, rule_key AS "ruleKey", status, subject, notes, ${isoTs('due_at')} AS "dueAt"
            FROM follow_ups WHERE rule = ${rule.code} AND auto_resolved_at IS NULL`,
      );
      const byKey = new Map(existing.map((e) => [e.ruleKey, e]));
      let created = 0;
      for (const m of matches) {
        const live = byKey.get(keyOf(m));
        if (live) {
          const due = m.dueDate ? dueAt(m.dueDate) : new Date(live.dueAt);
          const changed =
            live.subject !== m.subject ||
            live.notes !== m.notes ||
            new Date(live.dueAt).getTime() !== due.getTime();
          if (live.status !== 'DONE' && changed)
            await tx
              .update(followUps)
              .set({ subject: m.subject, notes: m.notes, dueAt: due })
              .where(eq(followUps.id, live.id));
          continue;
        }
        await tx.insert(followUps).values({
          reference: formatNumber.followUp(await nextNumber(tx, 'FOLLOW_UP')),
          subject: m.subject,
          notes: m.notes,
          clientId: m.clientId,
          shipmentId: m.shipmentId,
          assigneeId: m.assigneeId,
          dueAt: dueAt(m.dueDate ?? inTwoDays()),
          priority: rule.priority,
          rule: rule.code,
          ruleKey: keyOf(m),
        });
        created++;
      }
      // Open ones whose record no longer matches: the problem is fixed.
      const matched = new Set(matches.map(keyOf));
      const fixed = existing.filter((e) => e.status !== 'DONE' && !matched.has(e.ruleKey));
      for (const e of fixed)
        await tx.execute(sql`UPDATE follow_ups SET status = 'DONE', completed_at = now(),
          auto_resolved_at = now(), updated_at = now() WHERE id = ${e.id}`);
      // A dismissed one (done or deleted by hand) is let go once the problem is fixed, so the
      // same problem coming back later raises a new follow-up.
      const released = existing.filter((e) => e.status === 'DONE' && !matched.has(e.ruleKey));
      for (const e of released)
        await tx.execute(sql`UPDATE follow_ups SET auto_resolved_at = now() WHERE id = ${e.id}`);
      rules.push({ code: rule.code, matched: matches.length, created, resolved: fixed.length });
    }
  });
  return { ranAt: new Date().toISOString(), rules };
}

/** Each check with how many of its follow-ups are open (for restricted users, their clients only). */
export async function ruleStatuses(scoped: SQL | undefined): Promise<FollowUpRuleStatus[]> {
  const counts = await queryRows<{ rule: string; n: number }>(
    db,
    sql`SELECT f.rule, count(*)::int AS n FROM follow_ups f LEFT JOIN shipments s ON s.id = f.shipment_id
        WHERE f.rule IS NOT NULL AND f.status <> 'DONE' AND f.deleted_at IS NULL ${scoped ? sql`AND ${scoped}` : sql``}
        GROUP BY f.rule`,
  );
  return FOLLOW_UP_RULES.map((r) => ({
    ...r,
    open: counts.find((c) => c.rule === r.code)?.n ?? 0,
  }));
}

const run = (why: string) =>
  void runFollowUpRules()
    .then((r) => {
      const created = r.rules.reduce((n, x) => n + x.created, 0);
      const resolved = r.rules.reduce((n, x) => n + x.resolved, 0);
      if (created || resolved) logger.info({ why, created, resolved }, 'Follow-up checks ran');
    })
    .catch((err: unknown) => logger.error({ err }, 'Follow-up checks failed'));

let pending: NodeJS.Timeout | null = null;
/** After a save: run the checks a moment later, once for a burst of saves. */
export function queueFollowUpRules(): void {
  if (isTest) return;
  if (pending) clearTimeout(pending);
  pending = setTimeout(() => {
    pending = null;
    run('save');
  }, 2000);
  pending.unref();
}

/** Run the checks shortly after boot, then every 15 minutes (dates move on by themselves). */
export function startFollowUpRules(): () => void {
  const first = setTimeout(() => run('start'), 10_000);
  const timer = setInterval(() => run('schedule'), EVERY_MS);
  first.unref();
  timer.unref();
  logger.info(
    'Follow-up checks on: shipments, seal plans and CDC balances every 15 minutes and after saves',
  );
  return () => {
    clearTimeout(first);
    clearInterval(timer);
  };
}
