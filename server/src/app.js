import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import path from 'node:path';
import fs from 'node:fs';
import { rateLimit } from 'express-rate-limit';
import { config } from './config.js';
import { db } from './db/index.js';
import { errorHandler, ah } from './utils/http.js';
import authRoutes from './routes/auth.js';
import publicRoutes from './routes/public.js';
import customerRoutes from './routes/customer.js';
import adminRoutes from './routes/admin/index.js';
import superRoutes from './routes/superadmin.js';
import uploadRoutes from './routes/uploads.js';
import { handleWebhook } from './services/payments.js';

export function createApp() {
  const app = express();
  app.set('trust proxy', 1);
  app.disable('x-powered-by');

  app.use(
    helmet({
      crossOriginResourcePolicy: { policy: 'cross-origin' },
      contentSecurityPolicy: false, // SPA is served separately / by CDN; API returns JSON only
    })
  );
  app.use(cors({ origin: config.clientUrl.split(','), credentials: true }));

  // Razorpay webhook needs the raw body for signature verification.
  app.post(
    '/api/payments/webhook',
    express.raw({ type: 'application/json', limit: '1mb' }),
    ah(async (req, res) => res.json(await handleWebhook(req.body, req.headers['x-razorpay-signature'])))
  );

  app.use(express.json({ limit: '1mb' }));
  if (!config.isTest) app.use(morgan(config.isProd ? 'combined' : 'dev'));

  const limiter = (max) => rateLimit({ windowMs: config.rateLimit.windowMs, limit: max, standardHeaders: 'draft-7', legacyHeaders: false, message: { error: { code: 'RATE_LIMITED', message: 'Too many requests. Please try again later.' } }, skip: () => config.isTest });
  app.use('/api', limiter(config.rateLimit.max));
  const authLimiter = limiter(config.rateLimit.authMax);
  for (const p of ['/api/auth/login', '/api/auth/register', '/api/auth/forgot-password', '/api/auth/reset-password', '/api/auth/verify-otp', '/api/auth/resend-otp']) app.use(p, authLimiter);

  app.get('/api/health', ah(async (_req, res) => {
    await db.one('SELECT 1 AS ok');
    res.json({ status: 'ok', db: db.driver, time: new Date().toISOString() });
  }));

  app.use('/uploads', express.static(config.uploadDir, { maxAge: '7d', index: false }));
  app.use('/api/auth', authRoutes);
  app.use('/api/public', publicRoutes);
  app.use('/api/customer', customerRoutes);
  app.use('/api/admin', adminRoutes);
  app.use('/api/super', superRoutes);
  app.use('/api/uploads', uploadRoutes);

  app.use('/api', (_req, res) => res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Endpoint not found' } }));

  // Serve the built SPA in production (single deployable), if present.
  const dist = path.resolve(config.root, '..', 'client', 'dist');
  if (fs.existsSync(dist)) {
    app.use(express.static(dist, { index: false, maxAge: '1h' }));
    app.get('*', (_req, res) => res.sendFile(path.join(dist, 'index.html')));
  }

  app.use(errorHandler);
  return app;
}
