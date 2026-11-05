import 'dotenv/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const env = process.env;
const isTest = env.NODE_ENV === 'test' || !!env.VITEST;

export const config = {
  root,
  env: env.NODE_ENV || 'development',
  isProd: env.NODE_ENV === 'production',
  isTest,
  port: parseInt(env.PORT || '4000', 10),
  clientUrl: env.CLIENT_URL || 'http://localhost:5173',
  publicUrl: env.PUBLIC_URL || `http://localhost:${env.PORT || 4000}`,

  // Database: DATABASE_URL -> real PostgreSQL; otherwise embedded PGlite (Postgres in WASM)
  databaseUrl: isTest ? '' : env.DATABASE_URL || '',
  pgliteDir: isTest ? '' : env.PGLITE_DIR ?? path.join(root, 'data', 'pglite'),

  jwtSecret: env.JWT_SECRET || 'dev-insecure-secret-change-me',
  jwtExpiresIn: env.JWT_EXPIRES_IN || '1d',

  uploadDir: env.UPLOAD_DIR || path.join(root, 'uploads'),
  maxUploadMb: parseInt(env.MAX_UPLOAD_MB || '5', 10),

  rateLimit: {
    windowMs: 15 * 60 * 1000,
    max: parseInt(env.RATE_LIMIT_MAX || '1000', 10),
    authMax: parseInt(env.AUTH_RATE_LIMIT_MAX || '30', 10),
  },

  payments: {
    // "razorpay" when keys are present, otherwise "mock" (simulated checkout for dev/demo)
    mode: env.RAZORPAY_KEY_ID && env.RAZORPAY_KEY_SECRET ? 'razorpay' : 'mock',
    razorpayKeyId: env.RAZORPAY_KEY_ID || '',
    razorpayKeySecret: env.RAZORPAY_KEY_SECRET || '',
    razorpayWebhookSecret: env.RAZORPAY_WEBHOOK_SECRET || '',
  },

  mail: {
    host: env.SMTP_HOST || '',
    port: parseInt(env.SMTP_PORT || '587', 10),
    secure: env.SMTP_SECURE === 'true',
    user: env.SMTP_USER || '',
    pass: env.SMTP_PASS || '',
    from: env.MAIL_FROM || 'Smart RMS <no-reply@smartrms.local>',
  },

  sms: {
    // Twilio-compatible REST API
    twilioSid: env.TWILIO_ACCOUNT_SID || '',
    twilioToken: env.TWILIO_AUTH_TOKEN || '',
    twilioFrom: env.TWILIO_FROM || '',
  },

  whatsapp: {
    // Meta WhatsApp Cloud API
    token: env.WHATSAPP_TOKEN || '',
    phoneNumberId: env.WHATSAPP_PHONE_NUMBER_ID || '',
  },

  googleClientId: env.GOOGLE_CLIENT_ID || '',
  // Return OTP codes in API responses (never in production) to make local testing easy
  exposeOtp: env.EXPOSE_OTP ? env.EXPOSE_OTP === 'true' : env.NODE_ENV !== 'production',
  schedulerEnabled: !isTest && env.SCHEDULER_ENABLED !== 'false',
};

if (config.isProd && config.jwtSecret.startsWith('dev-')) {
  throw new Error('JWT_SECRET must be set in production');
}
