import { Router, type Request } from 'express';
import { z } from 'zod';
import {
  analyticsQuerySchema,
  flowQuerySchema,
  hasPermission,
  type OverviewSummary,
} from '@gs/shared';
import { requireAuth, requirePermission } from '../../middleware/auth';
import { parse } from '../../lib/validate';
import * as svc from './service';

/** Parse filters; default period is the current business year. */
async function filters(req: Request) {
  const q = parse(analyticsQuerySchema, req.query);
  const today = await svc.businessToday();
  const year = Number(today.slice(0, 4));
  const range = svc.yearRange(year);
  return { ...q, from: q.from ?? range.from, to: q.to ?? range.to, today };
}

export const analyticsRouter = Router();
analyticsRouter.use(requireAuth, requirePermission('dashboard:read'));

analyticsRouter.get('/kpis', async (req, res) => res.json(await svc.kpis(await filters(req))));
analyticsRouter.get('/monthly-volume', async (req, res) =>
  res.json(await svc.monthlyVolume(await filters(req))),
);
analyticsRouter.get('/transport-share', async (req, res) =>
  res.json(await svc.transportShare(await filters(req))),
);
analyticsRouter.get('/clearance-status', async (req, res) =>
  res.json(await svc.clearanceStatus(await filters(req))),
);
analyticsRouter.get('/by-country', async (req, res) => {
  const { flow } = parse(flowQuerySchema, { flow: req.query.flow });
  res.json(await svc.byCountry(await filters(req), flow));
});
analyticsRouter.get('/forwarders', async (req, res) =>
  res.json(await svc.forwarders(await filters(req))),
);
analyticsRouter.get('/ports', async (req, res) => res.json(await svc.ports(await filters(req))));
analyticsRouter.get('/accounts', async (req, res) =>
  res.json(await svc.accounts(await filters(req))),
);
analyticsRouter.get('/profit', requirePermission('accounting:read'), async (req, res) => {
  const f = await filters(req);
  const { year } = parse(
    z.object({ year: z.coerce.number().int().min(2000).max(2100).optional() }),
    { year: req.query.year },
  );
  res.json(await svc.profit(year ?? Number(f.today.slice(0, 4)), f.today, f.clientId));
});

analyticsRouter.get('/client-revenue', requirePermission('accounting:read'), async (req, res) =>
  res.json(await svc.clientRevenue(await filters(req))),
);

export const overviewRouter = Router();
overviewRouter.use(requireAuth, requirePermission('dashboard:read'));

/**
 * Everything the Overview's top half needs in one round trip: this month's KPIs vs last
 * month, the year's monthly volume, and (for accounting roles) net profit.
 */
overviewRouter.get('/summary', async (req, res) => {
  const { year: y } = parse(
    z.object({ year: z.coerce.number().int().min(2000).max(2100).optional() }),
    { year: req.query.year },
  );
  const today = await svc.businessToday();
  const year = y ?? Number(today.slice(0, 4));
  const monthStart = `${today.slice(0, 7)}-01`;
  const d = new Date(`${monthStart}T00:00:00Z`);
  const monthEnd = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0))
    .toISOString()
    .slice(0, 10);
  const [kpis, monthly, profit] = await Promise.all([
    svc.kpis({ from: monthStart, to: monthEnd }),
    svc.monthlyVolume(svc.yearRange(year)),
    hasPermission(req.auth!.permissions, 'accounting:read')
      ? svc.profit(year, today)
      : Promise.resolve(undefined),
  ]);
  const body: OverviewSummary = { year, today, kpis, monthly, ...(profit ? { profit } : {}) };
  res.json(body);
});

overviewRouter.get('/live-consignments', async (req, res) => {
  const f = parse(analyticsQuerySchema, req.query);
  res.json(await svc.liveConsignments(f));
});
