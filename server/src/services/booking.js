/**
 * Smart table booking engine.
 *
 * Concurrency: every write that claims tables runs in a MongoDB transaction that first takes
 * write locks (db.lock) on all candidate `tables` documents, then re-checks overlaps
 * against `reservation_tables`. Two concurrent requests for the same table therefore serialise:
 * the second one hits a write conflict, is retried after the first commits, then sees its rows
 * and fails cleanly.
 *
 * Overlap rule with buffer B: existing [s1,e1) conflicts with new [s2,e2) when
 *   s1 < e2 + B  AND  e1 + B > s2
 */
import { db } from '../db/index.js';
import { HttpError, badRequest, conflict, forbidden, notFound } from '../utils/http.js';
import { addMinutes, fromMinutes, localDate, localIso, makeCode, parseLocal, toLocalTs, toMinutes } from '../utils/common.js';
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

/** Shift a local 'YYYY-MM-DDTHH:mm:ss' timestamp by N minutes. */
const shiftIso = (iso, mins) => localIso(addMinutes(parseLocal(iso), mins));

/** FK existence check (PostgreSQL used to reject dangling references with 23503 -> 409 IN_USE). */
async function mustExist(col, id) {
  if (id == null) return;
  if (!(await db.exists(col, { id: Number(id) }))) {
    const e = new Error('This record is referenced by other data and cannot be removed or linked.');
    e.code = 'IN_USE';
    throw e;
  }
}

export async function getBranchConfig(branchId, q = db) { // eslint-disable-line no-unused-vars
  const b = await db.byId('restaurant_branches', branchId);
  if (!b) throw notFound('Branch');
  const r = await db.byId('restaurants', b.restaurant_id);
  const s = await db.findOne('restaurant_settings', { branch_id: b.id });
  if (!r || !s) throw notFound('Branch');
  const row = {
    id: b.id,
    name: b.name,
    restaurant_id: b.restaurant_id,
    opening_time: b.opening_time,
    closing_time: b.closing_time,
    weekly_holidays: b.weekly_holidays,
    is_active: !!(b.is_active && r.is_active),
    branch_phone: b.phone,
    restaurant_name: r.name,
    ...s,
  };
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

/** Table ids (of `ids`) that have an active booking overlapping [startIso, endIso) incl. buffer. */
async function busyTableIds(ids, startIso, endIso, bufferMin, excludeId) {
  const rows = await db.find(
    'reservation_tables',
    {
      active: true,
      table_id: { $in: ids },
      start_at: { $lt: shiftIso(endIso, bufferMin) },
      end_at: { $gt: shiftIso(startIso, -bufferMin) },
      reservation_id: { $ne: Number(excludeId) || 0 },
    },
    { projection: { table_id: 1 } }
  );
  return new Set(rows.map((r) => r.table_id));
}

async function withSections(tables) {
  const sections = await db.mapByIds('table_sections', tables.map((t) => t.section_id), { projection: { name: 1, location_type: 1 } });
  return tables.map((t) => {
    const s = sections.get(t.section_id);
    return { ...t, section_name: s ? s.name : null, location_type: s ? s.location_type : null };
  });
}

async function candidateTables(q, branchId, { guests, sectionId, tableIds }) { // eslint-disable-line no-unused-vars
  const bid = Number(branchId);
  if (tableIds?.length) {
    const wanted = [...new Set(tableIds.map(Number))];
    const rows = await withSections(await db.find('tables', { id: { $in: wanted }, branch_id: bid }, { sort: { id: 1 } }));
    if (rows.length !== new Set(tableIds).size) throw badRequest('One or more selected tables do not exist in this branch');
    const bad = rows.find((t) => !t.is_active || t.status === 'maintenance');
    if (bad) throw conflict(`Table ${bad.table_number} is not available (under maintenance or inactive)`, 'TABLE_UNAVAILABLE');
    return rows;
  }
  const filter = { branch_id: bid, is_active: true, status: { $ne: 'maintenance' }, capacity: { $gte: guests } };
  if (sectionId) filter.section_id = Number(sectionId);
  return withSections(await db.find('tables', filter, { sort: { capacity: 1, min_capacity: -1, id: 1 } }));
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
    ? await db.find(
        'reservation_tables',
        {
          active: true,
          table_id: { $in: ids },
          start_at: { $lt: dayEnd },
          end_at: { $gt: shiftIso(dayStart, -cfg.buffer_min) },
          reservation_id: { $ne: Number(excludeReservationId) || 0 },
        },
        { projection: { table_id: 1, start_at: 1, end_at: 1 } }
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
  // Replacement for SELECT ... FOR UPDATE: concurrent claimers of the same tables write-conflict and retry.
  await db.lock('tables', { id: { $in: ids } });
  const busy = await busyTableIds(ids, startIso, endIso, cfg.buffer_min, excludeId);

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

async function addHistory(t, reservationId, from, to, userId, note) { // eslint-disable-line no-unused-vars
  await db.insert('reservation_status_history', {
    reservation_id: Number(reservationId),
    from_status: from,
    to_status: to,
    changed_by: userId || null,
    note: note || null,
  });
}

async function insertReservationTables(reservationId, tables, startIso, endIso) {
  await db.insertMany(
    'reservation_tables',
    tables.map((tb) => ({ reservation_id: reservationId, table_id: tb.id, start_at: startIso, end_at: endIso }))
  );
}

export async function getReservation(id, q = db) { // eslint-disable-line no-unused-vars
  const r = await db.byId('reservations', id);
  if (!r) throw notFound('Reservation');
  const b = await db.byId('restaurant_branches', r.branch_id);
  if (!b) throw notFound('Reservation');
  const rest = await db.byId('restaurants', b.restaurant_id);
  if (!rest) throw notFound('Reservation');
  const section = r.section_id != null ? await db.byId('table_sections', r.section_id, { projection: { name: 1 } }) : null;
  const cu = r.customer_id != null ? await db.byId('customers', r.customer_id, { projection: { user_id: 1 } }) : null;

  const rts = await db.find('reservation_tables', { reservation_id: r.id }, { projection: { table_id: 1 } });
  const tmap = await db.mapByIds('tables', rts.map((x) => x.table_id));
  const smap = await db.mapByIds('table_sections', [...tmap.values()].map((t) => t.section_id), { projection: { name: 1 } });
  const tables = rts
    .map((x) => tmap.get(x.table_id))
    .filter(Boolean)
    .map((t) => ({ id: t.id, table_number: t.table_number, name: t.name, capacity: t.capacity, section_name: smap.get(t.section_id)?.name ?? null }))
    .sort((a, z) => (a.table_number < z.table_number ? -1 : a.table_number > z.table_number ? 1 : 0));

  return {
    ...r,
    branch_name: b.name,
    branch_address: b.address,
    branch_phone: b.phone,
    restaurant_name: rest.name,
    logo_url: rest.logo_url,
    section_name: section ? section.name : null,
    tables,
    user_id: cu ? cu.user_id : null,
  };
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

  const created = await db.tx(async () => {
    const tables = await claimTables(null, cfg, {
      branchId,
      startIso,
      endIso,
      guests,
      sectionId: input.section_id,
      tableIds: input.table_ids,
    });
    await mustExist('customers', customerId);
    await mustExist('table_sections', input.section_id || null);
    // A duplicate key inside a transaction aborts it, so pick a free code first (ON CONFLICT DO NOTHING retry).
    let code = makeCode('BK');
    for (let attempt = 0; attempt < 4 && (await db.exists('reservations', { booking_code: code })); attempt++) code = makeCode('BK');
    const row = await db.insert('reservations', {
      booking_code: code,
      branch_id: Number(branchId),
      customer_id: customerId != null ? Number(customerId) : null,
      customer_name: input.customer_name,
      phone: input.phone,
      email: input.email || null,
      booking_date: input.date,
      start_at: startIso,
      end_at: endIso,
      guests,
      section_id: input.section_id ? Number(input.section_id) : null,
      seating_preference: input.seating_preference || null,
      occasion: input.occasion || null,
      special_requests: input.special_requests || null,
      status,
      source: source || (admin ? 'admin' : 'online'),
      advance_amount: requiresAdvance ? Number(cfg.advance_payment_amount) : 0,
      payment_status: requiresAdvance ? 'pending' : 'not_required',
      admin_notes: admin ? input.admin_notes || null : null,
      created_by: actor?.id || null,
    });
    await insertReservationTables(row.id, tables, startIso, endIso);
    if (status === 'seated') await db.updateMany('tables', { id: { $in: tables.map((x) => x.id) } }, { status: 'occupied' });
    await addHistory(null, row.id, null, status, actor?.id, admin ? 'Created by staff' : 'Booking submitted online');
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

  await db.tx(async () => {
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
        tables = await claimTables(null, cfg, { branchId: r.branch_id, startIso, endIso, guests, sectionId, tableIds, excludeId: r.id });
      } catch (e) {
        // Database errors (e.g. transient write conflicts) abort the transaction: let db.tx retry it.
        if (changes.table_ids || !tableIds || !(e instanceof HttpError)) throw e;
        tables = await claimTables(null, cfg, { branchId: r.branch_id, startIso, endIso, guests, sectionId, excludeId: r.id });
      }
      await db.remove('reservation_tables', { reservation_id: r.id });
      await insertReservationTables(r.id, tables, startIso, endIso);
    }
    const newStatus = !admin && r.status === 'confirmed' && scheduleChanged && !cfg.auto_confirm ? 'pending' : r.status;
    // Only fields present in the request are changed; an explicit null/'' clears an optional field.
    const optional = { email: changes.email, occasion: changes.occasion, special_requests: changes.special_requests, seating_preference: changes.seating_preference, section_id: changes.section_id };
    if (admin) optional.admin_notes = changes.admin_notes;
    const set = { booking_date: date, start_at: startIso, end_at: endIso, guests, status: newStatus, updated_at: new Date() };
    for (const [k, v] of Object.entries({ customer_name: changes.customer_name, phone: changes.phone })) {
      if (v) set[k] = v;
    }
    for (const [k, v] of Object.entries(optional)) {
      if (v !== undefined) set[k] = v === '' ? null : v;
    }
    if (set.section_id != null) {
      set.section_id = Number(set.section_id);
      await mustExist('table_sections', set.section_id);
    }
    await db.update('reservations', { id: r.id }, { $set: set });
    await addHistory(null, r.id, r.status, newStatus, actor.id, scheduleChanged ? `Modified: ${date} ${time}, ${guests} guests` : 'Details updated');
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

  await db.tx(async () => {
    const set = { status, updated_at: new Date() };
    if (status === 'cancelled') Object.assign(set, { cancelled_at: new Date(), cancel_reason: note || null });
    else if (status === 'rejected' && note) set.admin_notes = note;
    // Guarded transition (replaces SELECT ... FOR UPDATE + status re-check).
    const moved = await db.findOneAndUpdate('reservations', { id: r.id, status: r.status }, { $set: set }, { projection: { id: 1 } });
    if (!moved) throw conflict('This booking was updated by someone else. Please refresh.');
    const tableIds = r.tables.map((x) => x.id);
    if (RELEASING.includes(status)) {
      await db.updateMany('reservation_tables', { reservation_id: r.id }, { active: false });
      if (r.status === 'seated') await db.updateMany('tables', { id: { $in: tableIds } }, { status: 'available' });
    }
    if (status === 'seated' && tableIds.length) await db.updateMany('tables', { id: { $in: tableIds } }, { status: 'occupied' });
    if (status === 'completed') {
      // Free the tables from now on (guests may leave early): end_at = GREATEST(start_at + 1 min, LEAST(end_at, now)).
      const nowIso = localIso();
      const rts = await db.find('reservation_tables', { reservation_id: r.id }, { projection: { table_id: 1, start_at: 1, end_at: 1 } });
      for (const rt of rts) {
        const least = rt.end_at < nowIso ? rt.end_at : nowIso;
        const minEnd = shiftIso(rt.start_at, 1);
        const end = least > minEnd ? least : minEnd;
        if (end !== rt.end_at) await db.update('reservation_tables', { reservation_id: r.id, table_id: rt.table_id }, { end_at: end });
      }
      if (tableIds.length) await db.updateMany('tables', { id: { $in: tableIds } }, { status: 'available' });
    }
    await addHistory(null, r.id, r.status, status, actor?.id, note || (byCustomer ? 'Cancelled by customer' : null));
  });

  // Refund paid advances when the booking is rejected or cancelled (within policy).
  if (['rejected', 'cancelled'].includes(status) && ['paid', 'partially_paid'].includes(r.payment_status)) {
    const { refundReservationAdvance } = await import('./payments.js');
    await refundReservationAdvance(r.id, actor, status === 'rejected' ? 'Booking rejected' : 'Booking cancelled');
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
  await db.tx(async () => {
    const tables = await claimTables(null, cfg, {
      branchId: r.branch_id,
      startIso: r.start_at,
      endIso: r.end_at,
      guests: r.guests,
      tableIds,
      excludeId: r.id,
    });
    await db.remove('reservation_tables', { reservation_id: r.id });
    await insertReservationTables(r.id, tables, r.start_at, r.end_at);
    await addHistory(null, r.id, r.status, r.status, actor.id, `Tables assigned: ${tables.map((x) => x.table_number).join(', ')}`);
  });
  return getReservation(id);
}

/** Live floor status for each table at a point in time. */
export async function liveTableStatus(branchId, at = localIso()) {
  at = toLocalTs(at);
  const day = at.slice(0, 10);
  const nextDay = localDate(addMinutes(parseLocal(`${day}T00:00:00`), 1440 + 60));
  const tables = await withSections(await db.find('tables', { branch_id: Number(branchId), is_active: true }));
  const ids = tables.map((t) => t.id);
  if (!ids.length) return [];

  // Candidate bookings: running at `at`, or starting later (next ones are limited to the same booking_date).
  const rts = await db.find(
    'reservation_tables',
    {
      table_id: { $in: ids },
      active: true,
      $or: [{ start_at: { $lte: at }, end_at: { $gt: at } }, { start_at: { $gt: at, $lt: `${nextDay}T00:00:00` } }],
    },
    { sort: { start_at: 1 } }
  );
  const resMap = await db.mapByIds('reservations', rts.map((x) => x.reservation_id));
  const openOrders = await db.aggregate('orders', [
    { $match: { table_id: { $in: ids }, order_type: 'dine_in', status: { $nin: ['completed', 'cancelled'] } } },
    { $group: { _id: '$table_id', n: { $sum: 1 } } },
  ]);
  const openByTable = new Map(openOrders.map((o) => [o._id, o.n]));

  const curStatuses = ['pending', 'confirmed', 'checked_in', 'seated'];
  const nextStatuses = ['pending', 'confirmed'];
  const soon = shiftIso(at, 60);

  const out = tables.map((t) => {
    const mine = rts.filter((x) => x.table_id === t.id);
    const curRt = mine.find((x) => x.start_at <= at && x.end_at > at && curStatuses.includes(resMap.get(x.reservation_id)?.status));
    const nxtRt = mine.find((x) => {
      const rs = resMap.get(x.reservation_id);
      return x.start_at > at && rs && nextStatuses.includes(rs.status) && rs.booking_date === day;
    });
    const cur = curRt ? resMap.get(curRt.reservation_id) : null;
    const nxt = nxtRt ? resMap.get(nxtRt.reservation_id) : null;
    let live;
    if (t.status === 'maintenance') live = 'maintenance';
    else if (t.status === 'occupied' || (cur && ['seated', 'checked_in'].includes(cur.status))) live = 'occupied';
    else if (cur || (nxt && nxt.start_at < soon)) live = 'reserved';
    else live = 'available';
    return {
      ...t,
      current_reservation_id: cur ? cur.id : null,
      current_booking_code: cur ? cur.booking_code : null,
      current_customer: cur ? cur.customer_name : null,
      current_reservation_status: cur ? cur.status : null,
      current_guests: cur ? cur.guests : null,
      current_start: cur ? cur.start_at : null,
      current_end: cur ? cur.end_at : null,
      next_reservation_id: nxt ? nxt.id : null,
      next_booking_code: nxt ? nxt.booking_code : null,
      next_start: nxt ? nxt.start_at : null,
      next_customer: nxt ? nxt.customer_name : null,
      open_orders: openByTable.get(t.id) || 0,
      live_status: live,
    };
  });
  // ORDER BY s.name NULLS LAST, t.table_number
  const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
  out.sort((a, b) => {
    if (a.section_name == null && b.section_name != null) return 1;
    if (a.section_name != null && b.section_name == null) return -1;
    return cmp(a.section_name ?? '', b.section_name ?? '') || cmp(a.table_number, b.table_number);
  });
  return out;
}
