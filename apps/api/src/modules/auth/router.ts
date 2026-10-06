import { Router, type Response } from 'express';
import { changePasswordSchema, loginInputSchema, type AuthResponse } from '@gs/shared';
import { changeOwnPassword } from '../staff/service';
import { env } from '../../config/env';
import { parse } from '../../lib/validate';
import { requireAuth } from '../../middleware/auth';
import { loginLimiter } from '../../middleware/rateLimit';
import { REFRESH_COOKIE, REFRESH_COOKIE_PATH } from './tokens';
import * as auth from './service';

function setRefreshCookie(res: Response, token: string, expires: Date): void {
  res.cookie(REFRESH_COOKIE, token, {
    httpOnly: true,
    secure: env.COOKIE_SECURE,
    sameSite: 'strict',
    path: REFRESH_COOKIE_PATH,
    expires,
  });
}

function clearRefreshCookie(res: Response): void {
  res.clearCookie(REFRESH_COOKIE, {
    httpOnly: true,
    secure: env.COOKIE_SECURE,
    sameSite: 'strict',
    path: REFRESH_COOKIE_PATH,
  });
}

export const authRouter = Router();

authRouter.post('/login', loginLimiter, async (req, res) => {
  const input = parse(loginInputSchema, req.body);
  const s = await auth.login(input.email, input.password, req);
  setRefreshCookie(res, s.refreshToken, s.refreshExpiresAt);
  const body: AuthResponse = { accessToken: s.accessToken, expiresIn: s.expiresIn, user: s.user };
  res.json(body);
});

authRouter.post('/refresh', async (req, res) => {
  try {
    const s = await auth.refresh(req.cookies?.[REFRESH_COOKIE] as string | undefined, req);
    setRefreshCookie(res, s.refreshToken, s.refreshExpiresAt);
    const body: AuthResponse = { accessToken: s.accessToken, expiresIn: s.expiresIn, user: s.user };
    res.json(body);
  } catch (err) {
    clearRefreshCookie(res);
    throw err;
  }
});

authRouter.post('/logout', async (req, res) => {
  await auth.logout(req.cookies?.[REFRESH_COOKIE] as string | undefined, req);
  clearRefreshCookie(res);
  res.status(204).end();
});

authRouter.get('/me', requireAuth, async (req, res) => {
  res.json({ user: await auth.me(req.auth!.userId) });
});

/** Change my own password; my other sessions are signed out. */
authRouter.post('/change-password', requireAuth, async (req, res) => {
  const v = parse(changePasswordSchema, req.body);
  await changeOwnPassword(
    v.currentPassword,
    v.newPassword,
    req.cookies?.[REFRESH_COOKIE] as string | undefined,
    req,
  );
  res.status(204).end();
});
