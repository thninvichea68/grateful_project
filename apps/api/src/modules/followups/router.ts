import { Router, type Request } from 'express';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import {
  followUpInputSchema,
  followUpListQuerySchema,
  followUpUpdateSchema,
  type FollowUpRow,
} from '@gs/shared';
import { db } from '../../db/client';
import { followUps, milestoneRules } from '../../db/schema';
import { requireAuth, requirePermission } from '../../middleware/auth';
import { parse } from '../../lib/validate';
import { audit } from '../../lib/audit';
import { badRequest, notFound } from '../../lib/errors';
import { likePattern, paginate, queryRows, toPaginated, whereAll, isoTs } from '../../lib/listing';
import { formatNumber, nextNumber } from '../../lib/numbering';
import {
  allowedClients,
  assertClientAllowed,
  assertClientVisible,
  clientCondition,
  scopeClients,
} from '../../lib/clientScope';
import { shipmentClientId } from '../shipments/service';
import { myWork } from './myWork';

const FU_CLIENT = sql`coalesce(f.client_id, s.client_id)`;

const idParam = z.object({ id: z.string().uuid() });
export const followUpsRouter = Router();
followUpsRouter.use(requireAuth);

/** "2026-10-06T17:00" (no zone) is Phnom Penh local time (UTC+7). */
function toInstant(v: string): Date {
  const withZone = /[zZ]|[+-]\d{2}:?\d{2}$/.test(v)
    ? v
    : `${v.length === 10 ? `${v}T17:00` : v}+07:00`;
  const d = new Date(withZone);
  if (Number.isNaN(d.getTime())) throw badRequest('Date and time is not valid');
  return d;
}

const PLANNED_AT = 'CASE WHEN f.milestone_rule_id IS NULL THEN f.due_at ELSE f.planned_at END';
const PLANNED_DUE = sql.raw(PLANNED_AT);
const SELECT = sql`
  SELECT f.id, f.reference, f.subject, f.notes, f.client_id AS "clientId", c.name AS "clientName", f.shipment_id AS "shipmentId",
         s.reference AS "shipmentReference", f.assignee_id AS "assigneeId", u.full_name AS "assigneeName",
         f.priority, f.status, (f.status <> 'DONE' AND ${PLANNED_DUE} IS NOT NULL AND ${PLANNED_DUE} < now()) AS overdue,
         (f.status = 'DONE' AND f.actual_at IS NOT NULL AND ${PLANNED_DUE} IS NOT NULL AND f.actual_at > ${PLANNED_DUE}) AS "completedLate",
         ${isoTs('CASE WHEN f.milestone_rule_id IS NULL THEN f.due_at ELSE f.planned_at END')} AS "dueAt",
         ${isoTs('f.actual_at')} AS "actualAt", f.milestone_rule_id AS "milestoneRuleId", mr.owner_role AS "ownerRole",
         mr.completion_field AS "completionField",
         ${isoTs('f.completed_at')} AS "completedAt"
  FROM follow_ups f LEFT JOIN clients c ON c.id = f.client_id LEFT JOIN shipments s ON s.id = f.shipment_id
  LEFT JOIN users u ON u.id = f.assignee_id LEFT JOIN milestone_rules mr ON mr.id = f.milestone_rule_id`;

// My Work: live jobs from the shipping plans with their current stage, alerts and clients.
followUpsRouter.get('/my-work', requirePermission('followups:read'), async (req, res) => {
  res.json(await myWork(scopeClients(req, undefined, 'shipments')));
});

followUpsRouter.get('/', requirePermission('followups:read'), async (req, res) => {
  const q = parse(followUpListQuerySchema, req.query);
  const c = [sql`f.deleted_at IS NULL`];
  c.push(
    sql`(f.milestone_rule_id IS NULL OR (mr.active AND NOT (mr.skip_when_cleared_by_other AND s.cleared_by <> 'GS')))`,
  );
  if (q.status === 'ACTIVE') c.push(sql`f.status <> 'DONE'`);
  else if (q.status) c.push(sql`f.status = ${q.status}`);
  if (q.priority) c.push(sql`f.priority = ${q.priority}`);
  if (q.assigneeId) c.push(sql`f.assignee_id = ${q.assigneeId}`);
  if (q.clientId) c.push(sql`f.client_id = ${q.clientId}`);
  const scoped = clientCondition(FU_CLIENT, scopeClients(req));
  if (scoped) c.push(scoped);
  if (q.overdue)
    c.push(sql`f.status <> 'DONE' AND ${PLANNED_DUE} IS NOT NULL AND ${PLANNED_DUE} < now()`);
  if (q.q) {
    const like = likePattern(q.q);
    c.push(
      sql`(f.reference ILIKE ${like} OR f.subject ILIKE ${like} OR c.name ILIKE ${like} OR s.reference ILIKE ${like})`,
    );
  }
  const rows = await queryRows<FollowUpRow & { total_count: string }>(
    db,
    sql`
    ${SELECT} ${whereAll(c)}
    ORDER BY (f.status = 'DONE'), (f.status <> 'DONE' AND ${PLANNED_DUE} < now()) DESC, ${PLANNED_DUE} NULLS LAST, f.reference
    ${paginate(q.page, q.pageSize)}`,
  );
  const [count] = await queryRows<{ n: string }>(
    db,
    sql`SELECT count(*) AS n FROM follow_ups f LEFT JOIN clients c ON c.id = f.client_id LEFT JOIN shipments s ON s.id = f.shipment_id
        LEFT JOIN milestone_rules mr ON mr.id = f.milestone_rule_id ${whereAll(c)}`,
  );
  res.json(
    toPaginated(
      rows.map((r) => ({ ...r, total_count: count!.n })),
      q.page,
      q.pageSize,
    ),
  );
});

/** A follow-up belongs to its own client, or else to its shipment's client. */
async function followUpClientId(id: string): Promise<string | null> {
  const [r] = await queryRows<{ clientId: string | null }>(
    db,
    sql`SELECT ${FU_CLIENT} AS "clientId" FROM follow_ups f LEFT JOIN shipments s ON s.id = f.shipment_id WHERE f.id = ${id} AND f.deleted_at IS NULL`,
  );
  if (!r) throw notFound('Follow-up');
  return r.clientId;
}
/** Restricted users may only file follow-ups under their own clients or shipments. */
async function assertLinksAllowed(
  req: Request,
  v: { clientId?: string | null | undefined; shipmentId?: string | null | undefined },
) {
  if (!allowedClients(req)) return;
  if (v.clientId) assertClientAllowed(req, v.clientId);
  if (v.shipmentId) assertClientAllowed(req, await shipmentClientId(v.shipmentId));
  if (!v.clientId && !v.shipmentId) assertClientAllowed(req, null);
}

async function getOne(id: string) {
  const [row] = await queryRows<FollowUpRow>(
    db,
    sql`${SELECT} WHERE f.id = ${id} AND f.deleted_at IS NULL`,
  );
  if (!row) throw notFound('Follow-up');
  return row;
}

followUpsRouter.post('/', requirePermission('followups:write'), async (req, res) => {
  const v = parse(followUpInputSchema, req.body);
  if (!v.dueAt) throw badRequest('Enter a due date');
  const dueAt = v.dueAt;
  if (v.status === 'DONE' && !v.actualAt)
    throw badRequest('Enter an actual date to complete a follow-up');
  await assertLinksAllowed(req, v);
  const id = await db.transaction(async (tx) => {
    const reference = formatNumber.followUp(await nextNumber(tx, 'FOLLOW_UP'));
    const [row] = await tx
      .insert(followUps)
      .values({
        ...v,
        reference,
        dueAt: toInstant(dueAt),
        actualAt: v.actualAt ? toInstant(v.actualAt) : null,
        status: v.actualAt ? 'DONE' : v.status,
        completedAt: v.actualAt ? toInstant(v.actualAt) : null,
        completedById: v.actualAt ? req.auth!.userId : null,
        createdById: req.auth!.userId,
      })
      .returning();
    await audit(tx, { action: 'CREATE', entity: 'follow_up', entityId: row!.id, after: row }, req);
    return row!.id;
  });
  res.status(201).json(await getOne(id));
});

followUpsRouter.patch('/:id', requirePermission('followups:write'), async (req, res) => {
  const { id } = parse(idParam, req.params);
  const v = parse(followUpUpdateSchema, req.body);
  assertClientVisible(req, await followUpClientId(id), 'Follow-up');
  if ('clientId' in v || 'shipmentId' in v) await assertLinksAllowed(req, v);
  await db.transaction(async (tx) => {
    const [before] = await tx
      .select()
      .from(followUps)
      .where(and(eq(followUps.id, id), isNull(followUps.deletedAt)))
      .for('update');
    if (!before) throw notFound('Follow-up');
    if (v.actualAt !== undefined && before.milestoneRuleId) {
      const [rule] = await tx
        .select({ completionField: milestoneRules.completionField })
        .from(milestoneRules)
        .where(eq(milestoneRules.id, before.milestoneRuleId));
      if (rule?.completionField)
        throw badRequest('Record this actual date on the linked shipment plan');
    }
    if (v.status === 'DONE' && !before.actualAt && !v.actualAt)
      throw badRequest('Enter an actual date to complete a follow-up');
    if (v.status && v.status !== 'DONE' && before.actualAt && v.actualAt === undefined)
      throw badRequest('Clear the actual date before reopening a follow-up');
    const patch: Partial<typeof followUps.$inferInsert> = Object.fromEntries(
      Object.entries({ ...v, dueAt: undefined, actualAt: undefined, status: undefined }).filter(
        ([, x]) => x !== undefined,
      ),
    );
    if (v.dueAt) patch.dueAt = toInstant(v.dueAt);
    if (v.actualAt !== undefined) {
      patch.actualAt = v.actualAt ? toInstant(v.actualAt) : null;
      patch.status = v.actualAt ? 'DONE' : v.status === 'DONE' ? 'OPEN' : (v.status ?? 'OPEN');
      patch.completedAt = v.actualAt ? toInstant(v.actualAt) : null;
      patch.completedById = v.actualAt ? req.auth!.userId : null;
    } else if (v.status) {
      patch.status = v.status;
    }
    const [after] = await tx.update(followUps).set(patch).where(eq(followUps.id, id)).returning();
    await audit(tx, { action: 'UPDATE', entity: 'follow_up', entityId: id, before, after }, req);
  });
  res.json(await getOne(id));
});

followUpsRouter.delete('/:id', requirePermission('followups:write'), async (req, res) => {
  const { id } = parse(idParam, req.params);
  assertClientVisible(req, await followUpClientId(id), 'Follow-up');
  const [before] = await db
    .select({ milestoneRuleId: followUps.milestoneRuleId })
    .from(followUps)
    .where(and(eq(followUps.id, id), isNull(followUps.deletedAt)));
  if (!before) throw notFound('Follow-up');
  if (before.milestoneRuleId) throw badRequest('Shipment milestones cannot be deleted here');
  const [row] = await db
    .update(followUps)
    .set({ deletedAt: new Date() })
    .where(and(eq(followUps.id, id), isNull(followUps.deletedAt)))
    .returning();
  if (!row) throw notFound('Follow-up');
  await audit(db, { action: 'DELETE', entity: 'follow_up', entityId: id, before: row }, req);
  res.status(204).end();
});
