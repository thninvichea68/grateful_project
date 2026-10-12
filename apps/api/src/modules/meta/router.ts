import { Router } from 'express';
import { sql } from 'drizzle-orm';
import type { NavCounts } from '@gs/shared';
import { eq } from 'drizzle-orm';
import { db } from '../../db/client';
import { settings } from '../../db/schema';
import { requireAuth } from '../../middleware/auth';
import { clientCondition, scopeClients } from '../../lib/clientScope';

export const metaRouter = Router();

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
  const body: NavCounts = {
    openFollowUps: Number(row?.open ?? 0),
    overdueFollowUps: Number(row?.overdue ?? 0),
    unreadNotifications: 0,
    creditNoteInbox: Number(inbox.rows[0]?.n ?? 0),
  };
  res.json(body);
});

/** Company details printed on invoices and vouchers (edited in Settings). */
metaRouter.get('/company', requireAuth, async (_req, res) => {
  const [row] = await db.select().from(settings).where(eq(settings.key, 'company'));
  res.json(row?.value ?? {});
});
