import { Router } from 'express';
import { z } from 'zod';
import { db } from '../../db/index.js';
import { ah, badRequest, conflict, notFound, validate } from '../../utils/http.js';
import { requirePerm } from '../../middleware/auth.js';
import { liveTableStatus } from '../../services/booking.js';
import { buildInsert, buildUpdate } from '../../utils/common.js';
import { crud, zs } from './crud.js';

const r = Router();

// ---------- Table sections ----------
r.use(
  '/sections',
  crud({
    table: 'table_sections',
    scope: 'branch',
    perm: 'tables.manage',
    viewPerm: 'tables.view',
    orderBy: 't.name',
    select: 't.*, (SELECT COUNT(*) FROM tables x WHERE x.section_id = t.id) AS table_count',
    schema: z.object({
      name: zs.str(100).min(1, 'Name is required'),
      location_type: z.enum(['indoor', 'outdoor', 'rooftop', 'private']),
      description: zs.optStr(),
      is_active: z.boolean().optional(),
    }),
  })
);

// ---------- Tables ----------
r.get(
  '/tables/live',
  requirePerm('tables.view', 'tables.manage', 'reservations.view'),
  ah(async (req, res) => {
    const at = typeof req.query.at === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(req.query.at) ? req.query.at.slice(0, 16) + ':00' : undefined;
    res.json(await liveTableStatus(req.branchId, at));
  })
);

r.patch(
  '/tables/:id(\\d+)/status',
  requirePerm('tables.manage', 'tables.view'),
  validate(z.object({ status: z.enum(['available', 'occupied', 'maintenance']), maintenance_note: zs.optStr() })),
  ah(async (req, res) => {
    const row = await db.one(
      `UPDATE tables SET status = $3, maintenance_note = $4 WHERE id = $1 AND branch_id = $2 RETURNING *`,
      [parseInt(req.params.id, 10), req.branchId, req.body.status, req.body.status === 'maintenance' ? req.body.maintenance_note || null : null]
    );
    if (!row) throw notFound('Table');
    res.json(row);
  })
);

r.use(
  '/tables',
  crud({
    table: 'tables',
    scope: 'branch',
    perm: 'tables.manage',
    viewPerm: 'tables.view',
    search: ['t.table_number', 't.name'],
    filters: { sectionId: 't.section_id', status: 't.status', type: 't.table_type' },
    orderBy: 't.table_number',
    select: 't.*, s.name AS section_name, s.location_type',
    from: 'tables t LEFT JOIN table_sections s ON s.id = t.section_id',
    refs: { section_id: ['table_sections', 'branch'] },
    schema: z.object({
      table_number: zs.str(20).min(1, 'Table number is required'),
      name: zs.optStr(100),
      section_id: zs.optInt(),
      capacity: z.number().int().min(1).max(50),
      min_capacity: z.number().int().min(1).max(50).default(1),
      table_type: z.enum(['2_seater', '4_seater', '6_seater', 'family', 'vip']),
      status: z.enum(['available', 'occupied', 'maintenance']).optional(),
      maintenance_note: zs.optStr(),
      is_active: z.boolean().optional(),
    }),
    async beforeDelete(_req, row) {
      const future = await db.one(
        `SELECT COUNT(*) AS n FROM reservation_tables rt JOIN reservations r ON r.id = rt.reservation_id
          WHERE rt.table_id = $1 AND rt.active AND r.status IN ('pending','confirmed','checked_in','seated') AND rt.end_at > now()::timestamp`,
        [row.id]
      );
      if (future.n > 0) throw conflict(`Table ${row.table_number} has ${future.n} upcoming booking(s). Reassign them first or deactivate the table.`);
    },
  })
);

// ---------- Food categories ----------
r.use(
  '/categories',
  crud({
    table: 'food_categories',
    scope: 'restaurant',
    perm: 'menu.manage',
    viewPerm: 'orders.view',
    orderBy: 't.sort_order, t.name',
    select: 't.*, (SELECT COUNT(*) FROM food_items f WHERE f.category_id = t.id) AS item_count',
    schema: z.object({
      name: zs.str(100).min(1, 'Name is required'),
      description: zs.optStr(),
      image_url: zs.optStr(),
      sort_order: z.number().int().default(0),
      is_active: z.boolean().optional(),
    }),
    async beforeDelete(_req, row) {
      if (row.item_count > 0) throw conflict('Move or delete the items in this category first');
    },
  })
);

// ---------- Food items (with images) ----------
const foodSchema = z.object({
  category_id: z.number().int(),
  name: zs.str(150).min(2, 'Name is required'),
  description: zs.optStr(2000),
  price: z.number().min(0),
  discounted_price: zs.optNum(),
  diet_type: z.enum(['veg', 'non_veg', 'vegan']),
  is_available: z.boolean().default(true),
  prep_time_min: z.number().int().min(0).max(240).default(15),
  is_bestseller: z.boolean().default(false),
  is_recommended: z.boolean().default(false),
  spice_level: z.number().int().min(0).max(3).default(0),
  ingredients: zs.optStr(2000),
  allergens: zs.optStr(500),
  images: z.array(z.string().max(500)).max(10).default([]),
});

const foodSelect = `SELECT f.*, c.name AS category_name,
   COALESCE((SELECT json_agg(fi.url ORDER BY fi.is_primary DESC, fi.sort_order) FROM food_images fi WHERE fi.food_item_id = f.id), '[]'::json) AS images,
   (SELECT COALESCE(SUM(oi.quantity),0) FROM order_items oi WHERE oi.food_item_id = f.id) AS times_ordered
  FROM food_items f JOIN food_categories c ON c.id = f.category_id`;

async function checkCategory(req, categoryId) {
  if (categoryId == null) return;
  const c = await db.one('SELECT id FROM food_categories WHERE id = $1 AND restaurant_id = $2', [categoryId, req.restaurantId]);
  if (!c) throw badRequest('Invalid category');
}
async function saveImages(t, foodId, images) {
  await t.query('DELETE FROM food_images WHERE food_item_id = $1', [foodId]);
  for (let i = 0; i < images.length; i++) {
    await t.query('INSERT INTO food_images(food_item_id, url, is_primary, sort_order) VALUES ($1,$2,$3,$4)', [foodId, images[i], i === 0, i]);
  }
}
const checkPrice = (d, cur = {}) => {
  const price = d.price ?? cur.price;
  const disc = d.discounted_price !== undefined ? d.discounted_price : cur.discounted_price;
  if (disc != null && Number(disc) > Number(price)) throw badRequest('Discounted price cannot exceed the price');
};

r.get(
  '/food-items',
  requirePerm('menu.manage', 'orders.view'),
  ah(async (req, res) => {
    const params = [req.restaurantId];
    const where = ['f.restaurant_id = $1'];
    if (req.query.q) {
      params.push(`%${req.query.q}%`);
      where.push(`(f.name ILIKE $${params.length} OR f.description ILIKE $${params.length})`);
    }
    if (req.query.categoryId) {
      params.push(parseInt(req.query.categoryId, 10));
      where.push(`f.category_id = $${params.length}`);
    }
    if (req.query.diet) {
      params.push(req.query.diet);
      where.push(`f.diet_type = $${params.length}`);
    }
    res.json(await db.many(`${foodSelect} WHERE ${where.join(' AND ')} ORDER BY c.sort_order, f.name`, params));
  })
);

r.get(
  '/food-items/:id(\\d+)',
  requirePerm('menu.manage', 'orders.view'),
  ah(async (req, res) => {
    const f = await db.one(`${foodSelect} WHERE f.id = $1 AND f.restaurant_id = $2`, [parseInt(req.params.id, 10), req.restaurantId]);
    if (!f) throw notFound('Food item');
    res.json(f);
  })
);

r.post(
  '/food-items',
  requirePerm('menu.manage'),
  validate(foodSchema),
  ah(async (req, res) => {
    const { images, ...data } = req.body;
    await checkCategory(req, data.category_id);
    checkPrice(data);
    const id = await db.tx(async (t) => {
      const { cols, placeholders, values } = buildInsert({ ...data, restaurant_id: req.restaurantId });
      const row = await t.one(`INSERT INTO food_items (${cols}) VALUES (${placeholders}) RETURNING id`, values);
      await saveImages(t, row.id, images);
      return row.id;
    });
    res.locals.createdId = id;
    res.status(201).json(await db.one(`${foodSelect} WHERE f.id = $1`, [id]));
  })
);

r.put(
  '/food-items/:id(\\d+)',
  requirePerm('menu.manage'),
  validate(foodSchema.partial()),
  ah(async (req, res) => {
    const id = parseInt(req.params.id, 10);
    const cur = await db.one('SELECT * FROM food_items WHERE id = $1 AND restaurant_id = $2', [id, req.restaurantId]);
    if (!cur) throw notFound('Food item');
    const { images, ...data } = req.body;
    await checkCategory(req, data.category_id);
    checkPrice(data, cur);
    await db.tx(async (t) => {
      const { sets, values } = buildUpdate(data, { startIndex: 2 });
      if (sets.length) await t.query(`UPDATE food_items SET ${sets.join(', ')}, updated_at = now() WHERE id = $1`, [id, ...values]);
      if (images) await saveImages(t, id, images);
    });
    res.json(await db.one(`${foodSelect} WHERE f.id = $1`, [id]));
  })
);

r.patch(
  '/food-items/:id(\\d+)/availability',
  requirePerm('menu.manage', 'orders.manage'),
  validate(z.object({ is_available: z.boolean() })),
  ah(async (req, res) => {
    const row = await db.one('UPDATE food_items SET is_available = $3, updated_at = now() WHERE id = $1 AND restaurant_id = $2 RETURNING id, is_available', [parseInt(req.params.id, 10), req.restaurantId, req.body.is_available]);
    if (!row) throw notFound('Food item');
    res.json(row);
  })
);

r.delete(
  '/food-items/:id(\\d+)',
  requirePerm('menu.manage'),
  ah(async (req, res) => {
    const row = await db.one('DELETE FROM food_items WHERE id = $1 AND restaurant_id = $2 RETURNING id', [parseInt(req.params.id, 10), req.restaurantId]);
    if (!row) throw notFound('Food item');
    res.json({ ok: true });
  })
);

export default r;
