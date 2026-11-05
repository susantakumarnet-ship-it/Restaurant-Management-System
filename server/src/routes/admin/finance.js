import { Router } from 'express';
import { z } from 'zod';
import { db, escapeRegex } from '../../db/index.js';
import { ah, badRequest, notFound, validate } from '../../utils/http.js';
import { requirePerm } from '../../middleware/auth.js';
import { ensureInvoice, recordManualPayment, refundPayment } from '../../services/payments.js';
import { getOrder } from '../../services/orders.js';
import { invoicePdf } from '../../services/pdf.js';
import { crud, zs } from './crud.js';
import { ilike, localDate, parseLocal, round2 } from '../../utils/common.js';

const r = Router();

/** Local-day bounds for `<ts>::date >= from` / `<ts>::date <= to` (restaurant timezone). */
const dayStart = (s) => parseLocal(String(s).slice(0, 10));
const nextDayStart = (s) => {
  const d = dayStart(s);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1);
};
function dateRange(from, to) {
  const c = {};
  if (from) c.$gte = dayStart(from);
  if (to) c.$lt = nextDayStart(to);
  return c;
}

// ================= Payments =================
r.get(
  '/payments',
  requirePerm('payments.manage'),
  ah(async (req, res) => {
    const q = req.query;
    const filter = { branch_id: req.branchId };
    if (q.status) filter.status = String(q.status);
    if (q.method) filter.method = String(q.method);
    if (q.purpose) filter.purpose = String(q.purpose);
    if (q.from || q.to) filter.created_at = dateRange(q.from, q.to);
    if (q.q) {
      const rx = ilike(q.q);
      const [orderIds, resIds] = await Promise.all([
        db.distinct('orders', 'id', { branch_id: req.branchId, order_code: rx }),
        db.distinct('reservations', 'id', { branch_id: req.branchId, booking_code: rx }),
      ]);
      filter.$or = [{ payment_code: rx }, { gateway_payment_id: rx }, { order_id: { $in: orderIds } }, { reservation_id: { $in: resIds } }];
    }
    const rows = await db.find('payments', filter, { sort: { created_at: -1 }, limit: 500 });
    const [orders, resvs, users] = await Promise.all([
      db.mapByIds('orders', rows.map((p) => p.order_id), { projection: { order_code: 1, contact_name: 1 } }),
      db.mapByIds('reservations', rows.map((p) => p.reservation_id), { projection: { booking_code: 1, customer_name: 1 } }),
      db.mapByIds('users', rows.map((p) => p.recorded_by), { projection: { name: 1 } }),
    ]);
    res.json(
      rows.map((p) => {
        const o = orders.get(p.order_id);
        const rs = resvs.get(p.reservation_id);
        return {
          ...p,
          order_code: o ? o.order_code : null,
          booking_code: rs ? rs.booking_code : null,
          customer_name: (o && o.contact_name != null ? o.contact_name : rs ? rs.customer_name : null) ?? null,
          recorded_by_name: users.get(p.recorded_by)?.name ?? null,
        };
      })
    );
  })
);

const PAID = ['success', 'partially_refunded', 'refunded'];

r.get(
  '/payments/summary',
  requirePerm('payments.manage'),
  ah(async (req, res) => {
    const from = req.query.from || localDate().slice(0, 8) + '01';
    const to = req.query.to || localDate();
    const paidSum = (extra) => ({ $sum: { $cond: [{ $and: [{ $in: ['$status', PAID] }, ...(extra ? [extra] : [])] }, '$amount', 0] } });
    const [g] = await db.aggregate('payments', [
      { $match: { branch_id: req.branchId, created_at: dateRange(from, to) } },
      {
        $group: {
          _id: null,
          received: paidSum(),
          refunded: { $sum: { $ifNull: ['$refunded_amount', 0] } },
          cash: paidSum({ $eq: ['$method', 'cash'] }),
          upi: paidSum({ $eq: ['$method', 'upi'] }),
          card: paidSum({ $eq: ['$method', 'card'] }),
          online: paidSum({ $eq: ['$method', 'online'] }),
          failed: { $sum: { $cond: [{ $eq: ['$status', 'failed'] }, 1, 0] } },
          pending: { $sum: { $cond: [{ $eq: ['$status', 'pending'] }, 1, 0] } },
        },
      },
    ]);
    const s = g || {};
    res.json({
      received: round2(s.received || 0),
      refunded: round2(s.refunded || 0),
      cash: round2(s.cash || 0),
      upi: round2(s.upi || 0),
      card: round2(s.card || 0),
      online: round2(s.online || 0),
      failed: s.failed || 0,
      pending: s.pending || 0,
    });
  })
);

r.post(
  '/payments',
  requirePerm('payments.manage'),
  validate(
    z
      .object({
        order_id: zs.optInt(),
        reservation_id: zs.optInt(),
        amount: zs.optNum(),
        method: z.enum(['cash', 'upi', 'card']),
        notes: zs.optStr(500),
      })
      .refine((v) => v.order_id || v.reservation_id, 'Select an order or booking')
  ),
  ah(async (req, res) => {
    const p = await recordManualPayment({ branchId: req.branchId, orderId: req.body.order_id, reservationId: req.body.reservation_id, amount: req.body.amount ?? undefined, method: req.body.method, notes: req.body.notes, actor: req.user });
    res.locals.createdId = p.id;
    res.status(201).json(p);
  })
);

r.post(
  '/payments/:id(\\d+)/refund',
  requirePerm('payments.manage'),
  validate(z.object({ amount: zs.optNum(), reason: zs.str(500).min(3, 'Please give a reason') })),
  ah(async (req, res) => {
    res.json(await refundPayment({ paymentId: parseInt(req.params.id, 10), amount: req.body.amount ?? undefined, reason: req.body.reason, actor: req.user, branchId: req.branchId }));
  })
);

// ================= Invoices =================
r.get(
  '/invoices',
  requirePerm('payments.manage'),
  ah(async (req, res) => {
    const filter = { branch_id: req.branchId };
    if (req.query.q) {
      const rx = { $regex: escapeRegex(req.query.q), $options: 'i' };
      const orderIds = await db.distinct('orders', 'id', { branch_id: req.branchId, order_code: rx });
      filter.$or = [{ invoice_number: rx }, { customer_name: rx }, { order_id: { $in: orderIds } }];
    }
    if (req.query.from || req.query.to) filter.issued_at = dateRange(req.query.from, req.query.to);
    const rows = await db.find('invoices', filter, { sort: { issued_at: -1 }, limit: 500 });
    const orders = await db.mapByIds('orders', rows.map((i) => i.order_id), { projection: { order_code: 1, payment_status: 1 } });
    res.json(
      rows.map((i) => {
        const o = orders.get(i.order_id);
        return { ...i, order_code: o ? o.order_code : null, payment_status: o ? o.payment_status : null };
      })
    );
  })
);

r.post(
  '/orders/:id(\\d+)/invoice',
  requirePerm('payments.manage', 'orders.manage'),
  ah(async (req, res) => {
    const o = await db.findOne('orders', { id: parseInt(req.params.id, 10), branch_id: req.branchId }, { projection: { id: 1 } });
    if (!o) throw notFound('Order');
    res.json(await ensureInvoice(db, o.id));
  })
);

r.get(
  '/invoices/:id(\\d+)/pdf',
  requirePerm('payments.manage', 'orders.manage'),
  ah(async (req, res) => {
    const invoice = await db.findOne('invoices', { id: parseInt(req.params.id, 10), branch_id: req.branchId });
    if (!invoice) throw notFound('Invoice');
    if (!invoice.order_id) throw badRequest('Invoice has no order');
    const o = await getOrder(invoice.order_id);
    invoicePdf(res, { invoice, order: o, restaurant: { name: o.restaurant_name, branch_name: o.branch_name, address: o.branch_address, gstin: o.gstin } });
  })
);

// ================= Coupons =================
r.use(
  '/coupons',
  crud({
    table: 'coupons',
    scope: 'restaurant',
    perm: 'coupons.manage',
    search: ['code', 'title'],
    sort: { is_active: -1, created_at: -1 },
    async enrich(rows) {
      const ids = rows.map((c) => c.id);
      const sums = await db.aggregate('orders', [
        { $match: { coupon_id: { $in: ids }, status: { $ne: 'cancelled' } } },
        { $group: { _id: '$coupon_id', n: { $sum: { $ifNull: ['$discount', 0] } } } },
      ]);
      const m = new Map(sums.map((x) => [x._id, x.n]));
      return rows.map((c) => ({ ...c, total_discount_given: round2(m.get(c.id) || 0) }));
    },
    refine: (v, ctx) => {
      if (v.discount_type === 'percent' && v.discount_value > 100) ctx.addIssue({ code: 'custom', path: ['discount_value'], message: 'Percentage cannot exceed 100' });
      if (v.valid_from && v.valid_to && v.valid_from > v.valid_to) ctx.addIssue({ code: 'custom', path: ['valid_to'], message: 'End date must be after start date' });
    },
    schema: z
      .object({
        code: z.string().trim().toUpperCase().min(3).max(40).regex(/^[A-Z0-9_-]+$/, 'Use letters, numbers, - or _'),
        title: zs.str(150).min(2),
        description: zs.optStr(1000),
        discount_type: z.enum(['percent', 'flat']),
        discount_value: z.number().positive(),
        min_order_amount: z.number().min(0).default(0),
        max_discount: zs.optNum(),
        valid_from: zs.optDate(),
        valid_to: zs.optDate(),
        usage_limit: zs.optInt(),
        per_user_limit: zs.optInt(),
        is_public: z.boolean().default(true),
        is_active: z.boolean().default(true),
        image_url: zs.optStr(),
      }),
  })
);

export default r;
