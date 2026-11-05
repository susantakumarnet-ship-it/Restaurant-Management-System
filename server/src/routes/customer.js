import { Router } from 'express';
import { z } from 'zod';
import { db } from '../db/index.js';
import { ah, badRequest, forbidden, notFound, validate } from '../utils/http.js';
import { authenticate } from '../middleware/auth.js';
import { changeStatus, createReservation, getReservation, modifyReservation } from '../services/booking.js';
import { changeOrderStatus, createOrder, getOrder } from '../services/orders.js';
import { completeMockPayment, createOnlinePayment, ensureInvoice, verifyOnlinePayment } from '../services/payments.js';
import { bookingPdf, invoicePdf } from '../services/pdf.js';

const r = Router();
r.use(authenticate);

const dateRe = /^\d{4}-\d{2}-\d{2}$/;
const timeRe = /^\d{2}:\d{2}$/;
const phone = z.string().trim().regex(/^\+?[0-9]{10,15}$/, 'Enter a valid mobile number');
const occasion = z.enum(['birthday', 'anniversary', 'business', 'family', 'date', 'other']).nullable().optional();

export const bookingSchema = z.object({
  branch_id: z.number().int(),
  customer_name: z.string().trim().min(2, 'Name is required').max(120),
  phone,
  email: z.string().trim().email().max(150).optional().nullable().or(z.literal('').transform(() => null)),
  date: z.string().regex(dateRe, 'Select a booking date'),
  time: z.string().regex(timeRe, 'Select a time slot'),
  guests: z.number().int().min(1).max(100),
  section_id: z.number().int().nullable().optional(),
  table_ids: z.array(z.number().int()).max(10).optional(),
  seating_preference: z.string().max(30).nullable().optional(),
  occasion,
  special_requests: z.string().max(1000).nullable().optional(),
  pre_order: z
    .object({ items: z.array(z.object({ food_item_id: z.number().int(), quantity: z.number().int().min(1).max(50) })).min(1), coupon_code: z.string().max(40).optional().nullable() })
    .optional()
    .nullable(),
});

/** Pick columns in order; missing ones become null (like SQL NULL). */
const pick = (o, keys) => Object.fromEntries(keys.map((k) => [k, o?.[k] ?? null]));

const mineOnly = (row, user, what) => {
  if (!row || row.user_id !== user.id) throw notFound(what);
  return row;
};

// ---------------- Bookings ----------------
r.get(
  '/bookings',
  ah(async (req, res) => {
    if (!req.user.customer_id) return res.json([]);
    const rows = await db.find('reservations', { customer_id: req.user.customer_id }, { sort: { start_at: -1 } });
    const branches = await db.mapByIds('restaurant_branches', rows.map((x) => x.branch_id), { projection: { name: 1, restaurant_id: 1 } });
    const rests = await db.mapByIds('restaurants', [...branches.values()].map((x) => x.restaurant_id), { projection: { name: 1 } });
    const links = rows.length ? await db.find('reservation_tables', { reservation_id: { $in: rows.map((x) => x.id) } }, { projection: { reservation_id: 1, table_id: 1 } }) : [];
    const tables = await db.mapByIds('tables', links.map((x) => x.table_id), { projection: { table_number: 1 } });
    const tablesBy = new Map();
    for (const l of links) {
      const t = tables.get(l.table_id);
      if (!t) continue;
      if (!tablesBy.has(l.reservation_id)) tablesBy.set(l.reservation_id, []);
      tablesBy.get(l.reservation_id).push(t.table_number);
    }
    const out = [];
    for (const rv of rows) {
      const b = branches.get(rv.branch_id);
      const rest = b && rests.get(b.restaurant_id);
      if (!b || !rest) continue; // inner JOINs
      out.push({
        ...pick(rv, ['id', 'booking_code', 'booking_date', 'start_at', 'end_at', 'guests', 'status', 'occasion', 'special_requests', 'advance_amount', 'payment_status', 'created_at']),
        branch_name: b.name ?? null,
        restaurant_name: rest.name ?? null,
        tables: (tablesBy.get(rv.id) || []).join(', '),
      });
    }
    res.json(out);
  })
);

r.get(
  '/bookings/:id',
  ah(async (req, res) => {
    const b = mineOnly(await getReservation(parseInt(req.params.id, 10) || 0).catch(() => null), req.user, 'Booking');
    const history = (
      await db.find('reservation_status_history', { reservation_id: b.id }, { sort: { id: 1 }, projection: { from_status: 1, to_status: 1, note: 1, created_at: 1 } })
    ).map((h) => pick(h, ['from_status', 'to_status', 'note', 'created_at']));
    const cfg = await db.findOne('restaurant_settings', { branch_id: b.branch_id }, { projection: { cancellation_deadline_hours: 1 } });
    const orders = (
      await db.find('orders', { reservation_id: b.id }, { sort: { id: 1 }, projection: { id: 1, order_code: 1, total: 1, status: 1 } })
    ).map((o) => pick(o, ['id', 'order_code', 'total', 'status']));
    res.json({ ...b, history, orders, cancellation_deadline_hours: cfg?.cancellation_deadline_hours });
  })
);

r.post(
  '/bookings',
  validate(bookingSchema),
  ah(async (req, res) => {
    const { branch_id, pre_order, ...input } = req.body;
    const booking = await createReservation({ branchId: branch_id, input, actor: req.user });
    let order = null;
    if (pre_order?.items?.length) {
      order = await createOrder({
        branchId: branch_id,
        actor: req.user,
        input: { order_type: 'dine_in', items: pre_order.items, coupon_code: pre_order.coupon_code, reservation_id: booking.id, contact_name: input.customer_name, contact_phone: input.phone, notes: `Pre-order for booking ${booking.booking_code}` },
      }).catch((e) => ({ error: e.message }));
    }
    res.status(201).json({ booking, order });
  })
);

r.put(
  '/bookings/:id',
  validate(bookingSchema.partial().omit({ branch_id: true, pre_order: true })),
  ah(async (req, res) => {
    res.json(await modifyReservation({ id: parseInt(req.params.id, 10) || 0, changes: req.body, actor: req.user }));
  })
);

r.post(
  '/bookings/:id/cancel',
  validate(z.object({ reason: z.string().max(500).optional() })),
  ah(async (req, res) => {
    res.json(await changeStatus({ id: parseInt(req.params.id, 10) || 0, status: 'cancelled', actor: req.user, note: req.body.reason || 'Cancelled by customer', byCustomer: true }));
  })
);

r.get(
  '/bookings/:id/confirmation.pdf',
  ah(async (req, res) => {
    const b = mineOnly(await getReservation(parseInt(req.params.id, 10) || 0).catch(() => null), req.user, 'Booking');
    bookingPdf(res, b);
  })
);

// ---------------- Orders ----------------
const orderSchema = z.object({
  branch_id: z.number().int(),
  order_type: z.enum(['dine_in', 'takeaway', 'delivery']),
  items: z.array(z.object({ food_item_id: z.number().int(), quantity: z.number().int().min(1).max(50), notes: z.string().max(200).optional().nullable() })).min(1).max(100),
  coupon_code: z.string().trim().max(40).optional().nullable(),
  contact_name: z.string().trim().min(2).max(120),
  contact_phone: phone,
  delivery_address: z.string().trim().max(500).optional().nullable(),
  notes: z.string().max(500).optional().nullable(),
  reservation_id: z.number().int().optional().nullable(),
  payment_method: z.enum(['online', 'cash']).default('online'),
});

r.get(
  '/orders',
  ah(async (req, res) => {
    if (!req.user.customer_id) return res.json([]);
    const rows = await db.find('orders', { customer_id: req.user.customer_id }, { sort: { created_at: -1 } });
    const branches = await db.mapByIds('restaurant_branches', rows.map((x) => x.branch_id), { projection: { name: 1 } });
    const items = rows.length
      ? await db.find('order_items', { order_id: { $in: rows.map((x) => x.id) } }, { sort: { id: 1 }, projection: { order_id: 1, name: 1, quantity: 1 } })
      : [];
    const itemsBy = new Map();
    for (const it of items) {
      if (!itemsBy.has(it.order_id)) itemsBy.set(it.order_id, []);
      itemsBy.get(it.order_id).push(it);
    }
    const out = [];
    for (const o of rows) {
      const b = branches.get(o.branch_id);
      if (!b) continue; // inner JOIN
      const its = itemsBy.get(o.id) || [];
      out.push({
        ...pick(o, ['id', 'order_code', 'order_type', 'status', 'payment_status', 'payment_method', 'total', 'created_at']),
        branch_name: b.name ?? null,
        item_count: its.length,
        // string_agg over zero rows is NULL (no COALESCE in the original query)
        summary: its.length ? its.map((it) => `${it.name} x${it.quantity}`).join(', ') : null,
      });
    }
    res.json(out);
  })
);

r.get(
  '/orders/:id',
  ah(async (req, res) => {
    const o = mineOnly(await getOrder(parseInt(req.params.id, 10) || 0).catch(() => null), req.user, 'Order');
    const PAY_COLS = ['payment_code', 'amount', 'method', 'status', 'refunded_amount', 'paid_at', 'created_at'];
    const payments = (await db.find('payments', { order_id: o.id }, { sort: { id: 1 } })).map((p) => pick(p, PAY_COLS));
    const reviewed = await db.find('reviews', { order_id: o.id, user_id: req.user.id }, { projection: { food_item_id: 1 } });
    res.json({ ...o, payments, reviewed_items: reviewed.map((x) => x.food_item_id ?? null) });
  })
);

r.post(
  '/orders',
  validate(orderSchema),
  ah(async (req, res) => {
    const { branch_id, ...input } = req.body;
    res.status(201).json(await createOrder({ branchId: branch_id, input, actor: req.user }));
  })
);

r.post(
  '/orders/:id/cancel',
  validate(z.object({ reason: z.string().max(500).optional() })),
  ah(async (req, res) => {
    res.json(await changeOrderStatus({ id: parseInt(req.params.id, 10) || 0, status: 'cancelled', actor: req.user, reason: req.body.reason || 'Cancelled by customer', byCustomer: true }));
  })
);

r.get(
  '/orders/:id/invoice.pdf',
  ah(async (req, res) => {
    const o = mineOnly(await getOrder(parseInt(req.params.id, 10) || 0).catch(() => null), req.user, 'Order');
    if (o.status === 'cancelled') throw badRequest('Cancelled orders have no invoice');
    const invoice = await ensureInvoice(db, o.id);
    invoicePdf(res, { invoice, order: o, restaurant: { name: o.restaurant_name, branch_name: o.branch_name, address: o.branch_address, gstin: o.gstin } });
  })
);

// ---------------- Payments ----------------
r.post(
  '/payments/create',
  validate(z.object({ order_id: z.number().int().optional(), reservation_id: z.number().int().optional() }).refine((v) => v.order_id || v.reservation_id, 'order_id or reservation_id required')),
  ah(async (req, res) => {
    res.json(await createOnlinePayment({ orderId: req.body.order_id, reservationId: req.body.reservation_id, user: req.user }));
  })
);

r.post(
  '/payments/verify',
  validate(z.object({ payment_id: z.number().int(), razorpay_order_id: z.string(), razorpay_payment_id: z.string(), razorpay_signature: z.string() })),
  ah(async (req, res) => {
    const b = req.body;
    res.json(await verifyOnlinePayment({ paymentId: b.payment_id, razorpay_order_id: b.razorpay_order_id, razorpay_payment_id: b.razorpay_payment_id, razorpay_signature: b.razorpay_signature, user: req.user }));
  })
);

r.post(
  '/payments/mock-complete',
  validate(z.object({ payment_id: z.number().int(), success: z.boolean() })),
  ah(async (req, res) => {
    res.json(await completeMockPayment({ paymentId: req.body.payment_id, success: req.body.success, user: req.user }));
  })
);

r.get(
  '/payments',
  ah(async (req, res) => {
    const rows = await db.find('payments', { user_id: req.user.id }, { sort: { created_at: -1 } });
    const orders = await db.mapByIds('orders', rows.map((p) => p.order_id), { projection: { order_code: 1 } });
    const resv = await db.mapByIds('reservations', rows.map((p) => p.reservation_id), { projection: { booking_code: 1 } });
    res.json(
      rows.map((p) => ({
        ...pick(p, ['id', 'payment_code', 'amount', 'method', 'status', 'purpose', 'refunded_amount', 'created_at']),
        reference: orders.get(p.order_id)?.order_code ?? resv.get(p.reservation_id)?.booking_code ?? null,
      }))
    );
  })
);

// ---------------- Reviews ----------------
r.get(
  '/reviews',
  ah(async (req, res) => {
    const rows = await db.find('reviews', { user_id: req.user.id }, { sort: { created_at: -1 } });
    const foods = await db.mapByIds('food_items', rows.map((x) => x.food_item_id), { projection: { name: 1 } });
    const branches = await db.mapByIds('restaurant_branches', rows.map((x) => x.branch_id), { projection: { name: 1 } });
    res.json(
      rows
        .filter((rv) => branches.has(rv.branch_id)) // inner JOIN restaurant_branches
        .map((rv) => ({ ...rv, food_name: foods.get(rv.food_item_id)?.name ?? null, branch_name: branches.get(rv.branch_id).name ?? null }))
    );
  })
);

r.post(
  '/reviews',
  validate(
    z.object({
      branch_id: z.number().int(),
      food_item_id: z.number().int().optional().nullable(),
      order_id: z.number().int().optional().nullable(),
      rating: z.number().int().min(1).max(5),
      comment: z.string().trim().max(2000).optional().nullable(),
      images: z.array(z.string().max(500)).max(5).default([]),
    })
  ),
  ah(async (req, res) => {
    const b = req.body;
    if (!req.user.customer_id) throw forbidden('Only customer accounts can post reviews');
    const branch = await db.findOne('restaurant_branches', { id: b.branch_id }, { projection: { restaurant_id: 1 } });
    if (!branch) throw notFound('Restaurant');
    if (b.food_item_id) {
      const f = await db.exists('food_items', { id: b.food_item_id, restaurant_id: branch.restaurant_id });
      if (!f) throw badRequest('Invalid food item');
    }
    if (b.order_id) {
      const o = await db.exists('orders', { id: b.order_id, customer_id: req.user.customer_id });
      if (!o) throw badRequest('Invalid order');
      // food_item_id IS NOT DISTINCT FROM $3 (null matches null/missing)
      const dup = await db.exists('reviews', { order_id: b.order_id, user_id: req.user.id, food_item_id: b.food_item_id || null });
      if (dup) throw badRequest('You have already reviewed this');
    }
    const review = await db.tx(async () => {
      const rv = await db.insert('reviews', {
        user_id: req.user.id,
        branch_id: b.branch_id,
        food_item_id: b.food_item_id || null,
        order_id: b.order_id || null,
        rating: b.rating,
        comment: b.comment || null,
        images: b.images,
      });
      if (b.food_item_id) {
        const [s] = await db.aggregate('reviews', [
          { $match: { food_item_id: b.food_item_id, is_published: true } },
          { $group: { _id: null, avg: { $avg: '$rating' }, n: { $sum: 1 } } },
        ]);
        await db.update('food_items', { id: b.food_item_id }, {
          $set: {
            avg_rating: s && s.avg != null ? Math.round((s.avg + Number.EPSILON) * 100) / 100 : null,
            rating_count: s ? s.n : 0,
          },
        });
      }
      return rv;
    });
    res.status(201).json(review);
  })
);

// ---------------- Notifications ----------------
r.get(
  '/notifications',
  ah(async (req, res) => {
    const rows = (
      await db.find('notifications', { user_id: req.user.id, channel: 'in_app' }, { sort: { created_at: -1 }, limit: 50 })
    ).map((n) => pick(n, ['id', 'type', 'title', 'message', 'link', 'is_read', 'created_at']));
    res.json({ items: rows, unread: rows.filter((n) => !n.is_read).length });
  })
);
r.post(
  '/notifications/read-all',
  ah(async (req, res) => {
    await db.updateMany('notifications', { user_id: req.user.id, channel: 'in_app' }, { $set: { is_read: true } });
    res.json({ ok: true });
  })
);
r.post(
  '/notifications/:id/read',
  ah(async (req, res) => {
    await db.update('notifications', { id: parseInt(req.params.id, 10) || 0, user_id: req.user.id }, { $set: { is_read: true } });
    res.json({ ok: true });
  })
);

export default r;
