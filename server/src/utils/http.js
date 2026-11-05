import { ZodError } from 'zod';

export class HttpError extends Error {
  constructor(status, message, code, details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const badRequest = (msg, details) => new HttpError(400, msg, 'BAD_REQUEST', details);
export const unauthorized = (msg = 'Authentication required') => new HttpError(401, msg, 'UNAUTHORIZED');
export const forbidden = (msg = 'You do not have permission to perform this action') => new HttpError(403, msg, 'FORBIDDEN');
export const notFound = (what = 'Resource') => new HttpError(404, `${what} not found`, 'NOT_FOUND');
export const conflict = (msg, code = 'CONFLICT') => new HttpError(409, msg, code);

/** Wrap async route handlers so rejections reach the error middleware. */
export const ah = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

/** Validate req.body / req.query with a zod schema; replaces it with the parsed (stripped, coerced) value. */
export const validate = (schema, source = 'body') => (req, _res, next) => {
  const result = schema.safeParse(req[source] ?? {});
  if (!result.success) return next(result.error);
  if (source === 'query') req.validQuery = result.data;
  else req[source] = result.data;
  next();
};

export function errorHandler(err, req, res, _next) {
  if (err instanceof ZodError) {
    return res.status(422).json({
      error: { code: 'VALIDATION_ERROR', message: err.issues[0]?.message ? `${err.issues[0].path.join('.') || 'input'}: ${err.issues[0].message}` : 'Invalid input', details: err.issues },
    });
  }
  if (err instanceof HttpError) {
    return res.status(err.status).json({ error: { code: err.code, message: err.message, details: err.details } });
  }
  if (err?.type === 'entity.parse.failed') {
    return res.status(400).json({ error: { code: 'BAD_JSON', message: 'Malformed JSON body' } });
  }
  if (err?.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({ error: { code: 'FILE_TOO_LARGE', message: 'File too large' } });
  }
  // MongoDB / data-layer errors -> friendly 4xx
  if (err?.code === 11000) return res.status(409).json({ error: { code: 'DUPLICATE', message: duplicateMessage(err) } });
  if (err?.code === 'IN_USE') return res.status(409).json({ error: { code: 'IN_USE', message: 'This record is referenced by other data and cannot be removed or linked.' } });
  if (err?.code === 'INVALID_VALUE' || err?.code === 121) {
    return res.status(422).json({ error: { code: 'INVALID_VALUE', message: err.message && err.code === 'INVALID_VALUE' ? err.message : 'One or more values are invalid.' } });
  }
  console.error('[error]', req.method, req.originalUrl, err?.message || err);
  res.status(500).json({ error: { code: 'INTERNAL', message: 'Something went wrong. Please try again.' } });
}

function duplicateMessage(err) {
  const c = `${Object.keys(err.keyPattern || {}).join(' ')} ${err.message || ''}`;
  if (c.includes('email')) return 'An account with this email already exists.';
  if (c.includes('phone')) return 'An account with this mobile number already exists.';
  if (c.includes('code')) return 'This code is already in use.';
  if (c.includes('table_number')) return 'A table with this number already exists.';
  return 'A record with the same unique value already exists.';
}

/** Pagination helper from query string. */
export function paging(q, defLimit = 50) {
  const limit = Math.min(Math.max(parseInt(q.limit, 10) || defLimit, 1), 500);
  const page = Math.max(parseInt(q.page, 10) || 1, 1);
  return { limit, offset: (page - 1) * limit, page };
}
