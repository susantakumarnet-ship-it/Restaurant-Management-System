import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { db } from '../../db/index.js';
import { ah, badRequest, conflict, forbidden, notFound, validate } from '../../utils/http.js';
import { clearAuthCache, requirePerm } from '../../middleware/auth.js';
import { buildUpdate, localDate, round2 } from '../../utils/common.js';
import { notify } from '../../services/notify.js';
import { crud, zs } from './crud.js';

const r = Router();
const pid = (req) => parseInt(req.params.id, 10) || 0;

// ================= Customers =================
const customerBase = `
  FROM customers c JOIN users u ON u.id = c.user_id
  WHERE (EXISTS (SELECT 1 FROM reservations x JOIN restaurant_branches b ON b.id = x.branch_id WHERE x.customer_id = c.id AND b.restaurant_id = $1)
      OR EXISTS (SELECT 1 FROM orders x JOIN restaurant_branches b ON b.id = x.branch_id WHERE x.customer_id = c.id AND b.restaurant_id = $1)
      OR EXISTS (SELECT 1 FROM reviews x JOIN restaurant_branches b ON b.id = x.branch_id WHERE x.user_id = c.user_id AND b.restaurant_id = $1))`;

r.get(
  '/customers',
  requirePerm('customers.view', 'customers.manage'),
  ah(async (req, res) => {
    const params = [req.restaurantId];
    let extra = '';
    if (req.query.q) {
      params.push(`%${String(req.query.q).trim()}%`);
      extra += ` AND (u.name ILIKE $2 OR u.email ILIKE $2 OR u.phone ILIKE $2)`;
    }
    if (req.query.status) {
      params.push(req.query.status);
      extra += ` AND c.status = $${params.length}`;
    }
    res.json(
      await db.many(
        `SELECT c.id, c.user_id, u.name, u.email, u.phone, u.avatar_url, c.loyalty_points, c.status, c.created_at,
            (SELECT COUNT(*) FROM reservations x JOIN restaurant_branches b ON b.id = x.branch_id WHERE x.customer_id = c.id AND b.restaurant_id = $1) AS bookings,
            (SELECT COUNT(*) FROM orders x JOIN restaurant_branches b ON b.id = x.branch_id WHERE x.customer_id = c.id AND b.restaurant_id = $1 AND x.status <> 'cancelled') AS orders,
            (SELECT COALESCE(SUM(x.total),0) FROM orders x JOIN restaurant_branches b ON b.id = x.branch_id WHERE x.customer_id = c.id AND b.restaurant_id = $1 AND x.status <> 'cancelled') AS total_spent,
            (SELECT MAX(x.start_at) FROM reservations x JOIN restaurant_branches b ON b.id = x.branch_id
              WHERE x.customer_id = c.id AND b.restaurant_id = $1 AND x.status IN ('completed','seated','checked_in')
                AND x.start_at <= LOCALTIMESTAMP) AS last_visit
         ${customerBase} ${extra} ORDER BY total_spent DESC, c.id DESC LIMIT 1000`,
        params
      )
    );
  })
);

r.get(
  '/customers/:id(\\d+)',
  requirePerm('customers.view', 'customers.manage'),
  ah(async (req, res) => {
    const c = await db.one(
      `SELECT c.*, u.name, u.email, u.phone, u.avatar_url, u.created_at AS registered_at, u.last_login_at ${customerBase} AND c.id = $2`,
      [req.restaurantId, pid(req)]
    );
    if (!c) throw notFound('Customer');
    const [bookings, orders, reviews] = await Promise.all([
      db.many(
        `SELECT x.id, x.booking_code, x.booking_date, x.start_at, x.guests, x.status, b.name AS branch_name
           FROM reservations x JOIN restaurant_branches b ON b.id = x.branch_id WHERE x.customer_id = $1 AND b.restaurant_id = $2 ORDER BY x.start_at DESC`,
        [c.id, req.restaurantId]
      ),
      db.many(
        `SELECT x.id, x.order_code, x.order_type, x.total, x.status, x.payment_status, x.created_at
           FROM orders x JOIN restaurant_branches b ON b.id = x.branch_id WHERE x.customer_id = $1 AND b.restaurant_id = $2 ORDER BY x.created_at DESC`,
        [c.id, req.restaurantId]
      ),
      db.many(
        `SELECT x.id, x.rating, x.comment, x.created_at, f.name AS food_name FROM reviews x
           JOIN restaurant_branches b ON b.id = x.branch_id LEFT JOIN food_items f ON f.id = x.food_item_id
          WHERE x.user_id = $1 AND b.restaurant_id = $2 ORDER BY x.created_at DESC`,
        [c.user_id, req.restaurantId]
      ),
    ]);
    const spent = round2(orders.filter((o) => o.status !== 'cancelled').reduce((s, o) => s + Number(o.total), 0));
    res.json({ ...c, restaurant_spent: spent, bookings, orders, reviews });
  })
);

r.patch(
  '/customers/:id(\\d+)',
  requirePerm('customers.manage'),
  validate(z.object({ status: z.enum(['active', 'blocked']).optional(), loyalty_points: z.number().int().min(0).optional(), notes: zs.optStr(2000) })),
  ah(async (req, res) => {
    const c = await db.one(`SELECT c.id, c.user_id ${customerBase} AND c.id = $2`, [req.restaurantId, pid(req)]);
    if (!c) throw notFound('Customer');
    const { sets, values } = buildUpdate(req.body, { startIndex: 2 });
    if (sets.length) await db.query(`UPDATE customers SET ${sets.join(', ')} WHERE id = $1`, [c.id, ...values]);
    clearAuthCache(c.user_id);
    res.json(await db.one('SELECT * FROM customers WHERE id = $1', [c.id]));
  })
);

// ================= Employees =================
const employees = crud({
  table: 'employees',
  scope: 'branch',
  perm: 'staff.manage',
  viewPerm: 'orders.manage',
  search: ['t.name', 't.email', 't.phone'],
  filters: { position: 't.position', status: 't.status' },
  orderBy: 't.position, t.name',
  select: `t.*, u.email AS login_email, ro.name AS login_role, u.is_active AS login_active,
    (SELECT COUNT(*) FROM staff_shifts s WHERE s.employee_id = t.id AND s.shift_date >= CURRENT_DATE) AS upcoming_shifts`,
  from: 'employees t LEFT JOIN users u ON u.id = t.user_id LEFT JOIN roles ro ON ro.id = u.role_id',
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
      const e = await db.one('SELECT user_id FROM employees WHERE id = $1', [id]);
      if (e?.user_id) {
        await db.query('UPDATE users SET is_active = false WHERE id = $1', [e.user_id]);
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
    const role = await db.one('SELECT id FROM roles WHERE name = $1', [req.body.role]);
    if (req.body.role === 'manager' && !['restaurant_admin', 'super_admin'].includes(req.user.role)) throw forbidden('Only restaurant admins can create manager accounts');
    let userId = emp.user_id;
    if (userId) {
      await db.query(
        `UPDATE users SET email = $2, role_id = $3, is_active = $4, password_hash = COALESCE($5, password_hash), updated_at = now() WHERE id = $1`,
        [userId, req.body.email, role.id, req.body.is_active, req.body.password ? await bcrypt.hash(req.body.password, 10) : null]
      );
      clearAuthCache(userId);
    } else {
      if (!req.body.password) throw badRequest('Password is required for a new account');
      const exists = await db.one('SELECT id FROM users WHERE lower(email) = $1', [req.body.email]);
      if (exists) throw conflict('This email is already used by another account');
      const u = await db.one(
        `INSERT INTO users(role_id, restaurant_id, branch_id, name, email, phone, password_hash, email_verified, is_active)
         VALUES ($1,$2,$3,$4,$5,$6,$7,true,$8) RETURNING id`,
        [role.id, req.restaurantId, req.branchId, emp.name, req.body.email, emp.phone || null, await bcrypt.hash(req.body.password, 10), req.body.is_active]
      );
      userId = u.id;
      await db.query('UPDATE employees SET user_id = $2 WHERE id = $1', [emp.id, userId]);
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
    const params = [req.branchId, from, to];
    let extra = '';
    if (req.query.employeeId) {
      params.push(parseInt(req.query.employeeId, 10));
      extra = ` AND s.employee_id = $${params.length}`;
    }
    res.json(
      await db.many(
        `SELECT s.*, s.shift_date::text AS shift_date, e.name AS employee_name, e.position FROM staff_shifts s JOIN employees e ON e.id = s.employee_id
          WHERE e.branch_id = $1 AND s.shift_date BETWEEN $2 AND $3 ${extra} ORDER BY s.shift_date, s.start_time, e.name`,
        params
      )
    );
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
  const s = await db.one('SELECT s.* FROM staff_shifts s JOIN employees e ON e.id = s.employee_id WHERE s.id = $1 AND e.branch_id = $2', [pid(req), req.branchId]);
  if (!s) throw notFound('Shift');
  return s;
}

r.post(
  '/shifts',
  requirePerm('staff.manage'),
  validate(shiftSchema.extend({ repeat_days: z.number().int().min(0).max(30).default(0) })),
  ah(async (req, res) => {
    const b = req.body;
    if (b.end_time <= b.start_time) throw badRequest('Shift end must be after start');
    const emp = await db.one(`SELECT id FROM employees WHERE id = $1 AND branch_id = $2 AND status <> 'terminated'`, [b.employee_id, req.branchId]);
    if (!emp) throw badRequest('Invalid employee');
    const created = [];
    for (let i = 0; i <= b.repeat_days; i++) {
      const d = new Date(`${b.shift_date}T00:00:00Z`);
      d.setUTCDate(d.getUTCDate() + i);
      const row = await db.one(
        `INSERT INTO staff_shifts(employee_id, shift_date, start_time, end_time, notes, attendance_status)
         VALUES ($1,$2,$3,$4,$5,COALESCE($6,'scheduled')) ON CONFLICT (employee_id, shift_date, start_time) DO NOTHING RETURNING *`,
        [b.employee_id, d.toISOString().slice(0, 10), b.start_time, b.end_time, b.notes || null, b.attendance_status || null]
      );
      if (row) created.push(row);
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
    const { sets, values } = buildUpdate(req.body, { startIndex: 2 });
    if (sets.length) await db.query(`UPDATE staff_shifts SET ${sets.join(', ')} WHERE id = $1`, [s.id, ...values]);
    res.json(await db.one('SELECT * FROM staff_shifts WHERE id = $1', [s.id]));
  })
);

r.delete(
  '/shifts/:id(\\d+)',
  requirePerm('staff.manage'),
  ah(async (req, res) => {
    const s = await scopedShift(req);
    await db.query('DELETE FROM staff_shifts WHERE id = $1', [s.id]);
    res.json({ ok: true });
  })
);

r.post(
  '/shifts/:id(\\d+)/check-in',
  requirePerm('staff.manage'),
  ah(async (req, res) => {
    const s = await scopedShift(req);
    const now = new Date();
    const start = new Date(`${s.shift_date}T${s.start_time}`);
    const late = now.getTime() - start.getTime() > 10 * 60000;
    res.json(await db.one(`UPDATE staff_shifts SET check_in_at = now(), attendance_status = $2 WHERE id = $1 RETURNING *`, [s.id, late ? 'late' : 'present']));
  })
);

r.post(
  '/shifts/:id(\\d+)/check-out',
  requirePerm('staff.manage'),
  ah(async (req, res) => {
    const s = await scopedShift(req);
    if (!s.check_in_at) throw badRequest('Check in first');
    res.json(await db.one(`UPDATE staff_shifts SET check_out_at = now() WHERE id = $1 RETURNING *`, [s.id]));
  })
);

r.get(
  '/attendance/summary',
  requirePerm('staff.manage'),
  ah(async (req, res) => {
    const from = req.query.from || localDate(new Date(Date.now() - 29 * 86400000));
    const to = req.query.to || localDate();
    res.json(
      await db.many(
        `SELECT e.id, e.name, e.position,
                COUNT(s.id) AS shifts,
                COUNT(s.id) FILTER (WHERE s.attendance_status = 'present') AS present,
                COUNT(s.id) FILTER (WHERE s.attendance_status = 'late') AS late,
                COUNT(s.id) FILTER (WHERE s.attendance_status = 'absent') AS absent,
                COUNT(s.id) FILTER (WHERE s.attendance_status = 'leave') AS leave,
                ROUND(COALESCE(SUM(EXTRACT(EPOCH FROM (s.check_out_at - s.check_in_at)) / 3600) FILTER (WHERE s.check_out_at IS NOT NULL), 0)::numeric, 1) AS hours
           FROM employees e LEFT JOIN staff_shifts s ON s.employee_id = e.id AND s.shift_date BETWEEN $2 AND $3
          WHERE e.branch_id = $1 AND e.status <> 'terminated' GROUP BY e.id ORDER BY e.name`,
        [req.branchId, from, to]
      )
    );
  })
);

// ================= Roles & permissions =================
r.get(
  '/roles',
  requirePerm('staff.manage', 'roles.manage'),
  ah(async (_req, res) => {
    const roles = await db.many(
      `SELECT r.id, r.name, r.display_name, r.is_staff,
              COALESCE((SELECT array_agg(p.code ORDER BY p.code) FROM role_permissions rp JOIN permissions p ON p.id = rp.permission_id WHERE rp.role_id = r.id), '{}') AS permissions
         FROM roles r WHERE r.is_staff AND r.name <> 'super_admin' ORDER BY r.id`
    );
    const permissions = await db.many('SELECT code, module, description FROM permissions ORDER BY module, code');
    res.json({ roles, permissions });
  })
);

r.put(
  '/roles/:id(\\d+)/permissions',
  requirePerm('roles.manage'),
  validate(z.object({ permissions: z.array(z.string().max(100)).max(100) })),
  ah(async (req, res) => {
    const role = await db.one('SELECT * FROM roles WHERE id = $1', [pid(req)]);
    if (!role || !role.is_staff || role.name === 'super_admin') throw notFound('Role');
    if (req.user.role !== 'super_admin') throw forbidden('Role permissions are shared by all restaurants and can only be changed by a super admin');
    const perms = req.body.permissions.filter((p) => p !== 'roles.manage');
    req.body.permissions = perms;
    await db.tx(async (t) => {
      await t.query('DELETE FROM role_permissions WHERE role_id = $1', [role.id]);
      await t.query(`INSERT INTO role_permissions(role_id, permission_id) SELECT $1, id FROM permissions WHERE code = ANY($2::text[])`, [role.id, req.body.permissions]);
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
    search: ['t.name', 't.contact_person', 't.phone', 't.email'],
    orderBy: 't.name',
    select: `t.*, (SELECT COUNT(*) FROM inventory_items i WHERE i.supplier_id = t.id) AS item_count,
      (SELECT COALESCE(SUM(x.total_cost),0) FROM inventory_transactions x WHERE x.supplier_id = t.id AND x.type = 'stock_in') AS total_purchases`,
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
    const [low, expiring] = await Promise.all([
      db.many(`SELECT * FROM inventory_items WHERE branch_id = $1 AND is_active AND quantity <= min_quantity ORDER BY (quantity / NULLIF(min_quantity,0)) NULLS FIRST`, [req.branchId]),
      db.many(`SELECT i.*, (i.expiry_date - CURRENT_DATE) AS days_left FROM inventory_items i WHERE i.branch_id = $1 AND i.is_active AND i.expiry_date IS NOT NULL AND i.expiry_date <= CURRENT_DATE + $2::int ORDER BY i.expiry_date`, [req.branchId, days]),
    ]);
    res.json({ low, expiring });
  })
);

r.get(
  '/inventory/transactions',
  requirePerm('inventory.manage'),
  ah(async (req, res) => {
    const params = [req.branchId];
    let extra = '';
    if (req.query.itemId) {
      params.push(parseInt(req.query.itemId, 10));
      extra += ` AND t.inventory_item_id = $${params.length}`;
    }
    if (req.query.type) {
      params.push(req.query.type);
      extra += ` AND t.type = $${params.length}`;
    }
    if (req.query.from) {
      params.push(req.query.from);
      extra += ` AND t.created_at::date >= $${params.length}::date`;
    }
    if (req.query.to) {
      params.push(req.query.to);
      extra += ` AND t.created_at::date <= $${params.length}::date`;
    }
    res.json(
      await db.many(
        `SELECT t.*, i.name AS item_name, i.unit, s.name AS supplier_name, u.name AS created_by_name
           FROM inventory_transactions t JOIN inventory_items i ON i.id = t.inventory_item_id
           LEFT JOIN suppliers s ON s.id = t.supplier_id LEFT JOIN users u ON u.id = t.created_by
          WHERE i.branch_id = $1 ${extra} ORDER BY t.created_at DESC LIMIT 500`,
        params
      )
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
    const result = await db.tx(async (t) => {
      const item = await t.one('SELECT * FROM inventory_items WHERE id = $1 AND branch_id = $2 FOR UPDATE', [b.inventory_item_id, req.branchId]);
      if (!item) throw notFound('Inventory item');
      if (b.supplier_id) {
        const s = await t.one('SELECT id FROM suppliers WHERE id = $1 AND restaurant_id = $2', [b.supplier_id, req.restaurantId]);
        if (!s) throw badRequest('Invalid supplier');
      }
      const qty = Number(item.quantity);
      // adjustment = set absolute stock count (physical count)
      const balance = b.type === 'stock_in' ? qty + b.quantity : b.type === 'adjustment' ? b.quantity : qty - b.quantity;
      if (balance < 0) throw badRequest(`Insufficient stock. Available: ${qty} ${item.unit}`);
      const delta = b.type === 'adjustment' ? Math.abs(b.quantity - qty) : b.quantity;
      const unitCost = b.unit_cost ?? Number(item.cost_per_unit);
      const tx = await t.one(
        `INSERT INTO inventory_transactions(inventory_item_id, type, quantity, unit_cost, total_cost, supplier_id, reference, notes, balance_after, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
        [item.id, b.type, delta, unitCost, round2(delta * unitCost), b.supplier_id || null, b.reference || null, b.notes || null, balance, req.user.id]
      );
      await t.query(
        `UPDATE inventory_items SET quantity = $2,
            cost_per_unit = CASE WHEN $3 = 'stock_in' AND $4::numeric IS NOT NULL THEN $4::numeric ELSE cost_per_unit END,
            supplier_id = CASE WHEN $3 = 'stock_in' AND $5::int IS NOT NULL THEN $5::int ELSE supplier_id END,
            expiry_date = CASE WHEN $3 = 'stock_in' AND $6::date IS NOT NULL THEN $6::date ELSE expiry_date END
          WHERE id = $1`,
        [item.id, balance, b.type, b.unit_cost ?? null, b.supplier_id || null, b.expiry_date || null]
      );
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
    search: ['t.name', 't.sku', 't.category'],
    filters: { category: 't.category', supplierId: 't.supplier_id' },
    orderBy: 't.name',
    select: `t.*, t.expiry_date::text AS expiry_date, s.name AS supplier_name,
      CASE WHEN t.quantity <= t.min_quantity THEN 'low' WHEN t.expiry_date IS NOT NULL AND t.expiry_date <= CURRENT_DATE + 7 THEN 'expiring' ELSE 'ok' END AS stock_status`,
    from: 'inventory_items t LEFT JOIN suppliers s ON s.id = t.supplier_id',
    refs: { supplier_id: ['suppliers', 'restaurant'] },
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
