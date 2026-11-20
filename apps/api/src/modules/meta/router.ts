import { Router } from 'express';
import { sql } from 'drizzle-orm';
import type { NavCounts } from '@gs/shared';
import { eq } from 'drizzle-orm';
import { db } from '../../db/client';
import { settings } from '../../db/schema';
import { requireAuth } from '../../middleware/auth';
import { clientCondition, scopeClients } from '../../lib/clientScope';
import { listVatRates } from '../accounting/ledger';

export const metaRouter = Router();

/** Sidebar / top-bar badges. Read from the database, never hard-coded. */
metaRouter.get('/nav-counts', requireAuth, async (req, res) => {
  // Only follow-ups of the clients this user may see (same rule as the Follow-Up list).
  const scoped = clientCondition(sql`coalesce(f.client_id, s.client_id)`, scopeClients(req));
  // Overdue = what My Work shows: shipping plans whose current milestone (the first open one)
  // is past its planned date, plus manual follow-ups past due. Later steps of the same plan
  // aren't counted again.
  const live = sql`f.deleted_at IS NULL
      AND (f.milestone_rule_id IS NULL OR
        (mr.active AND NOT (mr.skip_when_cleared_by_other AND s.cleared_by <> 'GS')))
      ${scoped ? sql`AND ${scoped}` : sql``}`;
  const result = await db.execute<{ open: string; overdue: string }>(sql`
    WITH live AS (
      SELECT f.id, f.shipment_id, f.milestone_rule_id, f.status, f.due_at, f.planned_at, mr.sequence
      FROM follow_ups f LEFT JOIN shipments s ON s.id = f.shipment_id
      LEFT JOIN milestone_rules mr ON mr.id = f.milestone_rule_id
      WHERE ${live}
    ),
    cur AS (
      SELECT DISTINCT ON (shipment_id) planned_at FROM live
      WHERE milestone_rule_id IS NOT NULL AND status <> 'DONE' ORDER BY shipment_id, sequence
    )
    SELECT (SELECT count(*) FROM live WHERE status <> 'DONE') AS open,
           (SELECT count(*) FROM cur WHERE planned_at < now())
           + (SELECT count(*) FROM live WHERE milestone_rule_id IS NULL AND status <> 'DONE' AND due_at < now())
             AS overdue
  `);
  const row = result.rows[0];
  const inbox = await db.execute<{ n: string }>(sql`
    SELECT count(*) AS n FROM credit_note_messages
    WHERE recipient_id = ${req.auth!.userId} AND read_at IS NULL AND kind = 'REVISED'`);
  const rsInbox = await db.execute<{ n: string }>(sql`
    SELECT count(*) AS n FROM record_summary_messages
    WHERE recipient_id = ${req.auth!.userId} AND read_at IS NULL AND kind = 'REVISED'`);
  const body: NavCounts = {
    openFollowUps: Number(row?.open ?? 0),
    overdueFollowUps: Number(row?.overdue ?? 0),
    unreadNotifications: 0,
    creditNoteInbox: Number(inbox.rows[0]?.n ?? 0),
    recordSummaryInbox: Number(rsInbox.rows[0]?.n ?? 0),
  };
  res.json(body);
});

/**
 * The dated VAT percents (Settings → Tax Management), for every signed-in user: document
 * editors preview totals at the percent of the document's date.
 */
metaRouter.get('/vat-rates', requireAuth, async (_req, res) => {
  res.json(await listVatRates());
});

/** Company details printed on invoices and vouchers (edited in Settings). */
metaRouter.get('/company', requireAuth, async (_req, res) => {
  const [row] = await db.select().from(settings).where(eq(settings.key, 'company'));
  res.json(row?.value ?? {});
});
