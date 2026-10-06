import bcrypt from 'bcryptjs';
import { and, eq, isNull, ne, sql } from 'drizzle-orm';
import {
  PERMISSIONS,
  type Permission,
  type RoleCode,
  type RoleInfo,
  type StaffMember,
} from '@gs/shared';
import type { Request } from 'express';
import type { z } from 'zod';
import type { staffInputSchema, staffUpdateSchema } from '@gs/shared';
import { db, type Tx } from '../../db/client';
import { refreshTokens, roles, staffProfiles, users } from '../../db/schema';
import { audit } from '../../lib/audit';
import { businessRule, conflict, notFound, unauthenticated } from '../../lib/errors';
import { queryRows, isoTs } from '../../lib/listing';
import { hashToken } from '../auth/tokens';

const SELECT = sql`
  SELECT u.id, u.email, u.full_name AS "fullName", r.code AS role, p.job_title AS "jobTitle", p.department, p.phone,
         coalesce(p.status, 'ACTIVE') AS status, u.is_active AS "isActive", ${isoTs('u.last_login_at')} AS "lastLoginAt", ${isoTs('u.created_at')} AS "createdAt"
  FROM users u JOIN roles r ON r.id = u.role_id LEFT JOIN staff_profiles p ON p.user_id = u.id`;

export async function listStaff(): Promise<StaffMember[]> {
  return queryRows<StaffMember>(
    db,
    sql`${SELECT} WHERE u.deleted_at IS NULL ORDER BY u.is_active DESC, u.full_name`,
  );
}

async function getStaff(id: string): Promise<StaffMember> {
  const [row] = await queryRows<StaffMember>(
    db,
    sql`${SELECT} WHERE u.id = ${id} AND u.deleted_at IS NULL`,
  );
  if (!row) throw notFound('Staff member');
  return row;
}

export async function listRoles(): Promise<RoleInfo[]> {
  return queryRows<RoleInfo>(
    db,
    sql`
    SELECT r.code, r.name, r.permissions,
           (SELECT count(*) FROM users u WHERE u.role_id = r.id AND u.deleted_at IS NULL AND u.is_active)::int AS members
    FROM roles r ORDER BY array_position(ARRAY['ADMIN','MANAGER','ACCOUNTANT','OPERATOR','VIEWER']::role_code[], r.code)`,
  );
}

async function roleId(tx: Tx, code: RoleCode): Promise<string> {
  const [r] = await tx.select({ id: roles.id }).from(roles).where(eq(roles.code, code));
  if (!r) throw businessRule(`Unknown role ${code}`);
  return r.id;
}

/** Sign a user out everywhere (used on deactivate and password reset). */
async function revokeSessions(tx: Tx, userId: string, exceptFamily?: string) {
  await tx
    .update(refreshTokens)
    .set({ revokedAt: new Date() })
    .where(
      and(
        eq(refreshTokens.userId, userId),
        isNull(refreshTokens.revokedAt),
        exceptFamily ? ne(refreshTokens.familyId, exceptFamily) : undefined,
      ),
    );
}

async function activeAdmins(tx: Tx): Promise<number> {
  const [r] = await queryRows<{ n: number }>(
    tx,
    sql`
    SELECT count(*)::int AS n FROM users u JOIN roles r ON r.id = u.role_id WHERE r.code = 'ADMIN' AND u.is_active AND u.deleted_at IS NULL`,
  );
  return r!.n;
}

export async function createStaff(
  input: z.output<typeof staffInputSchema>,
  req: Request,
): Promise<StaffMember> {
  const id = await db.transaction(async (tx) => {
    const [dup] = await queryRows<{ id: string }>(
      tx,
      sql`SELECT id FROM users WHERE lower(email) = ${input.email} AND deleted_at IS NULL`,
    );
    if (dup) throw conflict(`${input.email} already has an account`);
    const [u] = await tx
      .insert(users)
      .values({
        email: input.email,
        fullName: input.fullName,
        passwordHash: await bcrypt.hash(input.password, 12),
        roleId: await roleId(tx, input.role),
        isActive: input.status !== 'INACTIVE',
      })
      .returning({ id: users.id });
    await tx.insert(staffProfiles).values({
      userId: u!.id,
      jobTitle: input.jobTitle,
      department: input.department,
      phone: input.phone,
      status: input.status,
      joinedOn: new Date().toISOString().slice(0, 10),
    });
    await audit(
      tx,
      {
        action: 'CREATE',
        entity: 'user',
        entityId: u!.id,
        after: { ...input, password: undefined },
      },
      req,
    );
    return u!.id;
  });
  return getStaff(id);
}

export async function updateStaff(
  id: string,
  input: z.output<typeof staffUpdateSchema>,
  req: Request,
): Promise<StaffMember> {
  await db.transaction(async (tx) => {
    const before = await getStaff(id);
    const self = id === req.auth!.userId;
    if (self && input.role && input.role !== before.role)
      throw businessRule("You can't change your own role. Ask another Admin.");
    if (self && input.status === 'INACTIVE')
      throw businessRule("You can't deactivate your own account.");
    const losingAdmin =
      before.role === 'ADMIN' &&
      before.isActive &&
      ((input.role && input.role !== 'ADMIN') || input.status === 'INACTIVE');
    if (losingAdmin && (await activeAdmins(tx)) <= 1)
      throw businessRule('This is the last active Admin. Make someone else Admin first.');

    const userPatch: Partial<typeof users.$inferInsert> = {};
    if (input.fullName) userPatch.fullName = input.fullName;
    if (input.role) userPatch.roleId = await roleId(tx, input.role);
    if (input.status) userPatch.isActive = input.status !== 'INACTIVE';
    if (Object.keys(userPatch).length)
      await tx.update(users).set(userPatch).where(eq(users.id, id));
    const profile = Object.fromEntries(
      Object.entries({
        jobTitle: input.jobTitle,
        department: input.department,
        phone: input.phone,
        status: input.status,
      }).filter(([, v]) => v !== undefined),
    );
    if (Object.keys(profile).length) {
      await tx
        .insert(staffProfiles)
        .values({ userId: id, ...profile })
        .onConflictDoUpdate({ target: staffProfiles.userId, set: profile });
    }
    if (input.status === 'INACTIVE' || (input.role && input.role !== before.role))
      await revokeSessions(tx, id);
    await audit(tx, { action: 'UPDATE', entity: 'user', entityId: id, before, after: input }, req);
  });
  return getStaff(id);
}

export async function resetPassword(id: string, password: string, req: Request): Promise<void> {
  await db.transaction(async (tx) => {
    await getStaff(id);
    await tx
      .update(users)
      .set({ passwordHash: await bcrypt.hash(password, 12) })
      .where(eq(users.id, id));
    await revokeSessions(tx, id);
    await audit(
      tx,
      { action: 'UPDATE', entity: 'user', entityId: id, after: { passwordReset: true } },
      req,
    );
  });
}

export async function removeStaff(id: string, req: Request): Promise<void> {
  await db.transaction(async (tx) => {
    const before = await getStaff(id);
    if (id === req.auth!.userId) throw businessRule("You can't remove your own account.");
    if (before.role === 'ADMIN' && before.isActive && (await activeAdmins(tx)) <= 1)
      throw businessRule('This is the last active Admin.');
    await tx.update(users).set({ deletedAt: new Date(), isActive: false }).where(eq(users.id, id));
    await revokeSessions(tx, id);
    await audit(tx, { action: 'DELETE', entity: 'user', entityId: id, before }, req);
  });
}

export async function setRolePermissions(
  code: RoleCode,
  permissions: Permission[],
  req: Request,
): Promise<RoleInfo[]> {
  if (code === 'ADMIN') throw businessRule('The Admin role always has every permission.');
  const unique = PERMISSIONS.filter((p) => permissions.includes(p));
  await db.transaction(async (tx) => {
    const [before] = await tx.select().from(roles).where(eq(roles.code, code));
    if (!before) throw notFound('Role');
    await tx.update(roles).set({ permissions: unique }).where(eq(roles.code, code));
    await audit(
      tx,
      {
        action: 'UPDATE',
        entity: 'role',
        entityId: code,
        before: before.permissions,
        after: unique,
      },
      req,
    );
  });
  return listRoles();
}

/** Signed-in user changes their own password; other sessions are signed out. */
export async function changeOwnPassword(
  current: string,
  next: string,
  refreshCookie: string | undefined,
  req: Request,
): Promise<void> {
  const userId = req.auth!.userId;
  const [u] = await db.select({ hash: users.passwordHash }).from(users).where(eq(users.id, userId));
  if (!u || !(await bcrypt.compare(current, u.hash)))
    throw unauthenticated('Your current password is incorrect');
  await db.transaction(async (tx) => {
    await tx
      .update(users)
      .set({ passwordHash: await bcrypt.hash(next, 12) })
      .where(eq(users.id, userId));
    let family: string | undefined;
    if (refreshCookie) {
      const [t] = await tx
        .select({ f: refreshTokens.familyId })
        .from(refreshTokens)
        .where(eq(refreshTokens.tokenHash, hashToken(refreshCookie)));
      family = t?.f;
    }
    await revokeSessions(tx, userId, family);
    await audit(
      tx,
      { action: 'UPDATE', entity: 'user', entityId: userId, after: { passwordChanged: true } },
      req,
    );
  });
}
