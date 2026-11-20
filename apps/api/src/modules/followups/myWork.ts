import { sql, type SQL } from 'drizzle-orm';
import type { MyWork, MyWorkAlert, MyWorkClient, MyWorkJob } from '@gs/shared';
import { db } from '../../db/client';
import { env } from '../../config/env';
import { isoTs, queryRows } from '../../lib/listing';
import { clientCondition } from '../../lib/clientScope';
import { unbilledSql } from '../shipments/service';

/**
 * My Work: what operations must push today, read straight from the shipping plans. A job is a
 * plan with an open milestone; its stage is the first open one, due on the milestone's planned date.
 */
export async function myWork(clientIds: string[] | undefined): Promise<MyWork> {
  const tz = env.BUSINESS_TIMEZONE;
  const today = sql`(now() AT TIME ZONE ${tz})::date`;
  const scoped = clientCondition(sql`s.client_id`, clientIds);
  const and = (c: SQL | undefined) => (c ? sql`AND ${c}` : sql``);
  // Milestones that count: the rule is on, and not skipped because another broker clears.
  const live = sql`f.deleted_at IS NULL AND mr.active
    AND NOT (mr.skip_when_cleared_by_other AND s.cleared_by <> 'GS')`;

  const jobs = await queryRows<MyWorkJob>(
    db,
    sql`
    WITH steps AS (
      SELECT f.shipment_id, f.id, f.status, f.planned_at, mr.name, mr.owner_role, mr.sequence
      FROM follow_ups f
      JOIN milestone_rules mr ON mr.id = f.milestone_rule_id
      JOIN shipments s ON s.id = f.shipment_id
      WHERE ${live} AND s.deleted_at IS NULL ${and(scoped)}
    ),
    cur AS (
      SELECT DISTINCT ON (shipment_id) shipment_id, id, name, owner_role, planned_at
      FROM steps WHERE status <> 'DONE' ORDER BY shipment_id, sequence
    ),
    prog AS (
      SELECT shipment_id, count(*) FILTER (WHERE status = 'DONE')::int AS done, count(*)::int AS total
      FROM steps GROUP BY shipment_id
    )
    SELECT s.id AS "shipmentId", s.reference, s.direction::text AS direction,
           c.id AS "clientId", c.code AS "clientCode", c.name AS "clientName",
           CASE WHEN s.quantity IS NULL THEN NULL
                ELSE trim(to_char(s.quantity, 'FM999,999,990.##') || ' ' || coalesce(s.quantity_unit::text, '')) END AS quantity,
           CASE WHEN s.transport_mode = 'AIR' THEN 'AIR'
                WHEN s.load_type = 'LCL' THEN trim('LCL ' || coalesce(to_char(s.cbm, 'FM999,990.##') || ' CBM', ''))
                ELSE (SELECT string_agg(n || '×' || size, ', ' ORDER BY size)
                      FROM (SELECT size::text AS size, count(*) AS n FROM containers WHERE shipment_id = s.id GROUP BY size) z)
           END AS equipment,
           cur.id AS "followUpId", cur.name AS stage, cur.owner_role AS "stageOwner",
           ${isoTs('cur.planned_at')} AS "dueAt",
           coalesce(cur.planned_at < now(), false) AS overdue,
           coalesce((cur.planned_at AT TIME ZONE ${tz})::date = ${today}, false) AS "dueToday",
           CASE WHEN s.direction = 'IMPORT' THEN (CASE WHEN s.ata IS NULL THEN 'ETA' ELSE 'ATA' END)
                ELSE (CASE WHEN s.atd IS NULL THEN 'ETD' ELSE 'ATD' END) END AS "keyDateLabel",
           to_char(CASE WHEN s.direction = 'IMPORT' THEN coalesce(s.ata, s.eta) ELSE coalesce(s.atd, s.etd) END, 'YYYY-MM-DD') AS "keyDate",
           prog.done AS "stepsDone", prog.total AS "stepsTotal"
    FROM cur
    JOIN shipments s ON s.id = cur.shipment_id
    JOIN clients c ON c.id = s.client_id
    JOIN prog ON prog.shipment_id = s.id
    ORDER BY cur.planned_at ASC NULLS LAST, s.reference`,
  );

  const [arriving] = await queryRows<MyWork['arriving']>(
    db,
    sql`
    SELECT count(*)::int AS shipments,
           coalesce(sum((SELECT count(*) FROM containers x WHERE x.shipment_id = s.id)) FILTER (WHERE s.load_type = 'FCL'), 0)::int AS containers,
           (count(*) FILTER (WHERE s.load_type = 'LCL' AND s.transport_mode <> 'AIR'))::int AS lcl,
           (count(*) FILTER (WHERE s.transport_mode = 'AIR'))::int AS air
    FROM shipments s
    WHERE s.deleted_at IS NULL AND s.direction = 'IMPORT' AND s.ata IS NULL
      AND s.eta BETWEEN ${today} AND ${today} + 3 ${and(scoped)}`,
  );

  const unbilled = await queryRows<{
    id: string;
    reference: string;
    direction: string;
    clientCode: string;
  }>(
    db,
    sql`
    SELECT s.id, s.reference, s.direction::text AS direction, c.code AS "clientCode"
    FROM shipments s JOIN clients c ON c.id = s.client_id
    WHERE s.deleted_at IS NULL AND ${unbilledSql()} ${and(scoped)}
    ORDER BY s.reference`,
  );

  // Plan dates that have passed with no actual: the vessel's arrival or departure isn't confirmed.
  const late = await queryRows<{
    id: string;
    reference: string;
    direction: string;
    clientCode: string;
    planned: string;
    days: number;
  }>(
    db,
    sql`
    SELECT s.id, s.reference, s.direction::text AS direction, c.code AS "clientCode",
           to_char(CASE WHEN s.direction = 'IMPORT' THEN s.eta ELSE s.etd END, 'DD Mon') AS planned,
           (${today} - CASE WHEN s.direction = 'IMPORT' THEN s.eta ELSE s.etd END)::int AS days
    FROM shipments s JOIN clients c ON c.id = s.client_id
    WHERE s.deleted_at IS NULL AND s.status <> 'COMPLETED' ${and(scoped)}
      AND ((s.direction = 'IMPORT' AND s.ata IS NULL AND s.eta < ${today})
        OR (s.direction = 'EXPORT' AND s.atd IS NULL AND s.etd < ${today}))
    ORDER BY days DESC LIMIT 6`,
  );

  const alerts: MyWorkAlert[] = late.map((r) =>
    r.direction === 'IMPORT'
      ? {
          kind: 'ETA_PASSED',
          severity: r.days > 2 ? 'high' : 'medium',
          title: `ETA passed ${r.days} day${r.days === 1 ? '' : 's'} ago, no ATA`,
          detail: `${r.reference} · ${r.clientCode} · ETA ${r.planned}`,
          shipmentId: r.id,
        }
      : {
          kind: 'ETD_PASSED',
          severity: r.days > 2 ? 'high' : 'medium',
          title: `ETD passed ${r.days} day${r.days === 1 ? '' : 's'} ago, no ATD`,
          detail: `${r.reference} · ${r.clientCode} · ETD ${r.planned}`,
          shipmentId: r.id,
        },
  );
  if (unbilled.length)
    alerts.push({
      kind: 'NOT_INVOICED',
      severity: 'high',
      title:
        unbilled.length === 1
          ? 'Completed job not invoiced to client'
          : `${unbilled.length} completed jobs not invoiced to client`,
      detail: unbilled
        .slice(0, 4)
        .map((u) => `${u.reference} (${u.clientCode})`)
        .join(' · ')
        .concat(unbilled.length > 4 ? ` +${unbilled.length - 4} more` : ''),
      shipmentId: unbilled.length === 1 ? unbilled[0]!.id : null,
    });
  alerts.sort((a, b) => (a.severity === b.severity ? 0 : a.severity === 'high' ? -1 : 1));

  // Clients with live jobs, busiest first.
  const byClient = new Map<string, MyWorkClient>();
  for (const j of jobs) {
    const c = byClient.get(j.clientId) ?? {
      id: j.clientId,
      code: j.clientCode,
      name: j.clientName,
      activeJobs: 0,
      overdue: 0,
    };
    c.activeJobs += 1;
    if (j.overdue) c.overdue += 1;
    byClient.set(j.clientId, c);
  }

  return {
    jobs,
    arriving: arriving ?? { shipments: 0, containers: 0, lcl: 0, air: 0 },
    notInvoiced: {
      import: unbilled.filter((u) => u.direction === 'IMPORT').length,
      export: unbilled.filter((u) => u.direction === 'EXPORT').length,
    },
    alerts,
    clients: [...byClient.values()].sort(
      (a, b) =>
        b.overdue - a.overdue || b.activeJobs - a.activeJobs || a.code.localeCompare(b.code),
    ),
  };
}
