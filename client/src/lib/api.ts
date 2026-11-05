/**
 * Thin fetch wrapper for the REST API.
 * - Adds the JWT and (for admin calls) the selected branch header.
 * - Throws ApiError with the server's friendly message.
 */
const BASE = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, '') || '';
const TOKEN_KEY = 'rms_token';
const BRANCH_KEY = 'rms_admin_branch';

export class ApiError extends Error {
  status: number;
  code?: string;
  details?: any;
  constructor(status: number, message: string, code?: string, details?: any) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

const safeGet = (k: string) => {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
};
const safeSet = (k: string, v: string | null) => {
  try {
    if (v == null) localStorage.removeItem(k);
    else localStorage.setItem(k, v);
  } catch {
    /* storage unavailable */
  }
};

export const tokenStore = {
  get: () => safeGet(TOKEN_KEY),
  set: (t: string | null) => safeSet(TOKEN_KEY, t),
};
export const adminBranchStore = {
  get: () => {
    const v = safeGet(BRANCH_KEY);
    return v ? Number(v) : null;
  },
  set: (id: number | null) => safeSet(BRANCH_KEY, id == null ? null : String(id)),
};

let onUnauthorized: (() => void) | null = null;
export const setUnauthorizedHandler = (fn: () => void) => (onUnauthorized = fn);

type Opts = { method?: string; body?: any; params?: Record<string, any>; branch?: boolean; signal?: AbortSignal };

function buildUrl(path: string, params?: Record<string, any>) {
  const url = `${BASE}/api${path}`;
  if (!params) return url;
  const qs = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== '') qs.append(k, String(v));
  });
  const s = qs.toString();
  return s ? `${url}?${s}` : url;
}

function headers(branch: boolean, json = true) {
  const h: Record<string, string> = {};
  if (json) h['Content-Type'] = 'application/json';
  const t = tokenStore.get();
  if (t) h.Authorization = `Bearer ${t}`;
  if (branch) {
    const b = adminBranchStore.get();
    if (b) h['X-Branch-Id'] = String(b);
  }
  return h;
}

async function handle(res: Response) {
  if (res.status === 204) return null;
  const text = await res.text();
  let data: any = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  if (!res.ok) {
    if (res.status === 401 && onUnauthorized && tokenStore.get()) onUnauthorized();
    const e = data?.error;
    throw new ApiError(res.status, e?.message || `Request failed (${res.status})`, e?.code, e?.details);
  }
  return data;
}

export async function request<T = any>(path: string, { method = 'GET', body, params, branch = false, signal }: Opts = {}): Promise<T> {
  const res = await fetch(buildUrl(path, params), { method, headers: headers(branch), body: body !== undefined ? JSON.stringify(body) : undefined, signal });
  return handle(res);
}

export const api = {
  get: <T = any>(path: string, params?: Record<string, any>) => request<T>(path, { params }),
  post: <T = any>(path: string, body?: any) => request<T>(path, { method: 'POST', body: body ?? {} }),
  put: <T = any>(path: string, body?: any) => request<T>(path, { method: 'PUT', body }),
  patch: <T = any>(path: string, body?: any) => request<T>(path, { method: 'PATCH', body }),
  delete: <T = any>(path: string) => request<T>(path, { method: 'DELETE' }),
};

/** Admin API: paths are relative to /admin and automatically send the selected branch. */
export const adminApi = {
  get: <T = any>(path: string, params?: Record<string, any>) => request<T>(`/admin${path}`, { params, branch: true }),
  post: <T = any>(path: string, body?: any) => request<T>(`/admin${path}`, { method: 'POST', body: body ?? {}, branch: true }),
  put: <T = any>(path: string, body?: any) => request<T>(`/admin${path}`, { method: 'PUT', body, branch: true }),
  patch: <T = any>(path: string, body?: any) => request<T>(`/admin${path}`, { method: 'PATCH', body, branch: true }),
  delete: <T = any>(path: string) => request<T>(`/admin${path}`, { method: 'DELETE', branch: true }),
};

/** Upload image files; returns public URLs. */
export async function uploadFiles(files: File[] | FileList): Promise<string[]> {
  const fd = new FormData();
  Array.from(files).forEach((f) => fd.append('files', f));
  const res = await fetch(buildUrl('/uploads'), { method: 'POST', headers: headers(false, false), body: fd });
  const data = await handle(res);
  return data.urls;
}

/** Download an authenticated file (PDF / Excel). */
export async function downloadFile(path: string, params?: Record<string, any>, opts: { branch?: boolean; filename?: string } = {}) {
  const res = await fetch(buildUrl(path, params), { headers: headers(!!opts.branch, false) });
  if (!res.ok) await handle(res);
  const blob = await res.blob();
  const cd = res.headers.get('Content-Disposition') || '';
  const name = opts.filename || /filename="?([^"]+)"?/.exec(cd)?.[1] || 'download';
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Resolve an image URL from the API (relative /uploads paths) or external. */
export const assetUrl = (u?: string | null) => (!u ? '' : u.startsWith('/uploads') ? `${BASE}${u}` : u);
