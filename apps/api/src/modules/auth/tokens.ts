import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import { PERMISSIONS, ROLE_CODES, type Permission, type RoleCode } from '@gs/shared';
import { z } from 'zod';
import { env } from '../../config/env';

const ISSUER = 'gs-command-center';
const AUDIENCE = 'gs-web';

const claimsSchema = z.object({
  sub: z.string().uuid(),
  role: z.enum(ROLE_CODES),
  perms: z.array(z.string()),
});

export function signAccessToken(userId: string, role: RoleCode, permissions: Permission[]): string {
  return jwt.sign({ role, perms: permissions }, env.JWT_ACCESS_SECRET, {
    subject: userId,
    issuer: ISSUER,
    audience: AUDIENCE,
    expiresIn: env.ACCESS_TOKEN_TTL_SECONDS,
    algorithm: 'HS256',
  });
}

export function verifyAccessToken(token: string): {
  userId: string;
  role: RoleCode;
  permissions: Permission[];
} {
  const decoded = jwt.verify(token, env.JWT_ACCESS_SECRET, {
    issuer: ISSUER,
    audience: AUDIENCE,
    algorithms: ['HS256'],
  });
  const claims = claimsSchema.parse(decoded);
  const known = new Set<string>(PERMISSIONS);
  return {
    userId: claims.sub,
    role: claims.role,
    permissions: claims.perms.filter((p): p is Permission => known.has(p)),
  };
}

/** Opaque refresh token: 48 random bytes. Only its SHA-256 hash is stored. */
export function newRefreshToken(): { token: string; hash: string } {
  const token = crypto.randomBytes(48).toString('base64url');
  return { token, hash: hashToken(token) };
}

export function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export const REFRESH_COOKIE = 'gs_rt';
export const REFRESH_COOKIE_PATH = '/api/v1/auth';
