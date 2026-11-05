import { Router } from 'express';
import { z } from 'zod';
import { db } from '../../db/index.js';
import { ah, notFound, validate } from '../../utils/http.js';
import { requirePerm } from '../../middleware/auth.js';
import { liveTableStatus } from '../../services/booking.js';
import { REPORT_TYPES, runReport, sendReport } from '../../services/reports.js';
import { localDate } from '../../utils/common.js';
import { zs } from './crud.js';

const r = Router();

// ================= Dashboard =================
r.get(
  '/dashboard',
  requirePerm('dashboard.view'),
  ah(async (req, res) => {
    const b = req.branchId;
    const today = localDate();
    const month = today.slice(0, 7);
    const days = Math.min(Math.max(parseInt(req.query.days, 10) || 14, 7), 90);

    const [resv, ord, revenue, customers, popular, dailyRevenue, monthly, resvByDay, resvStatus, orderStatus, orderTypes, categories, recentRes, recentOrders, lowStock, tables] = await Promise.all([
      db.one(
        `SELECT COUNT(*) AS total,
                COUNT(*) FILTER (WHERE booking_date = $2) AS today,
                COUNT(*) FILTER (WHERE status = 'pending' AND booking_date >= $2) AS pending,
                COUNT(*) FILTER (WHERE status = 'confirmed' AND booking_date >= $2) AS confirmed,
                COUNT(*) FILTER (WHERE status = 'cancelled' AND to_char(booking_date,'YYYY-MM') = $3) AS cancelled,
                COALESCE(SUM(guests) FILTER (WHERE booking_date = $2 AND status NOT IN ('cancelled','rejected','no_show')),0) AS guests_today
           FROM reservations WHERE branch_id = $1`,
        [b, today, month]
      ),
      db.one(
        `SELECT COUNT(*) AS total, COUNT(*) FILTER (WHERE created_at::date = $2) AS today,
                COUNT(*) FILTER (WHERE status NOT IN ('completed','cancelled')) AS active
           FROM orders WHERE branch_id = $1`,
        [b, today]
      ),
      db.one(
        `SELECT COALESCE(SUM(amount - refunded_amount) FILTER (WHERE created_at::date = $2),0) AS today,
                COALESCE(SUM(amount - refunded_amount) FILTER (WHERE to_char(created_at,'YYYY-MM') = $3),0) AS month
           FROM payments WHERE branch_id = $1 AND status IN ('success','partially_refunded','refunded')`,
        [b, today, month]
      ),
      db.one(
        `SELECT COUNT(DISTINCT c) AS total FROM (
           SELECT customer_id c FROM reservations WHERE branch_id = $1 AND customer_id IS NOT NULL
           UNION SELECT customer_id FROM orders WHERE branch_id = $1 AND customer_id IS NOT NULL) x`,
        [b]
      ),
      db.many(
        `SELECT oi.food_item_id AS id, oi.name, SUM(oi.quantity) AS quantity, SUM(oi.line_total) AS revenue,
                (SELECT url FROM food_images fi WHERE fi.food_item_id = oi.food_item_id ORDER BY is_primary DESC LIMIT 1) AS image
           FROM order_items oi JOIN orders o ON o.id = oi.order_id
          WHERE o.branch_id = $1 AND o.status <> 'cancelled' AND o.created_at > now() - interval '30 days'
          GROUP BY oi.food_item_id, oi.name ORDER BY quantity DESC LIMIT 6`,
        [b]
      ),
      db.many(
        `SELECT to_char(d, 'YYYY-MM-DD') AS date,
                COALESCE((SELECT SUM(amount - refunded_amount) FROM payments p WHERE p.branch_id = $1 AND p.status IN ('success','partially_refunded','refunded') AND p.created_at::date = d::date),0) AS revenue,
                (SELECT COUNT(*) FROM orders o WHERE o.branch_id = $1 AND o.status <> 'cancelled' AND o.created_at::date = d::date) AS orders
           FROM generate_series(CURRENT_DATE - ($2::int - 1), CURRENT_DATE, interval '1 day') d ORDER BY d`,
        [b, days]
      ),
      db.many(
        `SELECT to_char(m, 'YYYY-MM') AS month,
                COALESCE((SELECT SUM(total) FROM orders o WHERE o.branch_id = $1 AND o.status <> 'cancelled' AND date_trunc('month', o.created_at) = m),0) AS sales,
                (SELECT COUNT(*) FROM orders o WHERE o.branch_id = $1 AND o.status <> 'cancelled' AND date_trunc('month', o.created_at) = m) AS orders,
                (SELECT COUNT(*) FROM reservations r WHERE r.branch_id = $1 AND date_trunc('month', r.booking_date) = m AND r.status NOT IN ('cancelled','rejected')) AS reservations
           FROM generate_series(date_trunc('month', CURRENT_DATE) - interval '11 months', date_trunc('month', CURRENT_DATE), interval '1 month') m ORDER BY m`,
        [b]
      ),
      db.many(
        `SELECT to_char(d, 'YYYY-MM-DD') AS date,
                (SELECT COUNT(*) FROM reservations r WHERE r.branch_id = $1 AND r.booking_date = d::date AND r.status NOT IN ('cancelled','rejected','no_show')) AS bookings,
                (SELECT COUNT(*) FROM reservations r WHERE r.branch_id = $1 AND r.booking_date = d::date AND r.status IN ('cancelled','rejected','no_show')) AS cancelled,
                (SELECT COALESCE(SUM(guests),0) FROM reservations r WHERE r.branch_id = $1 AND r.booking_date = d::date AND r.status NOT IN ('cancelled','rejected','no_show')) AS guests
           FROM generate_series(CURRENT_DATE - ($2::int - 1), CURRENT_DATE + 6, interval '1 day') d ORDER BY d`,
        [b, days]
      ),
      db.many(`SELECT status, COUNT(*) AS count FROM reservations WHERE branch_id = $1 AND booking_date >= CURRENT_DATE - 30 GROUP BY status ORDER BY count DESC`, [b]),
      db.many(`SELECT status, COUNT(*) AS count FROM orders WHERE branch_id = $1 AND created_at > now() - interval '30 days' GROUP BY status ORDER BY count DESC`, [b]),
      db.many(`SELECT order_type, COUNT(*) AS count, COALESCE(SUM(total),0) AS revenue FROM orders WHERE branch_id = $1 AND status <> 'cancelled' AND created_at > now() - interval '30 days' GROUP BY order_type`, [b]),
      db.many(
        `SELECT fc.name AS category, SUM(oi.quantity) AS quantity, SUM(oi.line_total) AS revenue
           FROM order_items oi JOIN orders o ON o.id = oi.order_id JOIN food_items fi ON fi.id = oi.food_item_id JOIN food_categories fc ON fc.id = fi.category_id
          WHERE o.branch_id = $1 AND o.status <> 'cancelled' AND o.created_at > now() - interval '30 days'
          GROUP BY fc.name ORDER BY revenue DESC`,
        [b]
      ),
      db.many(
        `SELECT id, booking_code, customer_name, guests, start_at, status FROM reservations
          WHERE branch_id = $1 AND booking_date = $2 AND status NOT IN ('cancelled','rejected') ORDER BY start_at LIMIT 8`,
        [b, today]
      ),
      db.many(`SELECT id, order_code, order_type, total, status, payment_status, created_at FROM orders WHERE branch_id = $1 ORDER BY created_at DESC LIMIT 8`, [b]),
      db.one(`SELECT COUNT(*) AS n FROM inventory_items WHERE branch_id = $1 AND is_active AND quantity <= min_quantity`, [b]),
      liveTableStatus(b),
    ]);

    const tableCounts = tables.reduce((acc, t) => ({ ...acc, [t.live_status]: (acc[t.live_status] || 0) + 1 }), {});
    res.json({
      cards: {
        total_reservations: resv.total,
        today_reservations: resv.today,
        pending_reservations: resv.pending,
        confirmed_reservations: resv.confirmed,
        cancelled_reservations: resv.cancelled,
        guests_today: resv.guests_today,
        total_orders: ord.total,
        today_orders: ord.today,
        active_orders: ord.active,
        today_revenue: revenue.today,
        monthly_revenue: revenue.month,
        total_customers: customers.total,
        available_tables: tableCounts.available || 0,
        occupied_tables: tableCounts.occupied || 0,
        reserved_tables: tableCounts.reserved || 0,
        maintenance_tables: tableCounts.maintenance || 0,
        total_tables: tables.length,
        low_stock_items: lowStock.n,
      },
      popular_items: popular,
      charts: { daily_revenue: dailyRevenue, monthly_sales: monthly, reservations_by_day: resvByDay, reservation_status: resvStatus, order_status: orderStatus, order_types: orderTypes, category_performance: categories },
      today_reservations: recentRes,
      recent_orders: recentOrders,
    });
  })
);

// ================= Reviews =================
r.get(
  '/reviews',
  requirePerm('reviews.manage'),
  ah(async (req, res) => {
    const params = [req.branchId];
    let extra = '';
    if (req.query.rating) {
      params.push(parseInt(req.query.rating, 10));
      extra += ` AND rv.rating = $${params.length}`;
    }
    if (req.query.type === 'food') extra += ' AND rv.food_item_id IS NOT NULL';
    if (req.query.type === 'restaurant') extra += ' AND rv.food_item_id IS NULL';
    res.json(
      await db.many(
        `SELECT rv.*, u.name AS customer_name, u.email AS customer_email, f.name AS food_name
           FROM reviews rv JOIN users u ON u.id = rv.user_id LEFT JOIN food_items f ON f.id = rv.food_item_id
          WHERE rv.branch_id = $1 ${extra} ORDER BY rv.created_at DESC LIMIT 500`,
        params
      )
    );
  })
);

async function recomputeFoodRating(foodId) {
  if (!foodId) return;
  await db.query(
    `UPDATE food_items SET avg_rating = COALESCE(s.avg, 0), rating_count = s.n FROM
       (SELECT ROUND(AVG(rating)::numeric, 2) AS avg, COUNT(*) AS n FROM reviews WHERE food_item_id = $1 AND is_published) s WHERE id = $1`,
    [foodId]
  );
}

r.patch(
  '/reviews/:id(\\d+)',
  requirePerm('reviews.manage'),
  validate(z.object({ is_published: z.boolean().optional(), admin_reply: zs.optStr(2000) })),
  ah(async (req, res) => {
    const rv = await db.one(
      `UPDATE reviews SET is_published = COALESCE($3, is_published), admin_reply = CASE WHEN $4::boolean THEN $5 ELSE admin_reply END
        WHERE id = $1 AND branch_id = $2 RETURNING *`,
      [parseInt(req.params.id, 10), req.branchId, req.body.is_published ?? null, req.body.admin_reply !== undefined, req.body.admin_reply ?? null]
    );
    if (!rv) throw notFound('Review');
    await recomputeFoodRating(rv.food_item_id);
    res.json(rv);
  })
);

r.delete(
  '/reviews/:id(\\d+)',
  requirePerm('reviews.manage'),
  ah(async (req, res) => {
    const rv = await db.one('DELETE FROM reviews WHERE id = $1 AND branch_id = $2 RETURNING food_item_id', [parseInt(req.params.id, 10), req.branchId]);
    if (!rv) throw notFound('Review');
    await recomputeFoodRating(rv.food_item_id);
    res.json({ ok: true });
  })
);

// ================= Reports =================
r.get('/reports', requirePerm('reports.view'), (_req, res) => res.json(REPORT_TYPES));
r.get(
  '/reports/:type',
  requirePerm('reports.view'),
  ah(async (req, res) => {
    const report = await runReport(req.params.type, { branchIds: [req.branchId], from: req.query.from, to: req.query.to, period: req.query.period, status: req.query.status });
    await sendReport(res, report, req.query.format, `${req.branch.restaurant_name} - ${req.branch.name}`);
  })
);

// ================= Notifications (branch admin feed) =================
r.get(
  '/notifications',
  ah(async (req, res) => {
    const rows = await db.many(
      `SELECT id, type, title, message, link, is_read, created_at FROM notifications
        WHERE branch_id = $1 AND user_id IS NULL AND channel = 'in_app' ORDER BY created_at DESC LIMIT 50`,
      [req.branchId]
    );
    res.json({ items: rows, unread: rows.filter((n) => !n.is_read).length });
  })
);
r.post(
  '/notifications/read-all',
  ah(async (req, res) => {
    await db.query(`UPDATE notifications SET is_read = true WHERE branch_id = $1 AND user_id IS NULL`, [req.branchId]);
    res.json({ ok: true });
  })
);
r.post(
  '/notifications/:id(\\d+)/read',
  ah(async (req, res) => {
    await db.query('UPDATE notifications SET is_read = true WHERE id = $1 AND branch_id = $2 AND user_id IS NULL', [parseInt(req.params.id, 10), req.branchId]);
    res.json({ ok: true });
  })
);

/** Outbound delivery log (email/SMS/WhatsApp) for this branch. */
r.get(
  '/notifications/outbox',
  requirePerm('reservations.manage', 'orders.manage'),
  ah(async (req, res) => {
    res.json(
      await db.many(
        `SELECT id, channel, type, title, recipient, status, error, created_at FROM notifications
          WHERE branch_id = $1 AND channel <> 'in_app' ORDER BY created_at DESC LIMIT 200`,
        [req.branchId]
      )
    );
  })
);

// ================= Audit logs =================
r.get(
  '/audit-logs',
  requirePerm('audit.view'),
  ah(async (req, res) => {
    const params = [req.restaurantId];
    let extra = '';
    if (req.query.q) {
      params.push(`%${req.query.q}%`);
      extra += ` AND (a.action ILIKE $2 OR a.entity ILIKE $2 OR u.name ILIKE $2)`;
    }
    res.json(
      await db.many(
        `SELECT a.*, u.name AS user_name, u.email AS user_email, b.name AS branch_name
           FROM audit_logs a LEFT JOIN users u ON u.id = a.user_id LEFT JOIN restaurant_branches b ON b.id = a.branch_id
          WHERE (b.restaurant_id = $1 OR (a.branch_id IS NULL AND u.restaurant_id = $1)) ${extra}
          ORDER BY a.created_at DESC LIMIT 300`,
        params
      )
    );
  })
);

export default r;
