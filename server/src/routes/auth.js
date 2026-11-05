import { Router } from 'express';
import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import { z } from 'zod';
import { config } from '../config.js';
import { db } from '../db/index.js';
import { ah, badRequest, conflict, forbidden, unauthorized, validate, HttpError } from '../utils/http.js';
import { authenticate, clearAuthCache, loadAuthUser, signToken } from '../middleware/auth.js';
import { notify } from '../services/notify.js';

const r = Router();

const phoneRe = /^\+?[0-9]{10,15}$/;
const password = z.string().min(8, 'Password must be at least 8 characters').max(100)
  .regex(/[A-Za-z]/, 'Password must contain a letter').regex(/[0-9]/, 'Password must contain a number');
const email = z.string().trim().toLowerCase().email('Enter a valid email').max(150);
const phone = z.string().trim().regex(phoneRe, 'Enter a valid mobile number (10-15 digits)');

async function issueOtp(user, purpose) {
  // Throttle: one code per 30 seconds.
  const recent = await db.one(`SELECT id FROM otp_codes WHERE user_id = $1 AND purpose = $2 AND created_at > now() - interval '30 seconds' AND used_at IS NULL`, [user.id, purpose]);
  if (recent) throw new HttpError(429, 'Please wait a few seconds before requesting another code', 'OTP_THROTTLED');
  const code = String(crypto.randomInt(100000, 1000000));
  await db.query(`UPDATE otp_codes SET used_at = now() WHERE user_id = $1 AND purpose = $2 AND used_at IS NULL`, [user.id, purpose]);
  await db.query(
    `INSERT INTO otp_codes(user_id, purpose, code_hash, expires_at) VALUES ($1,$2,$3, now() + interval '10 minutes')`,
    [user.id, purpose, await bcrypt.hash(code, 8)]
  );
  const msg = purpose === 'verify' ? `Your verification code is ${code}. It expires in 10 minutes.` : `Your password reset code is ${code}. It expires in 10 minutes.`;
  await notify({
    type: purpose === 'verify' ? 'otp_verify' : 'otp_reset',
    title: purpose === 'verify' ? 'Verify your account' : 'Reset your password',
    message: msg,
    email: user.email,
    phone: user.phone,
    channels: ['email', 'sms'],
  });
  return config.exposeOtp ? { devOtp: code } : {};
}

async function consumeOtp(userId, purpose, code) {
  const otp = await db.one(
    `SELECT * FROM otp_codes WHERE user_id = $1 AND purpose = $2 AND used_at IS NULL ORDER BY id DESC LIMIT 1`,
    [userId, purpose]
  );
  if (!otp || new Date(otp.expires_at) < new Date()) throw badRequest('Code expired. Please request a new one.');
  if (otp.attempts >= 5) throw badRequest('Too many attempts. Please request a new code.');
  const ok = await bcrypt.compare(code, otp.code_hash);
  if (!ok) {
    await db.query('UPDATE otp_codes SET attempts = attempts + 1 WHERE id = $1', [otp.id]);
    throw badRequest('Incorrect code');
  }
  await db.query('UPDATE otp_codes SET used_at = now() WHERE id = $1', [otp.id]);
}

async function findByIdentifier(identifier) {
  const id = identifier.trim();
  return db.one(
    `SELECT u.*, r.name AS role FROM users u JOIN roles r ON r.id = u.role_id
      WHERE lower(u.email) = lower($1) OR u.phone = $1`,
    [id]
  );
}

async function sessionFor(userId) {
  await db.query('UPDATE users SET last_login_at = now() WHERE id = $1', [userId]);
  clearAuthCache(userId);
  const user = await loadAuthUser(userId);
  return { token: signToken(user), user: publicUser(user) };
}

export const publicUser = (u) => ({
  id: u.id,
  name: u.name,
  email: u.email,
  phone: u.phone,
  avatar_url: u.avatar_url,
  role: u.role,
  role_name: u.role_name,
  is_staff: u.is_staff,
  permissions: u.permissions,
  restaurant_id: u.restaurant_id,
  branch_id: u.branch_id,
  customer_id: u.customer_id,
  email_verified: u.email_verified,
  phone_verified: u.phone_verified,
});

r.post(
  '/register',
  validate(z.object({ name: z.string().trim().min(2, 'Name is required').max(120), email, phone, password })),
  ah(async (req, res) => {
    const { name, email, phone, password } = req.body;
    const exists = await db.one('SELECT id, email_verified FROM users WHERE lower(email) = $1 OR phone = $2', [email, phone]);
    if (exists) throw conflict('An account with this email or mobile number already exists. Please log in.');
    const user = await db.tx(async (t) => {
      const role = await t.one(`SELECT id FROM roles WHERE name = 'customer'`);
      const u = await t.one(
        `INSERT INTO users(role_id, name, email, phone, password_hash) VALUES ($1,$2,$3,$4,$5) RETURNING id, name, email, phone`,
        [role.id, name, email, phone, await bcrypt.hash(password, 10)]
      );
      await t.query('INSERT INTO customers(user_id) VALUES ($1)', [u.id]);
      return u;
    });
    const otp = await issueOtp(user, 'verify');
    res.status(201).json({ message: 'Account created. Enter the verification code sent to your email/mobile.', email: user.email, ...otp });
  })
);

r.post(
  '/verify-otp',
  validate(z.object({ identifier: z.string().min(3), code: z.string().regex(/^\d{6}$/, 'Enter the 6-digit code') })),
  ah(async (req, res) => {
    const user = await findByIdentifier(req.body.identifier);
    if (!user) throw badRequest('Account not found');
    await consumeOtp(user.id, 'verify', req.body.code);
    await db.query('UPDATE users SET email_verified = true, phone_verified = true, updated_at = now() WHERE id = $1', [user.id]);
    await notify({
      userId: user.id,
      type: 'registration',
      title: 'Welcome to Smart RMS!',
      message: `Hi ${user.name}, your account is ready. Book a table or order your favourite dishes anytime.`,
      email: user.email,
      channels: ['in_app', 'email'],
    });
    res.json(await sessionFor(user.id));
  })
);

r.post(
  '/resend-otp',
  validate(z.object({ identifier: z.string().min(3) })),
  ah(async (req, res) => {
    const user = await findByIdentifier(req.body.identifier);
    if (!user || user.email_verified) return res.json({ message: 'If the account exists and is unverified, a new code has been sent.' });
    res.json({ message: 'A new code has been sent.', ...(await issueOtp(user, 'verify')) });
  })
);

r.post(
  '/login',
  validate(z.object({ identifier: z.string().trim().min(3, 'Enter your email or mobile'), password: z.string().min(1, 'Enter your password') })),
  ah(async (req, res) => {
    const user = await findByIdentifier(req.body.identifier);
    const ok = user?.password_hash && (await bcrypt.compare(req.body.password, user.password_hash));
    if (!ok) throw unauthorized('Invalid credentials');
    if (!user.is_active) throw forbidden('Your account has been deactivated. Please contact support.');
    if (user.role === 'customer') {
      const c = await db.one('SELECT status FROM customers WHERE user_id = $1', [user.id]);
      if (c?.status === 'blocked') throw forbidden('Your account has been blocked. Please contact the restaurant.');
      if (!user.email_verified) {
        const otp = await issueOtp(user, 'verify').catch(() => ({}));
        throw new HttpError(403, 'Please verify your account. We sent you a new code.', 'UNVERIFIED', { email: user.email, ...otp });
      }
    }
    res.json(await sessionFor(user.id));
  })
);

r.post(
  '/forgot-password',
  validate(z.object({ identifier: z.string().trim().min(3) })),
  ah(async (req, res) => {
    const user = await findByIdentifier(req.body.identifier);
    let extra = {};
    if (user && user.is_active) extra = await issueOtp(user, 'reset_password').catch((e) => { if (e.status === 429) throw e; return {}; });
    // Same response whether or not the account exists (prevents account enumeration).
    res.json({ message: 'If an account exists, a reset code has been sent to the registered email/mobile.', ...extra });
  })
);

r.post(
  '/reset-password',
  validate(z.object({ identifier: z.string().trim().min(3), code: z.string().regex(/^\d{6}$/), password })),
  ah(async (req, res) => {
    const user = await findByIdentifier(req.body.identifier);
    if (!user) throw badRequest('Invalid code');
    await consumeOtp(user.id, 'reset_password', req.body.code);
    await db.query('UPDATE users SET password_hash = $2, email_verified = true, updated_at = now() WHERE id = $1', [user.id, await bcrypt.hash(req.body.password, 10)]);
    res.json({ message: 'Password updated. You can now log in.' });
  })
);

/** Google Sign-In: verifies the ID token with Google, then logs in / creates a customer. */
r.post(
  '/google',
  validate(z.object({ credential: z.string().min(10) })),
  ah(async (req, res) => {
    if (!config.googleClientId) throw badRequest('Google login is not configured');
    const resp = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(req.body.credential)}`);
    if (!resp.ok) throw unauthorized('Invalid Google token');
    const info = await resp.json();
    if (info.aud !== config.googleClientId || info.email_verified !== 'true') throw unauthorized('Invalid Google token');
    let user = await db.one('SELECT id, is_active FROM users WHERE google_id = $1 OR lower(email) = lower($2)', [info.sub, info.email]);
    if (user && !user.is_active) throw forbidden('Account disabled');
    if (!user) {
      user = await db.tx(async (t) => {
        const role = await t.one(`SELECT id FROM roles WHERE name = 'customer'`);
        const u = await t.one(
          `INSERT INTO users(role_id, name, email, google_id, avatar_url, email_verified) VALUES ($1,$2,$3,$4,$5,true) RETURNING id`,
          [role.id, info.name || info.email, info.email.toLowerCase(), info.sub, info.picture || null]
        );
        await t.query('INSERT INTO customers(user_id) VALUES ($1)', [u.id]);
        return u;
      });
    } else {
      await db.query('UPDATE users SET google_id = COALESCE(google_id, $2), email_verified = true WHERE id = $1', [user.id, info.sub]);
    }
    res.json(await sessionFor(user.id));
  })
);

r.get('/config', (_req, res) => res.json({ googleClientId: config.googleClientId || null, paymentMode: config.payments.mode, razorpayKeyId: config.payments.razorpayKeyId || null }));

r.get(
  '/me',
  authenticate,
  ah(async (req, res) => {
    const extra = req.user.customer_id
      ? await db.one('SELECT loyalty_points, total_spent, date_of_birth, anniversary, address FROM customers WHERE id = $1', [req.user.customer_id])
      : null;
    res.json({ user: publicUser(req.user), customer: extra });
  })
);

r.put(
  '/me',
  authenticate,
  validate(
    z.object({
      name: z.string().trim().min(2).max(120).optional(),
      phone: phone.optional(),
      avatar_url: z.string().max(500).nullable().optional(),
      address: z.string().max(500).nullable().optional(),
      date_of_birth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional().or(z.literal('').transform(() => null)),
      anniversary: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional().or(z.literal('').transform(() => null)),
    })
  ),
  ah(async (req, res) => {
    const b = req.body;
    await db.query(
      `UPDATE users SET name = COALESCE($2, name), phone = COALESCE($3, phone), avatar_url = CASE WHEN $4::boolean THEN $5 ELSE avatar_url END, updated_at = now() WHERE id = $1`,
      [req.user.id, b.name ?? null, b.phone ?? null, b.avatar_url !== undefined, b.avatar_url ?? null]
    );
    if (req.user.customer_id) {
      await db.query(
        `UPDATE customers SET address = CASE WHEN $2::boolean THEN $3 ELSE address END,
            date_of_birth = CASE WHEN $4::boolean THEN $5::date ELSE date_of_birth END,
            anniversary = CASE WHEN $6::boolean THEN $7::date ELSE anniversary END WHERE id = $1`,
        [req.user.customer_id, b.address !== undefined, b.address ?? null, b.date_of_birth !== undefined, b.date_of_birth ?? null, b.anniversary !== undefined, b.anniversary ?? null]
      );
    }
    clearAuthCache(req.user.id);
    const user = await loadAuthUser(req.user.id);
    res.json({ user: publicUser(user) });
  })
);

r.put(
  '/me/password',
  authenticate,
  validate(z.object({ currentPassword: z.string().min(1), newPassword: password })),
  ah(async (req, res) => {
    const u = await db.one('SELECT password_hash FROM users WHERE id = $1', [req.user.id]);
    if (u.password_hash && !(await bcrypt.compare(req.body.currentPassword, u.password_hash))) throw badRequest('Current password is incorrect');
    await db.query('UPDATE users SET password_hash = $2, updated_at = now() WHERE id = $1', [req.user.id, await bcrypt.hash(req.body.newPassword, 10)]);
    res.json({ message: 'Password changed' });
  })
);

export default r;
