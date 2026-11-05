import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { client, db, login, setupApp, teardown } from './helpers.js';

// Regression tests for the MongoDB transaction / locking paths (db.tx, db.lock, guarded updates).
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
  items: [{ food_item_id: fx.food.curry, quantity: 1 }],
  contact_name: 'Cust',
  contact_phone: '9876500001',
  payment_method: 'cash',
  ...over,
});

describe('Concurrency', () => {
  it('never exceeds a coupon usage limit under simultaneous orders', async () => {
    const cp = await admin.post('/api/admin/coupons', { code: 'RACE3', title: 'Race', discount_type: 'flat', discount_value: 10, usage_limit: 3 });
    expect(cp.status).toBe(201);
    const results = await Promise.all([...Array(8)].map(() => cust.post('/api/customer/orders', order({ coupon_code: 'RACE3' }))));
    expect(results.filter((r) => r.status === 201)).toHaveLength(3);
    expect((await db.byId('coupons', cp.body.id)).used_count).toBe(3);
  });

  it('counts a payment once when it is completed several times at once', async () => {
    const o = await cust.post('/api/customer/orders', order({ payment_method: 'online' }));
    const pay = await cust.post('/api/customer/payments/create', { order_id: o.body.id });
    expect(pay.status).toBe(200);
    await Promise.all([...Array(5)].map(() => cust.post('/api/customer/payments/mock-complete', { payment_id: pay.body.payment_id, success: true })));
    const after = await db.byId('orders', o.body.id);
    expect(after.payment_status).toBe('paid');
    expect(after.amount_paid).toBe(after.total);
    expect(await db.count('payments', { order_id: o.body.id, status: 'success' })).toBe(1);
    expect(await db.count('invoices', { order_id: o.body.id })).toBe(1);
  });

  it('does not overpay an order with simultaneous manual payments', async () => {
    const o = await admin.post('/api/admin/orders', order());
    expect(o.status).toBe(201);
    const results = await Promise.all([...Array(5)].map(() => admin.post('/api/admin/payments', { order_id: o.body.id, method: 'cash' })));
    expect(results.filter((r) => r.status === 201)).toHaveLength(1);
    const after = await db.byId('orders', o.body.id);
    expect(after.amount_paid).toBe(after.total);
  });

  it('never takes stock below zero with simultaneous stock-outs', async () => {
    const item = await admin.post('/api/admin/inventory', { name: 'Race Flour', unit: 'kg', quantity: 10, min_quantity: 1, cost_per_unit: 10 });
    expect(item.status).toBe(201);
    const results = await Promise.all(
      [...Array(6)].map(() => admin.post('/api/admin/inventory/transactions', { inventory_item_id: item.body.id, type: 'stock_out', quantity: 3 }))
    );
    expect(results.filter((r) => r.status === 201)).toHaveLength(3);
    expect((await db.byId('inventory_items', item.body.id)).quantity).toBe(1);
  });

  it('creates one account for simultaneous registrations with the same email', async () => {
    const results = await Promise.all(
      [...Array(4)].map((_, i) => client(app).post('/api/auth/register', { name: 'Racer', email: 'race@test.com', phone: `90001000${i}0`, password: 'Race@12345' }))
    );
    expect(results.filter((r) => r.status === 201)).toHaveLength(1);
    expect(await db.count('users', { email: 'race@test.com' })).toBe(1);
  });
});
