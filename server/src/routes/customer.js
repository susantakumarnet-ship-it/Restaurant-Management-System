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

const mineOnly = (row, user, what) => {
  if (!row || row.user_id !== user.id) throw notFound(what);
  return row;
};

// ---------------- Bookings ----------------
r.get(
  '/bookings',
  ah(async (req, res) => {
    if (!req.user.customer_id) return res.json([]);
    res.json(
      await db.many(
        `SELECT r.id, r.booking_code, r.booking_date, r.start_at, r.end_at, r.guests, r.status, r.occasion, r.special_requests,
                r.advance_amount, r.payment_status, r.created_at, b.name AS branch_name, rest.name AS restaurant_name,
                COALESCE((SELECT string_agg(t.table_number, ', ') FROM reservation_tables rt JOIN tables t ON t.id = rt.table_id WHERE rt.reservation_id = r.id), '') AS tables
           FROM reservations r JOIN restaurant_branches b ON b.id = r.branch_id JOIN restaurants rest ON rest.id = b.restaurant_id
          WHERE r.customer_id = $1 ORDER BY r.start_at DESC`,
        [req.user.customer_id]
      )
    );
  })
);

r.get(
  '/bookings/:id',
  ah(async (req, res) => {
    const b = mineOnly(await getReservation(parseInt(req.params.id, 10) || 0).catch(() => null), req.user, 'Booking');
    const history = await db.many('SELECT from_status, to_status, note, created_at FROM reservation_status_history WHERE reservation_id = $1 ORDER BY id', [b.id]);
    const cfg = await db.one('SELECT cancellation_deadline_hours FROM restaurant_settings WHERE branch_id = $1', [b.branch_id]);
    const orders = await db.many('SELECT id, order_code, total, status FROM orders WHERE reservation_id = $1', [b.id]);
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
    res.json(
      await db.many(
        `SELECT o.id, o.order_code, o.order_type, o.status, o.payment_status, o.payment_method, o.total, o.created_at,
                b.name AS branch_name, (SELECT COUNT(*) FROM order_items oi WHERE oi.order_id = o.id) AS item_count,
                (SELECT string_agg(oi.name || ' x' || oi.quantity, ', ') FROM order_items oi WHERE oi.order_id = o.id) AS summary
           FROM orders o JOIN restaurant_branches b ON b.id = o.branch_id
          WHERE o.customer_id = $1 ORDER BY o.created_at DESC`,
        [req.user.customer_id]
      )
    );
  })
);

r.get(
  '/orders/:id',
  ah(async (req, res) => {
    const o = mineOnly(await getOrder(parseInt(req.params.id, 10) || 0).catch(() => null), req.user, 'Order');
    const payments = await db.many(
      `SELECT payment_code, amount, method, status, refunded_amount, paid_at, created_at FROM payments WHERE order_id = $1 ORDER BY id`,
      [o.id]
    );
    const reviewed = await db.many('SELECT food_item_id FROM reviews WHERE order_id = $1 AND user_id = $2', [o.id, req.user.id]);
    res.json({ ...o, payments, reviewed_items: reviewed.map((x) => x.food_item_id) });
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
    res.json(
      await db.many(
        `SELECT p.id, p.payment_code, p.amount, p.method, p.status, p.purpose, p.refunded_amount, p.created_at,
                COALESCE(o.order_code, rs.booking_code) AS reference
           FROM payments p LEFT JOIN orders o ON o.id = p.order_id LEFT JOIN reservations rs ON rs.id = p.reservation_id
          WHERE p.user_id = $1 ORDER BY p.created_at DESC`,
        [req.user.id]
      )
    );
  })
);

// ---------------- Reviews ----------------
r.get(
  '/reviews',
  ah(async (req, res) => {
    res.json(
      await db.many(
        `SELECT rv.*, f.name AS food_name, b.name AS branch_name FROM reviews rv
           LEFT JOIN food_items f ON f.id = rv.food_item_id JOIN restaurant_branches b ON b.id = rv.branch_id
          WHERE rv.user_id = $1 ORDER BY rv.created_at DESC`,
        [req.user.id]
      )
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
    const branch = await db.one('SELECT restaurant_id FROM restaurant_branches WHERE id = $1', [b.branch_id]);
    if (!branch) throw notFound('Restaurant');
    if (b.food_item_id) {
      const f = await db.one('SELECT id FROM food_items WHERE id = $1 AND restaurant_id = $2', [b.food_item_id, branch.restaurant_id]);
      if (!f) throw badRequest('Invalid food item');
    }
    if (b.order_id) {
      const o = await db.one('SELECT id FROM orders WHERE id = $1 AND customer_id = $2', [b.order_id, req.user.customer_id]);
      if (!o) throw badRequest('Invalid order');
      const dup = await db.one('SELECT id FROM reviews WHERE order_id = $1 AND user_id = $2 AND food_item_id IS NOT DISTINCT FROM $3', [b.order_id, req.user.id, b.food_item_id || null]);
      if (dup) throw badRequest('You have already reviewed this');
    }
    const review = await db.tx(async (t) => {
      const rv = await t.one(
        `INSERT INTO reviews(user_id, branch_id, food_item_id, order_id, rating, comment, images) VALUES ($1,$2,$3,$4,$5,$6,$7::text::jsonb) RETURNING *`,
        [req.user.id, b.branch_id, b.food_item_id || null, b.order_id || null, b.rating, b.comment || null, JSON.stringify(b.images)]
      );
      if (b.food_item_id) {
        await t.query(
          `UPDATE food_items SET avg_rating = s.avg, rating_count = s.n FROM
             (SELECT ROUND(AVG(rating)::numeric, 2) AS avg, COUNT(*) AS n FROM reviews WHERE food_item_id = $1 AND is_published) s
           WHERE id = $1`,
          [b.food_item_id]
        );
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
    const rows = await db.many(
      `SELECT id, type, title, message, link, is_read, created_at FROM notifications
        WHERE user_id = $1 AND channel = 'in_app' ORDER BY created_at DESC LIMIT 50`,
      [req.user.id]
    );
    res.json({ items: rows, unread: rows.filter((n) => !n.is_read).length });
  })
);
r.post(
  '/notifications/read-all',
  ah(async (req, res) => {
    await db.query(`UPDATE notifications SET is_read = true WHERE user_id = $1 AND channel = 'in_app'`, [req.user.id]);
    res.json({ ok: true });
  })
);
r.post(
  '/notifications/:id/read',
  ah(async (req, res) => {
    await db.query('UPDATE notifications SET is_read = true WHERE id = $1 AND user_id = $2', [parseInt(req.params.id, 10) || 0, req.user.id]);
    res.json({ ok: true });
  })
);

export default r;
