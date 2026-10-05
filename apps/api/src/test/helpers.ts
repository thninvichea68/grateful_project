import bcrypt from 'bcryptjs';
import { sql } from 'drizzle-orm';
import { ROLE_CODES, ROLE_DEFAULT_PERMISSIONS, ROLE_LABEL, type RoleCode } from '@gs/shared';
import { db } from '../db/client';
import { roles, users } from '../db/schema';

export const TEST_PASSWORD = 'Correct-Horse-9';

export async function resetDb(): Promise<void> {
  const res = await db.execute<{ tablename: string }>(
    sql`SELECT tablename FROM pg_tables WHERE schemaname = 'public'`,
  );
  const tables = res.rows.map((r) => `"${r.tablename}"`).join(', ');
  if (tables) await db.execute(sql.raw(`TRUNCATE ${tables} RESTART IDENTITY CASCADE`));
  await db.insert(roles).values(
    ROLE_CODES.map((code) => ({
      code,
      name: ROLE_LABEL[code],
      permissions: [...ROLE_DEFAULT_PERMISSIONS[code]],
    })),
  );
}

export async function createUser(
  role: RoleCode,
  email = `${role.toLowerCase()}@test.local`,
  isActive = true,
) {
  const [r] = await db
    .select()
    .from(roles)
    .where(sql`${roles.code} = ${role}`);
  const [u] = await db
    .insert(users)
    .values({
      email,
      fullName: `Test ${role}`,
      passwordHash: await bcrypt.hash(TEST_PASSWORD, 4),
      roleId: r!.id,
      isActive,
    })
    .returning();
  return u!;
}

/** Extract the refresh cookie value from a Set-Cookie header. */
export function refreshCookieFrom(setCookie: string[] | string | undefined): string | undefined {
  const list = Array.isArray(setCookie) ? setCookie : setCookie ? [setCookie] : [];
  const c = list.find((x) => x.startsWith('gs_rt='));
  return c?.split(';')[0];
}
