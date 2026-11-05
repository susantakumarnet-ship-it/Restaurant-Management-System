import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { db } from '../db/index.js';
import { ah, badRequest, conflict, notFound, validate } from '../utils/http.js';
import { authenticate, clearAuthCache, requireRole } from '../middleware/auth.js';
import { auditMutations } from '../middleware/audit.js';
import { buildUpdate, slugify } from '../utils/common.js';
import { runReport, sendReport } from '../services/reports.js';
import { zs } from './admin/crud.js';

const r = Router();
r.use(authenticate, requireRole('super_admin'), auditMutations);
const pid = (req) => parseInt(req.params.id, 10) || 0;

// ---------- Overview ----------
r.get(
  '/overview',
  ah(async (_req, res) => {
    const totals = await db.one(
      `SELECT (SELECT COUNT(*) FROM restaurants) AS restaurants, (SELECT COUNT(*) FROM restaurants WHERE is_active) AS active_restaurants,
              (SELECT COUNT(*) FROM restaurant_branches) AS branches, (SELECT COUNT(*) FROM customers) AS customers,
              (SELECT COUNT(*) FROM users u JOIN roles ro ON ro.id = u.role_id WHERE ro.is_staff) AS staff_users,
              (SELECT COUNT(*) FROM reservations WHERE created_at > now() - interval '30 days') AS reservations_30d,
              (SELECT COUNT(*) FROM orders WHERE created_at > now() - interval '30 days') AS orders_30d,
              (SELECT COALESCE(SUM(amount - refunded_amount),0) FROM payments WHERE status IN ('success','partially_refunded','refunded') AND created_at > now() - interval '30 days') AS revenue_30d`
    );
    const restaurants = await db.many(
      `SELECT r.id, r.name, r.subscription_plan, r.subscription_status, r.subscription_expires_at::text AS subscription_expires_at, r.is_active,
              (SELECT COUNT(*) FROM restaurant_branches b WHERE b.restaurant_id = r.id) AS branches,
              (SELECT COUNT(*) FROM reservations x JOIN restaurant_branches b ON b.id = x.branch_id WHERE b.restaurant_id = r.id AND x.created_at > now() - interval '30 days') AS reservations_30d,
              (SELECT COUNT(*) FROM orders x JOIN restaurant_branches b ON b.id = x.branch_id WHERE b.restaurant_id = r.id AND x.created_at > now() - interval '30 days') AS orders_30d,
              (SELECT COALESCE(SUM(p.amount - p.refunded_amount),0) FROM payments p JOIN restaurant_branches b ON b.id = p.branch_id WHERE b.restaurant_id = r.id AND p.status IN ('success','partially_refunded','refunded') AND p.created_at > now() - interval '30 days') AS revenue_30d
         FROM restaurants r ORDER BY revenue_30d DESC`
    );
    const monthly = await db.many(
      `SELECT to_char(m, 'YYYY-MM') AS month,
              COALESCE((SELECT SUM(amount - refunded_amount) FROM payments p WHERE p.status IN ('success','partially_refunded','refunded') AND date_trunc('month', p.created_at) = m),0) AS revenue
         FROM generate_series(date_trunc('month', CURRENT_DATE) - interval '11 months', date_trunc('month', CURRENT_DATE), interval '1 month') m ORDER BY m`
    );
    res.json({ totals, restaurants, monthly });
  })
);

// ---------- Restaurants ----------
const restaurantSchema = z.object({
  name: zs.str(150).min(2),
  description: zs.optStr(3000),
  cuisine: zs.optStr(150),
  email: zs.optStr(150),
  phone: zs.optStr(30),
  website: zs.optStr(200),
  gstin: zs.optStr(20),
  logo_url: zs.optStr(),
  subscription_plan: z.enum(['basic', 'pro', 'enterprise']).default('basic'),
  subscription_status: z.enum(['trial', 'active', 'past_due', 'cancelled']).default('active'),
  subscription_expires_at: zs.optDate(),
  is_active: z.boolean().default(true),
});

r.get(
  '/restaurants',
  ah(async (_req, res) => {
    res.json(
      await db.many(
        `SELECT r.*, r.subscription_expires_at::text AS subscription_expires_at,
                (SELECT COUNT(*) FROM restaurant_branches b WHERE b.restaurant_id = r.id) AS branch_count,
                (SELECT COUNT(*) FROM users u JOIN roles ro ON ro.id = u.role_id WHERE u.restaurant_id = r.id AND ro.name = 'restaurant_admin') AS admin_count
           FROM restaurants r ORDER BY r.name`
      )
    );
  })
);

r.post(
  '/restaurants',
  validate(restaurantSchema.extend({ branch_name: zs.str(150).min(2).default('Main Branch'), city: zs.optStr(100) })),
  ah(async (req, res) => {
    const { branch_name, city, ...b } = req.body;
    const row = await db.tx(async (t) => {
      let slug = slugify(b.name);
      if (await t.one('SELECT id FROM restaurants WHERE slug = $1', [slug])) slug = `${slug}-${Date.now().toString(36)}`;
      const rest = await t.one(
        `INSERT INTO restaurants(name, slug, description, cuisine, email, phone, website, gstin, logo_url, subscription_plan, subscription_status, subscription_expires_at, is_active)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
        [b.name, slug, b.description, b.cuisine, b.email, b.phone, b.website, b.gstin, b.logo_url, b.subscription_plan, b.subscription_status, b.subscription_expires_at, b.is_active]
      );
      const br = await t.one(`INSERT INTO restaurant_branches(restaurant_id, name, city, phone, email) VALUES ($1,$2,$3,$4,$5) RETURNING id`, [rest.id, branch_name, city || null, b.phone || null, b.email || null]);
      await t.query('INSERT INTO restaurant_settings(branch_id) VALUES ($1)', [br.id]);
      return rest;
    });
    res.locals.createdId = row.id;
    res.status(201).json(row);
  })
);

r.put(
  '/restaurants/:id(\\d+)',
  validate(restaurantSchema.partial()),
  ah(async (req, res) => {
    const { sets, values } = buildUpdate(req.body, { startIndex: 2 });
    if (sets.length) await db.query(`UPDATE restaurants SET ${sets.join(', ')}, updated_at = now() WHERE id = $1`, [pid(req), ...values]);
    const row = await db.one('SELECT * FROM restaurants WHERE id = $1', [pid(req)]);
    if (!row) throw notFound('Restaurant');
    clearAuthCache();
    res.json(row);
  })
);

r.delete(
  '/restaurants/:id(\\d+)',
  ah(async (req, res) => {
    const used = await db.one(
      `SELECT (SELECT COUNT(*) FROM orders o JOIN restaurant_branches b ON b.id = o.branch_id WHERE b.restaurant_id = $1)
            + (SELECT COUNT(*) FROM reservations x JOIN restaurant_branches b ON b.id = x.branch_id WHERE b.restaurant_id = $1) AS n`,
      [pid(req)]
    );
    if (used.n > 0) {
      await db.query('UPDATE restaurants SET is_active = false WHERE id = $1', [pid(req)]);
      return res.json({ ok: true, deactivated: true, message: 'Restaurant has transaction history, so it was deactivated instead of deleted.' });
    }
    await db.query('DELETE FROM restaurants WHERE id = $1', [pid(req)]);
    res.json({ ok: true });
  })
);

// ---------- Admin accounts ----------
r.get(
  '/admins',
  ah(async (_req, res) => {
    res.json(
      await db.many(
        `SELECT u.id, u.name, u.email, u.phone, u.is_active, u.last_login_at, u.created_at, u.restaurant_id, u.branch_id,
                ro.name AS role, ro.display_name AS role_name, r.name AS restaurant_name, b.name AS branch_name
           FROM users u JOIN roles ro ON ro.id = u.role_id LEFT JOIN restaurants r ON r.id = u.restaurant_id LEFT JOIN restaurant_branches b ON b.id = u.branch_id
          WHERE ro.is_staff ORDER BY ro.id, u.name`
      )
    );
  })
);

const adminSchema = z.object({
  name: zs.str(120).min(2),
  email: z.string().trim().toLowerCase().email(),
  phone: zs.optStr(20),
  password: z.string().min(8).optional(),
  role: z.enum(['super_admin', 'restaurant_admin', 'manager', 'waiter', 'chef', 'cashier']),
  restaurant_id: zs.optInt(),
  branch_id: zs.optInt(),
  is_active: z.boolean().default(true),
});

async function checkTenant(b) {
  if (b.role !== 'super_admin' && !b.restaurant_id) throw badRequest('Select a restaurant');
  if (b.branch_id) {
    const br = await db.one('SELECT id FROM restaurant_branches WHERE id = $1 AND restaurant_id = $2', [b.branch_id, b.restaurant_id]);
    if (!br) throw badRequest('Branch does not belong to the restaurant');
  }
}

r.post(
  '/admins',
  validate(adminSchema),
  ah(async (req, res) => {
    const b = req.body;
    if (!b.password) throw badRequest('Password is required');
    await checkTenant(b);
    if (await db.one('SELECT id FROM users WHERE lower(email) = $1', [b.email])) throw conflict('Email already in use');
    const role = await db.one('SELECT id FROM roles WHERE name = $1', [b.role]);
    const u = await db.one(
      `INSERT INTO users(role_id, restaurant_id, branch_id, name, email, phone, password_hash, email_verified, is_active)
       VALUES ($1,$2,$3,$4,$5,$6,$7,true,$8) RETURNING id, name, email`,
      [role.id, b.role === 'super_admin' ? null : b.restaurant_id, b.role === 'super_admin' ? null : b.branch_id || null, b.name, b.email, b.phone || null, await bcrypt.hash(b.password, 10), b.is_active]
    );
    res.locals.createdId = u.id;
    res.status(201).json(u);
  })
);

r.put(
  '/admins/:id(\\d+)',
  validate(adminSchema.partial()),
  ah(async (req, res) => {
    const id = pid(req);
    const cur = await db.one('SELECT u.*, ro.name AS role FROM users u JOIN roles ro ON ro.id = u.role_id WHERE u.id = $1 AND ro.is_staff', [id]);
    if (!cur) throw notFound('User');
    const b = { ...req.body };
    if (id === req.user.id && (b.is_active === false || (b.role && b.role !== 'super_admin'))) throw badRequest('You cannot deactivate or demote yourself');
    await checkTenant({ role: b.role || cur.role, restaurant_id: b.restaurant_id ?? cur.restaurant_id, branch_id: b.branch_id !== undefined ? b.branch_id : cur.branch_id });
    const data = { name: b.name, email: b.email, phone: b.phone, restaurant_id: b.restaurant_id, branch_id: b.branch_id, is_active: b.is_active };
    if (b.role) data.role_id = (await db.one('SELECT id FROM roles WHERE name = $1', [b.role])).id;
    if ((b.role || cur.role) === 'super_admin') {
      data.restaurant_id = null; // platform-level accounts are never tied to a tenant
      data.branch_id = null;
    }
    if (b.password) data.password_hash = await bcrypt.hash(b.password, 10);
    const { sets, values } = buildUpdate(data, { startIndex: 2 });
    if (sets.length) await db.query(`UPDATE users SET ${sets.join(', ')}, updated_at = now() WHERE id = $1`, [id, ...values]);
    clearAuthCache(id);
    res.json({ ok: true });
  })
);

// ---------- System settings ----------
r.get(
  '/settings',
  ah(async (_req, res) => {
    const rows = await db.many('SELECT key, value FROM system_settings ORDER BY key');
    res.json(Object.fromEntries(rows.map((x) => [x.key, x.value])));
  })
);

r.put(
  '/settings',
  validate(z.record(z.string().max(100), z.any())),
  ah(async (req, res) => {
    for (const [key, value] of Object.entries(req.body)) {
      await db.query(
        `INSERT INTO system_settings(key, value) VALUES ($1, $2::text::jsonb) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
        [key, JSON.stringify(value)]
      );
    }
    res.json({ ok: true });
  })
);

// ---------- Consolidated reports ----------
r.get(
  '/reports/:type',
  ah(async (req, res) => {
    const rid = req.query.restaurantId ? parseInt(req.query.restaurantId, 10) : null;
    const branches = await db.many(`SELECT id FROM restaurant_branches WHERE ($1::int IS NULL OR restaurant_id = $1)`, [rid]);
    const report = await runReport(req.params.type, { branchIds: branches.map((b) => b.id), from: req.query.from, to: req.query.to, period: req.query.period, status: req.query.status });
    await sendReport(res, report, req.query.format, rid ? `Restaurant #${rid} (all branches)` : 'All restaurants (consolidated)');
  })
);

r.get(
  '/audit-logs',
  ah(async (req, res) => {
    const params = [];
    let where = '';
    if (req.query.q) {
      params.push(`%${req.query.q}%`);
      where = 'WHERE a.action ILIKE $1 OR a.entity ILIKE $1 OR u.name ILIKE $1';
    }
    res.json(
      await db.many(
        `SELECT a.*, u.name AS user_name, u.email AS user_email, b.name AS branch_name FROM audit_logs a
           LEFT JOIN users u ON u.id = a.user_id LEFT JOIN restaurant_branches b ON b.id = a.branch_id
          ${where} ORDER BY a.created_at DESC LIMIT 300`,
        params
      )
    );
  })
);

export default r;
