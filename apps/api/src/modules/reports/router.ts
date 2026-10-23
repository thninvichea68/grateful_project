import { Router } from 'express';
import { z } from 'zod';
import {
  payrollMonthInputSchema,
  productionProfileSchema,
  productionReportQuerySchema,
} from '@gs/shared';
import { requireAuth, requirePermission } from '../../middleware/auth';
import { parse } from '../../lib/validate';
import { assertClientAllowed, assertClientVisible, scopeClients } from '../../lib/clientScope';
import * as svc from './service';

/** Reports (Payroll, MIH, Import & Export). A payroll file is read in the browser; saving keeps it. */
export const reportsRouter = Router();
reportsRouter.use(requireAuth);

/** Payroll → Capacity report: the month's exports by product line, and the saved setup. */
reportsRouter.get('/production', requirePermission('reports:read'), async (req, res) => {
  const q = parse(productionReportQuerySchema, req.query);
  assertClientVisible(req, q.clientId, 'Client');
  res.json(await svc.productionReport(q.clientId, q.month));
});

reportsRouter.put(
  '/production/profile/:clientId',
  requirePermission('reports:write'),
  async (req, res) => {
    const { clientId } = parse(z.object({ clientId: z.string().uuid() }), req.params);
    assertClientAllowed(req, clientId);
    res.json(await svc.saveProfile(clientId, parse(productionProfileSchema, req.body), req));
  },
);

const idParam = z.object({ id: z.string().uuid('Invalid payroll month id') });

/** Payroll → saved months, newest first. */
reportsRouter.get('/payroll', requirePermission('reports:read'), async (req, res) => {
  res.json(await svc.listPayrollMonths(scopeClients(req)));
});

/** One saved month with its staff rows, to reopen it as imported. */
reportsRouter.get('/payroll/:id', requirePermission('reports:read'), async (req, res) => {
  const { id } = parse(idParam, req.params);
  const month = await svc.getPayrollMonth(id);
  assertClientVisible(req, month.clientId, 'Payroll month');
  res.json(month);
});

/** Payroll → Save month. 409 when the month is saved already and `replace` isn't set. */
reportsRouter.post('/payroll', requirePermission('reports:write'), async (req, res) => {
  const v = parse(payrollMonthInputSchema, req.body);
  assertClientAllowed(req, v.clientId);
  res.status(201).json(await svc.savePayrollMonth(v, req));
});

reportsRouter.delete('/payroll/:id', requirePermission('reports:write'), async (req, res) => {
  const { id } = parse(idParam, req.params);
  const month = await svc.getPayrollMonth(id);
  assertClientVisible(req, month.clientId, 'Payroll month');
  await svc.deletePayrollMonth(id, req);
  res.status(204).end();
});
