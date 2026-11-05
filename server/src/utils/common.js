import crypto from 'node:crypto';

const ALPHA = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
/** Human friendly unique-ish code, e.g. BK-7G3K9Q. Uniqueness is enforced by DB constraints. */
export function makeCode(prefix, len = 6) {
  const bytes = crypto.randomBytes(len);
  let s = '';
  for (let i = 0; i < len; i++) s += ALPHA[bytes[i] % ALPHA.length];
  return `${prefix}-${s}`;
}

export const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

const pad = (n) => String(n).padStart(2, '0');

/** Local wall-clock 'YYYY-MM-DDTHH:mm:ss' for a Date (server TZ = restaurant TZ; set TZ env). */
export function localIso(d = new Date()) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}
export const localDate = (d = new Date()) => localIso(d).slice(0, 10);

/** Parse 'YYYY-MM-DDTHH:mm[:ss]' (local) into a Date. */
export function parseLocal(s) {
  const [date, time = '00:00:00'] = String(s).replace(' ', 'T').split('T');
  const [y, m, d] = date.split('-').map(Number);
  const [hh, mm, ss = 0] = time.split(':').map(Number);
  return new Date(y, m - 1, d, hh, mm, ss || 0);
}

export const addMinutes = (d, mins) => new Date(d.getTime() + mins * 60000);
export const toMinutes = (hhmm) => {
  const [h, m] = String(hhmm).split(':').map(Number);
  return h * 60 + (m || 0);
};
export const fromMinutes = (mins) => `${pad(Math.floor(mins / 60))}:${pad(mins % 60)}`;

/** Copy of an already-validated object without undefined values (safe for $set / insert). */
export function definedOnly(data) {
  const out = {};
  for (const [k, v] of Object.entries(data)) if (v !== undefined) out[k] = v;
  return out;
}

/** Normalise a TIME value to 'HH:mm:ss' (what PostgreSQL used to return). */
export const toTime = (v) => {
  if (v == null || v === '') return v;
  const [h = '0', m = '0', s = '0'] = String(v).split(':');
  return `${pad(Number(h))}:${pad(Number(m))}:${pad(Number(s))}`;
};

/** Normalise a local TIMESTAMP value to 'YYYY-MM-DDTHH:mm:ss'. Accepts Date or string. */
export const toLocalTs = (v) => (v == null ? v : v instanceof Date ? localIso(v) : localIso(parseLocal(v)));

/** Throw a 422 INVALID_VALUE (replacement for PostgreSQL CHECK constraint violations). */
export function invalid(message = 'One or more values are invalid.') {
  const e = new Error(message);
  e.code = 'INVALID_VALUE';
  return e;
}

/** Case-insensitive "contains" filter value for user search input (replacement for ILIKE '%q%'). */
export const ilike = (q) => ({ $regex: String(q).trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' });

export const slugify = (s) =>
  String(s)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
    .slice(0, 150);
