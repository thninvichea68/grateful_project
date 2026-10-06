import { Router } from 'express';
import { sql } from 'drizzle-orm';
import type { NavCounts } from '@gs/shared';
import { eq } from 'drizzle-orm';
import { db } from '../../db/client';
import { settings } from '../../db/schema';
import { requireAuth } from '../../middleware/auth';

export const metaRouter = Router();

/** Sidebar / top-bar badges. Read from the database, never hard-coded. */
metaRouter.get('/nav-counts', requireAuth, async (_req, res) => {
  const result = await db.execute<{ open: string; overdue: string }>(sql`
    SELECT count(*) FILTER (WHERE status <> 'DONE') AS open,
           count(*) FILTER (WHERE status <> 'DONE' AND due_at < now()) AS overdue
    FROM follow_ups WHERE deleted_at IS NULL
  `);
  const row = result.rows[0];
  const body: NavCounts = {
    openFollowUps: Number(row?.open ?? 0),
    overdueFollowUps: Number(row?.overdue ?? 0),
    unreadNotifications: 0,
  };
  res.json(body);
});

/** Company details printed on invoices and vouchers (edited in Settings). */
metaRouter.get('/company', requireAuth, async (_req, res) => {
  const [row] = await db.select().from(settings).where(eq(settings.key, 'company'));
  res.json(row?.value ?? {});
});
