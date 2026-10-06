import { Router } from 'express';
import { z } from 'zod';
import { clientInputSchema, clientListQuerySchema, hasPermission } from '@gs/shared';
import { requireAuth, requirePermission } from '../../middleware/auth';
import { parse } from '../../lib/validate';
import * as svc from './service';

const idParam = z.object({ id: z.string().uuid('Invalid client id') });
export const clientsRouter = Router();
clientsRouter.use(requireAuth);

clientsRouter.get('/', requirePermission('clients:read'), async (req, res) => {
  const q = parse(clientListQuerySchema, req.query);
  res.json(
    await svc.listClients({
      ...q,
      withProfit: hasPermission(req.auth!.permissions, 'accounting:read'),
    }),
  );
});

clientsRouter.get('/:id', requirePermission('clients:read'), async (req, res) => {
  const { id } = parse(idParam, req.params);
  res.json(await svc.getClient(id, hasPermission(req.auth!.permissions, 'accounting:read')));
});

clientsRouter.post('/', requirePermission('clients:write'), async (req, res) => {
  const id = await svc.createClient(parse(clientInputSchema, req.body), req);
  res.status(201).json({ id });
});

clientsRouter.patch('/:id', requirePermission('clients:write'), async (req, res) => {
  const { id } = parse(idParam, req.params);
  await svc.updateClient(id, parse(clientInputSchema.partial(), req.body), req);
  res.json({ id });
});

clientsRouter.delete('/:id', requirePermission('clients:write'), async (req, res) => {
  const { id } = parse(idParam, req.params);
  await svc.deleteClient(id, req);
  res.status(204).end();
});
