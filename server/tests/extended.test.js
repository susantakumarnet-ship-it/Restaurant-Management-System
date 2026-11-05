import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { client, customerByEmail, daysFromNow, db, login, setupApp, teardown, tomorrow } from './helpers.js';

let app, fx, admin, cust, cust2, sup;
beforeAll(async () => {
  ({ app, fx } = await setupApp());
  admin = client(app, await login(app, 'admin@test.com'), fx.A.branchId);
  cust = client(app, await login(app, 'cust@test.com'));
  cust2 = client(app, await login(app, 'cust2@test.com'));
  sup = client(app, await login(app, 'super@test.com'));
});
afterAll(teardown);

const book = (c, over = {}) =>
  c.post('/api/customer/bookings', { branch_id: fx.A.branchId, customer_name: 'Guest', phone: '9876500001', date: daysFromNow(2), time: '19:00', guests: 2, ...over });

describe('HTTP basics', () => {
  it('returns JSON 404 for unknown endpoints and 400 for malformed JSON', async () => {
    const nf = await request(app).get('/api/nope');
    expect(nf.status).toBe(404);
    expect(nf.body.error.code).toBe('NOT_FOUND');
    const bad = await request(app).post('/api/auth/login').set('Content-Type', 'application/json').send('{"identifier":');
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe('BAD_JSON');
  });
  it('requires X-Branch-Id for admin endpoints', async () => {
    const res = await client(app, await login(app, 'admin@test.com')).get('/api/admin/tables');
    expect(res.status).toBe(400);
  });
  it('health check reports the database', async () => {
    const res = await request(app).get('/api/health');
    expect(res.body).toMatchObject({ status: 'ok', db: 'mongodb-memory' });
  });
});

describe('OTP security', () => {
  it('locks a code after 5 wrong attempts and throttles resends', async () => {
    const reg = await request(app).post('/api/auth/register').send({ name: 'Otp User', email: 'otp@test.com', phone: '9111100000', password: 'Secret123' });
    expect(reg.status).toBe(201);
    for (let i = 0; i < 5; i++) {
      const r = await request(app).post('/api/auth/verify-otp').send({ identifier: 'otp@test.com', code: '000000' });
      expect(r.status).toBe(400);
    }
    const locked = await request(app).post('/api/auth/verify-otp').send({ identifier: 'otp@test.com', code: reg.body.devOtp });
    expect(locked.status).toBe(400);
    expect(locked.body.error.message).toMatch(/Too many attempts/);
    const resend = await request(app).post('/api/auth/resend-otp').send({ identifier: 'otp@test.com' });
    expect(resend.status).toBe(429);
  });
});

describe('Access control regressions', () => {
  it('blocking a customer revokes access immediately, unblocking restores it', async () => {
    const token = await login(app, 'cust2@test.com');
    const c2 = client(app, token);
    expect((await c2.get('/api/customer/bookings')).status).toBe(200);
    // customer must have activity in the restaurant to be visible to its admin
    await book(c2, { phone: '9876500002', date: daysFromNow(9) });
    const custRow = await customerByEmail('cust2@test.com');
    expect((await admin.patch(`/api/admin/customers/${custRow.id}`, { status: 'blocked' })).status).toBe(200);
    const blocked = await c2.get('/api/customer/bookings');
    expect(blocked.status).toBe(403);
    const relogin = await request(app).post('/api/auth/login').send({ identifier: 'cust2@test.com', password: 'Passw0rd!' });
    expect(relogin.status).toBe(403);
    await admin.patch(`/api/admin/customers/${custRow.id}`, { status: 'active' });
    expect((await c2.get('/api/customer/bookings')).status).toBe(200);
  });

  it('staff cannot post customer reviews', async () => {
    const res = await admin.post('/api/customer/reviews', { branch_id: fx.A.branchId, rating: 5, comment: 'self promo' });
    expect(res.status).toBe(403);
  });

  it("customers cannot read another customer's order or invoice", async () => {
    const o = await cust.post('/api/customer/orders', { branch_id: fx.A.branchId, order_type: 'takeaway', items: [{ food_item_id: fx.food.curry, quantity: 1 }], contact_name: 'Cust', contact_phone: '9876500001', payment_method: 'cash' });
    expect(o.status).toBe(201);
    expect((await cust2.get(`/api/customer/orders/${o.body.id}`)).status).toBe(404);
    expect((await cust2.get(`/api/customer/orders/${o.body.id}/invoice.pdf`)).status).toBe(404);
    expect((await cust2.post('/api/customer/payments/create', { order_id: o.body.id })).status).toBe(404);
  });

  it('a deactivated restaurant stops accepting bookings and orders', async () => {
    await db.update('restaurants', { id: fx.A.restaurantId }, { is_active: false });
    const b = await book(cust, { date: daysFromNow(8) });
    expect(b.status).toBe(400);
    const o = await cust.post('/api/customer/orders', { branch_id: fx.A.branchId, order_type: 'takeaway', items: [{ food_item_id: fx.food.curry, quantity: 1 }], contact_name: 'Cust', contact_phone: '9876500001' });
    expect(o.status).toBe(400);
    const pub = await request(app).get('/api/public/branches');
    expect(pub.body.find((x) => x.id === fx.A.branchId)).toBeUndefined();
    await db.update('restaurants', { id: fx.A.restaurantId }, { is_active: true });
  });
});

describe('Advance payments & pre-orders', () => {
  it('holds a booking pending until the advance is paid, then auto-confirms; cancel refunds', async () => {
    await admin.put('/api/admin/settings', { advance_payment_required: true, advance_payment_amount: 200, auto_confirm: true });
    const res = await book(cust, { date: daysFromNow(6), time: '13:00' });
    expect(res.status).toBe(201);
    const b = res.body.booking;
    expect(b.status).toBe('pending');
    expect(b.payment_status).toBe('pending');
    expect(b.advance_amount).toBe(200);

    const pay = await cust.post('/api/customer/payments/create', { reservation_id: b.id });
    expect(pay.body.amount).toBe(200);
    await cust.post('/api/customer/payments/mock-complete', { payment_id: pay.body.payment_id, success: true });
    const after = await cust.get(`/api/customer/bookings/${b.id}`);
    expect(after.body.payment_status).toBe('paid');
    expect(after.body.status).toBe('confirmed');
    // nothing left to pay
    expect((await cust.post('/api/customer/payments/create', { reservation_id: b.id })).status).toBe(400);

    const cancelled = await cust.post(`/api/customer/bookings/${b.id}/cancel`, { reason: 'Sick' });
    expect(cancelled.body.status).toBe('cancelled');
    expect(cancelled.body.payment_status).toBe('refunded');
    await admin.put('/api/admin/settings', { advance_payment_required: false, advance_payment_amount: 0, auto_confirm: false });
  });

  it('creates a dine-in pre-order linked to the booking', async () => {
    const res = await book(cust, { date: daysFromNow(7), time: '20:00', pre_order: { items: [{ food_item_id: fx.food.naan, quantity: 4 }] } });
    expect(res.status).toBe(201);
    expect(res.body.order.order_type).toBe('dine_in');
    expect(res.body.order.reservation_id).toBe(res.body.booking.id);
    const detail = await cust.get(`/api/customer/bookings/${res.body.booking.id}`);
    expect(detail.body.orders).toHaveLength(1);
  });
});

describe('Reservation operations (admin)', () => {
  let id;
  it('seat -> table occupied, complete -> table available', async () => {
    const r = await admin.post('/api/admin/reservations', { customer_name: 'Walk In', phone: '9000033333', date: tomorrow(), time: '15:00', guests: 2, table_ids: [fx.tables.t2], source: 'walk_in' });
    expect(r.status).toBe(201);
    id = r.body.id;
    await admin.patch(`/api/admin/reservations/${id}/status`, { status: 'seated' });
    expect((await db.byId('tables', fx.tables.t2)).status).toBe('occupied');
    await admin.patch(`/api/admin/reservations/${id}/status`, { status: 'completed' });
    expect((await db.byId('tables', fx.tables.t2)).status).toBe('available');
  });

  it('no-show releases the table for re-booking', async () => {
    const r = await admin.post('/api/admin/reservations', { customer_name: 'Ghost', phone: '9000044444', date: daysFromNow(3), time: '18:00', guests: 4, table_ids: [fx.tables.t4] });
    const clash = await admin.post('/api/admin/reservations', { customer_name: 'Clash', phone: '9000055555', date: daysFromNow(3), time: '18:30', guests: 4, table_ids: [fx.tables.t4] });
    expect(clash.status).toBe(409);
    await admin.patch(`/api/admin/reservations/${r.body.id}/status`, { status: 'no_show', note: 'Did not arrive' });
    const again = await admin.post('/api/admin/reservations', { customer_name: 'Clash', phone: '9000055555', date: daysFromNow(3), time: '18:30', guests: 4, table_ids: [fx.tables.t4] });
    expect(again.status).toBe(201);
  });

  it('reassigning to a busy table is rejected; admin modify re-checks availability', async () => {
    const a = await admin.post('/api/admin/reservations', { customer_name: 'Alpha', phone: '9000066666', date: daysFromNow(4), time: '12:00', guests: 2, table_ids: [fx.tables.t2] });
    const b = await admin.post('/api/admin/reservations', { customer_name: 'Bravo', phone: '9000077777', date: daysFromNow(4), time: '12:00', guests: 2, table_ids: [fx.tables.t6] });
    expect(a.status, JSON.stringify(a.body)).toBe(201);
    expect(b.status, JSON.stringify(b.body)).toBe(201);
    expect((await admin.put(`/api/admin/reservations/${b.body.id}/tables`, { table_ids: [fx.tables.t2] })).status).toBe(409);
    const moved = await admin.put(`/api/admin/reservations/${b.body.id}`, { time: '16:00' });
    expect(moved.status).toBe(200);
    expect(moved.body.start_at.slice(11, 16)).toBe('16:00');
    expect((await admin.put(`/api/admin/reservations/${b.body.id}/tables`, { table_ids: [fx.tables.t2] })).status).toBe(200);
    expect(a.status).toBe(201);
  });

  it('live floor marks upcoming bookings as reserved', async () => {
    const at = `${daysFromNow(4)}T11:30`;
    const live = await admin.get(`/api/admin/tables/live?at=${at}`);
    expect(live.status).toBe(200);
    expect(live.body.find((t) => t.id === fx.tables.t2).live_status).toBe('reserved');
  });

  it('cannot book a closed weekday', async () => {
    const day = [...Array(8)].map((_, i) => daysFromNow(i + 1)).find((d) => new Date(d + 'T00:00').getDay() === 2);
    await db.update('restaurant_branches', { id: fx.A.branchId }, { weekly_holidays: [2] });
    const res = await book(cust, { date: day });
    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/closed/);
    const av = await request(app).get(`/api/public/branches/${fx.A.branchId}/availability?date=${day}&guests=2`);
    expect(av.body.closed).toBe(true);
    await db.update('restaurant_branches', { id: fx.A.branchId }, { weekly_holidays: [] });
  });
});

describe('Review-found regressions', () => {
  it('modifying a booking can clear optional fields', async () => {
    const r = await admin.post('/api/admin/reservations', { customer_name: 'Clear Me', phone: '9000088888', date: daysFromNow(10), time: '13:00', guests: 2, special_requests: 'window', occasion: 'birthday' });
    const upd = await admin.put(`/api/admin/reservations/${r.body.id}`, { special_requests: '', occasion: null });
    expect(upd.status).toBe(200);
    expect(upd.body.special_requests).toBeNull();
    expect(upd.body.occasion).toBeNull();
    expect(upd.body.customer_name).toBe('Clear Me');
  });
  it('orders cannot be completed while a balance is outstanding', async () => {
    const o = await admin.post('/api/admin/orders', { order_type: 'takeaway', items: [{ food_item_id: fx.food.curry, quantity: 1 }] });
    for (const s of ['preparing', 'ready']) await admin.patch(`/api/admin/orders/${o.body.id}/status`, { status: s });
    const blocked = await admin.patch(`/api/admin/orders/${o.body.id}/status`, { status: 'completed' });
    expect(blocked.status).toBe(400);
    expect(blocked.body.error.message).toMatch(/outstanding/);
    await admin.post('/api/admin/payments', { order_id: o.body.id, method: 'upi' });
    expect((await admin.patch(`/api/admin/orders/${o.body.id}/status`, { status: 'completed' })).status).toBe(200);
  });
  it('staff availability lookup ignores the online minimum party size', async () => {
    await admin.put('/api/admin/settings', { min_guests: 2 });
    expect((await request(app).get(`/api/public/branches/${fx.A.branchId}/availability?date=${daysFromNow(2)}&guests=1`)).status).toBe(400);
    expect((await admin.get(`/api/admin/reservations/availability?date=${daysFromNow(2)}&guests=1`)).status).toBe(200);
    await admin.put('/api/admin/settings', { min_guests: 1 });
  });
  it('restaurant admins cannot see the roles.manage permission; role edits require super admin', async () => {
    const me = await admin.get('/api/admin/context');
    expect(me.body.user.permissions).not.toContain('roles.manage');
  });
  it('admin feed uses staff-facing wording', async () => {
    await book(cust, { date: daysFromNow(11), time: '12:30' });
    const feed = await admin.get('/api/admin/notifications');
    const n = feed.body.items.find((x) => x.type === 'booking_received');
    expect(n.title).toMatch(/^New booking/);
    expect(n.message).not.toMatch(/your booking/i);
  });
});

describe('Orders edge cases', () => {
  it('delivery requires an address; dine-in adds the service charge', async () => {
    const base = { branch_id: fx.A.branchId, items: [{ food_item_id: fx.food.curry, quantity: 1 }], contact_name: 'Cust', contact_phone: '9876500001' };
    expect((await cust.post('/api/customer/orders', { ...base, order_type: 'delivery' })).status).toBe(400);
    await admin.put('/api/admin/settings', { service_charge_rate: 10 });
    const q = await cust.post('/api/public/cart/quote', { branch_id: fx.A.branchId, order_type: 'dine_in', items: base.items });
    expect(q.body.service_charge).toBe(20);
    expect(q.body.tax).toBe(11); // 5% of (200 + 20)
    await admin.put('/api/admin/settings', { service_charge_rate: 0 });
  });

  it('rejects invalid status jumps and cancelling after preparation', async () => {
    const o = await admin.post('/api/admin/orders', { order_type: 'takeaway', items: [{ food_item_id: fx.food.curry, quantity: 1 }] });
    expect((await admin.patch(`/api/admin/orders/${o.body.id}/status`, { status: 'completed' })).status).toBe(400);
    await admin.patch(`/api/admin/orders/${o.body.id}/status`, { status: 'preparing' });
    await admin.patch(`/api/admin/orders/${o.body.id}/status`, { status: 'ready' });
    expect((await admin.patch(`/api/admin/orders/${o.body.id}/status`, { status: 'cancelled' })).status).toBe(400);
  });

  it('assigning a non-chef employee is rejected', async () => {
    const emp = await admin.post('/api/admin/employees', { name: 'Waiter Wally', position: 'waiter' });
    const o = await admin.post('/api/admin/orders', { order_type: 'takeaway', items: [{ food_item_id: fx.food.curry, quantity: 1 }] });
    expect((await admin.patch(`/api/admin/orders/${o.body.id}/assign`, { chef_id: emp.body.id })).status).toBe(400);
  });

  it('expired coupons are rejected', async () => {
    await admin.post('/api/admin/coupons', { code: 'OLD10', title: 'Old', discount_type: 'percent', discount_value: 10, valid_from: '2020-01-01', valid_to: '2020-12-31' });
    const res = await cust.post('/api/public/coupons/validate', { branch_id: fx.A.branchId, code: 'old10', subtotal: 500 });
    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/expired/);
  });
});

describe('Reviews moderation', () => {
  it('hiding a review removes it publicly and recalculates the dish rating', async () => {
    const r1 = await cust.post('/api/customer/reviews', { branch_id: fx.A.branchId, food_item_id: fx.food.naan, rating: 2, comment: 'Meh' });
    await cust2.post('/api/customer/reviews', { branch_id: fx.A.branchId, food_item_id: fx.food.naan, rating: 4, comment: 'Good' });
    expect((await db.byId('food_items', fx.food.naan)).avg_rating).toBe(3);
    const hide = await admin.patch(`/api/admin/reviews/${r1.body.id}`, { is_published: false, admin_reply: 'Sorry about that!' });
    expect(hide.status).toBe(200);
    expect(await db.byId('food_items', fx.food.naan, { projection: { avg_rating: 1, rating_count: 1 } })).toEqual({ avg_rating: 4, rating_count: 1 });
    const pub = await request(app).get(`/api/public/branches/${fx.A.branchId}/reviews`);
    expect(pub.body.find((x) => x.id === r1.body.id)).toBeUndefined();
  });
});

describe('Branches & settings', () => {
  it('creating a branch also creates its settings; last branch cannot be deleted', async () => {
    const br = await admin.post('/api/admin/branches', { name: 'Second', opening_time: '10:00', closing_time: '22:00', weekly_holidays: [1] });
    expect(br.status).toBe(201);
    const s = await db.findOne('restaurant_settings', { branch_id: br.body.id });
    expect(s.reservation_duration_min).toBe(90);
    expect((await admin.delete(`/api/admin/branches/${br.body.id}`)).status).toBe(200);
    expect((await admin.delete(`/api/admin/branches/${fx.A.branchId}`)).status).toBe(400);
  });
  it('rejects closing time before opening time', async () => {
    const res = await admin.put(`/api/admin/branches/${fx.A.branchId}`, { opening_time: '22:00', closing_time: '10:00' });
    expect(res.status).toBe(422);
  });
});

describe('Super admin', () => {
  it('creates a restaurant with a branch and an admin who is isolated to it', async () => {
    const r = await sup.post('/api/super/restaurants', { name: 'Brand New Diner', branch_name: 'Downtown', city: 'Pune', subscription_plan: 'pro' });
    expect(r.status).toBe(201);
    const branch = await db.findOne('restaurant_branches', { restaurant_id: r.body.id });
    const a = await sup.post('/api/super/admins', { name: 'New Admin', email: 'newadmin@test.com', password: 'Admin12345', role: 'restaurant_admin', restaurant_id: r.body.id });
    expect(a.status).toBe(201);
    const token = await login(app, 'newadmin@test.com', 'Admin12345');
    const ctx = await client(app, token).get('/api/admin/context');
    expect(ctx.body.branches.map((b) => b.id)).toEqual([branch.id]);
    expect((await client(app, token, fx.A.branchId).get('/api/admin/dashboard')).status).toBe(403);
    expect((await client(app, token, branch.id).get('/api/admin/dashboard')).status).toBe(200);
  });
  it('validates admin tenancy and prevents self-demotion', async () => {
    expect((await sup.post('/api/super/admins', { name: 'Xavier', email: 'x@test.com', password: 'Admin12345', role: 'manager' })).status).toBe(400);
    const me = await db.findOne('users', { email: 'super@test.com' });
    expect((await sup.put(`/api/super/admins/${me.id}`, { is_active: false })).status).toBe(400);
  });
  it('saves system settings and runs consolidated reports', async () => {
    expect((await sup.put('/api/super/settings', { platform_name: 'RMS', maintenance_mode: false })).status).toBe(200);
    expect((await sup.get('/api/super/settings')).body.platform_name).toBe('RMS');
    const rep = await sup.get(`/api/super/reports/bookings?from=2026-01-01&to=${daysFromNow(30)}`);
    expect(rep.status).toBe(200);
    expect(rep.body.rows.length).toBeGreaterThan(0);
  });
});

describe('Staff edge cases', () => {
  it('rejects shifts that end before they start; terminating disables the login', async () => {
    const emp = await admin.post('/api/admin/employees', { name: 'Temp Cashier', position: 'cashier' });
    expect((await admin.post('/api/admin/shifts', { employee_id: emp.body.id, shift_date: tomorrow(), start_time: '18:00', end_time: '10:00' })).status).toBe(400);
    await admin.post(`/api/admin/employees/${emp.body.id}/account`, { email: 'temp.cashier@test.com', password: 'Cashier123', role: 'cashier' });
    await login(app, 'temp.cashier@test.com', 'Cashier123');
    await admin.put(`/api/admin/employees/${emp.body.id}`, { status: 'terminated' });
    const res = await request(app).post('/api/auth/login').send({ identifier: 'temp.cashier@test.com', password: 'Cashier123' });
    expect(res.status).toBe(403);
  });
});

describe('Uploads & webhook', () => {
  const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6360000002000154a24f5d0000000049454e44ae426082', 'hex');
  it('requires auth, accepts real images and rejects disguised files', async () => {
    expect((await request(app).post('/api/uploads').attach('files', PNG, 'a.png')).status).toBe(401);
    const token = await login(app, 'admin@test.com');
    const ok = await request(app).post('/api/uploads').set('Authorization', `Bearer ${token}`).attach('files', PNG, { filename: 'a.png', contentType: 'image/png' });
    expect(ok.status).toBe(201);
    expect(ok.body.url).toMatch(/^\/uploads\/.+\.png$/);
    const served = await request(app).get(ok.body.url);
    expect(served.status).toBe(200);
    const fake = await request(app).post('/api/uploads').set('Authorization', `Bearer ${token}`).attach('files', Buffer.from('<script>alert(1)</script>'), { filename: 'x.png', contentType: 'image/png' });
    expect(fake.status).toBe(400);
  });
  it('rejects unsigned webhooks', async () => {
    const res = await request(app).post('/api/payments/webhook').set('Content-Type', 'application/json').send('{"event":"payment.captured"}');
    expect(res.status).toBe(403);
  });
});

describe('Notifications & dashboard', () => {
  it('customers receive in-app notifications and can mark them read', async () => {
    const n = await cust.get('/api/customer/notifications');
    expect(n.body.items.length).toBeGreaterThan(0);
    expect(n.body.unread).toBeGreaterThan(0);
    await cust.post('/api/customer/notifications/read-all');
    expect((await cust.get('/api/customer/notifications')).body.unread).toBe(0);
  });
  it('admin feed gets new online bookings; outbox logs email/SMS', async () => {
    const feed = await admin.get('/api/admin/notifications');
    expect(feed.body.items.some((x) => x.type === 'booking_received')).toBe(true);
    await new Promise((r) => setTimeout(r, 100));
    const out = await admin.get('/api/admin/notifications/outbox');
    expect(out.body.some((x) => x.channel === 'sms' && ['logged', 'sent'].includes(x.status))).toBe(true);
  });
  it("dashboard counts today's revenue from payments", async () => {
    const o = await admin.post('/api/admin/orders', { order_type: 'takeaway', items: [{ food_item_id: fx.food.curry, quantity: 1 }] });
    const before = (await admin.get('/api/admin/dashboard')).body.cards.today_revenue;
    await admin.post('/api/admin/payments', { order_id: o.body.id, method: 'cash' });
    const after = (await admin.get('/api/admin/dashboard')).body.cards.today_revenue;
    expect(Math.round((after - before) * 100) / 100).toBe(o.body.total);
  });
  it('weekly revenue report groups by ISO week', async () => {
    const res = await admin.get(`/api/admin/reports/revenue?from=2026-01-01&to=${daysFromNow(1)}&period=week`);
    expect(res.body.rows[0].period).toMatch(/^\d{4}-W\d{2}$/);
  });
});
