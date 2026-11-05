import { Router } from 'express';
import { z } from 'zod';
import { db } from '../db/index.js';
import { ah, notFound, validate } from '../utils/http.js';
import { optionalAuth } from '../middleware/auth.js';
import { getAvailability } from '../services/booking.js';
import { evaluateCoupon, priceOrder } from '../services/orders.js';
import { localDate } from '../utils/common.js';

const r = Router();
const id = (v) => parseInt(v, 10) || 0;
/** Pick columns in order; missing ones become null (like SQL NULL). */
const pick = (o, keys) => Object.fromEntries(keys.map((k) => [k, o?.[k] ?? null]));

r.get(
  '/branches',
  ah(async (_req, res) => {
    const restaurants = await db.find('restaurants', { is_active: true }, { projection: { id: 1, name: 1, logo_url: 1, cuisine: 1 } });
    const rmap = new Map(restaurants.map((x) => [x.id, x]));
    const branches = await db.find(
      'restaurant_branches',
      { is_active: true, restaurant_id: { $in: [...rmap.keys()] } },
      { sort: { restaurant_id: 1, id: 1 } }
    );
    res.json(
      branches.map((b) => {
        const rest = rmap.get(b.restaurant_id);
        return {
          ...pick(b, ['id', 'name', 'city', 'address', 'phone', 'opening_time', 'closing_time', 'images']),
          restaurant_id: rest.id,
          restaurant_name: rest.name ?? null,
          logo_url: rest.logo_url ?? null,
          cuisine: rest.cuisine ?? null,
        };
      })
    );
  })
);

r.get(
  '/branches/:id',
  ah(async (req, res) => {
    const branch = await db.findOne('restaurant_branches', { id: id(req.params.id), is_active: true });
    const rest = branch && (await db.findOne('restaurants', { id: branch.restaurant_id, is_active: true }));
    const s = rest && (await db.findOne('restaurant_settings', { branch_id: branch.id }));
    if (!branch || !rest || !s) throw notFound('Restaurant');
    const [stats] = await db.aggregate('reviews', [
      { $match: { branch_id: branch.id, is_published: true, food_item_id: null } },
      { $group: { _id: null, avg: { $avg: '$rating' }, n: { $sum: 1 } } },
    ]);
    const b = {
      ...branch,
      restaurant_name: rest.name ?? null,
      logo_url: rest.logo_url ?? null,
      cover_url: rest.cover_url ?? null,
      description: rest.description ?? null,
      cuisine: rest.cuisine ?? null,
      restaurant_email: rest.email ?? null,
      restaurant_phone: rest.phone ?? null,
      website: rest.website ?? null,
      ...pick(s, [
        'reservation_duration_min', 'min_guests', 'max_guests', 'max_advance_days', 'min_notice_minutes',
        'cancellation_deadline_hours', 'advance_payment_required', 'advance_payment_amount', 'gst_rate',
        'service_charge_rate', 'delivery_charge', 'min_delivery_order', 'accepts_delivery', 'accepts_takeaway',
        'booking_policy', 'currency', 'auto_confirm',
      ]),
      avg_rating: stats && stats.avg != null ? Math.round((stats.avg + Number.EPSILON) * 10) / 10 : null,
      review_count: stats ? stats.n : 0,
    };
    b.sections = (
      await db.find('table_sections', { branch_id: b.id, is_active: true }, { sort: { name: 1 }, projection: { id: 1, name: 1, location_type: 1, description: 1 } })
    ).map((x) => pick(x, ['id', 'name', 'location_type', 'description']));
    res.json(b);
  })
);

r.get(
  '/branches/:id/menu',
  ah(async (req, res) => {
    const b = await db.findOne('restaurant_branches', { id: id(req.params.id), is_active: true }, { projection: { restaurant_id: 1 } });
    if (!b) throw notFound('Restaurant');
    const cats = await db.find('food_categories', { restaurant_id: b.restaurant_id, is_active: true }, { sort: { sort_order: 1, name: 1 } });
    const categories = cats.map((c) => pick(c, ['id', 'name', 'description', 'image_url']));
    const catOrder = new Map(cats.map((c) => [c.id, c.sort_order ?? 0]));
    const foods = await db.find('food_items', { restaurant_id: b.restaurant_id, category_id: { $in: [...catOrder.keys()] } });
    foods.sort(
      (a, z2) =>
        catOrder.get(a.category_id) - catOrder.get(z2.category_id) ||
        Number(!!z2.is_bestseller) - Number(!!a.is_bestseller) ||
        (a.name < z2.name ? -1 : a.name > z2.name ? 1 : 0)
    );
    const foodIds = foods.map((f) => f.id);
    const images = new Map();
    if (foodIds.length) {
      const imgs = await db.find('food_images', { food_item_id: { $in: foodIds } }, { sort: { is_primary: -1, sort_order: 1 }, projection: { food_item_id: 1, url: 1 } });
      for (const im of imgs) {
        if (!images.has(im.food_item_id)) images.set(im.food_item_id, []);
        images.get(im.food_item_id).push(im.url);
      }
    }
    const ordered = new Map(
      foodIds.length
        ? (await db.aggregate('order_items', [{ $match: { food_item_id: { $in: foodIds } } }, { $group: { _id: '$food_item_id', n: { $sum: '$quantity' } } }])).map((x) => [x._id, x.n])
        : []
    );
    const items = foods.map((f) => ({
      ...pick(f, [
        'id', 'category_id', 'name', 'description', 'price', 'discounted_price', 'diet_type', 'is_available',
        'prep_time_min', 'is_bestseller', 'is_recommended', 'spice_level', 'ingredients', 'allergens', 'avg_rating', 'rating_count',
      ]),
      images: images.get(f.id) || [],
      times_ordered: ordered.get(f.id) || 0,
    }));
    res.json({ categories, items });
  })
);

r.get(
  '/branches/:id/offers',
  ah(async (req, res) => {
    const b = await db.findOne('restaurant_branches', { id: id(req.params.id) }, { projection: { restaurant_id: 1 } });
    if (!b) throw notFound('Restaurant');
    const today = localDate();
    const rows = await db.find(
      'coupons',
      {
        restaurant_id: b.restaurant_id,
        is_active: true,
        is_public: true,
        $and: [
          { $or: [{ valid_from: null }, { valid_from: { $lte: today } }] },
          { $or: [{ valid_to: null }, { valid_to: { $gte: today } }] },
          { $or: [{ usage_limit: null }, { $expr: { $lt: ['$used_count', '$usage_limit'] } }] },
        ],
      },
      { sort: { discount_value: -1 } }
    );
    res.json(rows.map((c) => pick(c, ['id', 'code', 'title', 'description', 'discount_type', 'discount_value', 'min_order_amount', 'max_discount', 'valid_to', 'image_url'])));
  })
);

r.get(
  '/branches/:id/reviews',
  ah(async (req, res) => {
    const foodId = req.query.foodItemId ? id(req.query.foodItemId) : null;
    const filter = { branch_id: id(req.params.id), is_published: true };
    if (foodId !== null) filter.food_item_id = foodId;
    const rows = await db.find('reviews', filter, { sort: { created_at: -1 }, limit: 50 });
    const users = await db.mapByIds('users', rows.map((x) => x.user_id), { projection: { name: 1, avatar_url: 1 } });
    const foods = await db.mapByIds('food_items', rows.map((x) => x.food_item_id), { projection: { name: 1 } });
    res.json(
      rows
        .filter((rv) => users.has(rv.user_id)) // inner JOIN users
        .map((rv) => {
          const u = users.get(rv.user_id);
          return {
            ...pick(rv, ['id', 'rating', 'comment', 'images', 'admin_reply', 'created_at', 'food_item_id']),
            food_name: foods.get(rv.food_item_id)?.name ?? null,
            customer_name: u.name == null ? null : String(u.name).split(' ')[0],
            avatar_url: u.avatar_url ?? null,
          };
        })
    );
  })
);

r.get(
  '/branches/:id/availability',
  validate(
    z.object({
      date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'date is required (YYYY-MM-DD)'),
      guests: z.coerce.number().int().min(1).max(100),
      sectionId: z.coerce.number().int().optional(),
      excludeReservationId: z.coerce.number().int().optional(),
    }),
    'query'
  ),
  ah(async (req, res) => {
    const q = req.validQuery;
    res.json(await getAvailability({ branchId: id(req.params.id), date: q.date, guests: q.guests, sectionId: q.sectionId, excludeReservationId: q.excludeReservationId || 0 }));
  })
);

const quoteSchema = z.object({
  branch_id: z.number().int(),
  order_type: z.enum(['dine_in', 'takeaway', 'delivery']).default('takeaway'),
  coupon_code: z.string().trim().max(40).optional().nullable(),
  items: z.array(z.object({ food_item_id: z.number().int(), quantity: z.number().int().min(1).max(50) })).min(1).max(100),
});

/** Cart quote: server-side totals incl. coupon, GST, service & delivery charges. */
r.post(
  '/cart/quote',
  optionalAuth,
  validate(quoteSchema),
  ah(async (req, res) => {
    const b = req.body;
    const price = await priceOrder(db, { branchId: b.branch_id, items: b.items, couponCode: b.coupon_code || null, orderType: b.order_type, customerId: req.user?.customer_id });
    const { cfg, ...out } = price;
    res.json(out);
  })
);

r.post(
  '/coupons/validate',
  optionalAuth,
  validate(z.object({ branch_id: z.number().int(), code: z.string().trim().min(1).max(40), subtotal: z.number().min(0) })),
  ah(async (req, res) => {
    const b = await db.findOne('restaurant_branches', { id: req.body.branch_id }, { projection: { restaurant_id: 1 } });
    if (!b) throw notFound('Restaurant');
    const { coupon, discount } = await evaluateCoupon(db, { restaurantId: b.restaurant_id, code: req.body.code, subtotal: req.body.subtotal, customerId: req.user?.customer_id });
    res.json({ valid: true, discount, coupon: { code: coupon.code, title: coupon.title, description: coupon.description } });
  })
);

export default r;
