import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { db } from '../../db/index.js';
import { ah, badRequest, conflict, forbidden, notFound, validate } from '../../utils/http.js';
import { clearAuthCache, requirePerm } from '../../middleware/auth.js';
import { definedOnly, ilike, localDate, localIso, parseLocal, round2, toTime } from '../../utils/common.js';
import { notify } from '../../services/notify.js';
import { crud, zs } from './crud.js';

const r = Router();
const pid = (req) => parseInt(req.params.id, 10) || 0;
const ci = { locale: 'en', strength: 2 };

/** 'YYYY-MM-DD' + n days (calendar arithmetic). */
const addDays = (s, n) => {
  const d = new Date(`${s}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const dayDiff = (a, b) => Math.round((Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86400000);

// ================= Customers =================
const branchIdsOf = (restaurantId) => db.distinct('restaurant_branches', 'id', { restaurant_id: restaurantId });

/**
 * Customers visible to a restaurant: they booked, ordered or reviewed at one of its branches.
 * Returns the ids (optionally limited to `onlyIds`).
 */
async function restaurantCustomerIds(bids, onlyIds) {
  const limit = onlyIds ? { customer_id: { $in: onlyIds } } : { customer_id: { $ne: null } };
  const [rc, oc, reviewUsers] = await Promise.all([
    db.distinct('reservations', 'customer_id', { branch_id: { $in: bids }, ...limit }),
    db.distinct('orders', 'customer_id', { branch_id: { $in: bids }, ...limit }),
    db.distinct('reviews', 'user_id', { branch_id: { $in: bids } }),
  ]);
  const ids = new Set([...rc, ...oc]);
  if (reviewUsers.length) {
    const filter = { user_id: { $in: reviewUsers } };
    if (onlyIds) filter.id = { $in: onlyIds };
    for (const id of await db.distinct('customers', 'id', filter)) ids.add(id);
  }
  return ids;
}

/** Customer (with user fields) scoped to the restaurant, or null. */
async function scopedCustomer(req, id) {
  const bids = await branchIdsOf(req.restaurantId);
  const ids = await restaurantCustomerIds(bids, [id]);
  if (!ids.has(id)) return null;
  const c = await db.byId('customers', id);
  if (!c) return null;
  const u = await db.byId('users', c.user_id, { projection: { name: 1, email: 1, phone: 1, avatar_url: 1, created_at: 1, last_login_at: 1 } });
  if (!u) return null;
  return { c, u, bids };
}

r.get(
  '/customers',
  requirePerm('customers.view', 'customers.manage'),
  ah(async (req, res) => {
    const bids = await branchIdsOf(req.restaurantId);
    const ids = [...(await restaurantCustomerIds(bids))];
    const filter = { id: { $in: ids } };
    if (req.query.status) filter.status = req.query.status;
    const customers = ids.length ? await db.find('customers', filter) : [];
    const userFilter = { id: { $in: customers.map((c) => c.user_id) } };
    if (req.query.q) {
      const q = ilike(req.query.q);
      userFilter.$or = [{ name: q }, { email: q }, { phone: q }];
    }
    const users = new Map(
      (customers.length ? await db.find('users', userFilter, { projection: { id: 1, name: 1, email: 1, phone: 1, avatar_url: 1 } }) : []).map((u) => [u.id, u])
    );
    const list = customers.filter((c) => users.has(c.user_id));
    const cids = list.map((c) => c.id);
    const nowLocal = localIso();
    const [bk, od, visits] = cids.length
      ? await Promise.all([
          db.aggregate('reservations', [{ $match: { customer_id: { $in: cids }, branch_id: { $in: bids } } }, { $group: { _id: '$customer_id', n: { $sum: 1 } } }]),
          db.aggregate('orders', [
            { $match: { customer_id: { $in: cids }, branch_id: { $in: bids }, status: { $ne: 'cancelled' } } },
            { $group: { _id: '$customer_id', n: { $sum: 1 }, spent: { $sum: '$total' } } },
          ]),
          db.aggregate('reservations', [
            { $match: { customer_id: { $in: cids }, branch_id: { $in: bids }, status: { $in: ['completed', 'seated', 'checked_in'] }, start_at: { $lte: nowLocal } } },
            { $group: { _id: '$customer_id', last: { $max: '$start_at' } } },
          ]),
        ])
      : [[], [], []];
    const bkBy = new Map(bk.map((x) => [x._id, x.n]));
    const odBy = new Map(od.map((x) => [x._id, x]));
    const visitBy = new Map(visits.map((x) => [x._id, x.last]));
    const rows = list
      .map((c) => {
        const u = users.get(c.user_id);
        return {
          id: c.id,
          user_id: c.user_id,
          name: u.name,
          email: u.email,
          phone: u.phone ?? null,
          avatar_url: u.avatar_url ?? null,
          loyalty_points: c.loyalty_points,
          status: c.status,
          created_at: c.created_at,
          bookings: bkBy.get(c.id) || 0,
          orders: odBy.get(c.id)?.n || 0,
          total_spent: round2(odBy.get(c.id)?.spent || 0),
          last_visit: visitBy.get(c.id) ?? null,
        };
      })
      .sort((a, b) => b.total_spent - a.total_spent || b.id - a.id)
      .slice(0, 1000);
    res.json(rows);
  })
);

r.get(
  '/customers/:id(\\d+)',
  requirePerm('customers.view', 'customers.manage'),
  ah(async (req, res) => {
    const found = await scopedCustomer(req, pid(req));
    if (!found) throw notFound('Customer');
    const { c: cust, u, bids } = found;
    const c = { ...cust, name: u.name, email: u.email, phone: u.phone ?? null, avatar_url: u.avatar_url ?? null, registered_at: u.created_at, last_login_at: u.last_login_at ?? null };
    const [resv, orders, revs] = await Promise.all([
      db.find('reservations', { customer_id: c.id, branch_id: { $in: bids } }, { sort: { start_at: -1 }, projection: { id: 1, booking_code: 1, booking_date: 1, start_at: 1, guests: 1, status: 1, branch_id: 1 } }),
      db.find('orders', { customer_id: c.id, branch_id: { $in: bids } }, { sort: { created_at: -1 }, projection: { id: 1, order_code: 1, order_type: 1, total: 1, status: 1, payment_status: 1, created_at: 1 } }),
      db.find('reviews', { user_id: c.user_id, branch_id: { $in: bids } }, { sort: { created_at: -1 }, projection: { id: 1, rating: 1, comment: 1, created_at: 1, food_item_id: 1 } }),
    ]);
    const [branches, foods] = await Promise.all([
      db.mapByIds('restaurant_branches', resv.map((x) => x.branch_id), { projection: { name: 1 } }),
      db.mapByIds('food_items', revs.map((x) => x.food_item_id), { projection: { name: 1 } }),
    ]);
    const bookings = resv.map(({ branch_id, ...x }) => ({ ...x, branch_name: branches.get(branch_id)?.name ?? null }));
    const reviews = revs.map(({ food_item_id, ...x }) => ({ ...x, food_name: foods.get(food_item_id)?.name ?? null }));
    const spent = round2(orders.filter((o) => o.status !== 'cancelled').reduce((s, o) => s + Number(o.total), 0));
    res.json({ ...c, restaurant_spent: spent, bookings, orders, reviews });
  })
);

r.patch(
  '/customers/:id(\\d+)',
  requirePerm('customers.manage'),
  validate(z.object({ status: z.enum(['active', 'blocked']).optional(), loyalty_points: z.number().int().min(0).optional(), notes: zs.optStr(2000) })),
  ah(async (req, res) => {
    const found = await scopedCustomer(req, pid(req));
    if (!found) throw notFound('Customer');
    const { c } = found;
    const data = definedOnly(req.body);
    if (Object.keys(data).length) await db.update('customers', { id: c.id }, { $set: data });
    clearAuthCache(c.user_id);
    res.json(await db.byId('customers', c.id));
  })
);

// ================= Employees =================
const employees = crud({
  table: 'employees',
  scope: 'branch',
  perm: 'staff.manage',
  viewPerm: 'orders.manage',
  search: ['name', 'email', 'phone'],
  filters: { position: 'position', status: 'status' },
  sort: { position: 1, name: 1 },
  // joined fields: login_email, login_role, login_active (LEFT JOIN users/roles) + upcoming_shifts count
  enrich: async (rows) => {
    const users = await db.mapByIds('users', rows.map((e) => e.user_id), { projection: { email: 1, role_id: 1, is_active: 1 } });
    const roles = await db.mapByIds('roles', [...users.values()].map((u) => u.role_id), { projection: { name: 1 } });
    const upcoming = rows.length
      ? await db.aggregate('staff_shifts', [
          { $match: { employee_id: { $in: rows.map((e) => e.id) }, shift_date: { $gte: localDate() } } },
          { $group: { _id: '$employee_id', n: { $sum: 1 } } },
        ])
      : [];
    const upBy = new Map(upcoming.map((x) => [x._id, x.n]));
    return rows.map((e) => {
      const u = users.get(e.user_id);
      return {
        ...e,
        login_email: u?.email ?? null,
        login_role: (u && roles.get(u.role_id)?.name) ?? null,
        login_active: u ? u.is_active : null,
        upcoming_shifts: upBy.get(e.id) || 0,
      };
    });
  },
  schema: z.object({
    name: zs.str(120).min(2, 'Name is required'),
    email: zs.optStr(150),
    phone: zs.optStr(20),
    position: z.enum(['manager', 'waiter', 'chef', 'cashier', 'host', 'cleaner', 'delivery']),
    salary: zs.optNum(),
    hire_date: zs.optDate(),
    status: z.enum(['active', 'on_leave', 'terminated']).default('active'),
    address: zs.optStr(),
  }),
  async afterSave(req, id, body) {
    // Terminating an employee disables their login.
    if (body.status === 'terminated') {
      const e = await db.byId('employees', id, { projection: { user_id: 1 } });
      if (e?.user_id) {
        await db.update('users', { id: e.user_id }, { $set: { is_active: false } });
        clearAuthCache(e.user_id);
      }
    }
  },
});
r.use('/employees', employees);

const STAFF_ASSIGNABLE = ['manager', 'waiter', 'chef', 'cashier'];

/** Create or update a login account for an employee with a staff role. */
r.post(
  '/employees/:id(\\d+)/account',
  requirePerm('staff.manage'),
  validate(z.object({ email: z.string().trim().toLowerCase().email(), password: z.string().min(8).optional(), role: z.enum(STAFF_ASSIGNABLE), is_active: z.boolean().default(true) })),
  ah(async (req, res) => {
    const emp = await employees.getOne(req, pid(req));
    const role = await db.findOne('roles', { name: req.body.role }, { projection: { id: 1 } });
    if (req.body.role === 'manager' && !['restaurant_admin', 'super_admin'].includes(req.user.role)) throw forbidden('Only restaurant admins can create manager accounts');
    let userId = emp.user_id;
    if (userId) {
      const set = { email: req.body.email, role_id: role.id, is_active: req.body.is_active, updated_at: new Date() };
      if (req.body.password) set.password_hash = await bcrypt.hash(req.body.password, 10);
      await db.update('users', { id: userId }, { $set: set });
      clearAuthCache(userId);
    } else {
      if (!req.body.password) throw badRequest('Password is required for a new account');
      const exists = await db.findOne('users', { email: req.body.email }, { projection: { id: 1 }, collation: ci });
      if (exists) throw conflict('This email is already used by another account');
      const u = await db.insert('users', {
        role_id: role.id,
        restaurant_id: req.restaurantId,
        branch_id: req.branchId,
        name: emp.name,
        email: req.body.email,
        phone: emp.phone || null,
        password_hash: await bcrypt.hash(req.body.password, 10),
        email_verified: true,
        is_active: req.body.is_active,
      });
      userId = u.id;
      await db.update('employees', { id: emp.id }, { $set: { user_id: userId } });
      await notify({ type: 'staff_account', title: 'Your staff account is ready', message: `Hi ${emp.name}, you can now log in to the staff dashboard with ${req.body.email}.`, email: req.body.email, channels: ['email'] });
    }
    res.json(await employees.getOne(req, emp.id));
  })
);

// ================= Shifts & attendance =================
r.get(
  '/shifts',
  requirePerm('staff.manage'),
  ah(async (req, res) => {
    const from = req.query.from || localDate();
    const to = req.query.to || from;
    const emps = new Map((await db.find('employees', { branch_id: req.branchId }, { projection: { id: 1, name: 1, position: 1 } })).map((e) => [e.id, e]));
    let empIds = [...emps.keys()];
    if (req.query.employeeId) {
      const only = parseInt(req.query.employeeId, 10);
      empIds = empIds.filter((id) => id === only);
    }
    const shifts = empIds.length ? await db.find('staff_shifts', { employee_id: { $in: empIds }, shift_date: { $gte: String(from), $lte: String(to) } }) : [];
    const rows = shifts.map((s) => ({ ...s, employee_name: emps.get(s.employee_id).name, position: emps.get(s.employee_id).position }));
    rows.sort((a, b) => (a.shift_date < b.shift_date ? -1 : a.shift_date > b.shift_date ? 1 : a.start_time < b.start_time ? -1 : a.start_time > b.start_time ? 1 : String(a.employee_name).localeCompare(String(b.employee_name))));
    res.json(rows);
  })
);

const shiftSchema = z.object({
  employee_id: z.number().int(),
  shift_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  start_time: zs.time(),
  end_time: zs.time(),
  notes: zs.optStr(),
  attendance_status: z.enum(['scheduled', 'present', 'late', 'absent', 'leave']).optional(),
});

async function scopedShift(req) {
  const s = await db.byId('staff_shifts', pid(req));
  if (!s || !(await db.exists('employees', { id: s.employee_id, branch_id: req.branchId }))) throw notFound('Shift');
  return s;
}

r.post(
  '/shifts',
  requirePerm('staff.manage'),
  validate(shiftSchema.extend({ repeat_days: z.number().int().min(0).max(30).default(0) })),
  ah(async (req, res) => {
    const b = req.body;
    if (b.end_time <= b.start_time) throw badRequest('Shift end must be after start');
    const emp = await db.findOne('employees', { id: b.employee_id, branch_id: req.branchId, status: { $ne: 'terminated' } }, { projection: { id: 1 } });
    if (!emp) throw badRequest('Invalid employee');
    const created = [];
    for (let i = 0; i <= b.repeat_days; i++) {
      try {
        // unique (employee_id, shift_date, start_time) index => ON CONFLICT DO NOTHING
        const row = await db.insert('staff_shifts', {
          employee_id: b.employee_id,
          shift_date: addDays(b.shift_date, i),
          start_time: toTime(b.start_time),
          end_time: toTime(b.end_time),
          notes: b.notes || null,
          attendance_status: b.attendance_status || 'scheduled',
        });
        created.push(row);
      } catch (e) {
        if (e?.code !== 11000) throw e;
      }
    }
    if (!created.length) throw conflict('This shift already exists');
    res.status(201).json(created);
  })
);

r.put(
  '/shifts/:id(\\d+)',
  requirePerm('staff.manage'),
  validate(shiftSchema.partial().omit({ employee_id: true })),
  ah(async (req, res) => {
    const s = await scopedShift(req);
    const start = (req.body.start_time || s.start_time).slice(0, 5);
    const end = (req.body.end_time || s.end_time).slice(0, 5);
    if (end <= start) throw badRequest('Shift end must be after start');
    const data = definedOnly(req.body);
    if (data.start_time) data.start_time = toTime(data.start_time);
    if (data.end_time) data.end_time = toTime(data.end_time);
    if (Object.keys(data).length) await db.update('staff_shifts', { id: s.id }, { $set: data });
    res.json(await db.byId('staff_shifts', s.id));
  })
);

r.delete(
  '/shifts/:id(\\d+)',
  requirePerm('staff.manage'),
  ah(async (req, res) => {
    const s = await scopedShift(req);
    await db.remove('staff_shifts', { id: s.id });
    res.json({ ok: true });
  })
);

r.post(
  '/shifts/:id(\\d+)/check-in',
  requirePerm('staff.manage'),
  ah(async (req, res) => {
    const s = await scopedShift(req);
    const now = new Date();
    const start = parseLocal(`${s.shift_date}T${s.start_time}`);
    const late = now.getTime() - start.getTime() > 10 * 60000;
    res.json(await db.findOneAndUpdate('staff_shifts', { id: s.id }, { $set: { check_in_at: now, attendance_status: late ? 'late' : 'present' } }));
  })
);

r.post(
  '/shifts/:id(\\d+)/check-out',
  requirePerm('staff.manage'),
  ah(async (req, res) => {
    const s = await scopedShift(req);
    if (!s.check_in_at) throw badRequest('Check in first');
    res.json(await db.findOneAndUpdate('staff_shifts', { id: s.id }, { $set: { check_out_at: new Date() } }));
  })
);

r.get(
  '/attendance/summary',
  requirePerm('staff.manage'),
  ah(async (req, res) => {
    const from = String(req.query.from || localDate(new Date(Date.now() - 29 * 86400000)));
    const to = String(req.query.to || localDate());
    const emps = await db.find('employees', { branch_id: req.branchId, status: { $ne: 'terminated' } }, { projection: { id: 1, name: 1, position: 1 } });
    const stats = emps.length
      ? await db.aggregate('staff_shifts', [
          { $match: { employee_id: { $in: emps.map((e) => e.id) }, shift_date: { $gte: from, $lte: to } } },
          {
            $group: {
              _id: '$employee_id',
              shifts: { $sum: 1 },
              present: { $sum: { $cond: [{ $eq: ['$attendance_status', 'present'] }, 1, 0] } },
              late: { $sum: { $cond: [{ $eq: ['$attendance_status', 'late'] }, 1, 0] } },
              absent: { $sum: { $cond: [{ $eq: ['$attendance_status', 'absent'] }, 1, 0] } },
              leave: { $sum: { $cond: [{ $eq: ['$attendance_status', 'leave'] }, 1, 0] } },
              hours: {
                $sum: {
                  $cond: [
                    { $and: [{ $gt: ['$check_out_at', null] }, { $gt: ['$check_in_at', null] }] },
                    { $divide: [{ $subtract: ['$check_out_at', '$check_in_at'] }, 3600000] },
                    0,
                  ],
                },
              },
            },
          },
        ])
      : [];
    const by = new Map(stats.map((s) => [s._id, s]));
    const rows = emps
      .map((e) => {
        const s = by.get(e.id);
        return {
          id: e.id,
          name: e.name,
          position: e.position,
          shifts: s?.shifts || 0,
          present: s?.present || 0,
          late: s?.late || 0,
          absent: s?.absent || 0,
          leave: s?.leave || 0,
          hours: Math.round((s?.hours || 0) * 10) / 10,
        };
      })
      .sort((a, b) => String(a.name).localeCompare(String(b.name)));
    res.json(rows);
  })
);

// ================= Roles & permissions =================
r.get(
  '/roles',
  requirePerm('staff.manage', 'roles.manage'),
  ah(async (_req, res) => {
    const roleRows = await db.find('roles', { is_staff: true, name: { $ne: 'super_admin' } }, { sort: { id: 1 }, projection: { id: 1, name: 1, display_name: 1, is_staff: 1 } });
    const links = roleRows.length ? await db.find('role_permissions', { role_id: { $in: roleRows.map((x) => x.id) } }, { projection: { role_id: 1, permission_id: 1 } }) : [];
    const permissions = await db.find('permissions', {}, { sort: { module: 1, code: 1 }, projection: { id: 1, code: 1, module: 1, description: 1 } });
    const codeById = new Map(permissions.map((p) => [p.id, p.code]));
    const roles = roleRows.map((ro) => ({
      id: ro.id,
      name: ro.name,
      display_name: ro.display_name,
      is_staff: ro.is_staff,
      permissions: links
        .filter((l) => l.role_id === ro.id && codeById.has(l.permission_id))
        .map((l) => codeById.get(l.permission_id))
        .sort(),
    }));
    res.json({ roles, permissions: permissions.map((p) => ({ code: p.code, module: p.module, description: p.description ?? null })) });
  })
);

r.put(
  '/roles/:id(\\d+)/permissions',
  requirePerm('roles.manage'),
  validate(z.object({ permissions: z.array(z.string().max(100)).max(100) })),
  ah(async (req, res) => {
    const role = await db.byId('roles', pid(req));
    if (!role || !role.is_staff || role.name === 'super_admin') throw notFound('Role');
    if (req.user.role !== 'super_admin') throw forbidden('Role permissions are shared by all restaurants and can only be changed by a super admin');
    const perms = req.body.permissions.filter((p) => p !== 'roles.manage');
    req.body.permissions = perms;
    await db.tx(async () => {
      await db.remove('role_permissions', { role_id: role.id });
      const ids = await db.find('permissions', { code: { $in: req.body.permissions } }, { projection: { id: 1 } });
      await db.insertMany('role_permissions', ids.map((p) => ({ role_id: role.id, permission_id: p.id })));
    });
    clearAuthCache();
    res.json({ ok: true });
  })
);

// ================= Inventory =================
r.use(
  '/suppliers',
  crud({
    table: 'suppliers',
    scope: 'restaurant',
    perm: 'inventory.manage',
    search: ['name', 'contact_person', 'phone', 'email'],
    sort: { name: 1 },
    // computed fields: item_count, total_purchases
    enrich: async (rows) => {
      const ids = rows.map((s) => s.id);
      const [items, purchases] = ids.length
        ? await Promise.all([
            db.aggregate('inventory_items', [{ $match: { supplier_id: { $in: ids } } }, { $group: { _id: '$supplier_id', n: { $sum: 1 } } }]),
            db.aggregate('inventory_transactions', [{ $match: { supplier_id: { $in: ids }, type: 'stock_in' } }, { $group: { _id: '$supplier_id', total: { $sum: '$total_cost' } } }]),
          ])
        : [[], []];
      const itemsBy = new Map(items.map((x) => [x._id, x.n]));
      const purchBy = new Map(purchases.map((x) => [x._id, x.total]));
      return rows.map((s) => ({ ...s, item_count: itemsBy.get(s.id) || 0, total_purchases: round2(purchBy.get(s.id) || 0) }));
    },
    schema: z.object({
      name: zs.str(150).min(2, 'Name is required'),
      contact_person: zs.optStr(120),
      phone: zs.optStr(30),
      email: zs.optStr(150),
      address: zs.optStr(),
      gstin: zs.optStr(20),
      is_active: z.boolean().optional(),
    }),
  })
);

r.get(
  '/inventory/alerts',
  requirePerm('inventory.manage'),
  ah(async (req, res) => {
    const days = parseInt(req.query.days, 10) || 7;
    const today = localDate();
    const [lowRows, expRows] = await Promise.all([
      db.find('inventory_items', { branch_id: req.branchId, is_active: true, $expr: { $lte: ['$quantity', '$min_quantity'] } }),
      db.find('inventory_items', { branch_id: req.branchId, is_active: true, expiry_date: { $ne: null, $lte: addDays(today, days) } }, { sort: { expiry_date: 1 } }),
    ]);
    // ORDER BY quantity / NULLIF(min_quantity, 0) NULLS FIRST
    const ratio = (i) => (Number(i.min_quantity) === 0 ? null : Number(i.quantity) / Number(i.min_quantity));
    const low = lowRows.sort((a, b) => {
      const ra = ratio(a);
      const rb = ratio(b);
      if (ra === null || rb === null) return ra === rb ? 0 : ra === null ? -1 : 1;
      return ra - rb;
    });
    const expiring = expRows.map((i) => ({ ...i, days_left: dayDiff(i.expiry_date, today) }));
    res.json({ low, expiring });
  })
);

r.get(
  '/inventory/transactions',
  requirePerm('inventory.manage'),
  ah(async (req, res) => {
    const items = new Map((await db.find('inventory_items', { branch_id: req.branchId }, { projection: { id: 1, name: 1, unit: 1 } })).map((i) => [i.id, i]));
    let itemIds = [...items.keys()];
    if (req.query.itemId) {
      const only = parseInt(req.query.itemId, 10);
      itemIds = itemIds.filter((id) => id === only);
    }
    const filter = { inventory_item_id: { $in: itemIds } };
    if (req.query.type) filter.type = req.query.type;
    if (req.query.from || req.query.to) {
      filter.created_at = {};
      if (req.query.from) filter.created_at.$gte = parseLocal(String(req.query.from).slice(0, 10));
      if (req.query.to) {
        const end = parseLocal(String(req.query.to).slice(0, 10));
        end.setDate(end.getDate() + 1);
        filter.created_at.$lt = end;
      }
    }
    const rows = itemIds.length ? await db.find('inventory_transactions', filter, { sort: { created_at: -1, id: -1 }, limit: 500 }) : [];
    const [suppliers, users] = await Promise.all([
      db.mapByIds('suppliers', rows.map((t) => t.supplier_id), { projection: { name: 1 } }),
      db.mapByIds('users', rows.map((t) => t.created_by), { projection: { name: 1 } }),
    ]);
    res.json(
      rows.map((t) => ({
        ...t,
        item_name: items.get(t.inventory_item_id).name,
        unit: items.get(t.inventory_item_id).unit,
        supplier_name: suppliers.get(t.supplier_id)?.name ?? null,
        created_by_name: users.get(t.created_by)?.name ?? null,
      }))
    );
  })
);

r.post(
  '/inventory/transactions',
  requirePerm('inventory.manage'),
  validate(
    z.object({
      inventory_item_id: z.number().int(),
      type: z.enum(['stock_in', 'stock_out', 'adjustment', 'wastage']),
      quantity: z.number().min(0, 'Quantity cannot be negative'),
      unit_cost: zs.optNum(),
      supplier_id: zs.optInt(),
      reference: zs.optStr(100),
      notes: zs.optStr(),
      expiry_date: zs.optDate(),
    })
  ),
  ah(async (req, res) => {
    const b = req.body;
    // "adjustment" sets the physical count (0 allowed); other movements need a positive quantity
    if (b.type !== 'adjustment' && !(b.quantity > 0)) throw badRequest('Quantity must be positive');
    const result = await db.tx(async () => {
      const itemFilter = { id: b.inventory_item_id, branch_id: req.branchId };
      await db.lock('inventory_items', itemFilter);
      const item = await db.findOne('inventory_items', itemFilter);
      if (!item) throw notFound('Inventory item');
      if (b.supplier_id) {
        const s = await db.findOne('suppliers', { id: b.supplier_id, restaurant_id: req.restaurantId }, { projection: { id: 1 } });
        if (!s) throw badRequest('Invalid supplier');
      }
      const qty = Number(item.quantity);
      // adjustment = set absolute stock count (physical count)
      const balance = b.type === 'stock_in' ? qty + b.quantity : b.type === 'adjustment' ? b.quantity : qty - b.quantity;
      if (balance < 0) throw badRequest(`Insufficient stock. Available: ${qty} ${item.unit}`);
      const delta = b.type === 'adjustment' ? Math.abs(b.quantity - qty) : b.quantity;
      const unitCost = b.unit_cost ?? Number(item.cost_per_unit);
      const tx = await db.insert('inventory_transactions', {
        inventory_item_id: item.id,
        type: b.type,
        quantity: delta,
        unit_cost: unitCost,
        total_cost: round2(delta * unitCost),
        supplier_id: b.supplier_id || null,
        reference: b.reference || null,
        notes: b.notes || null,
        balance_after: balance,
        created_by: req.user.id,
      });
      const set = { quantity: balance };
      if (b.type === 'stock_in') {
        if (b.unit_cost != null) set.cost_per_unit = b.unit_cost;
        if (b.supplier_id) set.supplier_id = b.supplier_id;
        if (b.expiry_date) set.expiry_date = b.expiry_date;
      }
      await db.update('inventory_items', { id: item.id }, { $set: set });
      return { tx, item, balance };
    });
    const { item, balance } = result;
    if (balance <= Number(item.min_quantity) && Number(item.quantity) > Number(item.min_quantity)) {
      await notify({
        branchId: req.branchId,
        adminFeed: true,
        channels: [],
        type: 'low_stock',
        title: `Low stock: ${item.name}`,
        message: `${item.name} is down to ${balance} ${item.unit} (minimum ${item.min_quantity}).`,
        adminLink: '/admin/inventory',
      });
    }
    res.locals.createdId = result.tx.id;
    res.status(201).json(result.tx);
  })
);

r.use(
  '/inventory',
  crud({
    table: 'inventory_items',
    scope: 'branch',
    perm: 'inventory.manage',
    search: ['name', 'sku', 'category'],
    filters: { category: 'category', supplierId: 'supplier_id' },
    sort: { name: 1 },
    refs: { supplier_id: ['suppliers', 'restaurant'] },
    // joined/computed fields: supplier_name, stock_status
    enrich: async (rows) => {
      const suppliers = await db.mapByIds('suppliers', rows.map((i) => i.supplier_id), { projection: { name: 1 } });
      const soon = addDays(localDate(), 7);
      return rows.map((i) => ({
        ...i,
        supplier_name: suppliers.get(i.supplier_id)?.name ?? null,
        stock_status: Number(i.quantity) <= Number(i.min_quantity) ? 'low' : i.expiry_date && i.expiry_date <= soon ? 'expiring' : 'ok',
      }));
    },
    schema: z.object({
      name: zs.str(150).min(2, 'Name is required'),
      sku: zs.optStr(50),
      category: zs.optStr(50),
      unit: zs.str(20).min(1),
      quantity: z.number().min(0).default(0),
      min_quantity: z.number().min(0).default(0),
      cost_per_unit: z.number().min(0).default(0),
      supplier_id: zs.optInt(),
      expiry_date: zs.optDate(),
      is_active: z.boolean().optional(),
    }),
  })
);

export default r;
