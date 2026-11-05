// Quick smoke test: in-memory DB + seed + a few requests.  node scripts/smoke.js
process.env.SCHEDULER_ENABLED = 'false';
const { db, initDb } = await import('../src/db/index.js');
const { migrate } = await import('../src/db/migrate.js');
const { seed } = await import('../src/db/seed.js');
const { createApp } = await import('../src/app.js');

let t = Date.now();
await initDb({ url: '', dir: '' });
await migrate({ log: () => {} });
console.log('migrate', Date.now() - t, 'ms');
t = Date.now();
await seed({ log: () => {} });
console.log('seed', Date.now() - t, 'ms');

const app = createApp();
const server = app.listen(0);
const base = `http://127.0.0.1:${server.address().port}/api`;
const call = async (method, path, body, token, headers = {}) => {
  const res = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = text.slice(0, 80); }
  return { status: res.status, data };
};
const ok = (label, r) => console.log(r.status < 400 ? 'OK  ' : 'FAIL', r.status, label, r.status >= 400 ? JSON.stringify(r.data).slice(0, 300) : '');

const admin = await call('POST', '/auth/login', { identifier: 'admin@saffronsage.com', password: 'Admin@123' });
ok('admin login', admin);
const ctx = await call('GET', '/admin/context', null, admin.data.token);
ok('context', ctx);
const H = { 'X-Branch-Id': String(ctx.data.branches[0].id) };
for (const p of ['/admin/dashboard', '/admin/reservations', '/admin/reservations/calendar', '/admin/tables/live', '/admin/tables', '/admin/sections', '/admin/categories', '/admin/food-items', '/admin/orders', '/admin/customers', '/admin/employees', '/admin/shifts', '/admin/attendance/summary', '/admin/roles', '/admin/inventory', '/admin/inventory/alerts', '/admin/inventory/transactions', '/admin/suppliers', '/admin/payments', '/admin/payments/summary', '/admin/invoices', '/admin/coupons', '/admin/reviews', '/admin/notifications', '/admin/audit-logs', '/admin/settings', '/admin/restaurant', '/admin/branches', '/admin/reports']) {
  ok(p, await call('GET', p, null, admin.data.token, H));
}
const today = new Date().toISOString().slice(0, 10);
const from = new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10);
for (const type of ['sales_daily', 'revenue', 'bookings', 'cancelled_bookings', 'customers', 'food_sales', 'payments', 'gst', 'inventory']) {
  ok(`report ${type}`, await call('GET', `/admin/reports/${type}?from=${from}&to=${today}`, null, admin.data.token, H));
}
const sup = await call('POST', '/auth/login', { identifier: 'super@smartrms.com', password: 'Admin@123' });
for (const p of ['/super/overview', '/super/restaurants', '/super/admins', '/super/settings', '/super/audit-logs', `/super/reports/revenue?from=${from}&to=${today}`]) ok(p, await call('GET', p, null, sup.data.token));

const cust = await call('POST', '/auth/login', { identifier: 'customer@example.com', password: 'Customer@123' });
ok('customer login', cust);
const bid = ctx.data.branches[0].id;
for (const p of ['/public/branches', `/public/branches/${bid}`, `/public/branches/${bid}/menu`, `/public/branches/${bid}/offers`, `/public/branches/${bid}/reviews`]) ok(p, await call('GET', p));
const tomorrow = new Date(Date.now() + 864e5).toISOString().slice(0, 10);
const av = await call('GET', `/public/branches/${bid}/availability?date=${tomorrow}&guests=2`);
ok('availability', av);
const slot = av.data.slots.find((s) => s.available > 0);
console.log('   slots', av.data.slots.length, 'first available', slot?.time, slot?.available);
const bk = await call('POST', '/customer/bookings', { branch_id: bid, customer_name: 'Priya Sharma', phone: '9876543210', email: 'customer@example.com', date: tomorrow, time: slot.time, guests: 2, occasion: 'birthday' }, cust.data.token);
ok('create booking', bk);
for (const p of ['/customer/bookings', '/customer/orders', '/customer/notifications', '/customer/reviews', '/customer/payments']) ok(p, await call('GET', p, null, cust.data.token));
const menu = await call('GET', `/public/branches/${bid}/menu`);
const items = menu.data.items.slice(0, 2).map((i) => ({ food_item_id: i.id, quantity: 2 }));
ok('quote', await call('POST', '/public/cart/quote', { branch_id: bid, order_type: 'delivery', coupon_code: 'FLAT100', items }, cust.data.token));
const order = await call('POST', '/customer/orders', { branch_id: bid, order_type: 'takeaway', items, contact_name: 'Priya', contact_phone: '9876543210', payment_method: 'online' }, cust.data.token);
ok('create order', order);
const pay = await call('POST', '/customer/payments/create', { order_id: order.data.id }, cust.data.token);
ok('create payment', pay);
ok('mock complete', await call('POST', '/customer/payments/mock-complete', { payment_id: pay.data.payment_id, success: true }, cust.data.token));
const od = await call('GET', `/customer/orders/${order.data.id}`, null, cust.data.token);
console.log('   order payment_status', od.data.payment_status, 'invoice', od.data.invoice_number);
const pdf = await fetch(`${base}/customer/orders/${order.data.id}/invoice.pdf`, { headers: { Authorization: `Bearer ${cust.data.token}` } });
console.log(pdf.status === 200 ? 'OK  ' : 'FAIL', pdf.status, 'invoice pdf', pdf.headers.get('content-type'));
const xl = await fetch(`${base}/admin/reports/food_sales?from=${from}&to=${today}&format=xlsx`, { headers: { Authorization: `Bearer ${admin.data.token}`, ...H } });
console.log(xl.status === 200 ? 'OK  ' : 'FAIL', xl.status, 'xlsx export');
const rp = await fetch(`${base}/admin/reports/bookings?from=${from}&to=${today}&format=pdf`, { headers: { Authorization: `Bearer ${admin.data.token}`, ...H } });
console.log(rp.status === 200 ? 'OK  ' : 'FAIL', rp.status, 'pdf export');
await new Promise((r) => setTimeout(r, 300));
server.close();
await db.close();
