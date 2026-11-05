import bcrypt from 'bcryptjs';
import request from 'supertest';
import { db, initDb } from '../src/db/index.js';
import { migrate } from '../src/db/migrate.js';
import { createApp } from '../src/app.js';
import { addMinutes, localDate } from '../src/utils/common.js';

export const tomorrow = () => localDate(addMinutes(new Date(), 1440));
export const daysFromNow = (n) => localDate(addMinutes(new Date(), n * 1440));

/** Fresh in-memory PostgreSQL (PGlite) + schema + a small fixture. */
export async function setupApp() {
  await db.close();
  await initDb({ url: '', dir: '' });
  await migrate({ log: () => {} });
  const fx = await createFixture();
  return { app: createApp(), fx };
}

export async function teardown() {
  await new Promise((r) => setTimeout(r, 50)); // let fire-and-forget notifications settle
  await db.close();
}

async function createFixture() {
  const hash = await bcrypt.hash('Passw0rd!', 4);
  const role = async (n) => (await db.one('SELECT id FROM roles WHERE name = $1', [n])).id;
  const mkRestaurant = async (name, slug) => {
    const r = await db.one(`INSERT INTO restaurants(name, slug) VALUES ($1,$2) RETURNING id`, [name, slug]);
    const b = await db.one(`INSERT INTO restaurant_branches(restaurant_id, name, opening_time, closing_time) VALUES ($1,'Main','11:00','23:00') RETURNING id`, [r.id]);
    await db.query(
      `INSERT INTO restaurant_settings(branch_id, reservation_duration_min, buffer_min, slot_interval_min, min_notice_minutes, cancellation_deadline_hours, gst_rate, service_charge_rate, delivery_charge, auto_confirm)
       VALUES ($1, 90, 15, 30, 60, 2, 5, 0, 40, false)`,
      [b.id]
    );
    return { restaurantId: r.id, branchId: b.id };
  };
  const A = await mkRestaurant('Test Bistro', 'test-bistro');
  const B = await mkRestaurant('Other Place', 'other-place');

  const section = await db.one(`INSERT INTO table_sections(branch_id, name, location_type) VALUES ($1,'Hall','indoor') RETURNING id`, [A.branchId]);
  const t2 = await db.one(`INSERT INTO tables(branch_id, section_id, table_number, capacity, table_type) VALUES ($1,$2,'T2',2,'2_seater') RETURNING id`, [A.branchId, section.id]);
  const t4 = await db.one(`INSERT INTO tables(branch_id, section_id, table_number, capacity, table_type) VALUES ($1,$2,'T4',4,'4_seater') RETURNING id`, [A.branchId, section.id]);
  const t6 = await db.one(`INSERT INTO tables(branch_id, section_id, table_number, capacity, table_type) VALUES ($1,$2,'T6',6,'6_seater') RETURNING id`, [A.branchId, section.id]);

  const cat = await db.one(`INSERT INTO food_categories(restaurant_id, name) VALUES ($1,'Mains') RETURNING id`, [A.restaurantId]);
  const curry = await db.one(`INSERT INTO food_items(restaurant_id, category_id, name, price, diet_type) VALUES ($1,$2,'Curry',200,'veg') RETURNING id`, [A.restaurantId, cat.id]);
  const naan = await db.one(`INSERT INTO food_items(restaurant_id, category_id, name, price, discounted_price, diet_type) VALUES ($1,$2,'Naan',100,80,'veg') RETURNING id`, [A.restaurantId, cat.id]);
  await db.query(
    `INSERT INTO coupons(restaurant_id, code, title, discount_type, discount_value, min_order_amount, max_discount, per_user_limit) VALUES ($1,'SAVE10','10% off','percent',10,100,50,1)`,
    [A.restaurantId]
  );

  const user = async (roleName, email, phone, restaurantId = null) => {
    const u = await db.one(
      `INSERT INTO users(role_id, restaurant_id, name, email, phone, password_hash, email_verified) VALUES ($1,$2,$3,$4,$5,$6,true) RETURNING id`,
      [await role(roleName), restaurantId, email.split('@')[0], email, phone, hash]
    );
    if (roleName === 'customer') await db.query('INSERT INTO customers(user_id) VALUES ($1)', [u.id]);
    return u.id;
  };
  await user('super_admin', 'super@test.com', '9000000000');
  await user('restaurant_admin', 'admin@test.com', '9000000001', A.restaurantId);
  await user('restaurant_admin', 'adminb@test.com', '9000000002', B.restaurantId);
  await user('waiter', 'waiter@test.com', '9000000003', A.restaurantId);
  await user('customer', 'cust@test.com', '9876500001');
  await user('customer', 'cust2@test.com', '9876500002');
  const chef = await db.one(`INSERT INTO employees(branch_id, name, position) VALUES ($1,'Chef Bob','chef') RETURNING id`, [A.branchId]);

  return { A, B, sectionId: section.id, tables: { t2: t2.id, t4: t4.id, t6: t6.id }, food: { curry: curry.id, naan: naan.id }, chefId: chef.id, password: 'Passw0rd!' };
}

export async function login(app, identifier, password = 'Passw0rd!') {
  const res = await request(app).post('/api/auth/login').send({ identifier, password });
  if (res.status !== 200) throw new Error(`login failed for ${identifier}: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body.token;
}

/** Supertest wrapper with auth + branch header. */
export function client(app, token, branchId) {
  const withHeaders = (req) => {
    if (token) req.set('Authorization', `Bearer ${token}`);
    if (branchId) req.set('X-Branch-Id', String(branchId));
    return req;
  };
  return {
    get: (u) => withHeaders(request(app).get(u)),
    post: (u, b) => withHeaders(request(app).post(u)).send(b || {}),
    put: (u, b) => withHeaders(request(app).put(u)).send(b || {}),
    patch: (u, b) => withHeaders(request(app).patch(u)).send(b || {}),
    delete: (u) => withHeaders(request(app).delete(u)),
  };
}

export { db };
