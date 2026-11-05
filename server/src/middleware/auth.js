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
  const user = await db.one(
    `SELECT u.id, u.name, u.email, u.phone, u.avatar_url, u.is_active, u.email_verified, u.phone_verified,
            u.restaurant_id, u.branch_id, r.name AS role, r.display_name AS role_name, r.is_staff,
            COALESCE((SELECT array_agg(p.code) FROM role_permissions rp JOIN permissions p ON p.id = rp.permission_id
                      WHERE rp.role_id = r.id), '{}') AS permissions,
            c.id AS customer_id, c.status AS customer_status
       FROM users u JOIN roles r ON r.id = u.role_id
       LEFT JOIN customers c ON c.user_id = u.id
      WHERE u.id = $1`,
    [id]
  );
  if (user) cache.set(id, { user, at: Date.now() });
  return user;
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
    const branch = await db.one(
      `SELECT b.*, r.name AS restaurant_name, r.gstin, r.logo_url, r.is_active AS restaurant_active
         FROM restaurant_branches b JOIN restaurants r ON r.id = b.restaurant_id WHERE b.id = $1`,
      [branchId]
    );
    if (!branch) throw notFound('Branch');
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
