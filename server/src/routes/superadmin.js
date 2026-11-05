import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { db, TIMEZONE } from '../db/index.js';
import { ah, badRequest, conflict, notFound, validate } from '../utils/http.js';
import { authenticate, clearAuthCache, requireRole } from '../middleware/auth.js';
import { auditMutations } from '../middleware/audit.js';
import { definedOnly, ilike, localDate, parseLocal, round2, slugify } from '../utils/common.js';
import { runReport, sendReport } from '../services/reports.js';
import { zs } from './admin/crud.js';

const r = Router();
r.use(authenticate, requireRole('super_admin'), auditMutations);
const pid = (req) => parseInt(req.params.id, 10) || 0;
const ci = { locale: 'en', strength: 2 };
const PAID = ['success', 'partially_refunded', 'refunded'];
const netAmount = { $subtract: ['$amount', '$refunded_amount'] };

/** 'YYYY-MM' + n months. */
const addMonths = (ym, n) => {
  const [y, m] = ym.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1 + n, 1)).toISOString().slice(0, 7);
};
/** FK violation replacement (PostgreSQL 23503 -> 409 IN_USE). */
const fkError = () => {
  const e = new Error('Referenced record does not exist');
  e.code = 'IN_USE';
  return e;
};
const staffRoleIds = () => db.distinct('roles', 'id', { is_staff: true });

// ---------- Overview ----------
r.get(
  '/overview',
  ah(async (_req, res) => {
    const since30 = new Date(Date.now() - 30 * 86400000);
    const month = localDate().slice(0, 7);
    const months = Array.from({ length: 12 }, (_, i) => addMonths(month, i - 11));
    const roleIds = await staffRoleIds();
    const [restaurantsN, activeN, branchesN, customersN, staffN, resv30, orders30, rev30, allRestaurants, allBranches, resvByBranch, ordByBranch, revByBranch, revMonthly] = await Promise.all([
      db.count('restaurants'),
      db.count('restaurants', { is_active: true }),
      db.count('restaurant_branches'),
      db.count('customers'),
      db.count('users', { role_id: { $in: roleIds } }),
      db.count('reservations', { created_at: { $gt: since30 } }),
      db.count('orders', { created_at: { $gt: since30 } }),
      db.aggregate('payments', [{ $match: { status: { $in: PAID }, created_at: { $gt: since30 } } }, { $group: { _id: null, total: { $sum: netAmount } } }]),
      db.find('restaurants', {}, { projection: { id: 1, name: 1, subscription_plan: 1, subscription_status: 1, subscription_expires_at: 1, is_active: 1 } }),
      db.find('restaurant_branches', {}, { projection: { id: 1, restaurant_id: 1 } }),
      db.aggregate('reservations', [{ $match: { created_at: { $gt: since30 } } }, { $group: { _id: '$branch_id', n: { $sum: 1 } } }]),
      db.aggregate('orders', [{ $match: { created_at: { $gt: since30 } } }, { $group: { _id: '$branch_id', n: { $sum: 1 } } }]),
      db.aggregate('payments', [{ $match: { status: { $in: PAID }, created_at: { $gt: since30 } } }, { $group: { _id: '$branch_id', total: { $sum: netAmount } } }]),
      db.aggregate('payments', [
        { $match: { status: { $in: PAID }, created_at: { $gte: parseLocal(`${months[0]}-01`), $lt: parseLocal(`${addMonths(month, 1)}-01`) } } },
        { $group: { _id: { $dateToString: { format: '%Y-%m', date: '$created_at', timezone: TIMEZONE } }, revenue: { $sum: netAmount } } },
      ]),
    ]);
    const totals = {
      restaurants: restaurantsN,
      active_restaurants: activeN,
      branches: branchesN,
      customers: customersN,
      staff_users: staffN,
      reservations_30d: resv30,
      orders_30d: orders30,
      revenue_30d: round2(rev30[0]?.total || 0),
    };
    // roll branch-level aggregates up to restaurants
    const restOf = new Map(allBranches.map((b) => [b.id, b.restaurant_id]));
    const acc = new Map(allRestaurants.map((x) => [x.id, { branches: 0, reservations_30d: 0, orders_30d: 0, revenue_30d: 0 }]));
    for (const b of allBranches) if (acc.has(b.restaurant_id)) acc.get(b.restaurant_id).branches++;
    const add = (rows, key, val) => {
      for (const x of rows) {
        const a = acc.get(restOf.get(x._id));
        if (a) a[key] += Number(val(x) || 0);
      }
    };
    add(resvByBranch, 'reservations_30d', (x) => x.n);
    add(ordByBranch, 'orders_30d', (x) => x.n);
    add(revByBranch, 'revenue_30d', (x) => x.total);
    const restaurants = allRestaurants
      .map((x) => {
        const a = acc.get(x.id);
        return {
          id: x.id,
          name: x.name,
          subscription_plan: x.subscription_plan,
          subscription_status: x.subscription_status,
          subscription_expires_at: x.subscription_expires_at ?? null,
          is_active: x.is_active,
          branches: a.branches,
          reservations_30d: a.reservations_30d,
          orders_30d: a.orders_30d,
          revenue_30d: round2(a.revenue_30d),
        };
      })
      .sort((a, b) => b.revenue_30d - a.revenue_30d);
    const revBy = new Map(revMonthly.map((x) => [x._id, x.revenue]));
    const monthly = months.map((m) => ({ month: m, revenue: round2(revBy.get(m) || 0) }));
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
    const [rows, adminRole] = await Promise.all([db.find('restaurants', {}, { sort: { name: 1 }, collation: { locale: 'en' } }), db.findOne('roles', { name: 'restaurant_admin' }, { projection: { id: 1 } })]);
    const ids = rows.map((x) => x.id);
    const [branches, admins] = await Promise.all([
      db.aggregate('restaurant_branches', [{ $match: { restaurant_id: { $in: ids } } }, { $group: { _id: '$restaurant_id', n: { $sum: 1 } } }]),
      adminRole ? db.aggregate('users', [{ $match: { restaurant_id: { $in: ids }, role_id: adminRole.id } }, { $group: { _id: '$restaurant_id', n: { $sum: 1 } } }]) : [],
    ]);
    const bBy = new Map(branches.map((x) => [x._id, x.n]));
    const aBy = new Map(admins.map((x) => [x._id, x.n]));
    res.json(rows.map((x) => ({ ...x, subscription_expires_at: x.subscription_expires_at ?? null, branch_count: bBy.get(x.id) || 0, admin_count: aBy.get(x.id) || 0 })));
  })
);

r.post(
  '/restaurants',
  validate(restaurantSchema.extend({ branch_name: zs.str(150).min(2).default('Main Branch'), city: zs.optStr(100) })),
  ah(async (req, res) => {
    const { branch_name, city, ...b } = req.body;
    const row = await db.tx(async () => {
      let slug = slugify(b.name);
      if (await db.exists('restaurants', { slug })) slug = `${slug}-${Date.now().toString(36)}`;
      const rest = await db.insert('restaurants', {
        name: b.name,
        slug,
        description: b.description,
        cuisine: b.cuisine,
        email: b.email,
        phone: b.phone,
        website: b.website,
        gstin: b.gstin,
        logo_url: b.logo_url,
        subscription_plan: b.subscription_plan,
        subscription_status: b.subscription_status,
        subscription_expires_at: b.subscription_expires_at,
        is_active: b.is_active,
      });
      const br = await db.insert('restaurant_branches', { restaurant_id: rest.id, name: branch_name, city: city || null, phone: b.phone || null, email: b.email || null });
      await db.insert('restaurant_settings', { branch_id: br.id });
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
    const data = definedOnly(req.body);
    if (Object.keys(data).length) await db.update('restaurants', { id: pid(req) }, { $set: { ...data, updated_at: new Date() } });
    const row = await db.byId('restaurants', pid(req));
    if (!row) throw notFound('Restaurant');
    clearAuthCache();
    res.json(row);
  })
);

r.delete(
  '/restaurants/:id(\\d+)',
  ah(async (req, res) => {
    const id = pid(req);
    const bids = await db.distinct('restaurant_branches', 'id', { restaurant_id: id });
    const n = bids.length ? (await db.count('orders', { branch_id: { $in: bids } })) + (await db.count('reservations', { branch_id: { $in: bids } })) : 0;
    if (n > 0) {
      await db.update('restaurants', { id }, { $set: { is_active: false } });
      return res.json({ ok: true, deactivated: true, message: 'Restaurant has transaction history, so it was deactivated instead of deleted.' });
    }
    await db.tx(async () => {
      // food_items -> food_categories is RESTRICT; remove the menu first so the category cascade cannot trip over it
      await db.remove('food_items', { restaurant_id: id });
      await db.remove('restaurants', { id });
    });
    res.json({ ok: true });
  })
);

// ---------- Admin accounts ----------
r.get(
  '/admins',
  ah(async (_req, res) => {
    const roles = await db.find('roles', { is_staff: true }, { projection: { id: 1, name: 1, display_name: 1 } });
    const roleBy = new Map(roles.map((x) => [x.id, x]));
    const users = await db.find('users', { role_id: { $in: roles.map((x) => x.id) } }, { projection: { id: 1, name: 1, email: 1, phone: 1, is_active: 1, last_login_at: 1, created_at: 1, restaurant_id: 1, branch_id: 1, role_id: 1 } });
    const [rests, branches] = await Promise.all([
      db.mapByIds('restaurants', users.map((u) => u.restaurant_id), { projection: { name: 1 } }),
      db.mapByIds('restaurant_branches', users.map((u) => u.branch_id), { projection: { name: 1 } }),
    ]);
    const rows = users.map((u) => ({
      id: u.id,
      name: u.name,
      email: u.email,
      phone: u.phone ?? null,
      is_active: u.is_active,
      last_login_at: u.last_login_at ?? null,
      created_at: u.created_at,
      restaurant_id: u.restaurant_id ?? null,
      branch_id: u.branch_id ?? null,
      role: roleBy.get(u.role_id).name,
      role_name: roleBy.get(u.role_id).display_name,
      restaurant_name: rests.get(u.restaurant_id)?.name ?? null,
      branch_name: branches.get(u.branch_id)?.name ?? null,
      _role_id: u.role_id,
    }));
    rows.sort((a, b) => a._role_id - b._role_id || String(a.name).localeCompare(String(b.name)));
    res.json(rows.map(({ _role_id, ...x }) => x));
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
    const br = await db.findOne('restaurant_branches', { id: b.branch_id, restaurant_id: b.restaurant_id }, { projection: { id: 1 } });
    if (!br) throw badRequest('Branch does not belong to the restaurant');
  }
}

/** The users.restaurant_id FK used to reject unknown restaurants. */
async function checkRestaurantExists(id) {
  if (id != null && !(await db.exists('restaurants', { id }))) throw fkError();
}

r.post(
  '/admins',
  validate(adminSchema),
  ah(async (req, res) => {
    const b = req.body;
    if (!b.password) throw badRequest('Password is required');
    await checkTenant(b);
    if (await db.findOne('users', { email: b.email }, { projection: { id: 1 }, collation: ci })) throw conflict('Email already in use');
    const role = await db.findOne('roles', { name: b.role }, { projection: { id: 1 } });
    const restaurantId = b.role === 'super_admin' ? null : b.restaurant_id;
    await checkRestaurantExists(restaurantId);
    const u = await db.insert('users', {
      role_id: role.id,
      restaurant_id: restaurantId,
      branch_id: b.role === 'super_admin' ? null : b.branch_id || null,
      name: b.name,
      email: b.email,
      phone: b.phone || null,
      password_hash: await bcrypt.hash(b.password, 10),
      email_verified: true,
      is_active: b.is_active,
    });
    res.locals.createdId = u.id;
    res.status(201).json({ id: u.id, name: u.name, email: u.email });
  })
);

r.put(
  '/admins/:id(\\d+)',
  validate(adminSchema.partial()),
  ah(async (req, res) => {
    const id = pid(req);
    const user = await db.byId('users', id);
    const curRole = user && (await db.findOne('roles', { id: user.role_id, is_staff: true }, { projection: { name: 1 } }));
    if (!curRole) throw notFound('User');
    const cur = { ...user, role: curRole.name };
    const b = { ...req.body };
    if (id === req.user.id && (b.is_active === false || (b.role && b.role !== 'super_admin'))) throw badRequest('You cannot deactivate or demote yourself');
    await checkTenant({ role: b.role || cur.role, restaurant_id: b.restaurant_id ?? cur.restaurant_id, branch_id: b.branch_id !== undefined ? b.branch_id : cur.branch_id });
    const data = { name: b.name, email: b.email, phone: b.phone, restaurant_id: b.restaurant_id, branch_id: b.branch_id, is_active: b.is_active };
    if (b.role) data.role_id = (await db.findOne('roles', { name: b.role }, { projection: { id: 1 } })).id;
    if ((b.role || cur.role) === 'super_admin') {
      data.restaurant_id = null; // platform-level accounts are never tied to a tenant
      data.branch_id = null;
    }
    if (b.password) data.password_hash = await bcrypt.hash(b.password, 10);
    const set = definedOnly(data);
    if (set.restaurant_id != null) await checkRestaurantExists(set.restaurant_id);
    if (Object.keys(set).length) await db.update('users', { id }, { $set: { ...set, updated_at: new Date() } });
    clearAuthCache(id);
    res.json({ ok: true });
  })
);

// ---------- System settings ----------
r.get(
  '/settings',
  ah(async (_req, res) => {
    const rows = await db.find('system_settings', {}, { sort: { key: 1 }, projection: { key: 1, value: 1 } });
    res.json(Object.fromEntries(rows.map((x) => [x.key, x.value])));
  })
);

r.put(
  '/settings',
  validate(z.record(z.string().max(100), z.any())),
  ah(async (req, res) => {
    for (const [key, value] of Object.entries(req.body)) {
      await db.update('system_settings', { key }, { $set: { value: value ?? null, updated_at: new Date() } }, { upsert: true });
    }
    res.json({ ok: true });
  })
);

// ---------- Consolidated reports ----------
r.get(
  '/reports/:type',
  ah(async (req, res) => {
    const rid = req.query.restaurantId ? parseInt(req.query.restaurantId, 10) : null;
    const branchIds = await db.distinct('restaurant_branches', 'id', rid == null ? {} : { restaurant_id: rid });
    const report = await runReport(req.params.type, { branchIds, from: req.query.from, to: req.query.to, period: req.query.period, status: req.query.status });
    await sendReport(res, report, req.query.format, rid ? `Restaurant #${rid} (all branches)` : 'All restaurants (consolidated)');
  })
);

r.get(
  '/audit-logs',
  ah(async (req, res) => {
    let filter = {};
    if (req.query.q) {
      const q = ilike(req.query.q);
      const named = await db.distinct('users', 'id', { name: q });
      filter = { $or: [{ action: q }, { entity: q }, { user_id: { $in: named } }] };
    }
    const logs = await db.find('audit_logs', filter, { sort: { created_at: -1, id: -1 }, limit: 300 });
    const [users, branches] = await Promise.all([
      db.mapByIds('users', logs.map((a) => a.user_id), { projection: { name: 1, email: 1 } }),
      db.mapByIds('restaurant_branches', logs.map((a) => a.branch_id), { projection: { name: 1 } }),
    ]);
    res.json(logs.map((a) => ({ ...a, user_name: users.get(a.user_id)?.name ?? null, user_email: users.get(a.user_id)?.email ?? null, branch_name: branches.get(a.branch_id)?.name ?? null })));
  })
);

export default r;
