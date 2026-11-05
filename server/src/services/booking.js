/**
 * Smart table booking engine.
 *
 * Concurrency: every write that claims tables runs in a transaction that first takes
 * row locks (SELECT ... FOR UPDATE) on all candidate `tables` rows, then re-checks overlaps
 * against `reservation_tables`. Two concurrent requests for the same table therefore serialise:
 * the second one waits for the first to commit, then sees its rows and fails cleanly.
 *
 * Overlap rule with buffer B: existing [s1,e1) conflicts with new [s2,e2) when
 *   s1 < e2 + B  AND  e1 + B > s2
 */
import { db } from '../db/index.js';
import { badRequest, conflict, forbidden, notFound } from '../utils/http.js';
import { addMinutes, fromMinutes, localDate, localIso, makeCode, parseLocal, toMinutes } from '../utils/common.js';
import { notify } from './notify.js';

export const RES_STATUSES = ['pending', 'confirmed', 'rejected', 'checked_in', 'seated', 'completed', 'cancelled', 'no_show'];
export const ACTIVE_STATUSES = ['pending', 'confirmed', 'checked_in', 'seated'];
const RELEASING = ['rejected', 'cancelled', 'no_show'];

export const TRANSITIONS = {
  pending: ['confirmed', 'rejected', 'cancelled'],
  confirmed: ['checked_in', 'seated', 'completed', 'cancelled', 'no_show'],
  checked_in: ['seated', 'completed', 'cancelled', 'no_show'],
  seated: ['completed'],
  rejected: [],
  completed: [],
  cancelled: [],
  no_show: [],
};

export async function getBranchConfig(branchId, q = db) {
  const row = await q.one(
    `SELECT b.id, b.name, b.restaurant_id, b.opening_time, b.closing_time, b.weekly_holidays, (b.is_active AND r.is_active) AS is_active,
            b.phone AS branch_phone, r.name AS restaurant_name, s.*
       FROM restaurant_branches b
       JOIN restaurants r ON r.id = b.restaurant_id
       JOIN restaurant_settings s ON s.branch_id = b.id
      WHERE b.id = $1`,
    [branchId]
  );
  if (!row) throw notFound('Branch');
  row.id = branchId;
  return row;
}

/** All possible slot start times ('HH:mm') for a branch day, ignoring availability. */
export function generateSlots(cfg) {
  const open = toMinutes(cfg.opening_time);
  const close = toMinutes(cfg.closing_time);
  const out = [];
  for (let m = open; m + cfg.reservation_duration_min <= close; m += cfg.slot_interval_min) out.push(fromMinutes(m));
  return out;
}

/** Returns null when the date is bookable, otherwise a human-readable reason. */
export function dateClosedReason(cfg, date, { admin = false } = {}) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return 'Invalid date';
  const today = localDate();
  if (date < today) return 'Date is in the past';
  const d = parseLocal(`${date}T00:00`);
  const maxDate = localDate(addMinutes(parseLocal(`${today}T00:00`), cfg.max_advance_days * 1440));
  if (!admin && date > maxDate) return `Bookings open only ${cfg.max_advance_days} days in advance`;
  const holidays = Array.isArray(cfg.weekly_holidays) ? cfg.weekly_holidays.map(Number) : [];
  if (holidays.includes(d.getDay())) return 'Restaurant is closed on this day';
  if (!cfg.is_active) return 'This branch is not accepting bookings';
  return null;
}

function validateGuests(cfg, guests) {
  if (!Number.isInteger(guests) || guests < 1) throw badRequest('Number of guests must be at least 1');
  if (guests < cfg.min_guests) throw badRequest(`Minimum ${cfg.min_guests} guests per booking`);
  if (guests > cfg.max_guests) throw badRequest(`Maximum ${cfg.max_guests} guests per booking. Please call us for larger groups.`);
}

const overlapSql = `
  SELECT DISTINCT rt.table_id
    FROM reservation_tables rt
   WHERE rt.active
     AND rt.table_id = ANY($1::int[])
     AND rt.start_at < ($3::timestamp + make_interval(mins => $4::int))
     AND (rt.end_at + make_interval(mins => $4::int)) > $2::timestamp
     AND rt.reservation_id <> $5::int`;

async function candidateTables(q, branchId, { guests, sectionId, tableIds }) {
  if (tableIds?.length) {
    const rows = await q.many(
      `SELECT t.*, s.name AS section_name, s.location_type FROM tables t
         LEFT JOIN table_sections s ON s.id = t.section_id
        WHERE t.id = ANY($1::int[]) AND t.branch_id = $2 ORDER BY t.id`,
      [tableIds, branchId]
    );
    if (rows.length !== new Set(tableIds).size) throw badRequest('One or more selected tables do not exist in this branch');
    const bad = rows.find((t) => !t.is_active || t.status === 'maintenance');
    if (bad) throw conflict(`Table ${bad.table_number} is not available (under maintenance or inactive)`, 'TABLE_UNAVAILABLE');
    return rows;
  }
  return q.many(
    `SELECT t.*, s.name AS section_name, s.location_type FROM tables t
       LEFT JOIN table_sections s ON s.id = t.section_id
      WHERE t.branch_id = $1 AND t.is_active AND t.status <> 'maintenance'
        AND t.capacity >= $2 AND ($3::int IS NULL OR t.section_id = $3::int)
      ORDER BY t.capacity, t.min_capacity DESC, t.id`,
    [branchId, guests, sectionId || null]
  );
}

const publicTable = (t) => ({
  id: t.id,
  table_number: t.table_number,
  name: t.name,
  capacity: t.capacity,
  table_type: t.table_type,
  section_id: t.section_id,
  section_name: t.section_name,
  location_type: t.location_type,
});

/** Available time slots + tables for a date. */
export async function getAvailability({ branchId, date, guests, sectionId, excludeReservationId = 0, admin = false }) {
  const cfg = await getBranchConfig(branchId);
  guests = Number(guests);
  // Staff may look up tables for any party size (e.g. combining small tables); customers get the branch limits.
  if (admin) {
    if (!Number.isInteger(guests) || guests < 1) throw badRequest('Number of guests must be at least 1');
  } else validateGuests(cfg, guests);
  const closed = dateClosedReason(cfg, date, { admin });
  const base = { date, guests, duration_min: cfg.reservation_duration_min, buffer_min: cfg.buffer_min };
  if (closed) return { ...base, closed: true, reason: closed, slots: [] };

  const tables = await candidateTables(db, branchId, { guests, sectionId });
  const ids = tables.map((t) => t.id);
  const dayStart = `${date}T00:00:00`;
  const dayEnd = localIso(addMinutes(parseLocal(dayStart), 1440 + cfg.buffer_min));
  const blocks = ids.length
    ? await db.many(
        `SELECT table_id, start_at, end_at FROM reservation_tables
          WHERE active AND table_id = ANY($1::int[]) AND start_at < $2::timestamp
            AND end_at > ($3::timestamp - make_interval(mins => $4::int)) AND reservation_id <> $5`,
        [ids, dayEnd, dayStart, cfg.buffer_min, excludeReservationId]
      )
    : [];
  const blocksByTable = new Map();
  for (const b of blocks) {
    if (!blocksByTable.has(b.table_id)) blocksByTable.set(b.table_id, []);
    blocksByTable.get(b.table_id).push([parseLocal(b.start_at).getTime(), parseLocal(b.end_at).getTime()]);
  }
  const bufferMs = cfg.buffer_min * 60000;
  const earliest = admin ? Date.now() - cfg.reservation_duration_min * 60000 : Date.now() + cfg.min_notice_minutes * 60000;

  const slots = [];
  for (const time of generateSlots(cfg)) {
    const start = parseLocal(`${date}T${time}`).getTime();
    if (start < earliest) continue;
    const end = start + cfg.reservation_duration_min * 60000;
    const free = tables.filter((t) => !(blocksByTable.get(t.id) || []).some(([s, e]) => s < end + bufferMs && e + bufferMs > start));
    slots.push({ time, end_time: localIso(new Date(end)).slice(11, 16), available: free.length, tables: free.map(publicTable) });
  }
  return { ...base, closed: false, reason: slots.some((s) => s.available) ? null : 'No tables available for this date and party size', slots };
}

/** Lock candidate tables and pick/validate the tables to use. Must run inside a transaction. */
async function claimTables(t, cfg, { branchId, startIso, endIso, guests, sectionId, tableIds, excludeId = 0 }) {
  const candidates = await candidateTables(t, branchId, { guests, sectionId, tableIds });
  if (!candidates.length) throw conflict('No table can accommodate this party size in the selected area', 'NO_AVAILABILITY');
  const ids = candidates.map((c) => c.id);
  await t.query('SELECT id FROM tables WHERE id = ANY($1::int[]) ORDER BY id FOR UPDATE', [ids]);
  const busy = new Set((await t.many(overlapSql, [ids, startIso, endIso, cfg.buffer_min, excludeId])).map((r) => r.table_id));

  if (tableIds?.length) {
    const taken = candidates.filter((c) => busy.has(c.id));
    if (taken.length) throw conflict(`Table ${taken.map((x) => x.table_number).join(', ')} is already booked for this time`, 'TABLE_UNAVAILABLE');
    const seats = candidates.reduce((s, c) => s + c.capacity, 0);
    if (seats < guests) throw badRequest(`Selected tables seat ${seats}, but the booking is for ${guests} guests`);
    return candidates;
  }
  const free = candidates.find((c) => !busy.has(c.id));
  if (!free) throw conflict('Sorry, no tables are available for this time slot. Please choose another time.', 'NO_AVAILABILITY');
  return [free];
}

function computeTimes(cfg, date, time, { admin }) {
  if (!/^\d{2}:\d{2}$/.test(time)) throw badRequest('Invalid time');
  const closed = dateClosedReason(cfg, date, { admin });
  if (closed) throw badRequest(closed);
  const startMin = toMinutes(time);
  if (startMin < toMinutes(cfg.opening_time) || startMin + cfg.reservation_duration_min > toMinutes(cfg.closing_time)) {
    throw badRequest(`Bookings must start between ${cfg.opening_time.slice(0, 5)} and ${fromMinutes(toMinutes(cfg.closing_time) - cfg.reservation_duration_min)}`);
  }
  if (!admin && !generateSlots(cfg).includes(time)) throw badRequest('Please choose one of the available time slots');
  const start = parseLocal(`${date}T${time}`);
  const minStart = admin ? Date.now() - cfg.reservation_duration_min * 60000 : Date.now() + cfg.min_notice_minutes * 60000;
  if (start.getTime() < minStart) throw badRequest(admin ? 'This time has already passed' : `Bookings require at least ${cfg.min_notice_minutes} minutes notice`);
  const end = addMinutes(start, cfg.reservation_duration_min);
  return { startIso: localIso(start), endIso: localIso(end) };
}

async function addHistory(t, reservationId, from, to, userId, note) {
  await t.query(
    `INSERT INTO reservation_status_history(reservation_id, from_status, to_status, changed_by, note) VALUES ($1,$2,$3,$4,$5)`,
    [reservationId, from, to, userId || null, note || null]
  );
}

export async function getReservation(id, q = db) {
  const r = await q.one(
    `SELECT r.*, b.name AS branch_name, b.address AS branch_address, b.phone AS branch_phone,
            rest.name AS restaurant_name, rest.logo_url, s.name AS section_name,
            COALESCE((SELECT json_agg(json_build_object('id', t.id, 'table_number', t.table_number, 'name', t.name,
                       'capacity', t.capacity, 'section_name', ts.name) ORDER BY t.table_number)
                       FROM reservation_tables rt JOIN tables t ON t.id = rt.table_id
                       LEFT JOIN table_sections ts ON ts.id = t.section_id
                      WHERE rt.reservation_id = r.id), '[]'::json) AS tables,
            cu.user_id
       FROM reservations r
       JOIN restaurant_branches b ON b.id = r.branch_id
       JOIN restaurants rest ON rest.id = b.restaurant_id
       LEFT JOIN table_sections s ON s.id = r.section_id
       LEFT JOIN customers cu ON cu.id = r.customer_id
      WHERE r.id = $1`,
    [id]
  );
  if (!r) throw notFound('Reservation');
  return r;
}

const fmtWhen = (r) => {
  const d = parseLocal(r.start_at);
  return `${d.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })} at ${r.start_at.slice(11, 16)}`;
};

/**
 * Create a reservation.
 * @param {object} p.input {customer_name, phone, email, date, time, guests, section_id, table_ids, seating_preference, occasion, special_requests}
 * @param {object} p.actor req.user (customer or staff)
 * @param {boolean} p.admin staff-created (walk-in / phone) -> relaxed slot rules, auto confirmed
 */
export async function createReservation({ branchId, input, actor, admin = false, source }) {
  const cfg = await getBranchConfig(branchId);
  const guests = Number(input.guests);
  validateGuests(cfg, guests);
  const { startIso, endIso } = computeTimes(cfg, input.date, input.time, { admin });

  const requiresAdvance = !admin && cfg.advance_payment_required && Number(cfg.advance_payment_amount) > 0;
  let status = admin ? 'confirmed' : cfg.auto_confirm && !requiresAdvance ? 'confirmed' : 'pending';
  if (admin && input.status && ['pending', 'confirmed', 'seated'].includes(input.status)) status = input.status;
  const customerId = admin ? input.customer_id || null : actor.customer_id;
  if (!admin && !customerId) throw forbidden('Only customer accounts can make online bookings');

  const created = await db.tx(async (t) => {
    const tables = await claimTables(t, cfg, {
      branchId,
      startIso,
      endIso,
      guests,
      sectionId: input.section_id,
      tableIds: input.table_ids,
    });
    let row;
    for (let attempt = 0; attempt < 5 && !row; attempt++) {
      const code = makeCode('BK');
      row = await t.one(
        `INSERT INTO reservations(booking_code, branch_id, customer_id, customer_name, phone, email, booking_date,
            start_at, end_at, guests, section_id, seating_preference, occasion, special_requests, status, source,
            advance_amount, payment_status, admin_notes, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)
         ON CONFLICT (booking_code) DO NOTHING RETURNING id`,
        [
          code, branchId, customerId, input.customer_name, input.phone, input.email || null, input.date,
          startIso, endIso, guests, input.section_id || null, input.seating_preference || null, input.occasion || null,
          input.special_requests || null, status, source || (admin ? 'admin' : 'online'),
          requiresAdvance ? cfg.advance_payment_amount : 0, requiresAdvance ? 'pending' : 'not_required',
          admin ? input.admin_notes || null : null, actor?.id || null,
        ]
      );
    }
    for (const tb of tables) {
      await t.query(`INSERT INTO reservation_tables(reservation_id, table_id, start_at, end_at) VALUES ($1,$2,$3,$4)`, [row.id, tb.id, startIso, endIso]);
    }
    if (status === 'seated') await t.query(`UPDATE tables SET status = 'occupied' WHERE id = ANY($1::int[])`, [tables.map((x) => x.id)]);
    await addHistory(t, row.id, null, status, actor?.id, admin ? 'Created by staff' : 'Booking submitted online');
    return row;
  });

  const r = await getReservation(created.id);
  const when = fmtWhen(r);
  await notify({
    userId: r.user_id,
    branchId,
    adminFeed: !admin,
    type: status === 'confirmed' ? 'booking_confirmed' : 'booking_received',
    title: status === 'confirmed' ? `Booking confirmed - ${r.booking_code}` : `Booking request received - ${r.booking_code}`,
    message:
      status === 'confirmed'
        ? `Your table for ${guests} at ${r.restaurant_name} (${r.branch_name}) on ${when} is confirmed.`
        : `We received your booking for ${guests} guests on ${when}. ${requiresAdvance ? 'Please complete the advance payment. ' : ''}We'll notify you once it is confirmed.`,
    email: r.email,
    phone: r.phone,
    link: `/my/bookings/${r.id}`,
    adminLink: `/admin/reservations?id=${r.id}`,
    adminTitle: `New booking ${status === 'pending' ? 'request' : ''} - ${r.booking_code}`.replace('  ', ' '),
    adminMessage: `${r.customer_name} (${r.phone}) booked for ${guests} guests on ${when}. Status: ${status}${requiresAdvance ? ', advance payment pending' : ''}.`,
  });
  return r;
}

function assertCustomerCanChange(r, cfg, actor) {
  if (r.user_id !== actor.id) throw notFound('Reservation');
  if (!['pending', 'confirmed'].includes(r.status)) throw badRequest(`A ${r.status.replace('_', ' ')} booking cannot be changed`);
  const deadline = parseLocal(r.start_at).getTime() - cfg.cancellation_deadline_hours * 3600000;
  if (Date.now() > deadline) {
    throw badRequest(`Changes are allowed only up to ${cfg.cancellation_deadline_hours} hour(s) before the booking time`);
  }
}

/** Modify date/time/guests/tables/details. Customers are bound by cancellation deadline & slot rules. */
export async function modifyReservation({ id, changes, actor, admin = false }) {
  const r = await getReservation(id);
  const cfg = await getBranchConfig(r.branch_id);
  if (!admin) assertCustomerCanChange(r, cfg, actor);
  if (admin && !ACTIVE_STATUSES.includes(r.status)) throw badRequest(`A ${r.status} booking cannot be modified`);

  const date = changes.date || r.booking_date;
  const time = changes.time || r.start_at.slice(11, 16);
  const guests = changes.guests != null ? Number(changes.guests) : r.guests;
  validateGuests(cfg, guests);
  const scheduleChanged = date !== r.booking_date || time !== r.start_at.slice(11, 16) || guests !== r.guests || changes.table_ids || changes.section_id !== undefined;

  await db.tx(async (t) => {
    let startIso = r.start_at;
    let endIso = r.end_at;
    if (scheduleChanged) {
      ({ startIso, endIso } = computeTimes(cfg, date, time, { admin }));
      const sectionId = changes.section_id !== undefined ? changes.section_id : r.section_id;
      const currentIds = r.tables.map((x) => x.id);
      let tableIds = changes.table_ids;
      // Try to keep current tables when they still fit.
      if (!tableIds && currentIds.length) {
        const seats = r.tables.reduce((s, x) => s + x.capacity, 0);
        if (seats >= guests && (!sectionId || sectionId === r.section_id)) tableIds = currentIds;
      }
      let tables;
      try {
        tables = await claimTables(t, cfg, { branchId: r.branch_id, startIso, endIso, guests, sectionId, tableIds, excludeId: r.id });
      } catch (e) {
        if (changes.table_ids || !tableIds) throw e;
        tables = await claimTables(t, cfg, { branchId: r.branch_id, startIso, endIso, guests, sectionId, excludeId: r.id });
      }
      await t.query('DELETE FROM reservation_tables WHERE reservation_id = $1', [r.id]);
      for (const tb of tables) {
        await t.query(`INSERT INTO reservation_tables(reservation_id, table_id, start_at, end_at) VALUES ($1,$2,$3,$4)`, [r.id, tb.id, startIso, endIso]);
      }
    }
    const newStatus = !admin && r.status === 'confirmed' && scheduleChanged && !cfg.auto_confirm ? 'pending' : r.status;
    // Only fields present in the request are changed; an explicit null/'' clears an optional field.
    const optional = { email: changes.email, occasion: changes.occasion, special_requests: changes.special_requests, seating_preference: changes.seating_preference, section_id: changes.section_id };
    if (admin) optional.admin_notes = changes.admin_notes;
    const sets = ['booking_date = $2', 'start_at = $3', 'end_at = $4', 'guests = $5', 'status = $6', 'updated_at = now()'];
    const params = [r.id, date, startIso, endIso, guests, newStatus];
    for (const [k, v] of Object.entries({ customer_name: changes.customer_name, phone: changes.phone })) {
      if (v) (params.push(v), sets.push(`${k} = $${params.length}`));
    }
    for (const [k, v] of Object.entries(optional)) {
      if (v !== undefined) (params.push(v === '' ? null : v), sets.push(`${k} = $${params.length}`));
    }
    await t.query(`UPDATE reservations SET ${sets.join(', ')} WHERE id = $1`, params);
    await addHistory(t, r.id, r.status, newStatus, actor.id, scheduleChanged ? `Modified: ${date} ${time}, ${guests} guests` : 'Details updated');
  });

  const updated = await getReservation(id);
  if (scheduleChanged) {
    await notify({
      userId: updated.user_id,
      branchId: updated.branch_id,
      adminFeed: !admin,
      type: 'booking_modified',
      title: `Booking updated - ${updated.booking_code}`,
      message: `Your booking is now on ${fmtWhen(updated)} for ${updated.guests} guests. Status: ${updated.status}.`,
      email: updated.email,
      phone: updated.phone,
      link: `/my/bookings/${updated.id}`,
      adminLink: `/admin/reservations?id=${updated.id}`,
      adminTitle: `Booking modified - ${updated.booking_code}`,
      adminMessage: `${updated.customer_name} changed the booking to ${fmtWhen(updated)} for ${updated.guests} guests. Status: ${updated.status}.`,
    });
  }
  return updated;
}

const STATUS_MESSAGES = {
  confirmed: (r) => [`Booking confirmed - ${r.booking_code}`, `Great news! Your table for ${r.guests} at ${r.restaurant_name} on ${fmtWhen(r)} is confirmed.`],
  rejected: (r) => [`Booking update - ${r.booking_code}`, `Sorry, we are unable to accommodate your booking on ${fmtWhen(r)}.${r.admin_notes ? ' Note: ' + r.admin_notes : ''}`],
  cancelled: (r) => [`Booking cancelled - ${r.booking_code}`, `Your booking on ${fmtWhen(r)} has been cancelled.${r.cancel_reason ? ' Reason: ' + r.cancel_reason : ''}`],
  completed: (r) => [`Thanks for dining with us!`, `We hope you enjoyed your visit to ${r.restaurant_name}. We'd love your review.`],
  no_show: (r) => [`Missed booking - ${r.booking_code}`, `We missed you on ${fmtWhen(r)}. The booking has been marked as no-show.`],
};

/** Change status with transition validation and side effects (table release, occupancy, refunds, notifications). */
export async function changeStatus({ id, status, actor, note, byCustomer = false }) {
  if (!RES_STATUSES.includes(status)) throw badRequest('Invalid status');
  const r = await getReservation(id);
  const cfg = await getBranchConfig(r.branch_id);
  if (byCustomer) {
    if (status !== 'cancelled') throw forbidden();
    assertCustomerCanChange(r, cfg, actor);
  }
  if (!TRANSITIONS[r.status].includes(status)) throw badRequest(`Cannot change booking from ${r.status} to ${status}`);
  if (status === 'confirmed' && r.tables.length === 0) throw badRequest('Assign a table before confirming this booking');

  await db.tx(async (t) => {
    const locked = await t.one('SELECT status FROM reservations WHERE id = $1 FOR UPDATE', [id]);
    if (locked.status !== r.status) throw conflict('This booking was updated by someone else. Please refresh.');
    const extra = status === 'cancelled' ? ', cancelled_at = now(), cancel_reason = $3' : status === 'rejected' ? ', admin_notes = COALESCE($3, admin_notes)' : '';
    const params = [id, status];
    if (extra) params.push(note || null);
    await t.query(`UPDATE reservations SET status = $2, updated_at = now() ${extra} WHERE id = $1`, params);
    const tableIds = r.tables.map((x) => x.id);
    if (RELEASING.includes(status)) {
      await t.query('UPDATE reservation_tables SET active = false WHERE reservation_id = $1', [id]);
      if (r.status === 'seated') await t.query(`UPDATE tables SET status = 'available' WHERE id = ANY($1::int[])`, [tableIds]);
    }
    if (status === 'seated' && tableIds.length) await t.query(`UPDATE tables SET status = 'occupied' WHERE id = ANY($1::int[])`, [tableIds]);
    if (status === 'completed') {
      // Free the tables from now on (guests may leave early).
      await t.query(
        `UPDATE reservation_tables SET end_at = GREATEST(start_at + interval '1 minute', LEAST(end_at, $2::timestamp)) WHERE reservation_id = $1`,
        [id, localIso()]
      );
      if (tableIds.length) await t.query(`UPDATE tables SET status = 'available' WHERE id = ANY($1::int[])`, [tableIds]);
    }
    await addHistory(t, id, r.status, status, actor?.id, note || (byCustomer ? 'Cancelled by customer' : null));
  });

  // Refund paid advances when the booking is rejected or cancelled (within policy).
  if (['rejected', 'cancelled'].includes(status) && ['paid', 'partially_paid'].includes(r.payment_status)) {
    const { refundReservationAdvance } = await import('./payments.js');
    await refundReservationAdvance(id, actor, status === 'rejected' ? 'Booking rejected' : 'Booking cancelled');
  }

  const updated = await getReservation(id);
  const msg = STATUS_MESSAGES[status]?.(updated);
  if (msg) {
    await notify({
      userId: updated.user_id,
      branchId: updated.branch_id,
      adminFeed: byCustomer,
      type: `booking_${status}`,
      title: msg[0],
      message: msg[1],
      email: updated.email,
      phone: updated.phone,
      channels: status === 'completed' ? ['in_app', 'email'] : undefined,
      link: `/my/bookings/${updated.id}`,
      adminLink: `/admin/reservations?id=${updated.id}`,
      adminTitle: `Booking cancelled by guest - ${updated.booking_code}`,
      adminMessage: `${updated.customer_name} cancelled the booking for ${updated.guests} on ${fmtWhen(updated)}.${note ? ' Reason: ' + note : ''} The table has been released.`,
    });
  }
  return updated;
}

/** Admin: (re)assign one or more tables to a booking with overlap protection. */
export async function assignTables({ id, tableIds, actor }) {
  if (!tableIds?.length) throw badRequest('Select at least one table');
  const r = await getReservation(id);
  if (!ACTIVE_STATUSES.includes(r.status)) throw badRequest(`Cannot assign tables to a ${r.status} booking`);
  const cfg = await getBranchConfig(r.branch_id);
  await db.tx(async (t) => {
    const tables = await claimTables(t, cfg, {
      branchId: r.branch_id,
      startIso: r.start_at,
      endIso: r.end_at,
      guests: r.guests,
      tableIds,
      excludeId: r.id,
    });
    await t.query('DELETE FROM reservation_tables WHERE reservation_id = $1', [r.id]);
    for (const tb of tables) {
      await t.query(`INSERT INTO reservation_tables(reservation_id, table_id, start_at, end_at) VALUES ($1,$2,$3,$4)`, [r.id, tb.id, r.start_at, r.end_at]);
    }
    await addHistory(t, r.id, r.status, r.status, actor.id, `Tables assigned: ${tables.map((x) => x.table_number).join(', ')}`);
  });
  return getReservation(id);
}

/** Live floor status for each table at a point in time. */
export async function liveTableStatus(branchId, at = localIso()) {
  return db.many(
    `SELECT t.*, s.name AS section_name, s.location_type,
       cur.id AS current_reservation_id, cur.booking_code AS current_booking_code, cur.customer_name AS current_customer,
       cur.status AS current_reservation_status, cur.guests AS current_guests, cur.start_at AS current_start, cur.end_at AS current_end,
       nxt.id AS next_reservation_id, nxt.booking_code AS next_booking_code, nxt.start_at AS next_start, nxt.customer_name AS next_customer,
       (SELECT COUNT(*) FROM orders o WHERE o.table_id = t.id AND o.order_type = 'dine_in'
          AND o.status NOT IN ('completed','cancelled')) AS open_orders,
       CASE
         WHEN t.status = 'maintenance' THEN 'maintenance'
         WHEN t.status = 'occupied' OR cur.status IN ('seated','checked_in') THEN 'occupied'
         WHEN cur.id IS NOT NULL OR nxt.start_at < ($2::timestamp + interval '60 minutes') THEN 'reserved'
         ELSE 'available'
       END AS live_status
     FROM tables t
     LEFT JOIN table_sections s ON s.id = t.section_id
     LEFT JOIN LATERAL (
       SELECT r.* FROM reservation_tables rt JOIN reservations r ON r.id = rt.reservation_id
        WHERE rt.table_id = t.id AND rt.active AND r.status IN ('pending','confirmed','checked_in','seated')
          AND rt.start_at <= $2::timestamp AND rt.end_at > $2::timestamp
        ORDER BY rt.start_at LIMIT 1) cur ON true
     LEFT JOIN LATERAL (
       SELECT r.* FROM reservation_tables rt JOIN reservations r ON r.id = rt.reservation_id
        WHERE rt.table_id = t.id AND rt.active AND r.status IN ('pending','confirmed')
          AND rt.start_at > $2::timestamp AND r.booking_date = $3::date
        ORDER BY rt.start_at LIMIT 1) nxt ON true
     WHERE t.branch_id = $1 AND t.is_active
     ORDER BY s.name NULLS LAST, t.table_number`,
    [branchId, at, at.slice(0, 10)]
  );
}
