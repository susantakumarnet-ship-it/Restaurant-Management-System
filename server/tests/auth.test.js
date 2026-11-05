import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { client, db, login, setupApp, teardown } from './helpers.js';

let app, fx;
beforeAll(async () => ({ app, fx } = await setupApp()));
afterAll(teardown);

describe('Registration, OTP & login', () => {
  const newUser = { name: 'New Person', email: 'new@test.com', phone: '9123456789', password: 'Secret123' };

  it('rejects weak passwords and invalid input', async () => {
    const res = await request(app).post('/api/auth/register').send({ ...newUser, password: 'short' });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('registers, requires OTP verification, then logs in', async () => {
    const reg = await request(app).post('/api/auth/register').send(newUser);
    expect(reg.status).toBe(201);
    expect(reg.body.devOtp).toMatch(/^\d{6}$/);

    // Unverified customers cannot log in
    const blocked = await request(app).post('/api/auth/login').send({ identifier: newUser.email, password: newUser.password });
    expect(blocked.status).toBe(403);
    expect(blocked.body.error.code).toBe('UNVERIFIED');

    const otp = (await db.one(`SELECT COUNT(*) AS n FROM otp_codes WHERE user_id = (SELECT id FROM users WHERE email = $1) AND used_at IS NULL`, [newUser.email])).n;
    expect(otp).toBe(1);

    const wrong = await request(app).post('/api/auth/verify-otp').send({ identifier: newUser.email, code: '000000' });
    expect(wrong.status).toBe(400);

    const code = blocked.body.error.details?.devOtp || reg.body.devOtp;
    const ok = await request(app).post('/api/auth/verify-otp').send({ identifier: newUser.email, code });
    expect(ok.status).toBe(200);
    expect(ok.body.token).toBeTruthy();
    expect(ok.body.user.role).toBe('customer');
    expect(ok.body.user.customer_id).toBeTruthy();

    // login with mobile number works too
    const byPhone = await request(app).post('/api/auth/login').send({ identifier: newUser.phone, password: newUser.password });
    expect(byPhone.status).toBe(200);
  });

  it('prevents duplicate accounts', async () => {
    const res = await request(app).post('/api/auth/register').send(newUser);
    expect(res.status).toBe(409);
  });

  it('rejects bad credentials without revealing which part is wrong', async () => {
    const res = await request(app).post('/api/auth/login').send({ identifier: 'cust@test.com', password: 'nope' });
    expect(res.status).toBe(401);
    expect(res.body.error.message).toBe('Invalid credentials');
  });

  it('resets a forgotten password with an OTP', async () => {
    const f = await request(app).post('/api/auth/forgot-password').send({ identifier: 'cust2@test.com' });
    expect(f.status).toBe(200);
    const r = await request(app).post('/api/auth/reset-password').send({ identifier: 'cust2@test.com', code: f.body.devOtp, password: 'NewPass123' });
    expect(r.status).toBe(200);
    await login(app, 'cust2@test.com', 'NewPass123');
  });

  it('does not reveal whether an account exists on forgot-password', async () => {
    const f = await request(app).post('/api/auth/forgot-password').send({ identifier: 'ghost@test.com' });
    expect(f.status).toBe(200);
    expect(f.body.devOtp).toBeUndefined();
  });

  it('returns and updates the profile', async () => {
    const token = await login(app, 'cust@test.com');
    const c = client(app, token);
    const upd = await c.put('/api/auth/me', { name: 'Cust Updated', address: '1 Street' });
    expect(upd.status).toBe(200);
    expect(upd.body.user.name).toBe('Cust Updated');
    const me = await c.get('/api/auth/me');
    expect(me.body.customer.address).toBe('1 Street');
  });
});

describe('Authorization (JWT + RBAC + tenant isolation)', () => {
  it('requires a token for protected routes', async () => {
    expect((await request(app).get('/api/customer/bookings')).status).toBe(401);
    expect((await request(app).get('/api/admin/context').set('Authorization', 'Bearer garbage')).status).toBe(401);
  });

  it('blocks customers from the admin API', async () => {
    const token = await login(app, 'cust@test.com');
    const res = await client(app, token, fx.A.branchId).get('/api/admin/dashboard');
    expect(res.status).toBe(403);
  });

  it('enforces permissions per role (waiter cannot manage menu)', async () => {
    const token = await login(app, 'waiter@test.com');
    const c = client(app, token, fx.A.branchId);
    expect((await c.get('/api/admin/reservations')).status).toBe(200);
    expect((await c.post('/api/admin/categories', { name: 'Hack' })).status).toBe(403);
    expect((await c.get('/api/admin/reports/sales_daily?from=2026-01-01&to=2026-01-31')).status).toBe(403);
  });

  it("prevents an admin from touching another restaurant's branch", async () => {
    const token = await login(app, 'adminb@test.com');
    const res = await client(app, token, fx.A.branchId).get('/api/admin/tables');
    expect(res.status).toBe(403);
  });

  it('only super admins can use the super admin API', async () => {
    const admin = await login(app, 'admin@test.com');
    expect((await client(app, admin).get('/api/super/overview')).status).toBe(403);
    const sup = await login(app, 'super@test.com');
    const res = await client(app, sup).get('/api/super/overview');
    expect(res.status).toBe(200);
    expect(res.body.totals.restaurants).toBe(2);
  });

  it('role permissions are platform-wide: only super admins may change them', async () => {
    const admin = client(app, await login(app, 'admin@test.com'), fx.A.branchId);
    const roles = await admin.get('/api/admin/roles');
    const waiter = roles.body.roles.find((r) => r.name === 'waiter');
    const denied = await admin.put(`/api/admin/roles/${waiter.id}/permissions`, { permissions: [...waiter.permissions, 'menu.manage'] });
    expect(denied.status).toBe(403);
    const sup = client(app, await login(app, 'super@test.com'), fx.A.branchId);
    const res = await sup.put(`/api/admin/roles/${waiter.id}/permissions`, { permissions: [...waiter.permissions, 'menu.manage'] });
    expect(res.status).toBe(200);
    const waiterToken = await login(app, 'waiter@test.com');
    const created = await client(app, waiterToken, fx.A.branchId).post('/api/admin/categories', { name: 'Specials' });
    expect(created.status).toBe(201);
  });
});
