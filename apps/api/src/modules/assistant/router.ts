import { Router } from 'express';
import { z } from 'zod';
import { ROLE_LABEL } from '@gs/shared';
import { requireAuth } from '../../middleware/auth';
import { assistantLimiter } from '../../middleware/rateLimit';
import { parse } from '../../lib/validate';
import { AppError } from '../../lib/errors';
import { logger } from '../../lib/logger';
import { SYSTEM_GUIDE } from './guide';
import { AssistantError, provider } from './providers';

const chatSchema = z.object({
  messages: z
    .array(
      z.object({
        role: z.enum(['user', 'assistant']),
        content: z.string().trim().min(1).max(4000),
      }),
    )
    .min(1)
    .max(40)
    .refine((m) => m[m.length - 1]!.role === 'user', 'The last message must be from the user'),
  /** Path of the page the user has open, so answers can refer to it. */
  page: z.string().max(200).optional(),
});

export const assistantRouter = Router();
assistantRouter.use(requireAuth);

assistantRouter.get('/status', (_req, res) => {
  res.json({ enabled: provider !== null });
});

/**
 * Streams the answer as newline-delimited JSON: `{"text":"…"}` chunks, then `{"done":true}`
 * or `{"error":"…"}`.
 */
assistantRouter.post('/chat', assistantLimiter, async (req, res) => {
  if (!provider) {
    throw new AppError(
      503,
      'INTERNAL',
      'The AI assistant is not set up. An administrator must add an AI API key to the server .env.',
    );
  }
  const body = parse(chatSchema, req.body);
  const auth = req.auth!;
  const userContext = [
    `The user's role is ${ROLE_LABEL[auth.role]}.`,
    `Their permissions: ${auth.permissions.join(', ')}.`,
    body.page ? `They currently have ${body.page} open.` : '',
  ]
    .filter(Boolean)
    .join(' ');

  res.status(200);
  res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('X-Accel-Buffering', 'no'); // nginx: pass chunks through unbuffered
  res.flushHeaders();
  const send = (obj: object) =>
    res.write(`${JSON.stringify(obj)}
`);

  const ctrl = new AbortController();
  res.on('close', () => ctrl.abort());
  try {
    const outcome = await provider({
      system: SYSTEM_GUIDE,
      userContext,
      messages: body.messages,
      signal: ctrl.signal,
      onText: (text) => send({ text }),
    });
    send(
      outcome === 'refused'
        ? { error: 'The assistant could not answer that. Try rephrasing your question.' }
        : { done: true },
    );
  } catch (err) {
    if (ctrl.signal.aborted) return;
    if (!(err instanceof AssistantError)) logger.error({ err }, 'assistant chat failed');
    send({
      error:
        err instanceof AssistantError
          ? err.message
          : 'The assistant is unavailable right now. Try again in a moment.',
    });
  }
  res.end();
});
