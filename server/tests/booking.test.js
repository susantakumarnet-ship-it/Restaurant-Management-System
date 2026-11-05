import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { generateSlots, dateClosedReason } from '../src/services/booking.js';
import { client, daysFromNow, db, login, setupApp, teardown, tomorrow } from './helpers.js';

let app, fx, cust, cust2, admin;
const booking = (over = {}) => ({ branch_id: fx.A.branchId, customer_name: 'Test Guest', phone: '9876500001', email: 'cust@test.com', date: tomorrow(), time: '19:00', guests: 2, ...over });

beforeAll(async () => {
  ({ app, fx } = await setupApp());
  cust = client(app, await login(app, 'cust@test.com'));
  cust2 = client(app, await login(app, 'cust2@test.com'));
  admin = client(app, await login(app, 'admin@test.com'), fx.A.branchId);
});
afterAll(teardown);

describe('Slot generation (unit)', () => {
  const cfg = { opening_time: '11:00:00', closing_time: '23:00:00', reservation_duration_min: 90, slot_interval_min: 30, max_advance_days: 30, weekly_holidays: [0], is_active: true };
  it('only offers slots that finish before closing', () => {
    const slots = generateSlots(cfg);
    expect(slots[0]).toBe('11:00');
    expect(slots.at(-1)).toBe('21:30');
    expect(slots).toHaveLength(22);
  });
  it('detects past dates, holidays and the advance window', () => {
    expect(dateClosedReason(cfg, '2000-01-01')).toMatch(/past/);
    expect(dateClosedReason(cfg, daysFromNow(400))).toMatch(/advance/);
    const sunday = [...Array(8)].map((_, i) => daysFromNow(i + 1)).find((d) => new Date(d + 'T00:00').getDay() === 0);
    expect(dateClosedReason(cfg, sunday)).toMatch(/closed/);
  });
});

describe('Availability & double-booking prevention', () => {
  it('shows tables that fit the party size', async () => {
    const res = await cust.get(`/api/public/branches/${fx.A.branchId}/availability?date=${tomorrow()}&guests=5`);
    expect(res.status).toBe(200);
    const slot = res.body.slots.find((s) => s.time === '19:00');
    expect(slot.tables.map((t) => t.table_number)).toEqual(['T6']);
  });

  it('auto-assigns the best fitting table and creates a pending booking with a unique ID', async () => {
    const res = await cust.post('/api/customer/bookings', booking());
    expect(res.status).toBe(201);
    expect(res.body.booking.booking_code).toMatch(/^BK-[A-Z0-9]{6}$/);
    expect(res.body.booking.status).toBe('pending');
    expect(res.body.booking.tables[0].table_number).toBe('T2');
  });

  it('rejects booking an already-booked table for an overlapping time (incl. buffer)', async () => {
    // 19:00-20:30 is taken on T2; 20:30 is inside the 15 min buffer
    const res = await cust2.post('/api/customer/bookings', booking({ time: '20:30', table_ids: [fx.tables.t2], phone: '9876500002' }));
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('TABLE_UNAVAILABLE');
    // ... but 21:00 is fine (after end + buffer)
    const later = await cust2.post('/api/customer/bookings', booking({ time: '21:00', table_ids: [fx.tables.t2], phone: '9876500002' }));
    expect(later.status).toBe(201);
  });

  it('removes booked tables from availability', async () => {
    const res = await cust.get(`/api/public/branches/${fx.A.branchId}/availability?date=${tomorrow()}&guests=2`);
    const slot = res.body.slots.find((s) => s.time === '19:30');
    expect(slot.tables.map((t) => t.table_number)).not.toContain('T2');
  });

  it('handles concurrent requests for the same table safely: exactly one wins', async () => {
    const attempts = await Promise.all(
      [...Array(6)].map(() => cust.post('/api/customer/bookings', booking({ date: daysFromNow(2), time: '13:00', table_ids: [fx.tables.t4], guests: 3 })))
    );
    const statuses = attempts.map((r) => r.status).sort();
    expect(statuses.filter((s) => s === 201)).toHaveLength(1);
    expect(statuses.filter((s) => s === 409)).toHaveLength(5);
    const rows = await db.many(
      `SELECT COUNT(*) AS n FROM reservation_tables WHERE table_id = $1 AND active AND start_at::date = $2::date`,
      [fx.tables.t4, daysFromNow(2)]
    );
    expect(rows[0].n).toBe(1);
  });

  it('returns NO_AVAILABILITY when every fitting table is taken', async () => {
    const d = daysFromNow(3);
    const first = await cust.post('/api/customer/bookings', booking({ date: d, time: '12:00', guests: 6 }));
    expect(first.status).toBe(201);
    const second = await cust2.post('/api/customer/bookings', booking({ date: d, time: '12:30', guests: 6, phone: '9876500002' }));
    expect(second.status).toBe(409);
    expect(second.body.error.code).toBe('NO_AVAILABILITY');
  });

  it('validates capacity, time slots and notice', async () => {
    expect((await cust.post('/api/customer/bookings', booking({ guests: 50 }))).status).toBe(400);
    expect((await cust.post('/api/customer/bookings', booking({ time: '19:10' }))).status).toBe(400);
    expect((await cust.post('/api/customer/bookings', booking({ time: '22:00' }))).status).toBe(400);
    expect((await cust.post('/api/customer/bookings', booking({ date: '2020-01-01' }))).status).toBe(400);
    expect((await cust.post('/api/customer/bookings', booking({ table_ids: [fx.tables.t2], guests: 4, time: '12:00' }))).status).toBe(400);
  });
});

describe('Booking lifecycle', () => {
  let id;
  it('admin confirms, customer sees status history', async () => {
    const created = await cust.post('/api/customer/bookings', booking({ date: daysFromNow(4), time: '18:00', guests: 4 }));
    id = created.body.booking.id;
    const conf = await admin.patch(`/api/admin/reservations/${id}/status`, { status: 'confirmed' });
    expect(conf.status).toBe(200);
    expect(conf.body.status).toBe('confirmed');
    const mine = await cust.get(`/api/customer/bookings/${id}`);
    expect(mine.body.history.map((h) => h.to_status)).toEqual(['pending', 'confirmed']);
  });

  it('rejects invalid transitions', async () => {
    const res = await admin.patch(`/api/admin/reservations/${id}/status`, { status: 'pending' });
    expect(res.status).toBe(400);
  });

  it('customer can modify within policy; re-checks availability', async () => {
    const res = await cust.put(`/api/customer/bookings/${id}`, { time: '19:30', guests: 4 });
    expect(res.status).toBe(200);
    expect(res.body.start_at.slice(11, 16)).toBe('19:30');
    expect(res.body.status).toBe('pending'); // needs re-approval (auto_confirm off)
  });

  it('other customers cannot see or cancel the booking', async () => {
    expect((await cust2.get(`/api/customer/bookings/${id}`)).status).toBe(404);
    expect((await cust2.post(`/api/customer/bookings/${id}/cancel`, {})).status).toBe(404);
  });

  it('cancellation releases the table', async () => {
    const res = await cust.post(`/api/customer/bookings/${id}/cancel`, { reason: 'Plans changed' });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('cancelled');
    const active = await db.one('SELECT COUNT(*) AS n FROM reservation_tables WHERE reservation_id = $1 AND active', [id]);
    expect(active.n).toBe(0);
    const again = await cust2.post('/api/customer/bookings', booking({ date: daysFromNow(4), time: '19:30', guests: 4, table_ids: [fx.tables.t4], phone: '9876500002' }));
    expect(again.status).toBe(201);
  });

  it('enforces the cancellation deadline for customers', async () => {
    // Booking that starts within the 2h deadline (inserted directly to simulate an imminent booking)
    const soon = new Date(Date.now() + 60 * 60000);
    const pad = (n) => String(n).padStart(2, '0');
    const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:00`;
    const end = new Date(soon.getTime() + 90 * 60000);
    const custRow = await db.one(`SELECT c.id FROM customers c JOIN users u ON u.id = c.user_id WHERE u.email = 'cust@test.com'`);
    const r = await db.one(
      `INSERT INTO reservations(booking_code, branch_id, customer_id, customer_name, phone, booking_date, start_at, end_at, guests, status)
       VALUES ('BK-SOON01',$1,$2,'X','9876500001',$3,$4,$5,2,'confirmed') RETURNING id`,
      [fx.A.branchId, custRow.id, iso(soon).slice(0, 10), iso(soon), iso(end)]
    );
    const res = await cust.post(`/api/customer/bookings/${r.id}/cancel`, {});
    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/hour/);
  });

  it('admin can create a walk-in booking and assign multiple tables for a large party', async () => {
    const created = await admin.post('/api/admin/reservations', { customer_name: 'Big Group', phone: '9000011111', date: daysFromNow(5), time: '20:00', guests: 10, table_ids: [fx.tables.t4, fx.tables.t6], source: 'walk_in' });
    expect(created.status).toBe(201);
    expect(created.body.status).toBe('confirmed');
    expect(created.body.tables).toHaveLength(2);
    const seated = await admin.patch(`/api/admin/reservations/${created.body.id}/status`, { status: 'seated' });
    expect(seated.status).toBe(200);
    const done = await admin.patch(`/api/admin/reservations/${created.body.id}/status`, { status: 'completed' });
    expect(done.status).toBe(200);
  });

  it('calendar and filters work', async () => {
    const cal = await admin.get(`/api/admin/reservations/calendar?month=${daysFromNow(4).slice(0, 7)}`);
    expect(cal.status).toBe(200);
    const filtered = await admin.get(`/api/admin/reservations?status=cancelled`);
    expect(filtered.body.every((r) => r.status === 'cancelled')).toBe(true);
    const search = await admin.get(`/api/admin/reservations?q=Big%20Group`);
    expect(search.body[0].customer_name).toBe('Big Group');
  });
});
