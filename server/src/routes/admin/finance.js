import { Router } from 'express';
import { z } from 'zod';
import { db } from '../../db/index.js';
import { ah, badRequest, notFound, validate } from '../../utils/http.js';
import { requirePerm } from '../../middleware/auth.js';
import { ensureInvoice, recordManualPayment, refundPayment } from '../../services/payments.js';
import { getOrder } from '../../services/orders.js';
import { invoicePdf } from '../../services/pdf.js';
import { crud, zs } from './crud.js';
import { localDate } from '../../utils/common.js';

const r = Router();

// ================= Payments =================
r.get(
  '/payments',
  requirePerm('payments.manage'),
  ah(async (req, res) => {
    const q = req.query;
    const params = [req.branchId];
    const where = ['p.branch_id = $1'];
    const add = (sql, v) => {
      params.push(v);
      where.push(sql.replace('?', `$${params.length}`));
    };
    if (q.status) add('p.status = ?', q.status);
    if (q.method) add('p.method = ?', q.method);
    if (q.purpose) add('p.purpose = ?', q.purpose);
    if (q.from) add('p.created_at::date >= ?::date', q.from);
    if (q.to) add('p.created_at::date <= ?::date', q.to);
    if (q.q) {
      params.push(`%${String(q.q).trim()}%`);
      const i = params.length;
      where.push(`(p.payment_code ILIKE $${i} OR o.order_code ILIKE $${i} OR rs.booking_code ILIKE $${i} OR p.gateway_payment_id ILIKE $${i})`);
    }
    const rows = await db.many(
      `SELECT p.*, o.order_code, rs.booking_code, COALESCE(o.contact_name, rs.customer_name) AS customer_name, u.name AS recorded_by_name
         FROM payments p LEFT JOIN orders o ON o.id = p.order_id LEFT JOIN reservations rs ON rs.id = p.reservation_id
         LEFT JOIN users u ON u.id = p.recorded_by
        WHERE ${where.join(' AND ')} ORDER BY p.created_at DESC LIMIT 500`,
      params
    );
    res.json(rows);
  })
);

r.get(
  '/payments/summary',
  requirePerm('payments.manage'),
  ah(async (req, res) => {
    const from = req.query.from || localDate().slice(0, 8) + '01';
    const to = req.query.to || localDate();
    res.json(
      await db.one(
        `SELECT COALESCE(SUM(amount) FILTER (WHERE status IN ('success','partially_refunded','refunded')),0) AS received,
                COALESCE(SUM(refunded_amount),0) AS refunded,
                COALESCE(SUM(amount) FILTER (WHERE status IN ('success','partially_refunded','refunded') AND method = 'cash'),0) AS cash,
                COALESCE(SUM(amount) FILTER (WHERE status IN ('success','partially_refunded','refunded') AND method = 'upi'),0) AS upi,
                COALESCE(SUM(amount) FILTER (WHERE status IN ('success','partially_refunded','refunded') AND method = 'card'),0) AS card,
                COALESCE(SUM(amount) FILTER (WHERE status IN ('success','partially_refunded','refunded') AND method = 'online'),0) AS online,
                COUNT(*) FILTER (WHERE status = 'failed') AS failed,
                COUNT(*) FILTER (WHERE status = 'pending') AS pending
           FROM payments WHERE branch_id = $1 AND created_at::date BETWEEN $2 AND $3`,
        [req.branchId, from, to]
      )
    );
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
    const params = [req.branchId];
    let extra = '';
    if (req.query.q) {
      params.push(`%${req.query.q}%`);
      extra += ` AND (i.invoice_number ILIKE $2 OR o.order_code ILIKE $2 OR i.customer_name ILIKE $2)`;
    }
    if (req.query.from) {
      params.push(req.query.from);
      extra += ` AND i.issued_at::date >= $${params.length}::date`;
    }
    if (req.query.to) {
      params.push(req.query.to);
      extra += ` AND i.issued_at::date <= $${params.length}::date`;
    }
    res.json(
      await db.many(
        `SELECT i.*, o.order_code, o.payment_status FROM invoices i LEFT JOIN orders o ON o.id = i.order_id
          WHERE i.branch_id = $1 ${extra} ORDER BY i.issued_at DESC LIMIT 500`,
        params
      )
    );
  })
);

r.post(
  '/orders/:id(\\d+)/invoice',
  requirePerm('payments.manage', 'orders.manage'),
  ah(async (req, res) => {
    const o = await db.one('SELECT id FROM orders WHERE id = $1 AND branch_id = $2', [parseInt(req.params.id, 10), req.branchId]);
    if (!o) throw notFound('Order');
    res.json(await ensureInvoice(db, o.id));
  })
);

r.get(
  '/invoices/:id(\\d+)/pdf',
  requirePerm('payments.manage', 'orders.manage'),
  ah(async (req, res) => {
    const invoice = await db.one('SELECT * FROM invoices WHERE id = $1 AND branch_id = $2', [parseInt(req.params.id, 10), req.branchId]);
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
    search: ['t.code', 't.title'],
    orderBy: 't.is_active DESC, t.created_at DESC',
    select: `t.*, t.valid_from::text AS valid_from, t.valid_to::text AS valid_to,
      (SELECT COALESCE(SUM(o.discount),0) FROM orders o WHERE o.coupon_id = t.id AND o.status <> 'cancelled') AS total_discount_given`,
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
