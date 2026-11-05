import { Router } from 'express';
import { z } from 'zod';
import { db, escapeRegex } from '../../db/index.js';
import { ah, badRequest, conflict, notFound, validate } from '../../utils/http.js';
import { requirePerm } from '../../middleware/auth.js';
import { liveTableStatus } from '../../services/booking.js';
import { definedOnly, invalid, localIso } from '../../utils/common.js';
import { crud, zs } from './crud.js';

const r = Router();
const collator = new Intl.Collator('en');

/** Map of value(field) -> count (or sum of sumField) over `col` for the given ids. */
async function groupCount(col, field, ids, { match = {}, sumField } = {}) {
  if (!ids.length) return new Map();
  const rows = await db.aggregate(col, [
    { $match: { ...match, [field]: { $in: ids } } },
    { $group: { _id: `$${field}`, n: { $sum: sumField ? { $ifNull: [`$${sumField}`, 0] } : 1 } } },
  ]);
  return new Map(rows.map((x) => [x._id, x.n]));
}

// ---------- Table sections ----------
r.use(
  '/sections',
  crud({
    table: 'table_sections',
    scope: 'branch',
    perm: 'tables.manage',
    viewPerm: 'tables.view',
    sort: { name: 1 },
    async enrich(rows) {
      const counts = await groupCount('tables', 'section_id', rows.map((x) => x.id));
      return rows.map((x) => ({ ...x, table_count: counts.get(x.id) || 0 }));
    },
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
    const row = await db.findOneAndUpdate(
      'tables',
      { id: parseInt(req.params.id, 10), branch_id: req.branchId },
      { $set: { status: req.body.status, maintenance_note: req.body.status === 'maintenance' ? req.body.maintenance_note || null : null } }
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
    search: ['table_number', 'name'],
    filters: { sectionId: 'section_id', status: 'status', type: 'table_type' },
    sort: { table_number: 1 },
    async enrich(rows) {
      const sections = await db.mapByIds('table_sections', rows.map((x) => x.section_id), { projection: { name: 1, location_type: 1 } });
      return rows.map((x) => {
        const s = sections.get(x.section_id);
        return { ...x, section_name: s ? s.name : null, location_type: s ? s.location_type : null };
      });
    },
    check(v) {
      // was CHECK (min_capacity <= capacity)
      if (v.min_capacity != null && v.capacity != null && Number(v.min_capacity) > Number(v.capacity)) throw invalid('Minimum capacity cannot exceed the capacity');
    },
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
      const links = await db.find('reservation_tables', { table_id: row.id, active: true, end_at: { $gt: localIso() } }, { projection: { reservation_id: 1 } });
      const n = links.length
        ? await db.count('reservations', { id: { $in: links.map((l) => l.reservation_id) }, status: { $in: ['pending', 'confirmed', 'checked_in', 'seated'] } })
        : 0;
      if (n > 0) throw conflict(`Table ${row.table_number} has ${n} upcoming booking(s). Reassign them first or deactivate the table.`);
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
    sort: { sort_order: 1, name: 1 },
    async enrich(rows) {
      const counts = await groupCount('food_items', 'category_id', rows.map((x) => x.id));
      return rows.map((x) => ({ ...x, item_count: counts.get(x.id) || 0 }));
    },
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

/**
 * Food items with category_name, images (primary first, then sort_order) and times_ordered,
 * ordered by category sort_order, then name. (Replacement for the old foodSelect JOIN.)
 */
async function loadFood(filter) {
  const items = await db.find('food_items', filter);
  if (!items.length) return [];
  const ids = items.map((f) => f.id);
  const [cats, imgs, ordered] = await Promise.all([
    db.mapByIds('food_categories', items.map((f) => f.category_id), { projection: { name: 1, sort_order: 1 } }),
    db.find('food_images', { food_item_id: { $in: ids } }, { sort: { is_primary: -1, sort_order: 1 }, projection: { food_item_id: 1, url: 1 } }),
    groupCount('order_items', 'food_item_id', ids, { sumField: 'quantity' }),
  ]);
  const imageMap = new Map();
  for (const im of imgs) {
    if (!imageMap.has(im.food_item_id)) imageMap.set(im.food_item_id, []);
    imageMap.get(im.food_item_id).push(im.url);
  }
  // INNER JOIN food_categories
  const rows = items
    .filter((f) => cats.has(f.category_id))
    .map((f) => ({ ...f, category_name: cats.get(f.category_id).name, images: imageMap.get(f.id) || [], times_ordered: ordered.get(f.id) || 0 }));
  rows.sort((a, b) => (cats.get(a.category_id).sort_order ?? 0) - (cats.get(b.category_id).sort_order ?? 0) || collator.compare(a.name, b.name));
  return rows;
}
const loadFoodOne = async (filter) => (await loadFood(filter))[0] || null;

async function checkCategory(req, categoryId) {
  if (categoryId == null) return;
  const c = await db.exists('food_categories', { id: Number(categoryId), restaurant_id: req.restaurantId });
  if (!c) throw badRequest('Invalid category');
}
async function saveImages(_t, foodId, images) {
  await db.remove('food_images', { food_item_id: foodId });
  if (images.length) await db.insertMany('food_images', images.map((url, i) => ({ food_item_id: foodId, url, is_primary: i === 0, sort_order: i })));
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
    const filter = { restaurant_id: req.restaurantId };
    if (req.query.q) {
      const rx = { $regex: escapeRegex(req.query.q), $options: 'i' };
      filter.$or = [{ name: rx }, { description: rx }];
    }
    if (req.query.categoryId) filter.category_id = parseInt(req.query.categoryId, 10);
    if (req.query.diet) filter.diet_type = String(req.query.diet);
    res.json(await loadFood(filter));
  })
);

r.get(
  '/food-items/:id(\\d+)',
  requirePerm('menu.manage', 'orders.view'),
  ah(async (req, res) => {
    const f = await loadFoodOne({ id: parseInt(req.params.id, 10), restaurant_id: req.restaurantId });
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
    const id = await db.tx(async () => {
      const row = await db.insert('food_items', { ...definedOnly(data), restaurant_id: req.restaurantId });
      await saveImages(null, row.id, images);
      return row.id;
    });
    res.locals.createdId = id;
    res.status(201).json(await loadFoodOne({ id }));
  })
);

r.put(
  '/food-items/:id(\\d+)',
  requirePerm('menu.manage'),
  validate(foodSchema.partial()),
  ah(async (req, res) => {
    const id = parseInt(req.params.id, 10);
    const cur = await db.findOne('food_items', { id, restaurant_id: req.restaurantId });
    if (!cur) throw notFound('Food item');
    const { images, ...rest } = req.body;
    const data = definedOnly(rest);
    await checkCategory(req, data.category_id);
    checkPrice(data, cur);
    await db.tx(async () => {
      if (Object.keys(data).length) await db.update('food_items', { id }, { $set: { ...data, updated_at: new Date() } });
      if (images) await saveImages(null, id, images);
    });
    res.json(await loadFoodOne({ id }));
  })
);

r.patch(
  '/food-items/:id(\\d+)/availability',
  requirePerm('menu.manage', 'orders.manage'),
  validate(z.object({ is_available: z.boolean() })),
  ah(async (req, res) => {
    const row = await db.findOneAndUpdate(
      'food_items',
      { id: parseInt(req.params.id, 10), restaurant_id: req.restaurantId },
      { $set: { is_available: req.body.is_available, updated_at: new Date() } },
      { projection: { id: 1, is_available: 1 } }
    );
    if (!row) throw notFound('Food item');
    res.json(row);
  })
);

r.delete(
  '/food-items/:id(\\d+)',
  requirePerm('menu.manage'),
  ah(async (req, res) => {
    const n = await db.remove('food_items', { id: parseInt(req.params.id, 10), restaurant_id: req.restaurantId });
    if (!n) throw notFound('Food item');
    res.json({ ok: true });
  })
);

export default r;
