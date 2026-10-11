import { Router } from 'express';
import { z } from 'zod';
import { clientInputSchema, clientListQuerySchema, hasPermission } from '@gs/shared';
import { requireAuth, requirePermission } from '../../middleware/auth';
import { parse } from '../../lib/validate';
import * as svc from './service';
import {
  allowedClients,
  assertClientAllowed,
  assertClientVisible,
  scopeClients,
} from '../../lib/clientScope';

const idParam = z.object({ id: z.string().uuid('Invalid client id') });
export const clientsRouter = Router();
clientsRouter.use(requireAuth);

clientsRouter.get('/', requirePermission('clients:read'), async (req, res) => {
  const q = parse(clientListQuerySchema, req.query);
  res.json(
    await svc.listClients({
      ...q,
      ids: scopeClients(req),
      withProfit: hasPermission(req.auth!.permissions, 'accounting:read'),
    }),
  );
});

clientsRouter.get('/:id', requirePermission('clients:read'), async (req, res) => {
  const { id } = parse(idParam, req.params);
  assertClientVisible(req, id, 'Client');
  res.json(await svc.getClient(id, hasPermission(req.auth!.permissions, 'accounting:read')));
});

clientsRouter.post('/', requirePermission('clients:write'), async (req, res) => {
  // A user limited to some clients can't add new ones (they'd never see them).
  if (allowedClients(req)) assertClientAllowed(req, null);
  const id = await svc.createClient(parse(clientInputSchema, req.body), req);
  res.status(201).json({ id });
});

clientsRouter.patch('/:id', requirePermission('clients:write'), async (req, res) => {
  const { id } = parse(idParam, req.params);
  assertClientVisible(req, id, 'Client');
  await svc.updateClient(id, parse(clientInputSchema.partial(), req.body), req);
  res.json({ id });
});

clientsRouter.delete('/:id', requirePermission('clients:write'), async (req, res) => {
  const { id } = parse(idParam, req.params);
  assertClientVisible(req, id, 'Client');
  await svc.deleteClient(id, req);
  res.status(204).end();
});
