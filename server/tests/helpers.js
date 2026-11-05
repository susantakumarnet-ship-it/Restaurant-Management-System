import bcrypt from 'bcryptjs';
import request from 'supertest';
import { db, initDb } from '../src/db/index.js';
import { migrate } from '../src/db/migrate.js';
import { createApp } from '../src/app.js';
import { addMinutes, localDate } from '../src/utils/common.js';

export const tomorrow = () => localDate(addMinutes(new Date(), 1440));
export const daysFromNow = (n) => localDate(addMinutes(new Date(), n * 1440));

/** Fresh ephemeral MongoDB (in-memory replica set) + indexes + a small fixture. */
export async function setupApp() {
  await db.close();
  await initDb({ uri: '', dataDir: '' });
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
  const role = async (n) => (await db.findOne('roles', { name: n })).id;
  const mkRestaurant = async (name, slug) => {
    const r = await db.insert('restaurants', { name, slug });
    const b = await db.insert('restaurant_branches', { restaurant_id: r.id, name: 'Main', opening_time: '11:00:00', closing_time: '23:00:00' });
    await db.insert('restaurant_settings', {
      branch_id: b.id, reservation_duration_min: 90, buffer_min: 15, slot_interval_min: 30, min_notice_minutes: 60,
      cancellation_deadline_hours: 2, gst_rate: 5, service_charge_rate: 0, delivery_charge: 40, auto_confirm: false,
    });
    return { restaurantId: r.id, branchId: b.id };
  };
  const A = await mkRestaurant('Test Bistro', 'test-bistro');
  const B = await mkRestaurant('Other Place', 'other-place');

  const section = await db.insert('table_sections', { branch_id: A.branchId, name: 'Hall', location_type: 'indoor' });
  const mkTable = (num, capacity, type) => db.insert('tables', { branch_id: A.branchId, section_id: section.id, table_number: num, capacity, table_type: type });
  const t2 = await mkTable('T2', 2, '2_seater');
  const t4 = await mkTable('T4', 4, '4_seater');
  const t6 = await mkTable('T6', 6, '6_seater');

  const cat = await db.insert('food_categories', { restaurant_id: A.restaurantId, name: 'Mains' });
  const curry = await db.insert('food_items', { restaurant_id: A.restaurantId, category_id: cat.id, name: 'Curry', price: 200, diet_type: 'veg' });
  const naan = await db.insert('food_items', { restaurant_id: A.restaurantId, category_id: cat.id, name: 'Naan', price: 100, discounted_price: 80, diet_type: 'veg' });
  await db.insert('coupons', {
    restaurant_id: A.restaurantId, code: 'SAVE10', title: '10% off', discount_type: 'percent', discount_value: 10,
    min_order_amount: 100, max_discount: 50, per_user_limit: 1,
  });

  const user = async (roleName, email, phone, restaurantId = null) => {
    const u = await db.insert('users', {
      role_id: await role(roleName), restaurant_id: restaurantId, name: email.split('@')[0], email, phone, password_hash: hash, email_verified: true,
    });
    if (roleName === 'customer') await db.insert('customers', { user_id: u.id });
    return u.id;
  };
  await user('super_admin', 'super@test.com', '9000000000');
  await user('restaurant_admin', 'admin@test.com', '9000000001', A.restaurantId);
  await user('restaurant_admin', 'adminb@test.com', '9000000002', B.restaurantId);
  await user('waiter', 'waiter@test.com', '9000000003', A.restaurantId);
  await user('customer', 'cust@test.com', '9876500001');
  await user('customer', 'cust2@test.com', '9876500002');
  const chef = await db.insert('employees', { branch_id: A.branchId, name: 'Chef Bob', position: 'chef' });

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

/** customers row for a user email (replaces `SELECT c.* FROM customers c JOIN users u ...`). */
export async function customerByEmail(email) {
  const u = await db.findOne('users', { email });
  return u ? db.findOne('customers', { user_id: u.id }) : null;
}

export { db };
