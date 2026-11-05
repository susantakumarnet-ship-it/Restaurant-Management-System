import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { client, customerByEmail, db, login, setupApp, teardown } from './helpers.js';

let app, fx, cust, admin;
beforeAll(async () => {
  ({ app, fx } = await setupApp());
  cust = client(app, await login(app, 'cust@test.com'));
  admin = client(app, await login(app, 'admin@test.com'), fx.A.branchId);
});
afterAll(teardown);

const order = (over = {}) => ({
  branch_id: fx.A.branchId,
  order_type: 'takeaway',
  items: [{ food_item_id: fx.food.curry, quantity: 2 }, { food_item_id: fx.food.naan, quantity: 1 }],
  contact_name: 'Cust',
  contact_phone: '9876500001',
  payment_method: 'online',
  ...over,
});

describe('Pricing', () => {
  it('computes subtotal, coupon, GST and delivery server-side', async () => {
    const res = await cust.post('/api/public/cart/quote', { branch_id: fx.A.branchId, order_type: 'delivery', coupon_code: 'save10', items: order().items });
    expect(res.status).toBe(200);
    // 2x200 + 1x80 (discounted) = 480; 10% = 48 (max 50); taxable 432; GST 5% = 21.6; delivery 40
    expect(res.body.subtotal).toBe(480);
    expect(res.body.discount).toBe(48);
    expect(res.body.tax).toBe(21.6);
    expect(res.body.cgst + res.body.sgst).toBeCloseTo(21.6);
    expect(res.body.delivery_charge).toBe(40);
    expect(res.body.total).toBe(493.6);
  });

  it('rejects invalid coupons and unavailable items', async () => {
    expect((await cust.post('/api/public/coupons/validate', { branch_id: fx.A.branchId, code: 'NOPE', subtotal: 500 })).status).toBe(400);
    expect((await cust.post('/api/public/coupons/validate', { branch_id: fx.A.branchId, code: 'SAVE10', subtotal: 50 })).status).toBe(400);
    await db.update('food_items', { id: fx.food.naan }, { is_available: false });
    const res = await cust.post('/api/customer/orders', order());
    expect(res.status).toBe(400);
    await db.update('food_items', { id: fx.food.naan }, { is_available: true });
  });
});

describe('Order + online payment + invoice', () => {
  let orderId, paymentDbId;
  it('places an order and pays via the gateway (mock mode)', async () => {
    const created = await cust.post('/api/customer/orders', order({ coupon_code: 'SAVE10' }));
    expect(created.status).toBe(201);
    orderId = created.body.id;
    expect(created.body.status).toBe('pending');
    expect(created.body.total).toBe(453.6);

    const pay = await cust.post('/api/customer/payments/create', { order_id: orderId });
    expect(pay.status).toBe(200);
    expect(pay.body.mode).toBe('mock');
    expect(pay.body.amount).toBe(453.6);

    const done = await cust.post('/api/customer/payments/mock-complete', { payment_id: pay.body.payment_id, success: true });
    expect(done.status).toBe(200);
    paymentDbId = pay.body.payment_id;

    const o = await cust.get(`/api/customer/orders/${orderId}`);
    expect(o.body.payment_status).toBe('paid');
    expect(o.body.status).toBe('confirmed');
    expect(o.body.invoice_number).toMatch(/^INV-/);
  });

  it('enforces per-user coupon limits', async () => {
    const res = await cust.post('/api/customer/orders', order({ coupon_code: 'SAVE10' }));
    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/already used/);
  });

  it('streams a PDF invoice', async () => {
    const res = await cust.get(`/api/customer/orders/${orderId}/invoice.pdf`);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('application/pdf');
  });

  it('kitchen flow: assign chef -> preparing -> ready -> completed awards loyalty points', async () => {
    const a = await admin.patch(`/api/admin/orders/${orderId}/assign`, { chef_id: fx.chefId });
    expect(a.body.status).toBe('preparing');
    expect(a.body.chef_name).toBe('Chef Bob');
    expect((await admin.patch(`/api/admin/orders/${orderId}/status`, { status: 'served' })).status).toBe(400); // not ready yet
    expect((await admin.patch(`/api/admin/orders/${orderId}/status`, { status: 'ready' })).status).toBe(200);
    expect((await admin.patch(`/api/admin/orders/${orderId}/status`, { status: 'served' })).status).toBe(400); // takeaway can't be served
    expect((await admin.patch(`/api/admin/orders/${orderId}/status`, { status: 'completed' })).status).toBe(200);
    const c = await customerByEmail('cust@test.com');
    expect(c.loyalty_points).toBe(20); // floor(453.6/100)=4 * 5
    expect(c.total_spent).toBe(453.6);
  });

  it('processes a partial refund', async () => {
    const res = await admin.post(`/api/admin/payments/${paymentDbId}/refund`, { amount: 100, reason: 'Item missing' });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('partially_refunded');
    expect(res.body.refunded_amount).toBe(100);
    const tooMuch = await admin.post(`/api/admin/payments/${paymentDbId}/refund`, { amount: 1000, reason: 'Oops' });
    expect(tooMuch.status).toBe(400);
  });
});

describe('POS orders, partial payments and cancellations', () => {
  it('records partial cash then UPI payment for a dine-in order', async () => {
    const created = await admin.post('/api/admin/orders', { order_type: 'dine_in', table_id: fx.tables.t4, items: [{ food_item_id: fx.food.curry, quantity: 1 }] });
    expect(created.status).toBe(201);
    expect(created.body.status).toBe('confirmed');
    const total = created.body.total; // 200 + 5% = 210
    expect(total).toBe(210);
    const tbl = await db.byId('tables', fx.tables.t4);
    expect(tbl.status).toBe('occupied');

    const p1 = await admin.post('/api/admin/payments', { order_id: created.body.id, amount: 100, method: 'cash' });
    expect(p1.status).toBe(201);
    expect(p1.body.is_partial).toBe(true);
    const over = await admin.post('/api/admin/payments', { order_id: created.body.id, amount: 500, method: 'upi' });
    expect(over.status).toBe(400);
    const p2 = await admin.post('/api/admin/payments', { order_id: created.body.id, method: 'upi' });
    expect(p2.status).toBe(201);
    expect(p2.body.amount).toBe(110);
    const o = await admin.get(`/api/admin/orders/${created.body.id}`);
    expect(o.body.payment_status).toBe('paid');
    expect(o.body.payments).toHaveLength(2);
  });

  it('customer cancellation of a paid order refunds automatically', async () => {
    const created = await cust.post('/api/customer/orders', order());
    const pay = await cust.post('/api/customer/payments/create', { order_id: created.body.id });
    await cust.post('/api/customer/payments/mock-complete', { payment_id: pay.body.payment_id, success: true });
    const res = await cust.post(`/api/customer/orders/${created.body.id}/cancel`, { reason: 'Changed mind' });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('cancelled');
    expect(res.body.payment_status).toBe('refunded');
  });

  it('failed payments do not mark the order as paid', async () => {
    const created = await cust.post('/api/customer/orders', order());
    const pay = await cust.post('/api/customer/payments/create', { order_id: created.body.id });
    const fail = await cust.post('/api/customer/payments/mock-complete', { payment_id: pay.body.payment_id, success: false });
    expect(fail.status).toBe(400);
    const o = await cust.get(`/api/customer/orders/${created.body.id}`);
    expect(o.body.payment_status).toBe('pending');
  });
});

describe('Reviews', () => {
  it('lets a customer rate a dish and updates the average', async () => {
    const res = await cust.post('/api/customer/reviews', { branch_id: fx.A.branchId, food_item_id: fx.food.curry, rating: 4, comment: 'Tasty' });
    expect(res.status).toBe(201);
    const f = await db.byId('food_items', fx.food.curry);
    expect(f.avg_rating).toBe(4);
    expect(f.rating_count).toBe(1);
    const pub = await cust.get(`/api/public/branches/${fx.A.branchId}/reviews`);
    expect(pub.body[0].comment).toBe('Tasty');
  });
});
