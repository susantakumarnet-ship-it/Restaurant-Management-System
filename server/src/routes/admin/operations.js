import { Router } from 'express';
import { z } from 'zod';
import { db, escapeRegex } from '../../db/index.js';
import { ah, badRequest, notFound, validate } from '../../utils/http.js';
import { requirePerm } from '../../middleware/auth.js';
import { assignTables, changeStatus, createReservation, getAvailability, getReservation, modifyReservation, RES_STATUSES } from '../../services/booking.js';
import { changeOrderStatus, createOrder, getOrder, ORDER_STATUSES } from '../../services/orders.js';
import { bookingPdf } from '../../services/pdf.js';
import { notify } from '../../services/notify.js';
import { zs } from './crud.js';
import { ilike, localDate, localIso, parseLocal } from '../../utils/common.js';

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
    const and = [{ branch_id: req.branchId }];
    if (q.q) {
      const rx = ilike(q.q);
      and.push({ $or: [{ booking_code: rx }, { customer_name: rx }, { phone: rx }, { email: rx }] });
    }
    if (q.status && RES_STATUSES.includes(q.status)) and.push({ status: q.status });
    if (q.date) and.push({ booking_date: String(q.date) });
    if (q.from) and.push({ booking_date: { $gte: String(q.from) } });
    if (q.to) and.push({ booking_date: { $lte: String(q.to) } });
    if (q.time) and.push({ start_at: { $regex: `^\\d{4}-\\d{2}-\\d{2}T${escapeRegex(q.time)}:` } });
    if (q.tableId) and.push({ id: { $in: await db.distinct('reservation_tables', 'reservation_id', { table_id: toInt(q.tableId) }) } });
    if (q.sectionId) and.push({ section_id: toInt(q.sectionId) });
    // 'upcoming': future bookings first (soonest at top), then past ones newest-first
    const nowTs = localIso();
    const pipeline = [{ $match: and.length > 1 ? { $and: and } : and[0] }];
    if (q.sort === 'created') pipeline.push({ $sort: { created_at: -1 } });
    else if (q.sort === 'upcoming') {
      pipeline.push(
        { $addFields: { _past: { $lt: ['$end_at', nowTs] } } },
        { $addFields: { _upStart: { $cond: ['$_past', null, '$start_at'] } } },
        { $sort: { _past: 1, _upStart: 1, start_at: -1 } }
      );
    } else pipeline.push({ $sort: { start_at: -1 } });
    pipeline.push({ $limit: 500 }, { $project: { _id: 0, _lock: 0, _past: 0, _upStart: 0 } });
    const rows = await db.aggregate('reservations', pipeline);
    res.json(await withSectionAndTables(rows));
  })
);

const toInt = (v) => (/^-?\d+$/.test(String(v).trim()) ? parseInt(v, 10) : NaN);
const collator = new Intl.Collator('en');

/** Adds section_name and tables [{id, table_number, capacity}] (ordered by table_number) to reservations. */
async function withSectionAndTables(rows) {
  if (!rows.length) return rows;
  const ids = rows.map((x) => x.id);
  const [sections, links] = await Promise.all([
    db.mapByIds('table_sections', rows.map((x) => x.section_id), { projection: { name: 1 } }),
    db.find('reservation_tables', { reservation_id: { $in: ids } }, { projection: { reservation_id: 1, table_id: 1 } }),
  ]);
  const tables = await db.mapByIds('tables', links.map((l) => l.table_id), { projection: { table_number: 1, capacity: 1 } });
  const byRes = new Map();
  for (const l of links) {
    const t = tables.get(l.table_id);
    if (!t) continue;
    if (!byRes.has(l.reservation_id)) byRes.set(l.reservation_id, []);
    byRes.get(l.reservation_id).push({ id: t.id, table_number: t.table_number, capacity: t.capacity });
  }
  return rows.map((x) => ({
    ...x,
    section_name: sections.get(x.section_id)?.name ?? null,
    tables: (byRes.get(x.id) || []).sort((a, b) => collator.compare(a.table_number, b.table_number)),
  }));
}

/** Month calendar: counts per day & status. */
r.get(
  '/reservations/calendar',
  requirePerm('reservations.view', 'reservations.manage'),
  ah(async (req, res) => {
    const month = /^\d{4}-\d{2}$/.test(req.query.month || '') ? req.query.month : localDate().slice(0, 7);
    const rows = await db.aggregate('reservations', [
      { $match: { branch_id: req.branchId, booking_date: { $regex: `^${month}-` } } },
      { $group: { _id: { date: '$booking_date', status: '$status' }, count: { $sum: 1 }, guests: { $sum: { $ifNull: ['$guests', 0] } } } },
      { $sort: { '_id.date': 1 } },
      { $project: { _id: 0, date: '$_id.date', status: '$_id.status', count: 1, guests: 1 } },
    ]);
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
    const hist = await db.find('reservation_status_history', { reservation_id: resv.id }, { sort: { id: 1 } });
    const users = await db.mapByIds('users', hist.map((h) => h.changed_by), { projection: { name: 1 } });
    const history = hist.map((h) => ({ ...h, changed_by_name: users.get(h.changed_by)?.name ?? null }));
    const payments = await db.find('payments', { reservation_id: resv.id }, { sort: { id: 1 } });
    const orders = await db.find('orders', { reservation_id: resv.id }, { sort: { id: 1 }, projection: { id: 1, order_code: 1, total: 1, status: 1, payment_status: 1 } });
    let customer = null;
    if (resv.customer_id) {
      const c = await db.byId('customers', resv.customer_id, { projection: { loyalty_points: 1, total_spent: 1 } });
      if (c) customer = { loyalty_points: c.loyalty_points, total_spent: c.total_spent, visits: await db.count('reservations', { customer_id: resv.customer_id }) };
    }
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
    const or = [{ phone: input.phone }];
    if (input.email) or.push({ email: input.email });
    const userIds = (await db.find('users', { $or: or }, { projection: { id: 1 }, collation: { locale: 'en', strength: 2 } })).map((u) => u.id);
    const cust = userIds.length ? await db.findOne('customers', { user_id: { $in: userIds } }, { projection: { id: 1 } }) : null;
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
    const and = [{ branch_id: req.branchId }];
    if (q.q) {
      const rx = ilike(q.q);
      and.push({ $or: [{ order_code: rx }, { contact_name: rx }, { contact_phone: rx }] });
    }
    if (q.status === 'active') and.push({ status: { $nin: ['completed', 'cancelled'] } });
    else if (q.status && ORDER_STATUSES.includes(q.status)) and.push({ status: q.status });
    if (q.type) and.push({ order_type: String(q.type) });
    if (q.payment) and.push({ payment_status: String(q.payment) });
    if (q.date) and.push({ created_at: { $gte: dayStart(q.date), $lt: nextDayStart(q.date) } });
    if (q.from) and.push({ created_at: { $gte: dayStart(q.from) } });
    if (q.to) and.push({ created_at: { $lt: nextDayStart(q.to) } });
    const orders = await db.find('orders', and.length > 1 ? { $and: and } : and[0], { sort: { created_at: -1 }, limit: 500 });
    if (!orders.length) return res.json([]);
    const [tables, chefs, items] = await Promise.all([
      db.mapByIds('tables', orders.map((o) => o.table_id), { projection: { table_number: 1 } }),
      db.mapByIds('employees', orders.map((o) => o.assigned_chef_id), { projection: { name: 1 } }),
      db.find('order_items', { order_id: { $in: orders.map((o) => o.id) } }, { sort: { id: 1 }, projection: { order_id: 1, name: 1, quantity: 1, notes: 1 } }),
    ]);
    const itemsBy = new Map();
    for (const it of items) {
      if (!itemsBy.has(it.order_id)) itemsBy.set(it.order_id, []);
      itemsBy.get(it.order_id).push({ name: it.name, quantity: it.quantity, notes: it.notes ?? null });
    }
    res.json(
      orders.map((o) => ({
        ...o,
        table_number: tables.get(o.table_id)?.table_number ?? null,
        chef_name: chefs.get(o.assigned_chef_id)?.name ?? null,
        items: itemsBy.get(o.id) || [],
      }))
    );
  })
);

/** Local-day bounds for `created_at::date` comparisons (restaurant timezone). */
const dayStart = (s) => parseLocal(String(s).slice(0, 10));
const nextDayStart = (s) => {
  const d = dayStart(s);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1);
};

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
    const payments = await db.find('payments', { order_id: o.id }, { sort: { id: 1 } });
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
      const u = await db.findOne('users', { phone: input.contact_phone }, { projection: { id: 1 } });
      const cust = u ? await db.findOne('customers', { user_id: u.id }, { projection: { id: 1 } }) : null;
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
      const chef = await db.exists('employees', { id: req.body.chef_id, branch_id: req.branchId, position: 'chef', status: 'active' });
      if (!chef) throw badRequest('Select an active chef from this branch');
    }
    await db.update('orders', { id: o.id }, { $set: { assigned_chef_id: req.body.chef_id || null, updated_at: new Date() } });
    // Assigning to the kitchen moves a confirmed order into preparation.
    if (req.body.chef_id && o.status === 'confirmed') {
      return res.json(await changeOrderStatus({ id: o.id, status: 'preparing', actor: req.user, branchId: req.branchId }));
    }
    res.json(await getOrder(o.id));
  })
);

export default r;
