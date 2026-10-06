import { Router } from 'express';
import { asc, eq, isNull } from 'drizzle-orm';
import {
  LOOKUP_TYPES,
  consigneeInputSchema,
  forwarderInputSchema,
  type LookupType,
  type LookupsResponse,
} from '@gs/shared';
import { db } from '../../db/client';
import { clients, consignees, countries, forwarders, lookupValues, ports } from '../../db/schema';
import { requireAuth, requirePermission } from '../../middleware/auth';
import { parse } from '../../lib/validate';
import { audit } from '../../lib/audit';

export const lookupsRouter = Router();
lookupsRouter.use(requireAuth);

/** Everything the forms' dropdowns need, in one request. */
lookupsRouter.get('/', async (_req, res) => {
  const [c, cn, f, p, co, v] = await Promise.all([
    db
      .select({
        id: clients.id,
        code: clients.code,
        name: clients.name,
        status: clients.status,
        commissionUsd: clients.commissionUsd,
      })
      .from(clients)
      .where(isNull(clients.deletedAt))
      .orderBy(asc(clients.name)),
    db
      .select({
        id: consignees.id,
        name: consignees.name,
        clientId: consignees.clientId,
        countryIso2: consignees.countryIso2,
      })
      .from(consignees)
      .where(eq(consignees.isActive, true))
      .orderBy(asc(consignees.name)),
    db
      .select({ id: forwarders.id, code: forwarders.code, name: forwarders.name })
      .from(forwarders)
      .where(eq(forwarders.isActive, true))
      .orderBy(asc(forwarders.name)),
    db
      .select({
        id: ports.id,
        code: ports.code,
        name: ports.name,
        shortName: ports.shortName,
        kind: ports.kind,
        customsPortNo: ports.customsPortNo,
      })
      .from(ports)
      .where(eq(ports.isActive, true))
      .orderBy(asc(ports.name)),
    db
      .select({ iso2: countries.iso2, name: countries.name })
      .from(countries)
      .orderBy(asc(countries.name)),
    db
      .select({ type: lookupValues.type, value: lookupValues.value, label: lookupValues.label })
      .from(lookupValues)
      .where(eq(lookupValues.isActive, true))
      .orderBy(asc(lookupValues.type), asc(lookupValues.sortOrder)),
  ]);
  const values = Object.fromEntries(
    LOOKUP_TYPES.map((t) => [t, [] as { value: string; label: string }[]]),
  ) as LookupsResponse['values'];
  for (const row of v) values[row.type as LookupType].push({ value: row.value, label: row.label });
  const body: LookupsResponse = {
    clients: c,
    consignees: cn,
    forwarders: f,
    ports: p,
    countries: co,
    values,
  };
  res.json(body);
});

lookupsRouter.post('/consignees', requirePermission('shipments:write'), async (req, res) => {
  const input = parse(consigneeInputSchema, req.body);
  const row = await db.transaction(async (tx) => {
    const [created] = await tx.insert(consignees).values(input).returning();
    await audit(
      tx,
      { action: 'CREATE', entity: 'consignee', entityId: created!.id, after: created },
      req,
    );
    return created!;
  });
  res
    .status(201)
    .json({ id: row.id, name: row.name, clientId: row.clientId, countryIso2: row.countryIso2 });
});

lookupsRouter.post('/forwarders', requirePermission('shipments:write'), async (req, res) => {
  const input = parse(forwarderInputSchema, req.body);
  const code =
    input.code ??
    input.name
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, '')
      .slice(0, 12);
  const row = await db.transaction(async (tx) => {
    const [created] = await tx.insert(forwarders).values({ code, name: input.name }).returning();
    await audit(
      tx,
      { action: 'CREATE', entity: 'forwarder', entityId: created!.id, after: created },
      req,
    );
    return created!;
  });
  res.status(201).json({ id: row.id, code: row.code, name: row.name });
});
