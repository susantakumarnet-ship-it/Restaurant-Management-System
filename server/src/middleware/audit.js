import { db } from '../db/index.js';

const REDACT = new Set(['password', 'currentPassword', 'newPassword', 'password_hash', 'code', 'otp', 'credential', 'razorpay_signature']);

function redact(obj, depth = 0) {
  if (!obj || typeof obj !== 'object' || depth > 3) return obj;
  if (Array.isArray(obj)) return obj.slice(0, 20).map((v) => redact(v, depth + 1));
  const out = {};
  for (const [k, v] of Object.entries(obj)) out[k] = REDACT.has(k) ? '[redacted]' : redact(v, depth + 1);
  return out;
}

export async function writeAudit({ userId, branchId, action, entity, entityId, details, ip }) {
  try {
    await db.insert('audit_logs', {
      user_id: userId || null,
      branch_id: branchId || null,
      action,
      entity: entity || null,
      entity_id: entityId != null ? String(entityId) : null,
      // JSON round-trip keeps the stored value identical to what the JSONB column held (no undefined/Date objects).
      details: details ? JSON.parse(JSON.stringify(redact(details))) : null,
      ip: ip || null,
    });
  } catch (e) {
    console.error('[audit] failed', e.message);
  }
}

/**
 * Records every successful mutating admin request (POST/PUT/PATCH/DELETE) to audit_logs.
 * Mounted on /api/admin and /api/super.
 */
export const auditMutations = (req, res, next) => {
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return next();
  res.on('finish', () => {
    if (res.statusCode >= 400 || !req.user) return;
    const parts = req.path.split('/').filter(Boolean);
    const entity = parts[0] || null;
    const entityId = parts.find((p) => /^\d+$/.test(p)) || res.locals.createdId || null;
    writeAudit({
      userId: req.user.id,
      branchId: req.branchId,
      action: `${req.method} ${req.baseUrl}${req.path}`,
      entity,
      entityId,
      details: req.body && Object.keys(req.body).length ? req.body : null,
      ip: req.ip,
    });
  });
  next();
};
