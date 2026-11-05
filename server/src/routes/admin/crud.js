import { Router } from 'express';
import { db } from '../../db/index.js';
import { ah, badRequest, notFound, validate } from '../../utils/http.js';
import { requirePerm } from '../../middleware/auth.js';
import { buildInsert, buildUpdate } from '../../utils/common.js';

/**
 * Generic tenant-scoped CRUD router.
 *  - scope 'branch'     -> rows filtered by branch_id = req.branchId
 *  - scope 'restaurant' -> rows filtered by restaurant_id = req.restaurantId
 *  - refs: foreign keys that must belong to the same tenant, e.g. { section_id: ['table_sections', 'branch'] }
 * Column names come only from the zod schema keys (never from user input), so dynamic SQL is safe.
 */
export function crud({ table, schema, scope, perm, viewPerm, json = [], search = [], filters = {}, orderBy = 't.id DESC', select = 't.*', from, refs = {}, beforeDelete, afterSave, refine }) {
  const r = Router();
  const createSchema = refine ? schema.superRefine(refine) : schema;
  const updateSchema = refine ? schema.partial().superRefine(refine) : schema.partial();
  const scopeCol = scope === 'branch' ? 'branch_id' : 'restaurant_id';
  const scopeVal = (req) => (scope === 'branch' ? req.branchId : req.restaurantId);
  const fromSql = from || `${table} t`;

  async function checkRefs(req, data) {
    for (const [col, [refTable, refScope]] of Object.entries(refs)) {
      if (data[col] == null) continue;
      const val = refScope === 'branch' ? req.branchId : req.restaurantId;
      const ok = await db.one(`SELECT id FROM ${refTable} WHERE id = $1 AND ${refScope === 'branch' ? 'branch_id' : 'restaurant_id'} = $2`, [data[col], val]);
      if (!ok) throw badRequest(`Invalid ${col.replace('_id', '')}`);
    }
  }

  async function getOne(req, id) {
    const row = await db.one(`SELECT ${select} FROM ${fromSql} WHERE t.id = $1 AND t.${scopeCol} = $2`, [id, scopeVal(req)]);
    if (!row) throw notFound(table.replace(/_/g, ' '));
    return row;
  }

  r.get(
    '/',
    requirePerm(viewPerm || perm, perm),
    ah(async (req, res) => {
      const where = [`t.${scopeCol} = $1`];
      const params = [scopeVal(req)];
      if (req.query.q && search.length) {
        params.push(`%${String(req.query.q).trim()}%`);
        where.push(`(${search.map((c) => `${c} ILIKE $${params.length}`).join(' OR ')})`);
      }
      for (const [key, col] of Object.entries(filters)) {
        if (req.query[key] !== undefined && req.query[key] !== '') {
          params.push(req.query[key]);
          where.push(`${col} = $${params.length}`);
        }
      }
      res.json(await db.many(`SELECT ${select} FROM ${fromSql} WHERE ${where.join(' AND ')} ORDER BY ${orderBy} LIMIT 1000`, params));
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
      const data = { ...req.body, [scopeCol]: scopeVal(req) };
      const { cols, placeholders, values } = buildInsert(data, { json });
      const row = await db.one(`INSERT INTO ${table} (${cols}) VALUES (${placeholders}) RETURNING id`, values);
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
      await getOne(req, id);
      await checkRefs(req, req.body);
      const { sets, values } = buildUpdate(req.body, { json, startIndex: 3 });
      if (sets.length) await db.query(`UPDATE ${table} SET ${sets.join(', ')} WHERE id = $1 AND ${scopeCol} = $2`, [id, scopeVal(req), ...values]);
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
      await db.query(`DELETE FROM ${table} WHERE id = $1 AND ${scopeCol} = $2`, [id, scopeVal(req)]);
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
