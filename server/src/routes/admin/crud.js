import { Router } from 'express';
import { db } from '../../db/index.js';
import { ah, badRequest, notFound, validate } from '../../utils/http.js';
import { requirePerm } from '../../middleware/auth.js';
import { definedOnly, ilike } from '../../utils/common.js';

const isIntField = (f) => f === 'id' || f.endsWith('_id');

/** Coerce a query-string filter value to the stored type. */
function coerce(v, type) {
  if (type === 'int') return /^-?\d+$/.test(String(v).trim()) ? parseInt(v, 10) : NaN;
  if (type === 'number') return Number(v);
  if (type === 'bool') return v === true || v === 'true' || v === '1';
  return String(v);
}

/**
 * Generic tenant-scoped CRUD router (MongoDB).
 *  - scope 'branch'     -> documents filtered by branch_id = req.branchId
 *  - scope 'restaurant' -> documents filtered by restaurant_id = req.restaurantId
 *  - sort:    Mongo sort spec, e.g. { name: 1 } (default { id: -1 })
 *  - search:  fields matched case-insensitively (ILIKE '%q%') with ?q=, e.g. ['name', 'phone']
 *  - filters: { queryKey: field } or { queryKey: { field, type: 'int'|'number'|'bool'|'string' } };
 *             with the string form, fields named id / *_id are compared as integers.
 *  - enrich:  async (rows, req) => rows  - adds joined / computed fields (what SELECT/JOIN used to provide).
 *             Applied to list results and to getOne (so beforeDelete / responses see the fields).
 *  - check:   (merged, req) => void  - cross-field rule run on create (body) and update (current + body);
 *             replacement for table CHECK constraints (throw invalid(...)).
 *  - collation: sort collation (default { locale: 'en' } ~ PostgreSQL en_US ordering)
 *  - refs: foreign keys that must belong to the same tenant, e.g. { section_id: ['table_sections', 'branch'] }
 * Field names come only from the zod schema keys (never from user input).
 */
export function crud({
  table,
  schema,
  scope,
  perm,
  viewPerm,
  search = [],
  filters = {},
  sort = { id: -1 },
  collation = { locale: 'en' },
  enrich,
  check,
  refs = {},
  beforeDelete,
  afterSave,
  refine,
}) {
  const r = Router();
  const createSchema = refine ? schema.superRefine(refine) : schema;
  const updateSchema = refine ? schema.partial().superRefine(refine) : schema.partial();
  const scopeCol = scope === 'branch' ? 'branch_id' : 'restaurant_id';
  const scopeVal = (req) => (scope === 'branch' ? req.branchId : req.restaurantId);
  const doEnrich = async (rows, req) => (enrich && rows.length ? (await enrich(rows, req)) || rows : rows);

  async function checkRefs(req, data) {
    for (const [col, [refTable, refScope]] of Object.entries(refs)) {
      if (data[col] == null) continue;
      const val = refScope === 'branch' ? req.branchId : req.restaurantId;
      const ok = await db.exists(refTable, { id: Number(data[col]), [refScope === 'branch' ? 'branch_id' : 'restaurant_id']: val });
      if (!ok) throw badRequest(`Invalid ${col.replace('_id', '')}`);
    }
  }

  async function getOne(req, id) {
    const row = await db.findOne(table, { id: Number(id), [scopeCol]: scopeVal(req) });
    if (!row) throw notFound(table.replace(/_/g, ' '));
    return (await doEnrich([row], req))[0];
  }

  r.get(
    '/',
    requirePerm(viewPerm || perm, perm),
    ah(async (req, res) => {
      const filter = { [scopeCol]: scopeVal(req) };
      if (req.query.q && search.length) {
        const rx = ilike(req.query.q);
        filter.$or = search.map((f) => ({ [f]: rx }));
      }
      for (const [key, spec] of Object.entries(filters)) {
        const v = req.query[key];
        if (v !== undefined && v !== '') {
          const field = typeof spec === 'string' ? spec : spec.field;
          const type = typeof spec === 'string' ? (isIntField(field) ? 'int' : 'string') : spec.type || 'string';
          filter[field] = coerce(v, type);
        }
      }
      const rows = await db.find(table, filter, { sort, limit: 1000, ...(collation ? { collation } : {}) });
      res.json(await doEnrich(rows, req));
    })
  );

  r.get(
    '/:id(\\d+)',
    requirePerm(viewPerm || perm, perm),
    ah(async (req, res) => res.json(await getOne(req, parseInt(req.params.id, 10))))
  );

  r.post(
    '/',
    requirePerm(perm),
    validate(createSchema),
    ah(async (req, res) => {
      await checkRefs(req, req.body);
      if (check) await check({ ...req.body }, req);
      const row = await db.insert(table, { ...definedOnly(req.body), [scopeCol]: scopeVal(req) });
      res.locals.createdId = row.id;
      if (afterSave) await afterSave(req, row.id, req.body);
      res.status(201).json(await getOne(req, row.id));
    })
  );

  r.put(
    '/:id(\\d+)',
    requirePerm(perm),
    validate(updateSchema),
    ah(async (req, res) => {
      const id = parseInt(req.params.id, 10);
      const cur = await getOne(req, id);
      await checkRefs(req, req.body);
      const data = definedOnly(req.body);
      if (check) await check({ ...cur, ...data }, req);
      if (Object.keys(data).length) await db.update(table, { id, [scopeCol]: scopeVal(req) }, { $set: data });
      if (afterSave) await afterSave(req, id, req.body);
      res.json(await getOne(req, id));
    })
  );

  r.delete(
    '/:id(\\d+)',
    requirePerm(perm),
    ah(async (req, res) => {
      const id = parseInt(req.params.id, 10);
      const row = await getOne(req, id);
      if (beforeDelete) await beforeDelete(req, row);
      await db.remove(table, { id, [scopeCol]: scopeVal(req) });
      res.json({ ok: true });
    })
  );

  r.getOne = getOne;
  return r;
}

/** Shared zod helpers for admin forms (accept '' from HTML inputs as null). */
import { z } from 'zod';
export const zs = {
  str: (max = 200) => z.string().trim().max(max),
  optStr: (max = 500) => z.string().trim().max(max).nullable().optional().transform((v) => (v === '' ? null : v)),
  optNum: () => z.union([z.number(), z.literal(''), z.null()]).optional().transform((v) => (v === '' ? null : v)),
  optInt: () => z.union([z.number().int(), z.literal(''), z.null()]).optional().transform((v) => (v === '' ? null : v)),
  optDate: () => z.union([z.string().regex(/^\d{4}-\d{2}-\d{2}$/), z.literal(''), z.null()]).optional().transform((v) => (v === '' ? null : v)),
  time: () => z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/, 'Invalid time'),
};
