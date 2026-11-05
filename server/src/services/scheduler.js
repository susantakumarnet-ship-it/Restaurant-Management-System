import { db } from '../db/index.js';
import { localIso, addMinutes } from '../utils/common.js';
import { notify } from './notify.js';

/** Sends booking reminders ~3 hours before the reservation. Runs every 5 minutes. */
export async function sendBookingReminders() {
  const now = new Date();
  const rows = await db.many(
    `SELECT r.id, r.booking_code, r.start_at, r.guests, r.email, r.phone, cu.user_id, b.id AS branch_id, rest.name AS restaurant_name, b.name AS branch_name
       FROM reservations r JOIN restaurant_branches b ON b.id = r.branch_id JOIN restaurants rest ON rest.id = b.restaurant_id
       LEFT JOIN customers cu ON cu.id = r.customer_id
      WHERE r.status = 'confirmed' AND r.reminder_sent_at IS NULL AND r.start_at > $1::timestamp AND r.start_at <= $2::timestamp
      LIMIT 200`,
    [localIso(now), localIso(addMinutes(now, 180))]
  );
  for (const r of rows) {
    await db.query('UPDATE reservations SET reminder_sent_at = now() WHERE id = $1', [r.id]);
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
