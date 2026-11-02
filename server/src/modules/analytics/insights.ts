import { sql, type SQL } from 'drizzle-orm';
import type {
  ClientHealth,
  InsightClient,
  InsightMetric,
  InsightRecommendation,
  InsightsResponse,
  Period,
} from '@gs/shared';
import { db } from '../../db/client';
import { env } from '../../config/env';
import { queryRows } from '../../lib/listing';
import { clearanceDate, periodDate } from '../../lib/shipmentDate';
import { previousPeriod } from './service';

/**
 * Business Insights: the figures management decides on, each against the period before.
 *  - Service: import clearance time (arrival → first declare date), delivery to the factory
 *    (clearance → ETA factory), on-time delivery (≤ 2 days), customs exceptions, follow-ups
 *    done by their due time.
 *  - Clients: volume growth, how long since their last shipment against their usual rhythm
 *    (→ health), and, for accounting roles, revenue, profit, margin and profit per declaration.
 *  - Partners and team: ports and forwarders by service, workload per staff member.
 *  - Recommendations: plain rules over the above, most serious first.
 * Shipments count in the period by their clearance date (see periodDate), the ledger by its
 * invoice date, billed rows only, as everywhere else in Analytics.
 */

const DELIVERY_TARGET_DAYS = 2;

interface Scope {
  clientId?: string[] | undefined;
}
const inClients = (col: SQL, f: Scope) =>
  f.clientId?.length
    ? sql`AND ${col} IN (${sql.join(
        f.clientId.map((id) => sql`${id}::uuid`),
        sql`, `,
      )})`
    : sql``;

const cd = clearanceDate();
const arrival = sql`coalesce(s.ata, s.eta)`;
const clearDays = sql`(CASE WHEN s.direction = 'IMPORT' AND ${cd} IS NOT NULL AND ${arrival} IS NOT NULL
  THEN greatest(${cd} - ${arrival}, 0) END)`;
const deliveryDays = sql`(CASE WHEN s.direction = 'IMPORT' AND ${cd} IS NOT NULL AND s.arrive_fty IS NOT NULL
  THEN greatest(s.arrive_fty - ${cd}, 0) END)`;
const inPeriod = (p: Period) =>
  sql`s.deleted_at IS NULL AND ${periodDate()} BETWEEN ${p.from}::date AND ${p.to}::date`;
const BILLED = sql`(a.inv_revenue + a.dis_total + a.dn_total) > 0`;

const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));
const metric = (
  value: number | null,
  previous: number | null,
  better: 'up' | 'down',
): InsightMetric => ({ value, previous, better });
const pct = (a: number, b: number) => (b ? Math.round((1000 * a) / b) / 10 : null);
const days = (from: string, to: string) =>
  Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000) + 1;

async function serviceFigures(p: Period, f: Scope) {
  const [r] = await queryRows<{
    shipments: number;
    clearanceDays: string | null;
    deliveryDays: string | null;
    delivered: number;
    onTime: number;
    exceptions: number;
  }>(
    db,
    sql`
    SELECT count(*)::int AS shipments,
           round(avg(${clearDays}), 1)::text AS "clearanceDays",
           round(avg(${deliveryDays}), 1)::text AS "deliveryDays",
           (count(${deliveryDays}))::int AS delivered,
           (count(*) FILTER (WHERE ${deliveryDays} <= ${DELIVERY_TARGET_DAYS}))::int AS "onTime",
           (count(*) FILTER (WHERE s.clearance_status = 'EXCEPTION'))::int AS exceptions
    FROM shipments s WHERE ${inPeriod(p)} ${inClients(sql`s.client_id`, f)}`,
  );
  const [fu] = await queryRows<{ done: number; onTime: number }>(
    db,
    sql`
    SELECT count(*)::int AS done, (count(*) FILTER (WHERE f.completed_at <= f.due_at))::int AS "onTime"
    FROM follow_ups f
    WHERE f.deleted_at IS NULL AND f.completed_at IS NOT NULL AND f.auto_resolved_at IS NULL
      AND (f.completed_at AT TIME ZONE ${env.BUSINESS_TIMEZONE})::date BETWEEN ${p.from}::date AND ${p.to}::date
      ${inClients(sql`f.client_id`, f)}`,
  );
  return {
    shipments: r!.shipments,
    clearanceDays: num(r!.clearanceDays),
    deliveryDays: num(r!.deliveryDays),
    onTimeDeliveryPct: pct(r!.onTime, r!.delivered),
    exceptionPct: pct(r!.exceptions, r!.shipments) ?? 0,
    followUpOnTimePct: pct(fu!.onTime, fu!.done),
  };
}

async function moneyFigures(p: Period, f: Scope) {
  const [r] = await queryRows<{ revenue: string; netProfit: string; declarations: number }>(
    db,
    sql`
    SELECT coalesce(sum(a.inv_revenue + a.dis_total + a.dn_total), 0)::text AS revenue,
           coalesce(sum(a.net_profit), 0)::text AS "netProfit", count(*)::int AS declarations
    FROM accounting_records a
    WHERE a.inv_date BETWEEN ${p.from}::date AND ${p.to}::date AND ${BILLED} ${inClients(sql`a.client_id`, f)}`,
  );
  const revenue = Number(r!.revenue);
  const profit = Number(r!.netProfit);
  return {
    revenue,
    netProfit: profit,
    marginPct: revenue ? Math.round((1000 * profit) / revenue) / 10 : null,
    profitPerDeclaration: r!.declarations
      ? Math.round((100 * profit) / r!.declarations) / 100
      : null,
  };
}

export async function insights(
  f: Scope & Period & { today: string },
  money: boolean,
): Promise<InsightsResponse> {
  const period: Period = { from: f.from, to: f.to };
  const previous = previousPeriod(period);
  const [now, before] = await Promise.all([serviceFigures(period, f), serviceFigures(previous, f)]);
  const [mNow, mBefore] = money
    ? await Promise.all([moneyFigures(period, f), moneyFigures(previous, f)])
    : [null, null];

  // ---- Monthly trend ----
  const trendRows = await queryRows<{
    month: string;
    shipments: number;
    clearanceDays: string | null;
    deliveryDays: string | null;
  }>(
    db,
    sql`
    WITH months AS (
      SELECT generate_series(date_trunc('month', ${period.from}::date), ${period.to}::date, interval '1 month')::date AS m)
    SELECT to_char(m, 'YYYY-MM') AS month,
           (SELECT count(*) FROM shipments s WHERE ${inPeriod(period)} AND date_trunc('month', ${periodDate()}) = m
              ${inClients(sql`s.client_id`, f)})::int AS shipments,
           (SELECT round(avg(${clearDays}), 1) FROM shipments s WHERE ${inPeriod(period)}
              AND date_trunc('month', ${periodDate()}) = m ${inClients(sql`s.client_id`, f)})::text AS "clearanceDays",
           (SELECT round(avg(${deliveryDays}), 1) FROM shipments s WHERE ${inPeriod(period)}
              AND date_trunc('month', ${periodDate()}) = m ${inClients(sql`s.client_id`, f)})::text AS "deliveryDays"
    FROM months ORDER BY m`,
  );
  const profitByMonth = money
    ? new Map(
        (
          await queryRows<{ month: string; netProfit: string }>(
            db,
            sql`
            SELECT to_char(a.inv_date, 'YYYY-MM') AS month, sum(a.net_profit)::text AS "netProfit"
            FROM accounting_records a
            WHERE a.inv_date BETWEEN ${period.from}::date AND ${period.to}::date AND ${BILLED}
              ${inClients(sql`a.client_id`, f)}
            GROUP BY 1`,
          )
        ).map((r) => [r.month, r.netProfit]),
      )
    : null;
  const trend = trendRows.map((r) => ({
    month: r.month,
    shipments: r.shipments,
    clearanceDays: num(r.clearanceDays),
    deliveryDays: num(r.deliveryDays),
    ...(profitByMonth ? { netProfit: profitByMonth.get(r.month) ?? '0' } : {}),
  }));

  // ---- Ports ----
  const ports = (
    await queryRows<{
      code: string;
      name: string;
      shipments: number;
      clearanceDays: string | null;
      deliveryDays: string | null;
      exceptions: number;
    }>(
      db,
      sql`
      SELECT p.code, coalesce(p.short_name, p.name) AS name, count(*)::int AS shipments,
             round(avg(${clearDays}), 1)::text AS "clearanceDays",
             round(avg(${deliveryDays}), 1)::text AS "deliveryDays",
             (count(*) FILTER (WHERE s.clearance_status = 'EXCEPTION'))::int AS exceptions
      FROM shipments s JOIN ports p ON p.id = s.clearance_port_id
      WHERE ${inPeriod(period)} ${inClients(sql`s.client_id`, f)}
      GROUP BY p.id ORDER BY count(*) DESC`,
    )
  ).map((r) => ({
    code: r.code,
    name: r.name,
    shipments: r.shipments,
    clearanceDays: num(r.clearanceDays),
    deliveryDays: num(r.deliveryDays),
    exceptionPct: pct(r.exceptions, r.shipments) ?? 0,
  }));

  // ---- Forwarders, scored ----
  const fwRows = await queryRows<{
    id: string;
    name: string;
    shipments: number;
    arrived: number;
    onTime: number;
    avgDelayDays: string | null;
    exceptions: number;
    clearanceDays: string | null;
  }>(
    db,
    sql`
    SELECT fw.id, fw.name, count(*)::int AS shipments,
           (count(*) FILTER (WHERE s.ata IS NOT NULL AND s.eta IS NOT NULL))::int AS arrived,
           (count(*) FILTER (WHERE s.ata <= s.eta))::int AS "onTime",
           round(avg(greatest(s.ata - s.eta, 0)) FILTER (WHERE s.ata IS NOT NULL AND s.eta IS NOT NULL), 1)::text AS "avgDelayDays",
           (count(*) FILTER (WHERE s.clearance_status = 'EXCEPTION'))::int AS exceptions,
           round(avg(${clearDays}), 1)::text AS "clearanceDays"
    FROM shipments s JOIN forwarders fw ON fw.id = s.forwarder_id
    WHERE ${inPeriod(period)} ${inClients(sql`s.client_id`, f)}
    GROUP BY fw.id ORDER BY count(*) DESC`,
  );
  const avgClear = now.clearanceDays ?? 0;
  const forwarders = fwRows
    .map((r) => {
      const onTimePct = pct(r.onTime, r.arrived);
      const exceptionPct = pct(r.exceptions, r.shipments) ?? 0;
      const clear = num(r.clearanceDays);
      // Quick clearance: 100 at no wait, 0 at twice the overall average or more.
      const quick =
        clear === null || !avgClear
          ? 50
          : Math.max(0, Math.min(100, 100 * (1 - clear / (2 * avgClear))));
      const score = Math.round(0.5 * (onTimePct ?? 50) + 0.3 * (100 - exceptionPct) + 0.2 * quick);
      return {
        id: r.id,
        name: r.name,
        shipments: r.shipments,
        onTimePct,
        avgDelayDays: num(r.avgDelayDays),
        exceptionPct,
        clearanceDays: clear,
        score,
      };
    })
    .sort((a, b) => b.score - a.score || b.shipments - a.shipments);

  // ---- Clients: volume, rhythm, health; money for accounting roles ----
  const clientRows = await queryRows<{
    clientId: string;
    code: string;
    name: string;
    shipments: number;
    prevShipments: number;
    lastShipment: string | null;
  }>(
    db,
    sql`
    SELECT c.id AS "clientId", c.code, c.name,
           (count(*) FILTER (WHERE ${periodDate()} BETWEEN ${period.from}::date AND ${period.to}::date))::int AS shipments,
           (count(*) FILTER (WHERE ${periodDate()} BETWEEN ${previous.from}::date AND ${previous.to}::date))::int AS "prevShipments",
           to_char(max(${periodDate()}) FILTER (WHERE ${periodDate()} <= ${period.to}::date), 'YYYY-MM-DD') AS "lastShipment"
    FROM clients c JOIN shipments s ON s.client_id = c.id AND s.deleted_at IS NULL
    WHERE c.deleted_at IS NULL ${inClients(sql`c.id`, f)}
    GROUP BY c.id`,
  );
  const clientMoney = money
    ? new Map(
        (
          await queryRows<{
            clientId: string;
            revenue: string;
            netProfit: string;
            declarations: number;
          }>(
            db,
            sql`
            SELECT a.client_id AS "clientId", sum(a.inv_revenue + a.dis_total + a.dn_total)::text AS revenue,
                   sum(a.net_profit)::text AS "netProfit", count(*)::int AS declarations
            FROM accounting_records a
            WHERE a.inv_date BETWEEN ${period.from}::date AND ${period.to}::date AND ${BILLED}
              ${inClients(sql`a.client_id`, f)}
            GROUP BY a.client_id`,
          )
        ).map((r) => [r.clientId, r]),
      )
    : null;
  const totalProfit = mNow?.netProfit ?? 0;
  const periodDays = days(period.from, period.to);
  const asOf = f.today < period.to ? f.today : period.to;
  const clients: InsightClient[] = clientRows
    .filter((r) => r.shipments || r.prevShipments)
    .map((r) => {
      const growthPct = r.prevShipments
        ? Math.round((100 * (r.shipments - r.prevShipments)) / r.prevShipments)
        : null;
      // As at the end of the period viewed (today for a period still running).
      const daysSinceLast = r.lastShipment ? days(r.lastShipment, asOf) - 1 : null;
      const usualGapDays = r.shipments ? Math.round(periodDays / r.shipments) : null;
      const health: ClientHealth =
        r.shipments === 0 ||
        (daysSinceLast !== null && daysSinceLast > Math.max(30, 2 * (usualGapDays ?? 30)))
          ? 'AT_RISK'
          : !r.prevShipments
            ? 'NEW'
            : (growthPct ?? 0) >= 20
              ? 'GROWING'
              : (growthPct ?? 0) <= -20
                ? 'DECLINING'
                : 'STABLE';
      const m = clientMoney?.get(r.clientId);
      const revenue = Number(m?.revenue ?? 0);
      const profit = Number(m?.netProfit ?? 0);
      return {
        clientId: r.clientId,
        code: r.code,
        name: r.name,
        shipments: r.shipments,
        prevShipments: r.prevShipments,
        growthPct,
        lastShipment: r.lastShipment,
        daysSinceLast,
        usualGapDays,
        health,
        ...(clientMoney
          ? {
              revenue: revenue.toFixed(2),
              netProfit: profit.toFixed(2),
              marginPct: revenue ? Math.round((1000 * profit) / revenue) / 10 : null,
              profitPerDeclaration: m?.declarations ? (profit / m.declarations).toFixed(2) : null,
              sharePct: totalProfit ? Math.round((1000 * profit) / totalProfit) / 10 : null,
            }
          : {}),
      };
    })
    .sort((a, b) =>
      money ? Number(b.netProfit) - Number(a.netProfit) : b.shipments - a.shipments,
    );

  // ---- Concentration: profit for accounting roles, else shipments ----
  const by: 'profit' | 'shipments' = money ? 'profit' : 'shipments';
  const weights = clients
    .map((c) => ({
      code: c.code,
      w: by === 'profit' ? Math.max(0, Number(c.netProfit)) : c.shipments,
    }))
    .sort((a, b) => b.w - a.w);
  const all = weights.reduce((s, x) => s + x.w, 0);
  const concentration = {
    by,
    topCode: weights[0]?.code ?? null,
    topPct: all ? Math.round((1000 * weights[0]!.w) / all) / 10 : 0,
    top3Pct: all
      ? Math.round((1000 * weights.slice(0, 3).reduce((s, x) => s + x.w, 0)) / all) / 10
      : 0,
  };

  // ---- Team: whoever owns the shipment (assigned, else who created it) ----
  const team = await queryRows<InsightsResponse['team'][number]>(
    db,
    sql`
    WITH owned AS (
      SELECT coalesce(s.assigned_to_id, s.created_by_id) AS user_id,
             (s.status <> 'COMPLETED') AS active,
             (${periodDate()} BETWEEN ${period.from}::date AND ${period.to}::date) AS handled
      FROM shipments s WHERE s.deleted_at IS NULL ${inClients(sql`s.client_id`, f)}),
    fu AS (
      SELECT f.assignee_id AS user_id, (f.status <> 'DONE') AS open, (f.status <> 'DONE' AND f.due_at < now()) AS overdue
      FROM follow_ups f WHERE f.deleted_at IS NULL ${inClients(sql`f.client_id`, f)})
    SELECT u.id AS "userId", u.full_name AS name,
           (SELECT count(*) FROM owned o WHERE o.user_id = u.id AND o.active)::int AS active,
           (SELECT count(*) FROM owned o WHERE o.user_id = u.id AND o.handled)::int AS handled,
           (SELECT count(*) FROM fu WHERE fu.user_id = u.id AND fu.open)::int AS "openFollowUps",
           (SELECT count(*) FROM fu WHERE fu.user_id = u.id AND fu.overdue)::int AS "overdueFollowUps"
    FROM users u
    WHERE u.deleted_at IS NULL
      AND (EXISTS (SELECT 1 FROM owned o WHERE o.user_id = u.id) OR EXISTS (SELECT 1 FROM fu WHERE fu.user_id = u.id))
    ORDER BY active DESC, u.full_name`,
  );

  const response: InsightsResponse = {
    period,
    previous,
    money,
    scorecard: {
      shipments: metric(now.shipments, before.shipments, 'up'),
      clearanceDays: metric(now.clearanceDays, before.clearanceDays, 'down'),
      deliveryDays: metric(now.deliveryDays, before.deliveryDays, 'down'),
      onTimeDeliveryPct: metric(now.onTimeDeliveryPct, before.onTimeDeliveryPct, 'up'),
      exceptionPct: metric(now.exceptionPct, before.exceptionPct, 'down'),
      followUpOnTimePct: metric(now.followUpOnTimePct, before.followUpOnTimePct, 'up'),
      ...(mNow && mBefore
        ? {
            netProfit: metric(mNow.netProfit, mBefore.netProfit, 'up'),
            marginPct: metric(mNow.marginPct, mBefore.marginPct, 'up'),
            profitPerDeclaration: metric(
              mNow.profitPerDeclaration,
              mBefore.profitPerDeclaration,
              'up',
            ),
          }
        : {}),
    },
    trend,
    ports,
    forwarders,
    clients,
    concentration,
    team,
    recommendations: [],
  };
  response.recommendations = recommend(response);
  return response;
}

const change = (m: InsightMetric) =>
  m.value !== null && m.previous ? (m.value - m.previous) / m.previous : null;
const fmt = (n: number) => n.toLocaleString('en-US', { maximumFractionDigits: 1 });
const money = (n: number) => `$${Math.round(n).toLocaleString('en-US')}`;
/**
 * A rise in words: "up 12%", or, from a small or tiny base where a percentage would read as
 * "up 2633%", the figures themselves ("up from 3").
 */
const rise = (pct: number, before: string) =>
  pct > 3 ? `up from ${before}` : `up ${Math.round(pct * 100)}%`;

/** Plain rules over the figures: what to act on, most serious first. */
export function recommend(r: InsightsResponse): InsightRecommendation[] {
  const out: InsightRecommendation[] = [];
  const s = r.scorecard;

  // Service
  const clearChange = change(s.clearanceDays);
  if (clearChange !== null && clearChange >= 0.15 && (s.clearanceDays.value ?? 0) >= 1)
    out.push({
      severity: 'high',
      area: 'Service',
      title: `Import clearance is ${Math.round(clearChange * 100)}% slower`,
      detail: `${fmt(s.clearanceDays.value!)} days from arrival to declaration, against ${fmt(s.clearanceDays.previous!)} the period before.`,
      action: 'Start declarations before arrival: chase invoices, permits and the DO earlier.',
      link: '/followup',
    });
  if ((s.exceptionPct.value ?? 0) >= 5)
    out.push({
      severity: 'high',
      area: 'Service',
      title: `${fmt(s.exceptionPct.value!)}% of shipments hit a customs exception`,
      detail: 'Each exception delays clearance and risks penalties for the client.',
      action: 'Review the exception cases for a common cause (documents, HS codes, CDC balance).',
      link: '/plans',
    });
  if (s.onTimeDeliveryPct.value !== null && s.onTimeDeliveryPct.value < 80)
    out.push({
      severity: 'medium',
      area: 'Service',
      title: `Only ${fmt(s.onTimeDeliveryPct.value)}% delivered to the factory within ${DELIVERY_TARGET_DAYS} days of clearance`,
      detail: `Average ${fmt(s.deliveryDays.value ?? 0)} days from clearance to factory.`,
      action: 'Book trucks when the declaration is lodged, not after clearance.',
    });
  if (s.followUpOnTimePct.value !== null && s.followUpOnTimePct.value < 80)
    out.push({
      severity: 'medium',
      area: 'Team',
      title: `${fmt(s.followUpOnTimePct.value)}% of follow-ups closed on time`,
      detail: 'Late follow-ups are where delays and missed documents start.',
      action: 'Review the overdue list daily; give each follow-up an owner.',
      link: '/followup?filter=overdue',
    });
  const overall = s.clearanceDays.value;
  for (const p of r.ports)
    if (
      overall &&
      p.clearanceDays !== null &&
      p.shipments >= 3 &&
      p.clearanceDays >= 1.5 * overall &&
      p.clearanceDays - overall >= 1
    )
      out.push({
        severity: 'medium',
        area: 'Service',
        title: `Clearance at ${p.name} takes ${fmt(p.clearanceDays)} days`,
        detail: `${fmt(p.clearanceDays - overall)} days more than the ${fmt(overall)}-day average, over ${p.shipments} shipments.`,
        action: `Check what holds ${p.code} up (inspections, port congestion, the broker there).`,
      });

  // Partners
  for (const fw of r.forwarders)
    if (fw.onTimePct !== null && fw.onTimePct < 70 && fw.shipments >= 3)
      out.push({
        severity: 'medium',
        area: 'Partners',
        title: `${fw.name}: ${fmt(fw.onTimePct)}% on time`,
        detail: `Average delay ${fmt(fw.avgDelayDays ?? 0)} days over ${fw.shipments} shipments (score ${fw.score}/100).`,
        action: 'Raise it at the next review, or move volume to a better-scoring forwarder.',
      });

  // Clients
  const atRisk = r.clients.filter(
    (c) => c.health === 'AT_RISK' && c.prevShipments + c.shipments >= 2,
  );
  for (const c of atRisk.slice(0, 3))
    out.push({
      severity: 'high',
      area: 'Clients',
      title: `${c.code}: no shipment for ${c.daysSinceLast ?? '–'} days`,
      detail: c.usualGapDays
        ? `Usually one every ${c.usualGapDays} days; ${c.shipments} this period against ${c.prevShipments} before.`
        : `${c.prevShipments} shipments the period before, none this period.`,
      action: 'Call the client: check for new suppliers, pricing or service issues.',
      link: `/clients/${c.clientId}`,
    });
  for (const c of r.clients
    .filter((x) => x.health === 'DECLINING' && (x.growthPct ?? 0) <= -30)
    .slice(0, 3))
    out.push({
      severity: 'medium',
      area: 'Clients',
      title: `${c.code}: volume down ${Math.abs(c.growthPct ?? 0)}%`,
      detail: `${c.shipments} shipments against ${c.prevShipments} the period before.`,
      action: 'Ask how their production plan looks; offer a rate review if it is price.',
      link: `/clients/${c.clientId}`,
    });
  // Only across several clients: filtered to one, it is always 100%.
  const activeClients = r.clients.filter((c) => c.shipments > 0).length;
  if (activeClients >= 3 && r.concentration.topPct >= 40 && r.concentration.topCode)
    out.push({
      severity: 'medium',
      area: 'Clients',
      title: `${r.concentration.topCode} brings ${fmt(r.concentration.topPct)}% of ${r.concentration.by}`,
      detail: `The top 3 clients bring ${fmt(r.concentration.top3Pct)}%. Losing one would hurt.`,
      action: 'Grow the next tier: quotations to smaller clients and new prospects.',
      link: '/quotations',
    });

  // Profit
  if (r.money && s.marginPct?.value !== null && s.marginPct?.value !== undefined) {
    const avgMargin = s.marginPct.value;
    for (const c of r.clients)
      if (
        c.marginPct !== null &&
        c.marginPct !== undefined &&
        (c.sharePct ?? 0) >= 5 &&
        c.marginPct < avgMargin * 0.6
      )
        out.push({
          severity: 'medium',
          area: 'Profit',
          title: `${c.code}: ${fmt(c.marginPct)}% margin`,
          detail: `Well under the ${fmt(avgMargin)}% average, on ${fmt(c.sharePct ?? 0)}% of profit.`,
          action: 'Review its rates and re-billed costs (THC, other pay) at the next quotation.',
          link: `/clients/${c.clientId}`,
        });
    for (const c of r.clients)
      if (Number(c.netProfit ?? 0) < 0 && c.shipments > 0)
        out.push({
          severity: 'high',
          area: 'Profit',
          title: `${c.code} made a loss`,
          detail: `Net profit ${c.netProfit} USD this period.`,
          action: 'Check for costs not re-billed and missing invoices before the next shipment.',
          link: `/clients/${c.clientId}`,
        });
  }

  // Team
  const busy = r.team.filter((t) => t.active > 0);
  const avgActive = busy.length ? busy.reduce((n, t) => n + t.active, 0) / busy.length : 0;
  for (const t of r.team)
    if (
      t.overdueFollowUps >= 5 ||
      (busy.length > 1 && t.active >= 1.5 * avgActive && t.active >= 10)
    )
      out.push({
        severity: 'medium',
        area: 'Team',
        title: `${t.name} is stretched`,
        detail:
          `${t.overdueFollowUps} overdue follow-ups, ${t.active} active shipments` +
          (busy.length > 1 ? ` (team average ${fmt(avgActive)}).` : '.'),
        action: 'Reassign some shipments or follow-ups to balance the load.',
      });

  // What is going well, so it can be kept up
  const growth = change(s.shipments);
  if (growth !== null && growth >= 0.1 && (s.shipments.previous ?? 0) >= 5)
    out.push({
      severity: 'good',
      area: 'Clients',
      title: `Volume ${rise(growth, String(s.shipments.previous))}`,
      detail: `${s.shipments.value} shipments against ${s.shipments.previous} the period before.`,
      action: 'Make sure staffing and trucking keep pace.',
    });
  const profitChange = s.netProfit ? change(s.netProfit) : null;
  if (profitChange !== null && profitChange >= 0.1)
    out.push({
      severity: 'good',
      area: 'Profit',
      title: `Net profit ${rise(profitChange, money(s.netProfit!.previous ?? 0))}`,
      detail: `${money(s.netProfit!.value ?? 0)} at a ${fmt(s.marginPct?.value ?? 0)}% margin.`,
      action: 'Note which clients drove it; use them as the reference for pricing.',
    });

  const rank = { high: 0, medium: 1, good: 2 } as const;
  return out.sort((a, b) => rank[a.severity] - rank[b.severity]);
}
