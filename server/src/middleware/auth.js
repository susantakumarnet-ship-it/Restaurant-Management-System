import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import { db } from '../db/index.js';
import { forbidden, unauthorized, badRequest, notFound } from '../utils/http.js';

export const signToken = (user) => jwt.sign({ sub: user.id, role: user.role }, config.jwtSecret, { expiresIn: config.jwtExpiresIn });

// Small cache so permission changes apply within seconds without a DB hit per request.
const cache = new Map();
const TTL = 15_000;
export const clearAuthCache = (userId) => (userId ? cache.delete(userId) : cache.clear());

export async function loadAuthUser(id) {
  const hit = cache.get(id);
  if (hit && hit.at > Date.now() - TTL) return hit.user;
  const user = await fetchAuthUser(id);
  if (user) cache.set(id, { user, at: Date.now() });
  return user;
}

async function fetchAuthUser(id) {
  const uid = Number(id);
  if (!Number.isFinite(uid)) return null;
  const u = await db.findOne('users', { id: uid }, {
    projection: { id: 1, name: 1, email: 1, phone: 1, avatar_url: 1, is_active: 1, email_verified: 1, phone_verified: 1, restaurant_id: 1, branch_id: 1, role_id: 1 },
  });
  if (!u) return null;
  const r = await db.byId('roles', u.role_id, { projection: { id: 1, name: 1, display_name: 1, is_staff: 1 } });
  if (!r) return null; // inner join on roles
  const [rps, c] = await Promise.all([
    db.find('role_permissions', { role_id: r.id }, { projection: { permission_id: 1 } }),
    db.findOne('customers', { user_id: u.id }, { projection: { id: 1, status: 1 } }),
  ]);
  const perms = rps.length ? await db.find('permissions', { id: { $in: rps.map((x) => x.permission_id) } }, { projection: { code: 1 } }) : [];
  return {
    id: u.id,
    name: u.name,
    email: u.email,
    phone: u.phone ?? null,
    avatar_url: u.avatar_url ?? null,
    is_active: u.is_active,
    email_verified: u.email_verified,
    phone_verified: u.phone_verified,
    restaurant_id: u.restaurant_id ?? null,
    branch_id: u.branch_id ?? null,
    role: r.name,
    role_name: r.display_name,
    is_staff: r.is_staff,
    permissions: perms.map((p) => p.code),
    customer_id: c ? c.id : null,
    customer_status: c ? c.status : null,
  };
}

async function resolveUser(req) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return null;
  let payload;
  try {
    payload = jwt.verify(token, config.jwtSecret);
  } catch {
    throw unauthorized('Session expired. Please log in again.');
  }
  const user = await loadAuthUser(payload.sub);
  if (!user || !user.is_active) throw unauthorized('Account is disabled or no longer exists.');
  // Blocking a customer takes effect immediately, even for already-issued tokens.
  if (user.customer_status === 'blocked') throw forbidden('Your account has been blocked. Please contact the restaurant.');
  return user;
}

export const authenticate = async (req, _res, next) => {
  try {
    const user = await resolveUser(req);
    if (!user) throw unauthorized();
    req.user = user;
    next();
  } catch (e) {
    next(e);
  }
};

export const optionalAuth = async (req, _res, next) => {
  try {
    req.user = (await resolveUser(req)) || null;
    next();
  } catch {
    req.user = null;
    next();
  }
};

export const requireRole = (...roles) => (req, _res, next) => {
  if (!req.user) return next(unauthorized());
  if (!roles.includes(req.user.role)) return next(forbidden());
  next();
};

export const requireStaff = (req, _res, next) => {
  if (!req.user) return next(unauthorized());
  if (!req.user.is_staff) return next(forbidden('Staff access only'));
  next();
};

export const hasPerm = (user, perm) => user?.role === 'super_admin' || user?.permissions?.includes(perm);

/** Require ANY of the listed permissions. */
export const requirePerm = (...perms) => (req, _res, next) => {
  if (!req.user) return next(unauthorized());
  if (perms.some((p) => hasPerm(req.user, p))) return next();
  next(forbidden());
};

/**
 * Resolves the branch the admin request operates on (X-Branch-Id header or ?branchId=)
 * and enforces tenant isolation: staff may only touch branches of their own restaurant
 * (and only their own branch if they are pinned to one).
 */
export const branchScope = async (req, _res, next) => {
  try {
    const raw = req.headers['x-branch-id'] || req.query.branchId;
    const branchId = parseInt(raw, 10);
    if (!branchId) throw badRequest('Branch not selected (X-Branch-Id header required)');
    const b = await db.byId('restaurant_branches', branchId);
    const r = b ? await db.byId('restaurants', b.restaurant_id, { projection: { name: 1, gstin: 1, logo_url: 1, is_active: 1 } }) : null;
    if (!b || !r) throw notFound('Branch');
    const branch = { ...b, restaurant_name: r.name, gstin: r.gstin ?? null, logo_url: r.logo_url ?? null, restaurant_active: r.is_active };
    assertBranchAccess(req.user, branch);
    req.branch = branch;
    req.branchId = branch.id;
    req.restaurantId = branch.restaurant_id;
    next();
  } catch (e) {
    next(e);
  }
};

export function assertBranchAccess(user, branch) {
  if (user.role === 'super_admin') return;
  if (!user.restaurant_id || user.restaurant_id !== branch.restaurant_id) throw forbidden('You do not have access to this branch');
  if (user.branch_id && user.branch_id !== branch.id) throw forbidden('You do not have access to this branch');
}
