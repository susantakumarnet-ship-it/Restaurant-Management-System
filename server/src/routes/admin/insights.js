import { Router } from 'express';
import { z } from 'zod';
import { db, TIMEZONE } from '../../db/index.js';
import { ah, notFound, validate } from '../../utils/http.js';
import { requirePerm } from '../../middleware/auth.js';
import { liveTableStatus } from '../../services/booking.js';
import { REPORT_TYPES, runReport, sendReport } from '../../services/reports.js';
import { ilike, localDate, parseLocal, round2 } from '../../utils/common.js';
import { zs } from './crud.js';

const r = Router();

// ---- local date helpers ----
/** 'YYYY-MM-DD' + n days (calendar arithmetic). */
const addDays = (s, n) => {
  const d = new Date(`${s}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
/** 'YYYY-MM' + n months. */
const addMonths = (ym, n) => {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return d.toISOString().slice(0, 7);
};
const daysBetween = (from, to) => {
  const out = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
};
const localDay = (field) => ({ $dateToString: { format: '%Y-%m-%d', date: field, timezone: TIMEZONE } });
const localMonth = (field) => ({ $dateToString: { format: '%Y-%m', date: field, timezone: TIMEZONE } });
const PAID = ['success', 'partially_refunded', 'refunded'];
const netAmount = { $subtract: ['$amount', '$refunded_amount'] };
const sumIf = (cond, value = 1) => ({ $sum: { $cond: [cond, value, 0] } });
const byKey = (rows) => new Map(rows.map((x) => [x._id, x]));

// ================= Dashboard =================
r.get(
  '/dashboard',
  requirePerm('dashboard.view'),
  ah(async (req, res) => {
    const b = req.branchId;
    const today = localDate();
    const month = today.slice(0, 7);
    const days = Math.min(Math.max(parseInt(req.query.days, 10) || 14, 7), 90);

    const todayStart = parseLocal(today);
    const tomorrowStart = parseLocal(addDays(today, 1));
    const monthStart = parseLocal(`${month}-01`);
    const nextMonthStart = parseLocal(`${addMonths(month, 1)}-01`);
    const since30 = new Date(Date.now() - 30 * 86400000);
    const firstDay = addDays(today, -(days - 1));
    const months = Array.from({ length: 12 }, (_, i) => addMonths(month, i - 11));
    const firstMonthStart = parseLocal(`${months[0]}-01`);
    const NOT_HAPPENING = ['cancelled', 'rejected', 'no_show'];

    const [resvAgg, ordAgg, revAgg, resvCustomers, orderCustomers, soldItems, payDaily, ordDaily, ordMonthly, resvMonthly, resvDaily, resvStatus, orderStatus, orderTypes, recentRes, recentOrders, lowStock, tables] =
      await Promise.all([
        db.aggregate('reservations', [
          { $match: { branch_id: b } },
          {
            $group: {
              _id: null,
              total: { $sum: 1 },
              today: sumIf({ $eq: ['$booking_date', today] }),
              pending: sumIf({ $and: [{ $eq: ['$status', 'pending'] }, { $gte: ['$booking_date', today] }] }),
              confirmed: sumIf({ $and: [{ $eq: ['$status', 'confirmed'] }, { $gte: ['$booking_date', today] }] }),
              cancelled: sumIf({ $and: [{ $eq: ['$status', 'cancelled'] }, { $eq: [{ $substrCP: ['$booking_date', 0, 7] }, month] }] }),
              guests_today: sumIf({ $and: [{ $eq: ['$booking_date', today] }, { $not: [{ $in: ['$status', NOT_HAPPENING] }] }] }, '$guests'),
            },
          },
        ]),
        db.aggregate('orders', [
          { $match: { branch_id: b } },
          {
            $group: {
              _id: null,
              total: { $sum: 1 },
              today: sumIf({ $and: [{ $gte: ['$created_at', todayStart] }, { $lt: ['$created_at', tomorrowStart] }] }),
              active: sumIf({ $not: [{ $in: ['$status', ['completed', 'cancelled']] }] }),
            },
          },
        ]),
        db.aggregate('payments', [
          { $match: { branch_id: b, status: { $in: PAID } } },
          {
            $group: {
              _id: null,
              today: sumIf({ $and: [{ $gte: ['$created_at', todayStart] }, { $lt: ['$created_at', tomorrowStart] }] }, netAmount),
              month: sumIf({ $and: [{ $gte: ['$created_at', monthStart] }, { $lt: ['$created_at', nextMonthStart] }] }, netAmount),
            },
          },
        ]),
        db.distinct('reservations', 'customer_id', { branch_id: b, customer_id: { $ne: null } }),
        db.distinct('orders', 'customer_id', { branch_id: b, customer_id: { $ne: null } }),
        // order items of the last 30 days, grouped by (food item, name) - feeds popular items + category performance
        db.aggregate('orders', [
          { $match: { branch_id: b, status: { $ne: 'cancelled' }, created_at: { $gt: since30 } } },
          { $project: { _id: 0, id: 1 } },
          { $lookup: { from: 'order_items', localField: 'id', foreignField: 'order_id', as: 'oi' } },
          { $unwind: '$oi' },
          { $group: { _id: { food_item_id: '$oi.food_item_id', name: '$oi.name' }, quantity: { $sum: '$oi.quantity' }, revenue: { $sum: '$oi.line_total' } } },
        ]),
        db.aggregate('payments', [
          { $match: { branch_id: b, status: { $in: PAID }, created_at: { $gte: parseLocal(firstDay), $lt: tomorrowStart } } },
          { $group: { _id: localDay('$created_at'), revenue: { $sum: netAmount } } },
        ]),
        db.aggregate('orders', [
          { $match: { branch_id: b, status: { $ne: 'cancelled' }, created_at: { $gte: parseLocal(firstDay), $lt: tomorrowStart } } },
          { $group: { _id: localDay('$created_at'), orders: { $sum: 1 } } },
        ]),
        db.aggregate('orders', [
          { $match: { branch_id: b, status: { $ne: 'cancelled' }, created_at: { $gte: firstMonthStart, $lt: nextMonthStart } } },
          { $group: { _id: localMonth('$created_at'), sales: { $sum: '$total' }, orders: { $sum: 1 } } },
        ]),
        db.aggregate('reservations', [
          { $match: { branch_id: b, booking_date: { $gte: `${months[0]}-01`, $lt: `${addMonths(month, 1)}-01` }, status: { $nin: ['cancelled', 'rejected'] } } },
          { $group: { _id: { $substrCP: ['$booking_date', 0, 7] }, n: { $sum: 1 } } },
        ]),
        db.aggregate('reservations', [
          { $match: { branch_id: b, booking_date: { $gte: firstDay, $lte: addDays(today, 6) } } },
          {
            $group: {
              _id: '$booking_date',
              bookings: sumIf({ $not: [{ $in: ['$status', NOT_HAPPENING] }] }),
              cancelled: sumIf({ $in: ['$status', NOT_HAPPENING] }),
              guests: sumIf({ $not: [{ $in: ['$status', NOT_HAPPENING] }] }, '$guests'),
            },
          },
        ]),
        db.aggregate('reservations', [
          { $match: { branch_id: b, booking_date: { $gte: addDays(today, -30) } } },
          { $group: { _id: '$status', count: { $sum: 1 } } },
          { $sort: { count: -1 } },
          { $project: { _id: 0, status: '$_id', count: 1 } },
        ]),
        db.aggregate('orders', [
          { $match: { branch_id: b, created_at: { $gt: since30 } } },
          { $group: { _id: '$status', count: { $sum: 1 } } },
          { $sort: { count: -1 } },
          { $project: { _id: 0, status: '$_id', count: 1 } },
        ]),
        db.aggregate('orders', [
          { $match: { branch_id: b, status: { $ne: 'cancelled' }, created_at: { $gt: since30 } } },
          { $group: { _id: '$order_type', count: { $sum: 1 }, revenue: { $sum: '$total' } } },
          { $project: { _id: 0, order_type: '$_id', count: 1, revenue: 1 } },
        ]),
        db.find(
          'reservations',
          { branch_id: b, booking_date: today, status: { $nin: ['cancelled', 'rejected'] } },
          { sort: { start_at: 1 }, limit: 8, projection: { id: 1, booking_code: 1, customer_name: 1, guests: 1, start_at: 1, status: 1 } }
        ),
        db.find('orders', { branch_id: b }, { sort: { created_at: -1 }, limit: 8, projection: { id: 1, order_code: 1, order_type: 1, total: 1, status: 1, payment_status: 1, created_at: 1 } }),
        db.count('inventory_items', { branch_id: b, is_active: true, $expr: { $lte: ['$quantity', '$min_quantity'] } }),
        liveTableStatus(b),
      ]);

    const resv = resvAgg[0] || { total: 0, today: 0, pending: 0, confirmed: 0, cancelled: 0, guests_today: 0 };
    const ord = ordAgg[0] || { total: 0, today: 0, active: 0 };
    const revenue = revAgg[0] || { today: 0, month: 0 };
    const totalCustomers = new Set([...resvCustomers, ...orderCustomers]).size;

    // Popular items (top 6 by quantity) with their primary image
    const popularRaw = [...soldItems].sort((x, y) => y.quantity - x.quantity).slice(0, 6);
    const imgIds = popularRaw.map((p) => p._id.food_item_id).filter((v) => v != null);
    const images = imgIds.length ? await db.find('food_images', { food_item_id: { $in: imgIds } }, { sort: { is_primary: -1, id: 1 }, projection: { food_item_id: 1, url: 1 } }) : [];
    const imageBy = new Map();
    for (const im of images) if (!imageBy.has(im.food_item_id)) imageBy.set(im.food_item_id, im.url);
    const popular = popularRaw.map((p) => ({
      id: p._id.food_item_id ?? null,
      name: p._id.name,
      quantity: p.quantity,
      revenue: round2(p.revenue || 0),
      image: imageBy.get(p._id.food_item_id) ?? null,
    }));

    // Category performance (inner joins: items whose food/category no longer exists are skipped)
    const foods = await db.mapByIds('food_items', soldItems.map((s) => s._id.food_item_id), { projection: { category_id: 1 } });
    const cats = await db.mapByIds('food_categories', [...foods.values()].map((f) => f.category_id), { projection: { name: 1 } });
    const catAcc = new Map();
    for (const s of soldItems) {
      const cat = cats.get(foods.get(s._id.food_item_id)?.category_id);
      if (!cat) continue;
      const a = catAcc.get(cat.name) || { category: cat.name, quantity: 0, revenue: 0 };
      a.quantity += Number(s.quantity || 0);
      a.revenue += Number(s.revenue || 0);
      catAcc.set(cat.name, a);
    }
    const categories = [...catAcc.values()].map((c) => ({ ...c, revenue: round2(c.revenue) })).sort((x, y) => y.revenue - x.revenue);

    // Gap-filled series (generate_series replacement)
    const payBy = byKey(payDaily);
    const ordBy = byKey(ordDaily);
    const dailyRevenue = daysBetween(firstDay, today).map((d) => ({ date: d, revenue: round2(payBy.get(d)?.revenue || 0), orders: ordBy.get(d)?.orders || 0 }));
    const salesBy = byKey(ordMonthly);
    const resvMonthBy = byKey(resvMonthly);
    const monthly = months.map((m) => ({ month: m, sales: round2(salesBy.get(m)?.sales || 0), orders: salesBy.get(m)?.orders || 0, reservations: resvMonthBy.get(m)?.n || 0 }));
    const resvDayBy = byKey(resvDaily);
    const resvByDay = daysBetween(firstDay, addDays(today, 6)).map((d) => {
      const x = resvDayBy.get(d);
      return { date: d, bookings: x?.bookings || 0, cancelled: x?.cancelled || 0, guests: x?.guests || 0 };
    });

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
        today_revenue: round2(revenue.today || 0),
        monthly_revenue: round2(revenue.month || 0),
        total_customers: totalCustomers,
        available_tables: tableCounts.available || 0,
        occupied_tables: tableCounts.occupied || 0,
        reserved_tables: tableCounts.reserved || 0,
        maintenance_tables: tableCounts.maintenance || 0,
        total_tables: tables.length,
        low_stock_items: lowStock,
      },
      popular_items: popular,
      charts: {
        daily_revenue: dailyRevenue,
        monthly_sales: monthly,
        reservations_by_day: resvByDay,
        reservation_status: resvStatus,
        order_status: orderStatus,
        order_types: orderTypes.map((t) => ({ order_type: t.order_type, count: t.count, revenue: round2(t.revenue || 0) })),
        category_performance: categories,
      },
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
    const filter = { branch_id: req.branchId };
    if (req.query.rating) filter.rating = parseInt(req.query.rating, 10);
    if (req.query.type === 'food') filter.food_item_id = { $ne: null };
    if (req.query.type === 'restaurant') filter.food_item_id = null;
    const rows = await db.find('reviews', filter, { sort: { created_at: -1, id: -1 }, limit: 500 });
    const [users, foods] = await Promise.all([
      db.mapByIds('users', rows.map((x) => x.user_id), { projection: { name: 1, email: 1 } }),
      db.mapByIds('food_items', rows.map((x) => x.food_item_id), { projection: { name: 1 } }),
    ]);
    res.json(
      rows
        .filter((rv) => users.has(rv.user_id))
        .map((rv) => ({ ...rv, customer_name: users.get(rv.user_id).name, customer_email: users.get(rv.user_id).email, food_name: foods.get(rv.food_item_id)?.name ?? null }))
    );
  })
);

async function recomputeFoodRating(foodId) {
  if (!foodId) return;
  const [s] = await db.aggregate('reviews', [{ $match: { food_item_id: foodId, is_published: true } }, { $group: { _id: null, avg: { $avg: '$rating' }, n: { $sum: 1 } } }]);
  await db.update('food_items', { id: foodId }, { $set: { avg_rating: s ? round2(s.avg ?? 0) : 0, rating_count: s ? s.n : 0 } });
}

r.patch(
  '/reviews/:id(\\d+)',
  requirePerm('reviews.manage'),
  validate(z.object({ is_published: z.boolean().optional(), admin_reply: zs.optStr(2000) })),
  ah(async (req, res) => {
    const filter = { id: parseInt(req.params.id, 10), branch_id: req.branchId };
    const set = {};
    if (req.body.is_published != null) set.is_published = req.body.is_published;
    if (req.body.admin_reply !== undefined) set.admin_reply = req.body.admin_reply ?? null;
    const rv = Object.keys(set).length ? await db.findOneAndUpdate('reviews', filter, { $set: set }) : await db.findOne('reviews', filter);
    if (!rv) throw notFound('Review');
    await recomputeFoodRating(rv.food_item_id);
    res.json(rv);
  })
);

r.delete(
  '/reviews/:id(\\d+)',
  requirePerm('reviews.manage'),
  ah(async (req, res) => {
    const rv = await db.findOne('reviews', { id: parseInt(req.params.id, 10), branch_id: req.branchId }, { projection: { id: 1, food_item_id: 1 } });
    if (!rv) throw notFound('Review');
    await db.remove('reviews', { id: rv.id });
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
    const rows = await db.find(
      'notifications',
      { branch_id: req.branchId, user_id: null, channel: 'in_app' },
      { sort: { created_at: -1, id: -1 }, limit: 50, projection: { id: 1, type: 1, title: 1, message: 1, link: 1, is_read: 1, created_at: 1 } }
    );
    res.json({ items: rows, unread: rows.filter((n) => !n.is_read).length });
  })
);
r.post(
  '/notifications/read-all',
  ah(async (req, res) => {
    await db.updateMany('notifications', { branch_id: req.branchId, user_id: null }, { $set: { is_read: true } });
    res.json({ ok: true });
  })
);
r.post(
  '/notifications/:id(\\d+)/read',
  ah(async (req, res) => {
    await db.update('notifications', { id: parseInt(req.params.id, 10), branch_id: req.branchId, user_id: null }, { $set: { is_read: true } });
    res.json({ ok: true });
  })
);

/** Outbound delivery log (email/SMS/WhatsApp) for this branch. */
r.get(
  '/notifications/outbox',
  requirePerm('reservations.manage', 'orders.manage'),
  ah(async (req, res) => {
    res.json(
      await db.find(
        'notifications',
        { branch_id: req.branchId, channel: { $ne: 'in_app' } },
        { sort: { created_at: -1, id: -1 }, limit: 200, projection: { id: 1, channel: 1, type: 1, title: 1, recipient: 1, status: 1, error: 1, created_at: 1 } }
      )
    );
  })
);

// ================= Audit logs =================
r.get(
  '/audit-logs',
  requirePerm('audit.view'),
  ah(async (req, res) => {
    const rid = req.restaurantId;
    const [branchIds, userIds] = await Promise.all([db.distinct('restaurant_branches', 'id', { restaurant_id: rid }), db.distinct('users', 'id', { restaurant_id: rid })]);
    const and = [{ $or: [{ branch_id: { $in: branchIds } }, { branch_id: null, user_id: { $in: userIds } }] }];
    if (req.query.q) {
      const q = ilike(req.query.q);
      const named = await db.distinct('users', 'id', { name: q });
      and.push({ $or: [{ action: q }, { entity: q }, { user_id: { $in: named } }] });
    }
    const logs = await db.find('audit_logs', { $and: and }, { sort: { created_at: -1, id: -1 }, limit: 300 });
    res.json(await withAuditNames(logs));
  })
);

/** LEFT JOIN users / restaurant_branches for audit rows. */
async function withAuditNames(logs) {
  const [users, branches] = await Promise.all([
    db.mapByIds('users', logs.map((a) => a.user_id), { projection: { name: 1, email: 1 } }),
    db.mapByIds('restaurant_branches', logs.map((a) => a.branch_id), { projection: { name: 1 } }),
  ]);
  return logs.map((a) => ({ ...a, user_name: users.get(a.user_id)?.name ?? null, user_email: users.get(a.user_id)?.email ?? null, branch_name: branches.get(a.branch_id)?.name ?? null }));
}

export default r;
