import { sql, type SQL } from 'drizzle-orm';
import type { Request } from 'express';
import { forbidden, notFound } from './errors';

/**
 * Per-user client access. A user whose `clientIds` is null works with every client; a
 * restricted user only ever sees or changes records of their own clients. Records with
 * no client at all (e.g. a general follow-up) are hidden from restricted users.
 */

/** Matches no client: used when a restricted user asks for a client they can't see. */
const NONE = '00000000-0000-0000-0000-000000000000';

/** The clients this request may touch; null = every client. */
export const allowedClients = (req: Request): string[] | null => req.auth?.clientIds ?? null;

/**
 * The client filter to apply to a list: what was asked for, narrowed to what the user may
 * see. Undefined = no filter (unrestricted user who asked for all clients).
 */
export function scopeClients(
  req: Request,
  requested?: string | string[] | null,
): string[] | undefined {
  const asked = requested == null ? [] : Array.isArray(requested) ? requested : [requested];
  const allowed = allowedClients(req);
  if (!allowed) return asked.length ? asked : undefined;
  if (!asked.length) return allowed.length ? allowed : [NONE];
  const both = asked.filter((id) => allowed.includes(id));
  return both.length ? both : [NONE];
}

/** `column IN (...)` for a scoped list, or nothing when every client is allowed. */
export function clientCondition(column: SQL, ids: string[] | undefined): SQL | undefined {
  if (!ids) return undefined;
  return sql`${column} IN (${sql.join(
    ids.map((id) => sql`${id}::uuid`),
    sql`, `,
  )})`;
}

export function canAccessClient(req: Request, clientId: string | null | undefined): boolean {
  const allowed = allowedClients(req);
  if (!allowed) return true;
  return !!clientId && allowed.includes(clientId);
}

/** For reads by id: a record of another client looks like it doesn't exist. */
export function assertClientVisible(
  req: Request,
  clientId: string | null | undefined,
  entity: string,
): void {
  if (!canAccessClient(req, clientId)) throw notFound(entity);
}

/** For writes that name a client (create, or move to another client). */
export function assertClientAllowed(req: Request, clientId: string | null | undefined): void {
  if (!canAccessClient(req, clientId))
    throw forbidden('You can only work with the clients assigned to you');
}
