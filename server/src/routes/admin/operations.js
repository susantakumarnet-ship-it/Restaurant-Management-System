import { Router } from 'express';
import { z } from 'zod';
import { db } from '../../db/index.js';
import { ah, badRequest, notFound, validate } from '../../utils/http.js';
import { requirePerm } from '../../middleware/auth.js';
import { assignTables, changeStatus, createReservation, getAvailability, getReservation, modifyReservation, RES_STATUSES } from '../../services/booking.js';
import { changeOrderStatus, createOrder, getOrder, ORDER_STATUSES } from '../../services/orders.js';
import { bookingPdf } from '../../services/pdf.js';
import { notify } from '../../services/notify.js';
import { zs } from './crud.js';
import { localDate } from '../../utils/common.js';

const r = Router();
const pid = (req) => parseInt(req.params.id, 10) || 0;

async function scopedReservation(req) {
  const res = await getReservation(pid(req)).catch(() => null);
  if (!res || res.branch_id !== req.branchId) throw notFound('Reservation');
  return res;
}

// ================= Reservations =================
r.get(
  '/reservations',
  requirePerm('reservations.view', 'reservations.manage'),
  ah(async (req, res) => {
    const q = req.query;
    const params = [req.branchId];
    const where = ['r.branch_id = $1'];
    const add = (sql, v) => {
      params.push(v);
      where.push(sql.replace('?', `$${params.length}`));
    };
    if (q.q) add(`(r.booking_code ILIKE ? OR r.customer_name ILIKE ? OR r.phone ILIKE ? OR r.email ILIKE ?)`.replace(/\?/g, `$${params.length + 1}`), `%${String(q.q).trim()}%`);
    if (q.status && RES_STATUSES.includes(q.status)) add('r.status = ?', q.status);
    if (q.date) add('r.booking_date = ?::date', q.date);
    if (q.from) add('r.booking_date >= ?::date', q.from);
    if (q.to) add('r.booking_date <= ?::date', q.to);
    if (q.time) add(`to_char(r.start_at, 'HH24:MI') = ?`, q.time);
    if (q.tableId) add('EXISTS (SELECT 1 FROM reservation_tables x WHERE x.reservation_id = r.id AND x.table_id = ?::int)', q.tableId);
    if (q.sectionId) add('r.section_id = ?::int', q.sectionId);
    // 'upcoming': future bookings first (soonest at top), then past ones newest-first
    const sort =
      q.sort === 'created'
        ? 'r.created_at DESC'
        : q.sort === 'upcoming'
          ? `(r.end_at < LOCALTIMESTAMP), CASE WHEN r.end_at >= LOCALTIMESTAMP THEN r.start_at END ASC, r.start_at DESC`
          : 'r.start_at DESC';
    res.json(
      await db.many(
        `SELECT r.*, s.name AS section_name,
                COALESCE((SELECT json_agg(json_build_object('id', t.id, 'table_number', t.table_number, 'capacity', t.capacity) ORDER BY t.table_number)
                  FROM reservation_tables rt JOIN tables t ON t.id = rt.table_id WHERE rt.reservation_id = r.id), '[]'::json) AS tables
           FROM reservations r LEFT JOIN table_sections s ON s.id = r.section_id
          WHERE ${where.join(' AND ')} ORDER BY ${sort} LIMIT 500`,
        params
      )
    );
  })
);

/** Month calendar: counts per day & status. */
r.get(
  '/reservations/calendar',
  requirePerm('reservations.view', 'reservations.manage'),
  ah(async (req, res) => {
    const month = /^\d{4}-\d{2}$/.test(req.query.month || '') ? req.query.month : localDate().slice(0, 7);
    const rows = await db.many(
      `SELECT booking_date::text AS date, status, COUNT(*) AS count, SUM(guests) AS guests
         FROM reservations WHERE branch_id = $1 AND to_char(booking_date, 'YYYY-MM') = $2
        GROUP BY booking_date, status ORDER BY booking_date`,
      [req.branchId, month]
    );
    const days = {};
    for (const row of rows) {
      days[row.date] ||= { date: row.date, total: 0, guests: 0, byStatus: {} };
      days[row.date].total += row.count;
      days[row.date].guests += row.guests;
      days[row.date].byStatus[row.status] = row.count;
    }
    res.json({ month, days: Object.values(days) });
  })
);

r.get(
  '/reservations/availability',
  requirePerm('reservations.view', 'reservations.manage'),
  ah(async (req, res) => {
    const { date, guests, sectionId, excludeReservationId } = req.query;
    if (!date || !guests) throw badRequest('date and guests are required');
    res.json(
      await getAvailability({
        branchId: req.branchId,
        date,
        guests: parseInt(guests, 10),
        sectionId: sectionId ? parseInt(sectionId, 10) : null,
        excludeReservationId: parseInt(excludeReservationId, 10) || 0,
        admin: true,
      })
    );
  })
);

r.get(
  '/reservations/:id(\\d+)',
  requirePerm('reservations.view', 'reservations.manage'),
  ah(async (req, res) => {
    const resv = await scopedReservation(req);
    const history = await db.many(
      `SELECT h.*, u.name AS changed_by_name FROM reservation_status_history h LEFT JOIN users u ON u.id = h.changed_by
        WHERE h.reservation_id = $1 ORDER BY h.id`,
      [resv.id]
    );
    const payments = await db.many('SELECT * FROM payments WHERE reservation_id = $1 ORDER BY id', [resv.id]);
    const orders = await db.many('SELECT id, order_code, total, status, payment_status FROM orders WHERE reservation_id = $1', [resv.id]);
    const customer = resv.customer_id
      ? await db.one(
          `SELECT c.loyalty_points, c.total_spent, (SELECT COUNT(*) FROM reservations x WHERE x.customer_id = c.id) AS visits
             FROM customers c WHERE c.id = $1`,
          [resv.customer_id]
        )
      : null;
    res.json({ ...resv, history, payments, orders, customer });
  })
);

r.get(
  '/reservations/:id(\\d+)/confirmation.pdf',
  requirePerm('reservations.view', 'reservations.manage'),
  ah(async (req, res) => bookingPdf(res, await scopedReservation(req)))
);

const adminBooking = z.object({
  customer_name: zs.str(120).min(2, 'Name is required'),
  phone: z.string().trim().regex(/^\+?[0-9]{10,15}$/, 'Enter a valid mobile number'),
  email: zs.optStr(150),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  time: z.string().regex(/^\d{2}:\d{2}$/),
  guests: z.number().int().min(1).max(100),
  section_id: zs.optInt(),
  table_ids: z.array(z.number().int()).max(10).optional(),
  occasion: z.enum(['birthday', 'anniversary', 'business', 'family', 'date', 'other']).nullable().optional().or(z.literal('').transform(() => null)),
  special_requests: zs.optStr(1000),
  admin_notes: zs.optStr(1000),
  source: z.enum(['phone', 'walk_in', 'admin']).default('admin'),
  status: z.enum(['pending', 'confirmed', 'seated']).optional(),
});

r.post(
  '/reservations',
  requirePerm('reservations.manage'),
  validate(adminBooking),
  ah(async (req, res) => {
    const input = { ...req.body };
    // Link to an existing customer account by phone/email when possible.
    const cust = await db.one(
      `SELECT c.id FROM customers c JOIN users u ON u.id = c.user_id WHERE u.phone = $1 OR ($2::text IS NOT NULL AND lower(u.email) = lower($2)) LIMIT 1`,
      [input.phone, input.email || null]
    );
    input.customer_id = cust?.id || null;
    const created = await createReservation({ branchId: req.branchId, input, actor: req.user, admin: true, source: input.source });
    res.locals.createdId = created.id;
    res.status(201).json(created);
  })
);

r.put(
  '/reservations/:id(\\d+)',
  requirePerm('reservations.manage'),
  validate(adminBooking.partial().omit({ source: true, status: true })),
  ah(async (req, res) => {
    await scopedReservation(req);
    res.json(await modifyReservation({ id: pid(req), changes: req.body, actor: req.user, admin: true }));
  })
);

r.patch(
  '/reservations/:id(\\d+)/status',
  requirePerm('reservations.manage'),
  validate(z.object({ status: z.enum(RES_STATUSES), note: zs.optStr(1000) })),
  ah(async (req, res) => {
    await scopedReservation(req);
    res.json(await changeStatus({ id: pid(req), status: req.body.status, actor: req.user, note: req.body.note }));
  })
);

r.put(
  '/reservations/:id(\\d+)/tables',
  requirePerm('reservations.manage'),
  validate(z.object({ table_ids: z.array(z.number().int()).min(1).max(10) })),
  ah(async (req, res) => {
    await scopedReservation(req);
    res.json(await assignTables({ id: pid(req), tableIds: req.body.table_ids, actor: req.user }));
  })
);

r.post(
  '/reservations/:id(\\d+)/notify',
  requirePerm('reservations.manage'),
  validate(z.object({ message: zs.str(1000).optional() })),
  ah(async (req, res) => {
    const resv = await scopedReservation(req);
    const when = `${resv.booking_date} at ${resv.start_at.slice(11, 16)}`;
    await notify({
      userId: resv.user_id,
      branchId: resv.branch_id,
      type: `booking_${resv.status}`,
      title: `Booking ${resv.booking_code} - ${resv.status.replace('_', ' ')}`,
      message: req.body.message || `Your booking for ${resv.guests} on ${when} at ${resv.restaurant_name} is ${resv.status.replace('_', ' ')}. Table(s): ${resv.tables.map((t) => t.table_number).join(', ') || 'TBA'}.`,
      email: resv.email,
      phone: resv.phone,
      link: `/my/bookings/${resv.id}`,
    });
    res.json({ ok: true });
  })
);

// ================= Orders =================
r.get(
  '/orders',
  requirePerm('orders.view', 'orders.manage'),
  ah(async (req, res) => {
    const q = req.query;
    const params = [req.branchId];
    const where = ['o.branch_id = $1'];
    if (q.q) {
      params.push(`%${String(q.q).trim()}%`);
      where.push(`(o.order_code ILIKE $${params.length} OR o.contact_name ILIKE $${params.length} OR o.contact_phone ILIKE $${params.length})`);
    }
    if (q.status === 'active') where.push(`o.status NOT IN ('completed','cancelled')`);
    else if (q.status && ORDER_STATUSES.includes(q.status)) {
      params.push(q.status);
      where.push(`o.status = $${params.length}`);
    }
    if (q.type) {
      params.push(q.type);
      where.push(`o.order_type = $${params.length}`);
    }
    if (q.payment) {
      params.push(q.payment);
      where.push(`o.payment_status = $${params.length}`);
    }
    if (q.date) {
      params.push(q.date);
      where.push(`o.created_at::date = $${params.length}::date`);
    }
    if (q.from) {
      params.push(q.from);
      where.push(`o.created_at::date >= $${params.length}::date`);
    }
    if (q.to) {
      params.push(q.to);
      where.push(`o.created_at::date <= $${params.length}::date`);
    }
    res.json(
      await db.many(
        `SELECT o.*, t.table_number, e.name AS chef_name,
                COALESCE((SELECT json_agg(json_build_object('name', oi.name, 'quantity', oi.quantity, 'notes', oi.notes) ORDER BY oi.id)
                  FROM order_items oi WHERE oi.order_id = o.id), '[]'::json) AS items
           FROM orders o LEFT JOIN tables t ON t.id = o.table_id LEFT JOIN employees e ON e.id = o.assigned_chef_id
          WHERE ${where.join(' AND ')} ORDER BY o.created_at DESC LIMIT 500`,
        params
      )
    );
  })
);

async function scopedOrder(req) {
  const o = await getOrder(pid(req)).catch(() => null);
  if (!o || o.branch_id !== req.branchId) throw notFound('Order');
  return o;
}

r.get(
  '/orders/:id(\\d+)',
  requirePerm('orders.view', 'orders.manage'),
  ah(async (req, res) => {
    const o = await scopedOrder(req);
    const payments = await db.many('SELECT * FROM payments WHERE order_id = $1 ORDER BY id', [o.id]);
    res.json({ ...o, payments });
  })
);

r.post(
  '/orders',
  requirePerm('orders.manage'),
  validate(
    z.object({
      order_type: z.enum(['dine_in', 'takeaway', 'delivery']),
      items: z.array(z.object({ food_item_id: z.number().int(), quantity: z.number().int().min(1).max(100), notes: zs.optStr(200) })).min(1),
      table_id: zs.optInt(),
      reservation_id: zs.optInt(),
      coupon_code: zs.optStr(40),
      contact_name: zs.optStr(120),
      contact_phone: zs.optStr(20),
      delivery_address: zs.optStr(500),
      notes: zs.optStr(500),
    })
  ),
  ah(async (req, res) => {
    const input = { ...req.body };
    if (input.contact_phone) {
      const cust = await db.one('SELECT c.id FROM customers c JOIN users u ON u.id = c.user_id WHERE u.phone = $1', [input.contact_phone]);
      input.customer_id = cust?.id || null;
    }
    if (input.order_type === 'dine_in' && !input.table_id) throw badRequest('Select a table for dine-in orders');
    const o = await createOrder({ branchId: req.branchId, input, actor: req.user, staff: true });
    res.locals.createdId = o.id;
    res.status(201).json(o);
  })
);

r.patch(
  '/orders/:id(\\d+)/status',
  requirePerm('orders.manage'),
  validate(z.object({ status: z.enum(ORDER_STATUSES), reason: zs.optStr(500) })),
  ah(async (req, res) => {
    res.json(await changeOrderStatus({ id: pid(req), status: req.body.status, actor: req.user, branchId: req.branchId, reason: req.body.reason }));
  })
);

r.patch(
  '/orders/:id(\\d+)/assign',
  requirePerm('orders.manage'),
  validate(z.object({ chef_id: zs.optInt() })),
  ah(async (req, res) => {
    const o = await scopedOrder(req);
    if (req.body.chef_id) {
      const chef = await db.one(`SELECT id FROM employees WHERE id = $1 AND branch_id = $2 AND position = 'chef' AND status = 'active'`, [req.body.chef_id, req.branchId]);
      if (!chef) throw badRequest('Select an active chef from this branch');
    }
    await db.query('UPDATE orders SET assigned_chef_id = $2, updated_at = now() WHERE id = $1', [o.id, req.body.chef_id || null]);
    // Assigning to the kitchen moves a confirmed order into preparation.
    if (req.body.chef_id && o.status === 'confirmed') {
      return res.json(await changeOrderStatus({ id: o.id, status: 'preparing', actor: req.user, branchId: req.branchId }));
    }
    res.json(await getOrder(o.id));
  })
);

export default r;
