import { Router } from 'express';
import { z } from 'zod';
import { db } from '../../db/index.js';
import { ah, badRequest, forbidden, notFound, validate } from '../../utils/http.js';
import { requirePerm } from '../../middleware/auth.js';
import { definedOnly, invalid, toTime } from '../../utils/common.js';
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
  ah(async (req, res) => res.json(await db.byId('restaurants', req.restaurantId)))
);

r.put(
  '/restaurant',
  requirePerm('restaurant.manage'),
  validate(restaurantSchema.partial()),
  ah(async (req, res) => {
    const data = definedOnly(req.body);
    if (Object.keys(data).length) await db.update('restaurants', { id: req.restaurantId }, { $set: { ...data, updated_at: new Date() } });
    res.json(await db.byId('restaurants', req.restaurantId));
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

/** Was CHECK (closing_time > opening_time) on restaurant_branches. */
function checkHours(opening, closing) {
  if (opening != null && closing != null && !(closing > opening)) throw invalid('Closing time must be after opening time');
}

// Branch list for the current restaurant (all staff can read; managing requires restaurant.manage)
r.get(
  '/branches',
  ah(async (req, res) => res.json(await db.find('restaurant_branches', { restaurant_id: req.restaurantId }, { sort: { id: 1 } })))
);

r.post(
  '/branches',
  requirePerm('restaurant.manage'),
  validate(branchSchema),
  ah(async (req, res) => {
    if (req.user.branch_id) throw forbidden('Branch-level staff cannot create branches');
    const b = req.body;
    const opening_time = toTime(b.opening_time);
    const closing_time = toTime(b.closing_time);
    checkHours(opening_time, closing_time);
    const row = await db.tx(async () => {
      const br = await db.insert('restaurant_branches', {
        restaurant_id: req.restaurantId,
        name: b.name,
        address: b.address ?? null,
        city: b.city ?? null,
        state: b.state ?? null,
        postal_code: b.postal_code ?? null,
        latitude: b.latitude ?? null,
        longitude: b.longitude ?? null,
        map_url: b.map_url ?? null,
        phone: b.phone ?? null,
        email: b.email ?? null,
        opening_time,
        closing_time,
        weekly_holidays: b.weekly_holidays,
        images: b.images,
        is_active: b.is_active ?? true,
      });
      await db.insert('restaurant_settings', { branch_id: br.id });
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
    const br = await db.findOne('restaurant_branches', { id, restaurant_id: req.restaurantId });
    if (!br) throw notFound('Branch');
    if (req.user.branch_id && req.user.branch_id !== id) throw forbidden();
    const data = definedOnly(req.body);
    if (data.opening_time != null) data.opening_time = toTime(data.opening_time);
    if (data.closing_time != null) data.closing_time = toTime(data.closing_time);
    if (Object.keys(data).length) {
      checkHours(data.opening_time ?? br.opening_time, data.closing_time ?? br.closing_time);
      await db.update('restaurant_branches', { id }, { $set: { ...data, updated_at: new Date() } });
    }
    res.json(await db.byId('restaurant_branches', id));
  })
);

r.delete(
  '/branches/:id(\\d+)',
  requirePerm('restaurant.manage'),
  ah(async (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (req.user.branch_id) throw forbidden();
    const count = await db.count('restaurant_branches', { restaurant_id: req.restaurantId });
    if (count <= 1) throw badRequest('A restaurant must have at least one branch');
    const used = (await db.count('reservations', { branch_id: id })) + (await db.count('orders', { branch_id: id }));
    if (used > 0) {
      await db.update('restaurant_branches', { id, restaurant_id: req.restaurantId }, { $set: { is_active: false } });
      return res.json({ ok: true, deactivated: true, message: 'Branch has history, so it was deactivated instead of deleted.' });
    }
    await db.remove('restaurant_branches', { id, restaurant_id: req.restaurantId });
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

r.get('/settings', ah(async (req, res) => res.json(await db.findOne('restaurant_settings', { branch_id: req.branchId }))));

r.put(
  '/settings',
  requirePerm('restaurant.manage'),
  validate(settingsSchema.partial()),
  ah(async (req, res) => {
    const cur = await db.findOne('restaurant_settings', { branch_id: req.branchId });
    const merged = { ...cur, ...req.body };
    if (merged.max_guests < merged.min_guests) throw badRequest('Maximum guests must be greater than or equal to minimum guests');
    const data = definedOnly(req.body);
    if (Object.keys(data).length) await db.update('restaurant_settings', { branch_id: req.branchId }, { $set: { ...data, updated_at: new Date() } });
    res.json(await db.findOne('restaurant_settings', { branch_id: req.branchId }));
  })
);

export default r;
