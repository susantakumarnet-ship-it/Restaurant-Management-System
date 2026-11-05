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

r.get(
  '/branches',
  ah(async (_req, res) => {
    res.json(
      await db.many(
        `SELECT b.id, b.name, b.city, b.address, b.phone, b.opening_time, b.closing_time, b.images,
                r.id AS restaurant_id, r.name AS restaurant_name, r.logo_url, r.cuisine
           FROM restaurant_branches b JOIN restaurants r ON r.id = b.restaurant_id
          WHERE b.is_active AND r.is_active ORDER BY r.id, b.id`
      )
    );
  })
);

r.get(
  '/branches/:id',
  ah(async (req, res) => {
    const b = await db.one(
      `SELECT b.*, r.name AS restaurant_name, r.logo_url, r.cover_url, r.description, r.cuisine, r.email AS restaurant_email,
              r.phone AS restaurant_phone, r.website,
              s.reservation_duration_min, s.min_guests, s.max_guests, s.max_advance_days, s.min_notice_minutes,
              s.cancellation_deadline_hours, s.advance_payment_required, s.advance_payment_amount, s.gst_rate,
              s.service_charge_rate, s.delivery_charge, s.min_delivery_order, s.accepts_delivery, s.accepts_takeaway,
              s.booking_policy, s.currency, s.auto_confirm,
              (SELECT ROUND(AVG(rating)::numeric, 1) FROM reviews WHERE branch_id = b.id AND is_published AND food_item_id IS NULL) AS avg_rating,
              (SELECT COUNT(*) FROM reviews WHERE branch_id = b.id AND is_published AND food_item_id IS NULL) AS review_count
         FROM restaurant_branches b JOIN restaurants r ON r.id = b.restaurant_id
         JOIN restaurant_settings s ON s.branch_id = b.id
        WHERE b.id = $1 AND b.is_active AND r.is_active`,
      [id(req.params.id)]
    );
    if (!b) throw notFound('Restaurant');
    b.sections = await db.many(`SELECT id, name, location_type, description FROM table_sections WHERE branch_id = $1 AND is_active ORDER BY name`, [b.id]);
    res.json(b);
  })
);

r.get(
  '/branches/:id/menu',
  ah(async (req, res) => {
    const b = await db.one('SELECT restaurant_id FROM restaurant_branches WHERE id = $1 AND is_active', [id(req.params.id)]);
    if (!b) throw notFound('Restaurant');
    const categories = await db.many(
      `SELECT id, name, description, image_url FROM food_categories WHERE restaurant_id = $1 AND is_active ORDER BY sort_order, name`,
      [b.restaurant_id]
    );
    const items = await db.many(
      `SELECT f.id, f.category_id, f.name, f.description, f.price, f.discounted_price, f.diet_type, f.is_available,
              f.prep_time_min, f.is_bestseller, f.is_recommended, f.spice_level, f.ingredients, f.allergens, f.avg_rating, f.rating_count,
              COALESCE((SELECT json_agg(fi.url ORDER BY fi.is_primary DESC, fi.sort_order) FROM food_images fi WHERE fi.food_item_id = f.id), '[]'::json) AS images,
              (SELECT COALESCE(SUM(oi.quantity),0) FROM order_items oi WHERE oi.food_item_id = f.id) AS times_ordered
         FROM food_items f JOIN food_categories c ON c.id = f.category_id
        WHERE f.restaurant_id = $1 AND c.is_active
        ORDER BY c.sort_order, f.is_bestseller DESC, f.name`,
      [b.restaurant_id]
    );
    res.json({ categories, items });
  })
);

r.get(
  '/branches/:id/offers',
  ah(async (req, res) => {
    const b = await db.one('SELECT restaurant_id FROM restaurant_branches WHERE id = $1', [id(req.params.id)]);
    if (!b) throw notFound('Restaurant');
    const today = localDate();
    res.json(
      await db.many(
        `SELECT id, code, title, description, discount_type, discount_value, min_order_amount, max_discount, valid_to, image_url
           FROM coupons
          WHERE restaurant_id = $1 AND is_active AND is_public
            AND (valid_from IS NULL OR valid_from <= $2) AND (valid_to IS NULL OR valid_to >= $2)
            AND (usage_limit IS NULL OR used_count < usage_limit)
          ORDER BY discount_value DESC`,
        [b.restaurant_id, today]
      )
    );
  })
);

r.get(
  '/branches/:id/reviews',
  ah(async (req, res) => {
    const foodId = req.query.foodItemId ? id(req.query.foodItemId) : null;
    res.json(
      await db.many(
        `SELECT rv.id, rv.rating, rv.comment, rv.images, rv.admin_reply, rv.created_at, rv.food_item_id,
                f.name AS food_name, split_part(u.name, ' ', 1) AS customer_name, u.avatar_url
           FROM reviews rv JOIN users u ON u.id = rv.user_id LEFT JOIN food_items f ON f.id = rv.food_item_id
          WHERE rv.branch_id = $1 AND rv.is_published AND ($2::int IS NULL OR rv.food_item_id = $2)
          ORDER BY rv.created_at DESC LIMIT 50`,
        [id(req.params.id), foodId]
      )
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
    const b = await db.one('SELECT restaurant_id FROM restaurant_branches WHERE id = $1', [req.body.branch_id]);
    if (!b) throw notFound('Restaurant');
    const { coupon, discount } = await evaluateCoupon(db, { restaurantId: b.restaurant_id, code: req.body.code, subtotal: req.body.subtotal, customerId: req.user?.customer_id });
    res.json({ valid: true, discount, coupon: { code: coupon.code, title: coupon.title, description: coupon.description } });
  })
);

export default r;
