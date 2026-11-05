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

const CI = { locale: 'en', strength: 2 }; // case-insensitive collation (matches the users.email index)

const phoneRe = /^\+?[0-9]{10,15}$/;
const password = z.string().min(8, 'Password must be at least 8 characters').max(100)
  .regex(/[A-Za-z]/, 'Password must contain a letter').regex(/[0-9]/, 'Password must contain a number');
const email = z.string().trim().toLowerCase().email('Enter a valid email').max(150);
const phone = z.string().trim().regex(phoneRe, 'Enter a valid mobile number (10-15 digits)');

async function issueOtp(user, purpose) {
  // Throttle: one code per 30 seconds.
  const recent = await db.exists('otp_codes', { user_id: user.id, purpose, created_at: { $gt: new Date(Date.now() - 30 * 1000) }, used_at: null });
  if (recent) throw new HttpError(429, 'Please wait a few seconds before requesting another code', 'OTP_THROTTLED');
  const code = String(crypto.randomInt(100000, 1000000));
  await db.updateMany('otp_codes', { user_id: user.id, purpose, used_at: null }, { $set: { used_at: new Date() } });
  await db.insert('otp_codes', {
    user_id: user.id,
    purpose,
    code_hash: await bcrypt.hash(code, 8),
    expires_at: new Date(Date.now() + 10 * 60 * 1000),
  });
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
  const otp = await db.findOne('otp_codes', { user_id: userId, purpose, used_at: null }, { sort: { id: -1 } });
  if (!otp || new Date(otp.expires_at) < new Date()) throw badRequest('Code expired. Please request a new one.');
  if (otp.attempts >= 5) throw badRequest('Too many attempts. Please request a new code.');
  const ok = await bcrypt.compare(code, otp.code_hash);
  if (!ok) {
    await db.update('otp_codes', { id: otp.id }, { $inc: { attempts: 1 } });
    throw badRequest('Incorrect code');
  }
  await db.update('otp_codes', { id: otp.id }, { $set: { used_at: new Date() } });
}

/** users.* + role name, matched by email (case-insensitive) or phone. */
async function findByIdentifier(identifier) {
  const id = identifier.trim();
  const u = await db.findOne('users', { $or: [{ email: id }, { phone: id }] }, { collation: CI });
  if (!u) return null;
  const role = await db.byId('roles', u.role_id, { projection: { name: 1 } });
  if (!role) return null; // inner JOIN roles
  return { ...u, role: role.name };
}

async function sessionFor(userId) {
  await db.update('users', { id: userId }, { $set: { last_login_at: new Date() } });
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
    const exists = await db.findOne('users', { $or: [{ email }, { phone }] }, { projection: { id: 1, email_verified: 1 }, collation: CI });
    if (exists) throw conflict('An account with this email or mobile number already exists. Please log in.');
    const passwordHash = await bcrypt.hash(password, 10);
    const user = await db.tx(async () => {
      const role = await db.findOne('roles', { name: 'customer' }, { projection: { id: 1 } });
      const u = await db.insert('users', { role_id: role.id, name, email, phone, password_hash: passwordHash });
      await db.insert('customers', { user_id: u.id });
      return { id: u.id, name: u.name, email: u.email, phone: u.phone };
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
    await db.update('users', { id: user.id }, { $set: { email_verified: true, phone_verified: true, updated_at: new Date() } });
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
      const c = await db.findOne('customers', { user_id: user.id }, { projection: { status: 1 } });
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
    await db.update('users', { id: user.id }, { $set: { password_hash: await bcrypt.hash(req.body.password, 10), email_verified: true, updated_at: new Date() } });
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
    // `google_id = NULL` never matched in SQL: only include the clauses that have a value.
    const or = [];
    if (info.sub != null) or.push({ google_id: String(info.sub) });
    if (info.email != null) or.push({ email: String(info.email) });
    let user = or.length ? await db.findOne('users', { $or: or }, { projection: { id: 1, is_active: 1 }, collation: CI }) : null;
    if (user && !user.is_active) throw forbidden('Account disabled');
    if (!user) {
      user = await db.tx(async () => {
        const role = await db.findOne('roles', { name: 'customer' }, { projection: { id: 1 } });
        const u = await db.insert('users', {
          role_id: role.id,
          name: info.name || info.email,
          email: info.email.toLowerCase(),
          google_id: info.sub,
          avatar_url: info.picture || null,
          email_verified: true,
        });
        await db.insert('customers', { user_id: u.id });
        return { id: u.id };
      });
    } else {
      // google_id = COALESCE(google_id, $2), email_verified = true
      await db.update('users', { id: user.id, google_id: null }, { $set: { google_id: info.sub } });
      await db.update('users', { id: user.id }, { $set: { email_verified: true } });
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
      ? await db.findOne('customers', { id: req.user.customer_id }, { projection: { loyalty_points: 1, total_spent: 1, date_of_birth: 1, anniversary: 1, address: 1 } })
      : null;
    res.json({
      user: publicUser(req.user),
      customer: extra
        ? {
            loyalty_points: extra.loyalty_points ?? null,
            total_spent: extra.total_spent ?? null,
            date_of_birth: extra.date_of_birth ?? null,
            anniversary: extra.anniversary ?? null,
            address: extra.address ?? null,
          }
        : null,
    });
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
    const userSet = { updated_at: new Date() };
    if (b.name != null) userSet.name = b.name; // COALESCE($2, name)
    if (b.phone != null) userSet.phone = b.phone;
    if (b.avatar_url !== undefined) userSet.avatar_url = b.avatar_url ?? null;
    await db.update('users', { id: req.user.id }, { $set: userSet });
    if (req.user.customer_id) {
      const custSet = {};
      if (b.address !== undefined) custSet.address = b.address ?? null;
      if (b.date_of_birth !== undefined) custSet.date_of_birth = b.date_of_birth ?? null;
      if (b.anniversary !== undefined) custSet.anniversary = b.anniversary ?? null;
      if (Object.keys(custSet).length) await db.update('customers', { id: req.user.customer_id }, { $set: custSet });
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
    const u = await db.byId('users', req.user.id, { projection: { password_hash: 1 } });
    if (u.password_hash && !(await bcrypt.compare(req.body.currentPassword, u.password_hash))) throw badRequest('Current password is incorrect');
    await db.update('users', { id: req.user.id }, { $set: { password_hash: await bcrypt.hash(req.body.newPassword, 10), updated_at: new Date() } });
    res.json({ message: 'Password changed' });
  })
);

export default r;
