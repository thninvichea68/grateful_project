import { z } from 'zod';
import { ROLE_CODES, PERMISSIONS } from '../permissions';

export const loginInputSchema = z.object({
  email: z.string().trim().toLowerCase().email('Enter a valid email address'),
  password: z.string().min(1, 'Enter your password').max(200),
});
export type LoginInput = z.infer<typeof loginInputSchema>;

export const sessionUserSchema = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  fullName: z.string(),
  jobTitle: z.string().nullable(),
  avatarUrl: z.string().nullable(),
  role: z.enum(ROLE_CODES),
  permissions: z.array(z.enum(PERMISSIONS)),
});
export type SessionUser = z.infer<typeof sessionUserSchema>;

export const authResponseSchema = z.object({
  accessToken: z.string(),
  expiresIn: z.number().int().describe('Access token lifetime in seconds'),
  user: sessionUserSchema,
});
export type AuthResponse = z.infer<typeof authResponseSchema>;

export const navCountsSchema = z.object({
  openFollowUps: z.number().int(),
  overdueFollowUps: z.number().int(),
  unreadNotifications: z.number().int(),
});
export type NavCounts = z.infer<typeof navCountsSchema>;
