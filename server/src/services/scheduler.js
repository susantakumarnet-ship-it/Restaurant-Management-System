import { db } from '../db/index.js';
import { localIso, addMinutes } from '../utils/common.js';
import { notify } from './notify.js';

/** Sends booking reminders ~3 hours before the reservation. Runs every 5 minutes. */
export async function sendBookingReminders() {
  const now = new Date();
  const found = await db.find(
    'reservations',
    { status: 'confirmed', reminder_sent_at: null, start_at: { $gt: localIso(now), $lte: localIso(addMinutes(now, 180)) } },
    { limit: 200, projection: { id: 1, booking_code: 1, start_at: 1, guests: 1, email: 1, phone: 1, branch_id: 1, customer_id: 1 } }
  );
  const branches = await db.mapByIds('restaurant_branches', found.map((r) => r.branch_id), { projection: { name: 1, restaurant_id: 1 } });
  const restaurants = await db.mapByIds('restaurants', [...branches.values()].map((b) => b.restaurant_id), { projection: { name: 1 } });
  const customers = await db.mapByIds('customers', found.map((r) => r.customer_id), { projection: { user_id: 1 } });
  const rows = [];
  for (const r of found) {
    const b = branches.get(r.branch_id);
    const rest = b && restaurants.get(b.restaurant_id);
    if (!b || !rest) continue; // inner joins
    rows.push({
      id: r.id, booking_code: r.booking_code, start_at: r.start_at, guests: r.guests, email: r.email ?? null, phone: r.phone ?? null,
      user_id: customers.get(r.customer_id)?.user_id ?? null, branch_id: b.id, restaurant_name: rest.name, branch_name: b.name,
    });
  }
  for (const r of rows) {
    await db.update('reservations', { id: r.id }, { $set: { reminder_sent_at: new Date() } });
    await notify({
      userId: r.user_id,
      branchId: r.branch_id,
      type: 'booking_reminder',
      title: `Reminder: your table at ${r.start_at.slice(11, 16)} today`,
      message: `See you soon at ${r.restaurant_name} (${r.branch_name})! Booking ${r.booking_code} for ${r.guests} guests at ${r.start_at.slice(11, 16)}.`,
      email: r.email,
      phone: r.phone,
      link: `/my/bookings/${r.id}`,
    });
  }
  return rows.length;
}

export function startScheduler() {
  const tick = () => sendBookingReminders().catch((e) => console.error('[scheduler]', e.message));
  setTimeout(tick, 5000);
  return setInterval(tick, 5 * 60 * 1000);
}
