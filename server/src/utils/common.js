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

/** Build a dynamic UPDATE SET clause from a whitelisted, already-validated object. */
export function buildUpdate(data, { json = [], startIndex = 1 } = {}) {
  const keys = Object.keys(data).filter((k) => data[k] !== undefined);
  const sets = keys.map((k, i) => `${k} = $${i + startIndex}${json.includes(k) ? '::text::jsonb' : ''}`);
  const values = keys.map((k) => (json.includes(k) ? JSON.stringify(data[k]) : data[k]));
  return { sets, values, keys };
}

export function buildInsert(data, { json = [] } = {}) {
  const keys = Object.keys(data).filter((k) => data[k] !== undefined);
  const placeholders = keys.map((k, i) => `$${i + 1}${json.includes(k) ? '::text::jsonb' : ''}`);
  const values = keys.map((k) => (json.includes(k) ? JSON.stringify(data[k]) : data[k]));
  return { cols: keys.join(', '), placeholders: placeholders.join(', '), values };
}

export const slugify = (s) =>
  String(s)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
    .slice(0, 150);
