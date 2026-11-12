/**
 * MongoDB data layer.
 *
 * - MONGODB_URI set   -> connects to that server (MongoDB Atlas in production).
 * - otherwise (dev)   -> starts a local single-node replica set via mongodb-memory-server,
 *                        persisted in MONGO_DATA_DIR (zero install). Tests use an ephemeral one.
 *
 * Documents keep integer `id` fields (from the `counters` collection) so the REST API is unchanged.
 * `_id` is never returned. Transactions: `await db.tx(async () => { ...db calls... })` - every db.*
 * call made inside the callback automatically joins the transaction (AsyncLocalStorage).
 * The callback may be retried on transient write conflicts, so keep side effects (notifications,
 * emails) outside of it.
 */
import fs from 'node:fs';
import { AsyncLocalStorage } from 'node:async_hooks';
import { MongoClient } from 'mongodb';
import { config } from '../config.js';
import { COLLECTIONS, INBOUND } from './schema.js';

export const TIMEZONE = process.env.TZ || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';

let client = null;
let database = null;
let memServer = null;
let driverName = null;
const als = new AsyncLocalStorage();

export class DbError extends Error {
  constructor(message, code, extra = {}) {
    super(message);
    this.name = 'DbError';
    this.code = code;
    Object.assign(this, extra);
  }
}

/**
 * Percent-encode the username/password in a connection string, so a password pasted with raw
 * special characters (e.g. "p@ss") still works. Already-encoded values are left unchanged.
 */
export function normalizeMongoUri(uri) {
  const s = String(uri).trim();
  const m = s.match(/^(mongodb(?:\+srv)?:\/\/)([^/?#]*)(.*)$/s);
  if (!m) return s;
  const [, scheme, authority, rest] = m;
  const at = authority.lastIndexOf('@');
  if (at < 0) return s;
  const cred = authority.slice(0, at);
  const host = authority.slice(at + 1);
  const colon = cred.indexOf(':');
  const enc = (v) => {
    let decoded = v;
    try { decoded = decodeURIComponent(v); } catch { /* raw % in password: encode as-is */ }
    return encodeURIComponent(decoded);
  };
  const userinfo = colon < 0 ? enc(cred) : `${enc(cred.slice(0, colon))}:${enc(cred.slice(colon + 1))}`;
  return `${scheme}${userinfo}@${host}${rest}`;
}

export async function initDb({ uri = config.mongoUri, dbName = config.mongoDbName, dataDir = config.mongoDataDir } = {}) {
  if (database) return database;
  if (!uri) {
    if (config.isProd) throw new Error('MONGODB_URI must be set in production (e.g. your MongoDB Atlas connection string; URL-encode special characters in the password, @ -> %40)');
    const { MongoMemoryReplSet } = await import('mongodb-memory-server');
    const instanceOpts = [{ storageEngine: 'wiredTiger', ...(dataDir ? { dbPath: dataDir } : {}) }];
    if (dataDir) fs.mkdirSync(dataDir, { recursive: true });
    memServer = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' }, instanceOpts });
    await memServer.waitUntilRunning();
    uri = memServer.getUri();
    driverName = dataDir ? 'mongodb-local' : 'mongodb-memory';
  } else {
    driverName = 'mongodb';
    uri = normalizeMongoUri(uri);
  }
  client = new MongoClient(uri, { maxPoolSize: parseInt(process.env.DB_POOL_MAX || '10', 10) });
  await client.connect();
  database = client.db(dbName);
  return database;
}

function getDb() {
  if (!database) throw new Error('Database not initialised. Call initDb() first.');
  return database;
}

// Fire-and-forget work started inside a tx (e.g. notifications) can outlive it: an ended session is ignored.
const session = () => {
  const s = als.getStore();
  return s && !s.hasEnded ? s : undefined;
};
const withSession = (opts = {}) => {
  const s = session();
  return s ? { ...opts, session: s } : opts;
};
const strip = (projection) => {
  if (!projection) return { _id: 0, _lock: 0 };
  const inclusive = Object.values(projection).some((v) => v === 1 || v === true || typeof v === 'object' || typeof v === 'string');
  return inclusive ? { _id: 0, ...projection } : { _id: 0, _lock: 0, ...projection };
};

function applyDefaults(name, doc) {
  const defs = COLLECTIONS[name]?.defaults || {};
  const out = {};
  for (const [k, v] of Object.entries(defs)) out[k] = typeof v === 'function' ? v() : v;
  for (const [k, v] of Object.entries(doc)) if (v !== undefined) out[k] = v;
  return out;
}

/** Escape user input for use inside a $regex. */
export const escapeRegex = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export const db = {
  get driver() {
    return driverName;
  },

  /** Raw driver collection (pass db.opts() to calls so they join the current transaction). */
  col: (name) => getDb().collection(name),
  /** Driver options carrying the current transaction session, if any. */
  opts: withSession,
  /** True when executing inside db.tx(). */
  get inTx() {
    return !!session();
  },

  async nextId(name, count = 1) {
    const r = await getDb().collection('counters').findOneAndUpdate({ _id: name }, { $inc: { seq: count } }, withSession({ upsert: true, returnDocument: 'after' }));
    return r.seq - count + 1;
  },

  /** Insert one document with schema defaults + auto integer id. Returns the stored document (no _id). */
  async insert(name, doc) {
    const full = applyDefaults(name, doc);
    if (COLLECTIONS[name]?.autoId !== false && full.id == null) full.id = await db.nextId(name);
    else if (full.id != null) await bumpCounter(name, full.id);
    await getDb().collection(name).insertOne(full, withSession());
    delete full._id;
    return full;
  },

  async insertMany(name, docs) {
    if (!docs.length) return [];
    const autoId = COLLECTIONS[name]?.autoId !== false;
    const full = docs.map((d) => applyDefaults(name, d));
    if (autoId) {
      const missing = full.filter((d) => d.id == null);
      if (missing.length) {
        let next = await db.nextId(name, missing.length);
        for (const d of missing) d.id = next++;
      }
      const maxId = Math.max(...full.map((d) => d.id));
      await bumpCounter(name, maxId);
    }
    await getDb().collection(name).insertMany(full, withSession({ ordered: true }));
    return full.map(({ _id, ...d }) => d);
  },

  find: (name, filter = {}, { sort, limit, skip, projection, collation } = {}) => {
    let cur = getDb().collection(name).find(filter, withSession({ projection: strip(projection), ...(collation ? { collation } : {}) }));
    if (sort) cur = cur.sort(sort);
    if (skip) cur = cur.skip(skip);
    if (limit) cur = cur.limit(limit);
    return cur.toArray();
  },

  findOne: (name, filter = {}, { sort, projection, collation } = {}) =>
    getDb().collection(name).findOne(filter, withSession({ projection: strip(projection), ...(sort ? { sort } : {}), ...(collation ? { collation } : {}) })),

  /** Find by integer id. */
  byId: (name, id, opts) => db.findOne(name, { id: Number(id) }, opts),

  /** Map of id -> document for a list of ids (handy for "joins"). */
  async mapByIds(name, ids, { projection, key = 'id' } = {}) {
    const uniq = [...new Set(ids.filter((v) => v != null))];
    if (!uniq.length) return new Map();
    const proj = projection ? { ...projection, [key]: 1 } : undefined;
    const rows = await db.find(name, { [key]: { $in: uniq } }, { projection: proj });
    return new Map(rows.map((r) => [r[key], r]));
  },

  count: (name, filter = {}) => getDb().collection(name).countDocuments(filter, withSession()),
  exists: async (name, filter) => !!(await getDb().collection(name).findOne(filter, withSession({ projection: { _id: 1 } }))),
  distinct: (name, field, filter = {}) => getDb().collection(name).distinct(field, filter, withSession()),

  /** updateOne. `update` is either an operator document ({$set, $inc, ...}) or a plain object (treated as $set). */
  async update(name, filter, update, opts = {}) {
    const r = await getDb().collection(name).updateOne(filter, toUpdate(update), withSession(opts));
    return r.matchedCount;
  },
  async updateMany(name, filter, update, opts = {}) {
    const r = await getDb().collection(name).updateMany(filter, toUpdate(update), withSession(opts));
    return r.matchedCount;
  },
  /** findOneAndUpdate returning the updated document (or null). */
  findOneAndUpdate: (name, filter, update, { upsert = false, returnNew = true, sort, projection } = {}) =>
    getDb().collection(name).findOneAndUpdate(filter, toUpdate(update), withSession({ upsert, sort, returnDocument: returnNew ? 'after' : 'before', projection: strip(projection) })),

  aggregate: (name, pipeline) => getDb().collection(name).aggregate(pipeline, withSession()).toArray(),

  /**
   * Delete documents honouring the schema's FK rules (cascade / set_null / restrict), like PostgreSQL did.
   * Returns the number of deleted documents. Restrict violations throw DbError code 'IN_USE'.
   */
  async remove(name, filter) {
    const autoId = COLLECTIONS[name]?.autoId !== false;
    if (autoId) {
      const ids = (await getDb().collection(name).find(filter, withSession({ projection: { id: 1 } })).toArray()).map((d) => d.id);
      if (!ids.length) return 0;
      await handleInbound(name, ids);
      const r = await getDb().collection(name).deleteMany({ id: { $in: ids } }, withSession());
      return r.deletedCount;
    }
    const r = await getDb().collection(name).deleteMany(filter, withSession());
    return r.deletedCount;
  },

  /**
   * Run fn inside a multi-document transaction. Nested calls join the outer transaction.
   * Use db.lock() to serialise concurrent writers on the same documents (replaces SELECT ... FOR UPDATE).
   */
  async tx(fn) {
    if (session()) return fn();
    const s = client.startSession();
    try {
      let result;
      await s.withTransaction(async () => {
        result = await als.run(s, fn);
      });
      return result;
    } finally {
      await s.endSession();
    }
  },

  /** Take a write lock on matching documents inside a transaction (concurrent tx conflict + retry). */
  async lock(name, filter) {
    await getDb().collection(name).updateMany(filter, { $inc: { _lock: 1 } }, withSession());
  },

  async ping() {
    await getDb().command({ ping: 1 });
  },

  async close() {
    if (client) await client.close().catch(() => {});
    if (memServer) await memServer.stop().catch(() => {});
    client = null;
    database = null;
    memServer = null;
    driverName = null;
  },

  /** Drop every collection (tests / reset). */
  async dropAll() {
    const cols = await getDb().listCollections({}, { nameOnly: true }).toArray();
    for (const c of cols) await getDb().collection(c.name).drop().catch(() => {});
  },
};

function toUpdate(u) {
  return Object.keys(u).some((k) => k.startsWith('$')) ? u : { $set: u };
}

async function bumpCounter(name, id) {
  await getDb().collection('counters').updateOne({ _id: name }, { $max: { seq: id } }, withSession({ upsert: true }));
}

async function handleInbound(name, ids) {
  for (const { collection, field, onDelete } of INBOUND[name] || []) {
    const filter = { [field]: { $in: ids } };
    if (onDelete === 'restrict') {
      if (await db.exists(collection, filter)) {
        throw new DbError('This record is referenced by other data and cannot be removed.', 'IN_USE', { collection: name, referencedBy: collection });
      }
    } else if (onDelete === 'set_null') {
      await getDb().collection(collection).updateMany(filter, { $set: { [field]: null } }, withSession());
    } else {
      await db.remove(collection, filter);
    }
  }
}

/** Create all indexes declared in schema.js (idempotent). */
export async function ensureIndexes() {
  const d = getDb();
  const existing = new Set((await d.listCollections({}, { nameOnly: true }).toArray()).map((c) => c.name));
  for (const [name, def] of Object.entries(COLLECTIONS)) {
    if (!existing.has(name)) await d.createCollection(name).catch(() => {});
    for (const [keys, options = {}] of def.indexes || []) await d.collection(name).createIndex(keys, options);
  }
}
