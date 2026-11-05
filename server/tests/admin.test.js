import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { client, db, login, setupApp, teardown, tomorrow } from './helpers.js';

let app, fx, admin;
beforeAll(async () => {
  ({ app, fx } = await setupApp());
  admin = client(app, await login(app, 'admin@test.com'), fx.A.branchId);
});
afterAll(teardown);

describe('Admin CRUD', () => {
  it('creates, updates and deletes a table with validation', async () => {
    const bad = await admin.post('/api/admin/tables', { table_number: 'X1', capacity: 0, table_type: '2_seater' });
    expect(bad.status).toBe(422);
    const created = await admin.post('/api/admin/tables', { table_number: 'X1', capacity: 2, table_type: '2_seater', section_id: fx.sectionId });
    expect(created.status).toBe(201);
    expect(created.body.section_name).toBe('Hall');
    const dup = await admin.post('/api/admin/tables', { table_number: 'X1', capacity: 2, table_type: '2_seater' });
    expect(dup.status).toBe(409);
    const upd = await admin.put(`/api/admin/tables/${created.body.id}`, { capacity: 4, table_type: '4_seater' });
    expect(upd.body.capacity).toBe(4);
    expect((await admin.delete(`/api/admin/tables/${created.body.id}`)).status).toBe(200);
  });

  it('rejects foreign keys from another tenant', async () => {
    const other = await db.one(`INSERT INTO table_sections(branch_id, name) VALUES ($1,'Foreign') RETURNING id`, [fx.B.branchId]);
    const res = await admin.post('/api/admin/tables', { table_number: 'X2', capacity: 2, table_type: '2_seater', section_id: other.id });
    expect(res.status).toBe(400);
  });

  it('blocks deleting a table with upcoming bookings', async () => {
    await admin.post('/api/admin/reservations', { customer_name: 'Hold', phone: '9000022222', date: tomorrow(), time: '13:00', guests: 6, table_ids: [fx.tables.t6] });
    const res = await admin.delete(`/api/admin/tables/${fx.tables.t6}`);
    expect(res.status).toBe(409);
  });

  it('manages menu items with images and price validation', async () => {
    const cat = await admin.post('/api/admin/categories', { name: 'Desserts' });
    const bad = await admin.post('/api/admin/food-items', { category_id: cat.body.id, name: 'Cake', price: 100, discounted_price: 150, diet_type: 'veg' });
    expect(bad.status).toBe(400);
    const item = await admin.post('/api/admin/food-items', { category_id: cat.body.id, name: 'Cake', price: 150, discounted_price: 120, diet_type: 'veg', images: ['/uploads/a.jpg', '/uploads/b.jpg'], is_bestseller: true });
    expect(item.status).toBe(201);
    expect(item.body.images).toEqual(['/uploads/a.jpg', '/uploads/b.jpg']);
    const menu = await admin.get(`/api/public/branches/${fx.A.branchId}/menu`);
    expect(menu.body.items.find((i) => i.name === 'Cake').discounted_price).toBe(120);
    const del = await admin.delete(`/api/admin/categories/${cat.body.id}`);
    expect(del.status).toBe(409); // category not empty
  });

  it('validates coupon business rules', async () => {
    const res = await admin.post('/api/admin/coupons', { code: 'BIG', title: 'Too big', discount_type: 'percent', discount_value: 150 });
    expect(res.status).toBe(422);
    const ok = await admin.post('/api/admin/coupons', { code: 'party-25', title: 'Party', discount_type: 'flat', discount_value: 25 });
    expect(ok.status).toBe(201);
    expect(ok.body.code).toBe('PARTY-25');
  });

  it('updates booking settings with cross-field validation', async () => {
    const bad = await admin.put('/api/admin/settings', { min_guests: 10, max_guests: 2 });
    expect(bad.status).toBe(400);
    const ok = await admin.put('/api/admin/settings', { reservation_duration_min: 120, buffer_min: 10 });
    expect(ok.body.reservation_duration_min).toBe(120);
  });
});

describe('Inventory', () => {
  it('tracks stock movements and blocks negative stock', async () => {
    const item = await admin.post('/api/admin/inventory', { name: 'Rice', unit: 'kg', quantity: 10, min_quantity: 5, cost_per_unit: 50 });
    expect(item.status).toBe(201);
    const out = await admin.post('/api/admin/inventory/transactions', { inventory_item_id: item.body.id, type: 'stock_out', quantity: 6 });
    expect(out.status).toBe(201);
    expect(out.body.balance_after).toBe(4);
    const tooMuch = await admin.post('/api/admin/inventory/transactions', { inventory_item_id: item.body.id, type: 'stock_out', quantity: 50 });
    expect(tooMuch.status).toBe(400);
    const alerts = await admin.get('/api/admin/inventory/alerts');
    expect(alerts.body.low.map((i) => i.name)).toContain('Rice');
    const feed = await admin.get('/api/admin/notifications');
    expect(feed.body.items.some((n) => n.type === 'low_stock')).toBe(true);
    const inAgain = await admin.post('/api/admin/inventory/transactions', { inventory_item_id: item.body.id, type: 'stock_in', quantity: 20, unit_cost: 55 });
    expect(inAgain.body.balance_after).toBe(24);
  });
});

describe('Staff', () => {
  it('creates an employee, a login account and a shift with check-in', async () => {
    const emp = await admin.post('/api/admin/employees', { name: 'New Cashier', position: 'cashier', phone: '9111111111' });
    expect(emp.status).toBe(201);
    const acc = await admin.post(`/api/admin/employees/${emp.body.id}/account`, { email: 'cashier.new@test.com', password: 'Cashier123', role: 'cashier' });
    expect(acc.status).toBe(200);
    expect(acc.body.login_role).toBe('cashier');
    await login(app, 'cashier.new@test.com', 'Cashier123');
    const shift = await admin.post('/api/admin/shifts', { employee_id: emp.body.id, shift_date: tomorrow(), start_time: '10:00', end_time: '18:00', repeat_days: 2 });
    expect(shift.status).toBe(201);
    expect(shift.body).toHaveLength(3);
    const ci = await admin.post(`/api/admin/shifts/${shift.body[0].id}/check-in`);
    expect(['present', 'late']).toContain(ci.body.attendance_status);
  });
});

describe('Dashboard, reports & audit', () => {
  it('returns dashboard cards and charts', async () => {
    const res = await admin.get('/api/admin/dashboard');
    expect(res.status).toBe(200);
    expect(res.body.cards.total_tables).toBeGreaterThan(0);
    expect(res.body.charts.daily_revenue.length).toBeGreaterThanOrEqual(7);
  });

  it('exports reports as JSON, Excel and PDF', async () => {
    const q = `from=2026-01-01&to=${tomorrow()}`;
    const json = await admin.get(`/api/admin/reports/bookings?${q}`);
    expect(json.status).toBe(200);
    expect(json.body.columns.length).toBeGreaterThan(3);
    const xlsx = await admin.get(`/api/admin/reports/gst?${q}&format=xlsx`);
    expect(xlsx.headers['content-type']).toMatch(/spreadsheetml/);
    const pdf = await admin.get(`/api/admin/reports/inventory?${q}&format=pdf`);
    expect(pdf.headers['content-type']).toBe('application/pdf');
    expect((await admin.get(`/api/admin/reports/unknown?${q}`)).status).toBe(400);
  });

  it('writes audit logs for admin mutations', async () => {
    await new Promise((r) => setTimeout(r, 50));
    const logs = await admin.get('/api/admin/audit-logs');
    expect(logs.status).toBe(200);
    expect(logs.body.some((l) => l.action.includes('POST /api/admin/tables'))).toBe(true);
    const withPassword = logs.body.find((l) => l.action.includes('/account'));
    expect(withPassword.details.password).toBe('[redacted]');
  });
});
