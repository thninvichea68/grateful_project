import { Router, type Request } from 'express';
import { sql } from 'drizzle-orm';
import type { NavCounts, NotificationItem } from '@gs/shared';
import { eq } from 'drizzle-orm';
import { db } from '../../db/client';
import { requireAuth } from '../../middleware/auth';
import { clientCondition, scopeClients } from '../../lib/clientScope';
import { isoTs, queryRows } from '../../lib/listing';
import { settings, users } from '../../db/schema';

export const metaRouter = Router();

/**
 * The bell's alerts: open follow-ups of the clients this user may see. Each alerts when it is
 * raised and again when it goes overdue; it is unread if that happened after the user last
 * opened the list.
 */
const alerts = (req: Request) => {
  const scoped = clientCondition(sql`coalesce(f.client_id, s.client_id)`, scopeClients(req));
  return sql`
    SELECT f.id, f.reference, f.subject, f.rule, f.priority, f.due_at, f.shipment_id, s.reference AS shipment_reference,
           c.name AS client_name, f.due_at < now() AS overdue,
           CASE WHEN f.due_at < now() THEN greatest(f.created_at, f.due_at) ELSE f.created_at END AS alert_at,
           (CASE WHEN f.due_at < now() THEN greatest(f.created_at, f.due_at) ELSE f.created_at END)
             > coalesce((SELECT u.alerts_seen_at FROM users u WHERE u.id = ${req.auth!.userId}), '-infinity') AS unread
    FROM follow_ups f
    LEFT JOIN shipments s ON s.id = f.shipment_id
    LEFT JOIN clients c ON c.id = coalesce(f.client_id, s.client_id)
    WHERE f.deleted_at IS NULL AND f.status <> 'DONE' ${scoped ? sql`AND ${scoped}` : sql``}`;
};

/** The bell's list: unread first, then overdue, then the newest. */
metaRouter.get('/notifications', requireAuth, async (req, res) => {
  const rows = await queryRows<NotificationItem>(
    db,
    sql`SELECT a.id, a.reference, a.subject, a.rule, a.priority, ${isoTs('a.due_at')} AS "dueAt", a.overdue,
               a.shipment_id AS "shipmentId", a.shipment_reference AS "shipmentReference",
               a.client_name AS "clientName", ${isoTs('a.alert_at')} AS "alertAt", a.unread
        FROM (${alerts(req)}) a
        ORDER BY a.unread DESC, a.overdue DESC, a.alert_at DESC LIMIT 30`,
  );
  res.json(rows);
});

/** The user opened the list: everything in it is read. */
metaRouter.post('/notifications/seen', requireAuth, async (req, res) => {
  await db.update(users).set({ alertsSeenAt: new Date() }).where(eq(users.id, req.auth!.userId));
  res.status(204).end();
});

/** Sidebar / top-bar badges. Read from the database, never hard-coded. */
metaRouter.get('/nav-counts', requireAuth, async (req, res) => {
  // Only follow-ups of the clients this user may see (same rule as the Follow-Up list).
  const scoped = clientCondition(sql`coalesce(f.client_id, s.client_id)`, scopeClients(req));
  const result = await db.execute<{ open: string; overdue: string }>(sql`
    SELECT count(*) FILTER (WHERE f.status <> 'DONE') AS open,
           count(*) FILTER (WHERE f.status <> 'DONE' AND f.due_at < now()) AS overdue
    FROM follow_ups f LEFT JOIN shipments s ON s.id = f.shipment_id
    WHERE f.deleted_at IS NULL ${scoped ? sql`AND ${scoped}` : sql``}
  `);
  const row = result.rows[0];
  const inbox = await db.execute<{ n: string }>(sql`
    SELECT count(*) AS n FROM credit_note_messages
    WHERE recipient_id = ${req.auth!.userId} AND read_at IS NULL`);
  const rsInbox = await db.execute<{ n: string }>(sql`
    SELECT count(*) AS n FROM record_summary_messages
    WHERE recipient_id = ${req.auth!.userId} AND read_at IS NULL`);
  const [unread] = await queryRows<{ n: number }>(
    db,
    sql`SELECT count(*)::int AS n FROM (${alerts(req)}) a WHERE a.unread`,
  );
  const body: NavCounts = {
    openFollowUps: Number(row?.open ?? 0),
    overdueFollowUps: Number(row?.overdue ?? 0),
    unreadNotifications: unread?.n ?? 0,
    creditNoteInbox: Number(inbox.rows[0]?.n ?? 0),
    recordSummaryInbox: Number(rsInbox.rows[0]?.n ?? 0),
  };
  res.json(body);
});

/** Company details printed on invoices and vouchers (edited in Settings). */
metaRouter.get('/company', requireAuth, async (_req, res) => {
  const [row] = await db.select().from(settings).where(eq(settings.key, 'company'));
  res.json(row?.value ?? {});
});
