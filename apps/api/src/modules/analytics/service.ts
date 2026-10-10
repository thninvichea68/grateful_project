import { sql, type SQL } from 'drizzle-orm';
import type {
  AccountRow,
  ClearanceStatusRow,
  ClientRevenueRow,
  CountryRow,
  ForwarderRow,
  KpiResponse,
  LiveConsignment,
  MonthlyVolumeRow,
  Period,
  PortRow,
  ProfitSummary,
  TransportShareResponse,
} from '@gs/shared';
import { db } from '../../db/client';
import { env } from '../../config/env';
import { queryRows } from '../../lib/listing';

export interface Filters {
  from?: string | undefined;
  to?: string | undefined;
  clientId?: string[] | undefined;
  direction?: string | undefined;
  transportMode?: string | undefined;
  loadType?: string | undefined;
}

/** Today's date in Phnom Penh (not the server's zone). */
export async function businessToday(): Promise<string> {
  const [r] = await queryRows<{ d: string }>(
    db,
    sql`SELECT to_char((now() AT TIME ZONE ${env.BUSINESS_TIMEZONE})::date, 'YYYY-MM-DD') AS d`,
  );
  return r!.d;
}

export function yearRange(year: number): Period {
  return { from: `${year}-01-01`, to: `${year}-12-31` };
}

/**
 * WHERE for the shipments alias `s`. The period applies to ETA; shipments without an
 * ETA are excluded from period-bound figures (they have no month to belong to).
 */
function shipWhere(f: Filters, opts: { ignoreDirection?: boolean } = {}): SQL {
  const c: SQL[] = [sql`s.deleted_at IS NULL`];
  if (f.from) c.push(sql`s.eta >= ${f.from}::date`);
  if (f.to) c.push(sql`s.eta <= ${f.to}::date`);
  if (f.clientId?.length)
    c.push(
      sql`s.client_id IN (${sql.join(
        f.clientId.map((id) => sql`${id}::uuid`),
        sql`, `,
      )})`,
    );
  if (f.direction && !opts.ignoreDirection) c.push(sql`s.direction = ${f.direction}`);
  if (f.transportMode) c.push(sql`s.transport_mode = ${f.transportMode}`);
  if (f.loadType) c.push(sql`s.load_type = ${f.loadType}`);
  return sql`WHERE ${sql.join(c, sql` AND `)}`;
}

/** Same-length period immediately before [from, to]. For a whole month, the previous whole month. */
export function previousPeriod(p: Period): Period {
  const from = new Date(`${p.from}T00:00:00Z`);
  const to = new Date(`${p.to}T00:00:00Z`);
  const lastDayOfMonth = new Date(
    Date.UTC(to.getUTCFullYear(), to.getUTCMonth() + 1, 0),
  ).getUTCDate();
  const wholeMonth =
    from.getUTCDate() === 1 &&
    to.getUTCDate() === lastDayOfMonth &&
    from.getUTCMonth() === to.getUTCMonth() &&
    from.getUTCFullYear() === to.getUTCFullYear();
  if (wholeMonth) {
    const pf = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth() - 1, 1));
    const pt = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), 0));
    return { from: pf.toISOString().slice(0, 10), to: pt.toISOString().slice(0, 10) };
  }
  const days = Math.round((to.getTime() - from.getTime()) / 86_400_000) + 1;
  const pt = new Date(from.getTime() - 86_400_000);
  const pf = new Date(pt.getTime() - (days - 1) * 86_400_000);
  return { from: pf.toISOString().slice(0, 10), to: pt.toISOString().slice(0, 10) };
}

async function counts(f: Filters) {
  const [r] = await queryRows<{
    total: number;
    imports: number;
    exports: number;
    cleared: number;
    pending: number;
    exceptions: number;
  }>(
    db,
    sql`
    SELECT count(*)::int AS total,
           (count(*) FILTER (WHERE s.direction = 'IMPORT'))::int AS imports,
           (count(*) FILTER (WHERE s.direction = 'EXPORT'))::int AS exports,
           (count(*) FILTER (WHERE s.clearance_status = 'CLEARED'))::int AS cleared,
           (count(*) FILTER (WHERE s.clearance_status IN ('PENDING', 'IN_PROGRESS')))::int AS pending,
           (count(*) FILTER (WHERE s.status = 'EXCEPTION' OR s.clearance_status = 'EXCEPTION'))::int AS exceptions
    FROM shipments s ${shipWhere(f)}`,
  );
  return r!;
}

export async function kpis(f: Filters & Period): Promise<KpiResponse> {
  const prev = previousPeriod(f);
  const [cur, before] = await Promise.all([counts(f), counts({ ...f, ...prev })]);
  return {
    period: { from: f.from, to: f.to },
    previousPeriod: prev,
    total: cur.total,
    imports: cur.imports,
    exports: cur.exports,
    cleared: cur.cleared,
    clearancePending: cur.pending,
    exceptions: cur.exceptions,
    previous: {
      total: before.total,
      imports: before.imports,
      exports: before.exports,
      cleared: before.cleared,
    },
  };
}

/** One row per month of the period, zero-filled, bucketed on ETA. */
export async function monthlyVolume(f: Filters & Period): Promise<MonthlyVolumeRow[]> {
  return queryRows<MonthlyVolumeRow>(
    db,
    sql`
    WITH months AS (
      SELECT generate_series(date_trunc('month', ${f.from}::date), date_trunc('month', ${f.to}::date), interval '1 month')::date AS m
    ), agg AS (
      SELECT date_trunc('month', s.eta)::date AS m,
             count(*) FILTER (WHERE s.direction = 'IMPORT') AS imports,
             count(*) FILTER (WHERE s.direction = 'EXPORT') AS exports
      FROM shipments s ${shipWhere(f)} GROUP BY 1
    )
    SELECT to_char(months.m, 'YYYY-MM') AS month, coalesce(agg.imports, 0)::int AS imports, coalesce(agg.exports, 0)::int AS exports,
           (coalesce(agg.imports, 0) + coalesce(agg.exports, 0))::int AS total
    FROM months LEFT JOIN agg ON agg.m = months.m ORDER BY months.m`,
  );
}

export async function transportShare(f: Filters): Promise<TransportShareResponse> {
  const c = await counts(f);
  const byMode = await queryRows<{ mode: string; count: number }>(
    db,
    sql`
    SELECT CASE WHEN s.transport_mode = 'AIR' THEN 'AIR' WHEN s.load_type = 'FCL' THEN 'CY/CY' WHEN s.load_type = 'LCL' THEN 'LCL' ELSE s.transport_mode::text END AS mode,
           count(*)::int AS count
    FROM shipments s ${shipWhere(f)} GROUP BY 1 ORDER BY 2 DESC`,
  );
  return { imports: c.imports, exports: c.exports, total: c.total, byMode };
}

export async function clearanceStatus(f: Filters): Promise<ClearanceStatusRow[]> {
  return queryRows<ClearanceStatusRow>(
    db,
    sql`
    SELECT st AS status, coalesce(x.n, 0)::int AS count
    FROM unnest(enum_range(NULL::clearance_status)) AS st
    LEFT JOIN (SELECT s.clearance_status AS cs, count(*) AS n FROM shipments s ${shipWhere(f)} GROUP BY 1) x ON x.cs = st
    ORDER BY array_position(ARRAY['CLEARED','IN_PROGRESS','PENDING','EXCEPTION']::clearance_status[], st)`,
  );
}

/** Import → origin country; export → destination country. */
export async function byCountry(f: Filters, flow: 'import' | 'export'): Promise<CountryRow[]> {
  const col = flow === 'import' ? sql`s.origin_country_iso2` : sql`s.destination_country_iso2`;
  return queryRows<CountryRow>(
    db,
    sql`
    SELECT co.iso2, co.name, count(*)::int AS count,
           round(100.0 * count(*) / nullif(sum(count(*)) OVER (), 0), 1)::float AS pct
    FROM shipments s JOIN countries co ON co.iso2 = ${col}
    ${shipWhere({ ...f, direction: flow === 'import' ? 'IMPORT' : 'EXPORT' })}
    GROUP BY co.iso2, co.name ORDER BY count DESC, co.name`,
  );
}

export async function forwarders(f: Filters): Promise<ForwarderRow[]> {
  return queryRows<ForwarderRow>(
    db,
    sql`
    SELECT fw.id, fw.name,
           count(*)::int AS shipments,
           (count(*) FILTER (WHERE s.direction = 'IMPORT'))::int AS imports,
           (count(*) FILTER (WHERE s.direction = 'EXPORT'))::int AS exports,
           (count(*) FILTER (WHERE s.direction = 'IMPORT' AND s.arrive_fty IS NOT NULL))::int AS factory,
           (count(*) FILTER (WHERE s.ata IS NOT NULL AND s.eta IS NOT NULL))::int AS arrived,
           round(100.0 * count(*) FILTER (WHERE s.ata <= s.eta) / nullif(count(*) FILTER (WHERE s.ata IS NOT NULL AND s.eta IS NOT NULL), 0), 1)::float AS "onTimePct",
           round(avg(greatest(s.ata - s.eta, 0)) FILTER (WHERE s.ata IS NOT NULL AND s.eta IS NOT NULL), 1)::float AS "avgDelayDays",
           round(100.0 * count(*) FILTER (WHERE s.status = 'EXCEPTION' OR s.clearance_status = 'EXCEPTION') / count(*), 1)::float AS "exceptionPct",
           round(100.0 * count(*) FILTER (WHERE s.clearance_status = 'CLEARED') / count(*), 1)::float AS "clearedPct"
    FROM shipments s JOIN forwarders fw ON fw.id = s.forwarder_id
    ${shipWhere(f)}
    GROUP BY fw.id, fw.name ORDER BY shipments DESC, fw.name`,
  );
}

export async function ports(f: Filters): Promise<PortRow[]> {
  return queryRows<PortRow>(
    db,
    sql`
    SELECT p.id, p.code, p.name, p.short_name AS "shortName",
           (count(*) FILTER (WHERE s.direction = 'IMPORT'))::int AS imports,
           (count(*) FILTER (WHERE s.direction = 'EXPORT'))::int AS exports,
           count(*)::int AS total
    FROM shipments s JOIN ports p ON p.id = s.clearance_port_id
    ${shipWhere(f, { ignoreDirection: true })}
    GROUP BY p.id ORDER BY total DESC, p.short_name`,
  );
}

export async function accounts(f: Filters): Promise<AccountRow[]> {
  const rows = await queryRows<{
    clientId: string;
    code: string;
    name: string;
    direction: string | null;
    total: number;
    cy: number;
    lcl: number;
    air: number;
  }>(
    db,
    sql`
    SELECT c.id AS "clientId", c.code, c.name, s.direction,
           count(s.id)::int AS total,
           (count(s.id) FILTER (WHERE s.transport_mode <> 'AIR' AND s.load_type = 'FCL'))::int AS cy,
           (count(s.id) FILTER (WHERE s.transport_mode <> 'AIR' AND s.load_type = 'LCL'))::int AS lcl,
           (count(s.id) FILTER (WHERE s.transport_mode = 'AIR'))::int AS air
    FROM clients c
    JOIN shipments s ON s.client_id = c.id
    ${shipWhere(f)} AND c.deleted_at IS NULL
    GROUP BY c.id, c.code, c.name, s.direction`,
  );
  const zero = () => ({ total: 0, cy: 0, lcl: 0, air: 0 });
  const map = new Map<string, AccountRow>();
  for (const r of rows) {
    const acc = map.get(r.clientId) ?? {
      clientId: r.clientId,
      code: r.code,
      name: r.name,
      all: zero(),
      import: zero(),
      export: zero(),
    };
    const bucket = r.direction === 'IMPORT' ? acc.import : acc.export;
    for (const k of ['total', 'cy', 'lcl', 'air'] as const) {
      bucket[k] += r[k];
      acc.all[k] += r[k];
    }
    map.set(r.clientId, acc);
  }
  return [...map.values()].sort(
    (a, b) => b.all.total - a.all.total || a.name.localeCompare(b.name),
  );
}

/** Every YYYY-MM from `from` to `to` inclusive. */
function monthsBetween(from: string, to: string): string[] {
  const out: string[] = [];
  let y = Number(from.slice(0, 4));
  let m = Number(from.slice(5, 7));
  const end = to.slice(0, 7);
  for (let key = from.slice(0, 7); key <= end && out.length < 600; ) {
    out.push(key);
    m += 1;
    if (m > 12) [y, m] = [y + 1, 1];
    key = `${y}-${String(m).padStart(2, '0')}`;
  }
  return out;
}

/**
 * Each client's ledger for the period (by invoice date): every revenue and cost column,
 * net profit, margin, share of all profit and a month-by-month trend. Ledger rows have
 * no direction or transport mode, so only the period and client filters apply.
 */
export async function clientRevenue(
  f: Filters & { from: string; to: string },
): Promise<ClientRevenueRow[]> {
  const c: SQL[] = [sql`a.inv_date BETWEEN ${f.from}::date AND ${f.to}::date`];
  if (f.clientId?.length)
    c.push(
      sql`a.client_id IN (${sql.join(
        f.clientId.map((id) => sql`${id}::uuid`),
        sql`, `,
      )})`,
    );
  const where = sql`WHERE ${sql.join(c, sql` AND `)}`;
  const rows = await queryRows<Omit<ClientRevenueRow, 'monthly'>>(
    db,
    sql`
    SELECT c.id AS "clientId", c.code, c.name, count(*)::int AS entries,
           (count(*) FILTER (WHERE a.chea_status = 'UNPAID'))::int AS unpaid,
           sum(a.inv_revenue)::text AS "invRevenue", sum(a.dis_total)::text AS "disTotal",
           sum(a.dn_total)::text AS "dnTotal", sum(a.vat)::text AS vat,
           sum(a.clear_fee)::text AS "clearFee", sum(a.thc)::text AS thc,
           sum(a.commission)::text AS commission, sum(a.other_pay)::text AS "otherPay",
           sum(a.inv_revenue + a.dis_total + a.dn_total)::text AS revenue,
           sum(a.clear_fee + a.thc + a.commission + a.other_pay)::text AS costs,
           sum(a.net_profit)::text AS "netProfit",
           round(100.0 * sum(a.net_profit) / nullif(sum(a.inv_revenue + a.dis_total + a.dn_total), 0), 1)::float AS "marginPct",
           round(100.0 * sum(a.net_profit) / nullif(sum(sum(a.net_profit)) OVER (), 0), 1)::float AS "sharePct",
           to_char(max(a.inv_date), 'YYYY-MM-DD') AS "lastInvDate"
    FROM accounting_records a JOIN clients c ON c.id = a.client_id ${where}
    GROUP BY c.id ORDER BY sum(a.net_profit) DESC, c.name`,
  );
  const monthly = await queryRows<{
    clientId: string;
    month: string;
    revenue: string;
    netProfit: string;
  }>(
    db,
    sql`
    SELECT a.client_id AS "clientId", to_char(a.inv_date, 'YYYY-MM') AS month,
           sum(a.inv_revenue + a.dis_total + a.dn_total)::text AS revenue, sum(a.net_profit)::text AS "netProfit"
    FROM accounting_records a ${where} GROUP BY 1, 2`,
  );
  const byKey = new Map(monthly.map((m) => [`${m.clientId}|${m.month}`, m]));
  const months = monthsBetween(f.from, f.to);
  return rows.map((r) => ({
    ...r,
    monthly: months.map((month) => {
      const m = byKey.get(`${r.clientId}|${month}`);
      return { month, revenue: m?.revenue ?? '0.00', netProfit: m?.netProfit ?? '0.00' };
    }),
  }));
}

/** Net profit from the monthly ledger (invoice date), for roles with accounting:read. */
export async function profit(
  year: number,
  today: string,
  clientId?: string[],
): Promise<ProfitSummary> {
  const cf = clientId?.length
    ? sql`AND a.client_id IN (${sql.join(
        clientId.map((id) => sql`${id}::uuid`),
        sql`, `,
      )})`
    : sql``;
  const monthly = await queryRows<{ month: string; netProfit: string }>(
    db,
    sql`
    WITH months AS (SELECT generate_series(make_date(${year}, 1, 1), make_date(${year}, 12, 1), interval '1 month')::date AS m)
    SELECT to_char(m, 'YYYY-MM') AS month,
           coalesce((SELECT sum(a.net_profit) FROM accounting_records a WHERE date_trunc('month', a.inv_date) = m ${cf}), 0)::text AS "netProfit"
    FROM months ORDER BY m`,
  );
  const byClient = await queryRows<{
    clientId: string;
    code: string;
    name: string;
    netProfit: string;
    pct: number;
  }>(
    db,
    sql`
    SELECT c.id AS "clientId", c.code, c.name, sum(a.net_profit)::text AS "netProfit",
           round(100.0 * sum(a.net_profit) / nullif(sum(sum(a.net_profit)) OVER (), 0), 1)::float AS pct
    FROM accounting_records a JOIN clients c ON c.id = a.client_id
    WHERE a.inv_date BETWEEN make_date(${year}, 1, 1) AND make_date(${year}, 12, 31) ${cf}
    GROUP BY c.id ORDER BY sum(a.net_profit) DESC`,
  );
  const thisKey = today.slice(0, 7);
  const prevDate = new Date(Date.UTC(Number(today.slice(0, 4)), Number(today.slice(5, 7)) - 2, 1))
    .toISOString()
    .slice(0, 7);
  const [lm] = prevDate.startsWith(String(year))
    ? [monthly.find((m) => m.month === prevDate)]
    : await queryRows<{ month: string; netProfit: string }>(
        db,
        sql`
        SELECT ${prevDate} AS month, coalesce(sum(a.net_profit), 0)::text AS "netProfit" FROM accounting_records a
        WHERE to_char(a.inv_date, 'YYYY-MM') = ${prevDate} ${cf}`,
      );
  const total = monthly.reduce((s, m) => s + Math.round(Number(m.netProfit) * 100), 0) / 100;
  return {
    year,
    total: total.toFixed(2),
    thisMonth: monthly.find((m) => m.month === thisKey)?.netProfit ?? '0',
    lastMonth: lm?.netProfit ?? '0',
    monthly,
    byClient,
  };
}

export async function liveConsignments(f: Filters, limit = 8): Promise<LiveConsignment[]> {
  return queryRows<LiveConsignment>(
    db,
    sql`
    SELECT s.id, s.reference, c.code AS "clientCode", s.direction,
           coalesce((SELECT array_agg(invoice_no ORDER BY sort_order) FROM cargo_invoices WHERE shipment_id = s.id), '{}') AS "invoiceNos",
           fw.name AS "forwarderName", p.name AS "clearancePortName", to_char(s.eta, 'YYYY-MM-DD') AS eta, s.status, s.clearance_status AS "clearanceStatus"
    FROM shipments s JOIN clients c ON c.id = s.client_id
    LEFT JOIN forwarders fw ON fw.id = s.forwarder_id LEFT JOIN ports p ON p.id = s.clearance_port_id
    ${shipWhere({ ...f, from: undefined, to: undefined })} AND s.status IN ('IN_PROGRESS', 'EXCEPTION', 'PENDING')
    ORDER BY CASE s.status WHEN 'EXCEPTION' THEN 0 WHEN 'IN_PROGRESS' THEN 1 ELSE 2 END,
             abs(s.eta - (now() AT TIME ZONE ${env.BUSINESS_TIMEZONE})::date) NULLS LAST
    LIMIT ${limit}`,
  );
}
