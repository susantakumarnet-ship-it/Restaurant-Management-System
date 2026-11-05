export const money = (n: number | string | null | undefined, opts: { decimals?: boolean } = {}) => {
  const v = Number(n || 0);
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: opts.decimals === false ? 0 : v % 1 === 0 ? 0 : 2,
    maximumFractionDigits: opts.decimals === false ? 0 : 2,
  }).format(v);
};

export const compactMoney = (n: number | string) => {
  const v = Number(n || 0);
  if (v >= 1e7) return `₹${(v / 1e7).toFixed(1)}Cr`;
  if (v >= 1e5) return `₹${(v / 1e5).toFixed(1)}L`;
  if (v >= 1e3) return `₹${(v / 1e3).toFixed(1)}k`;
  return `₹${Math.round(v)}`;
};

/** 'YYYY-MM-DD' -> Date at local midnight (avoids UTC shift). */
export const parseDate = (s: string) => {
  const [y, m, d] = s.slice(0, 10).split('-').map(Number);
  return new Date(y, m - 1, d);
};

export const fmtDate = (s?: string | null, opts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short', year: 'numeric' }) => {
  if (!s) return '-';
  const d = /^\d{4}-\d{2}-\d{2}$/.test(s) ? parseDate(s) : /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(s) ? new Date(s) : new Date(s);
  return isNaN(d.getTime()) ? s : d.toLocaleDateString('en-IN', opts);
};

export const fmtDateTime = (s?: string | null) => {
  if (!s) return '-';
  const d = new Date(s);
  return isNaN(d.getTime()) ? s : d.toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
};

/** Local reservation timestamp 'YYYY-MM-DDTHH:mm:ss' -> 'HH:mm' (no timezone conversion). */
export const fmtTime = (s?: string | null) => {
  if (!s) return '-';
  const t = s.includes('T') ? s.split('T')[1] : s;
  const [h, m] = t.split(':').map(Number);
  const ampm = h >= 12 ? 'PM' : 'AM';
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${ampm}`;
};

export const timeAgo = (s: string) => {
  const diff = (Date.now() - new Date(s).getTime()) / 1000;
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 604800) return `${Math.floor(diff / 86400)}d ago`;
  return fmtDate(s);
};

const pad = (n: number) => String(n).padStart(2, '0');
export const toDateInput = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const addDays = (d: Date, n: number) => {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
};

export const titleCase = (s?: string | null) => (s ? s.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()) : '');

type Tone = 'gray' | 'amber' | 'green' | 'red' | 'blue' | 'purple' | 'teal' | 'orange';
export const STATUS_TONE: Record<string, Tone> = {
  // reservations
  pending: 'amber', confirmed: 'blue', rejected: 'red', checked_in: 'teal', seated: 'purple', completed: 'green', cancelled: 'gray', no_show: 'red',
  // orders
  preparing: 'orange', ready: 'teal', served: 'purple', delivered: 'purple',
  // payments
  paid: 'green', success: 'green', partially_paid: 'amber', failed: 'red', refunded: 'gray', partially_refunded: 'amber', not_required: 'gray',
  // tables / misc
  available: 'green', occupied: 'red', reserved: 'amber', maintenance: 'gray', active: 'green', blocked: 'red', inactive: 'gray',
  low: 'red', expiring: 'amber', ok: 'green', present: 'green', late: 'amber', absent: 'red', leave: 'blue', scheduled: 'gray',
  on_leave: 'blue', terminated: 'gray', sent: 'green', logged: 'blue', trial: 'blue', past_due: 'red',
};

export const TONE_CLASS: Record<Tone, string> = {
  gray: 'bg-ink-100 text-ink-700 ring-ink-200',
  amber: 'bg-amber-50 text-amber-800 ring-amber-200',
  green: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  red: 'bg-red-50 text-red-700 ring-red-200',
  blue: 'bg-sky-50 text-sky-700 ring-sky-200',
  purple: 'bg-violet-50 text-violet-700 ring-violet-200',
  teal: 'bg-teal-50 text-teal-700 ring-teal-200',
  orange: 'bg-orange-50 text-orange-700 ring-orange-200',
};

export const OCCASIONS = [
  { value: 'birthday', label: 'Birthday' },
  { value: 'anniversary', label: 'Anniversary' },
  { value: 'business', label: 'Business Meeting' },
  { value: 'family', label: 'Family Dinner' },
  { value: 'date', label: 'Date Night' },
  { value: 'other', label: 'Other' },
];

export const DIET_LABEL: Record<string, string> = { veg: 'Veg', non_veg: 'Non-Veg', vegan: 'Vegan' };
