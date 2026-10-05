import crypto from 'node:crypto';
import express, { type Express } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { pinoHttp } from 'pino-http';
import swaggerUi from 'swagger-ui-express';
import { sql } from 'drizzle-orm';
import { env, isTest } from './config/env';
import { logger } from './lib/logger';
import { db } from './db/client';
import { apiLimiter } from './middleware/rateLimit';
import { errorHandler, notFoundHandler } from './middleware/error';
import { authRouter } from './modules/auth/router';
import { metaRouter } from './modules/meta/router';
import { buildOpenApiDocument } from './openapi/spec';

export function createApp(): Express {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', env.TRUST_PROXY);

  app.use(
    pinoHttp({
      logger,
      genReqId: (req, res) => {
        const id = (req.headers['x-request-id'] as string | undefined) ?? crypto.randomUUID();
        res.setHeader('x-request-id', id);
        return id;
      },
      autoLogging: !isTest,
      customLogLevel: (_req, res, err) =>
        err || res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info',
    }),
  );
  app.use(helmet());
  app.use(
    cors({
      origin: env.CORS_ORIGIN.split(',').map((s) => s.trim()),
      credentials: true,
    }),
  );
  app.use(express.json({ limit: '2mb' }));
  app.use(cookieParser());

  const v1 = express.Router();
  v1.use(apiLimiter);

  v1.get('/health', async (_req, res) => {
    await db.execute(sql`SELECT 1`);
    res.json({ status: 'ok', db: 'up' });
  });
  v1.use('/auth', authRouter);
  v1.use('/meta', metaRouter);

  app.use('/api/v1', v1);

  // API docs: Swagger UI needs inline scripts, so relax CSP for this path only.
  const openApiDoc = buildOpenApiDocument();
  app.get('/api/openapi.json', (_req, res) => res.json(openApiDoc));
  app.use(
    '/api/docs',
    helmet({ contentSecurityPolicy: false }),
    swaggerUi.serve,
    swaggerUi.setup(openApiDoc, { customSiteTitle: 'GS Command Center API' }),
  );

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
