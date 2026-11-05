import { Router } from 'express';
import { z } from 'zod';
import { db } from '../../db/index.js';
import { ah, badRequest, forbidden, notFound, validate } from '../../utils/http.js';
import { requirePerm } from '../../middleware/auth.js';
import { buildUpdate } from '../../utils/common.js';
import { zs } from './crud.js';

const r = Router();

const restaurantSchema = z.object({
  name: zs.str(150).min(2),
  logo_url: zs.optStr(),
  cover_url: zs.optStr(),
  description: zs.optStr(3000),
  cuisine: zs.optStr(150),
  email: zs.optStr(150),
  phone: zs.optStr(30),
  website: zs.optStr(200),
  gstin: zs.optStr(20),
});

r.get(
  '/restaurant',
  ah(async (req, res) => res.json(await db.one('SELECT * FROM restaurants WHERE id = $1', [req.restaurantId])))
);

r.put(
  '/restaurant',
  requirePerm('restaurant.manage'),
  validate(restaurantSchema.partial()),
  ah(async (req, res) => {
    const { sets, values } = buildUpdate(req.body, { startIndex: 2 });
    if (sets.length) await db.query(`UPDATE restaurants SET ${sets.join(', ')}, updated_at = now() WHERE id = $1`, [req.restaurantId, ...values]);
    res.json(await db.one('SELECT * FROM restaurants WHERE id = $1', [req.restaurantId]));
  })
);

export const branchSchema = z.object({
  name: zs.str(150).min(2),
  address: zs.optStr(),
  city: zs.optStr(100),
  state: zs.optStr(100),
  postal_code: zs.optStr(20),
  latitude: zs.optNum(),
  longitude: zs.optNum(),
  map_url: zs.optStr(1000),
  phone: zs.optStr(30),
  email: zs.optStr(150),
  opening_time: zs.time(),
  closing_time: zs.time(),
  weekly_holidays: z.array(z.number().int().min(0).max(6)).default([]),
  images: z.array(z.string().max(500)).max(20).default([]),
  is_active: z.boolean().optional(),
});

// Branch list for the current restaurant (all staff can read; managing requires restaurant.manage)
r.get(
  '/branches',
  ah(async (req, res) => res.json(await db.many('SELECT * FROM restaurant_branches WHERE restaurant_id = $1 ORDER BY id', [req.restaurantId])))
);

r.post(
  '/branches',
  requirePerm('restaurant.manage'),
  validate(branchSchema),
  ah(async (req, res) => {
    if (req.user.branch_id) throw forbidden('Branch-level staff cannot create branches');
    const b = req.body;
    const row = await db.tx(async (t) => {
      const br = await t.one(
        `INSERT INTO restaurant_branches(restaurant_id, name, address, city, state, postal_code, latitude, longitude, map_url, phone, email,
            opening_time, closing_time, weekly_holidays, images, is_active)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::text::jsonb,$15::text::jsonb, COALESCE($16, true)) RETURNING *`,
        [req.restaurantId, b.name, b.address, b.city, b.state, b.postal_code, b.latitude, b.longitude, b.map_url, b.phone, b.email,
          b.opening_time, b.closing_time, JSON.stringify(b.weekly_holidays), JSON.stringify(b.images), b.is_active ?? null]
      );
      await t.query('INSERT INTO restaurant_settings(branch_id) VALUES ($1)', [br.id]);
      return br;
    });
    res.locals.createdId = row.id;
    res.status(201).json(row);
  })
);

r.put(
  '/branches/:id(\\d+)',
  requirePerm('restaurant.manage'),
  validate(branchSchema.partial()),
  ah(async (req, res) => {
    const id = parseInt(req.params.id, 10);
    const br = await db.one('SELECT id FROM restaurant_branches WHERE id = $1 AND restaurant_id = $2', [id, req.restaurantId]);
    if (!br) throw notFound('Branch');
    if (req.user.branch_id && req.user.branch_id !== id) throw forbidden();
    const { sets, values } = buildUpdate(req.body, { json: ['weekly_holidays', 'images'], startIndex: 2 });
    if (sets.length) await db.query(`UPDATE restaurant_branches SET ${sets.join(', ')}, updated_at = now() WHERE id = $1`, [id, ...values]);
    res.json(await db.one('SELECT * FROM restaurant_branches WHERE id = $1', [id]));
  })
);

r.delete(
  '/branches/:id(\\d+)',
  requirePerm('restaurant.manage'),
  ah(async (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (req.user.branch_id) throw forbidden();
    const count = await db.one('SELECT COUNT(*) AS n FROM restaurant_branches WHERE restaurant_id = $1', [req.restaurantId]);
    if (count.n <= 1) throw badRequest('A restaurant must have at least one branch');
    const used = await db.one('SELECT (SELECT COUNT(*) FROM reservations WHERE branch_id = $1) + (SELECT COUNT(*) FROM orders WHERE branch_id = $1) AS n', [id]);
    if (used.n > 0) {
      await db.query('UPDATE restaurant_branches SET is_active = false WHERE id = $1 AND restaurant_id = $2', [id, req.restaurantId]);
      return res.json({ ok: true, deactivated: true, message: 'Branch has history, so it was deactivated instead of deleted.' });
    }
    await db.query('DELETE FROM restaurant_branches WHERE id = $1 AND restaurant_id = $2', [id, req.restaurantId]);
    res.json({ ok: true });
  })
);

const settingsSchema = z.object({
  reservation_duration_min: z.number().int().min(15).max(480),
  buffer_min: z.number().int().min(0).max(120),
  slot_interval_min: z.number().int().min(5).max(120),
  min_guests: z.number().int().min(1),
  max_guests: z.number().int().min(1).max(100),
  max_advance_days: z.number().int().min(0).max(365),
  min_notice_minutes: z.number().int().min(0).max(10080),
  cancellation_deadline_hours: z.number().int().min(0).max(168),
  auto_confirm: z.boolean(),
  advance_payment_required: z.boolean(),
  advance_payment_amount: z.number().min(0),
  gst_rate: z.number().min(0).max(28),
  service_charge_rate: z.number().min(0).max(20),
  delivery_charge: z.number().min(0),
  min_delivery_order: z.number().min(0),
  accepts_delivery: z.boolean(),
  accepts_takeaway: z.boolean(),
  loyalty_points_per_100: z.number().int().min(0).max(100),
  booking_policy: zs.optStr(5000),
});

r.get('/settings', ah(async (req, res) => res.json(await db.one('SELECT * FROM restaurant_settings WHERE branch_id = $1', [req.branchId]))));

r.put(
  '/settings',
  requirePerm('restaurant.manage'),
  validate(settingsSchema.partial()),
  ah(async (req, res) => {
    const cur = await db.one('SELECT * FROM restaurant_settings WHERE branch_id = $1', [req.branchId]);
    const merged = { ...cur, ...req.body };
    if (merged.max_guests < merged.min_guests) throw badRequest('Maximum guests must be greater than or equal to minimum guests');
    const { sets, values } = buildUpdate(req.body, { startIndex: 2 });
    if (sets.length) await db.query(`UPDATE restaurant_settings SET ${sets.join(', ')}, updated_at = now() WHERE branch_id = $1`, [req.branchId, ...values]);
    res.json(await db.one('SELECT * FROM restaurant_settings WHERE branch_id = $1', [req.branchId]));
  })
);

export default r;
