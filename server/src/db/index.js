/**
 * Database adapter.
 * - DATABASE_URL set  -> node-postgres Pool against a real PostgreSQL server (production).
 * - otherwise         -> PGlite, a full PostgreSQL build running in-process (dev/test, zero install).
 * Both expose the same tiny API: query / one / many / tx / exec.
 */
import fs from 'node:fs';
import { config } from '../config.js';

// Normalise types so both drivers return identical JS values.
const toTs = (v) => (v == null ? v : String(v).replace(' ', 'T'));
const PARSERS = {
  20: (v) => parseInt(v, 10), // int8 (count(*))
  1700: (v) => parseFloat(v), // numeric
  1082: (v) => v, // date -> 'YYYY-MM-DD'
  1114: toTs, // timestamp (restaurant local time) -> 'YYYY-MM-DDTHH:mm:ss'
};

let impl = null;

// Keep DB date/time functions (CURRENT_DATE, now()::timestamp, ::date casts) in the same timezone
// as the Node process (set TZ for the restaurant), so SQL and JS agree on "today" and "now".
const TIMEZONE = process.env.TZ || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
const tzSql = `SET TIME ZONE '${TIMEZONE.replace(/'/g, '')}'`;

export async function initDb({ url = config.databaseUrl, dir = config.pgliteDir } = {}) {
  if (impl) return impl;
  if (url) {
    const pg = (await import('pg')).default;
    for (const [oid, fn] of Object.entries(PARSERS)) pg.types.setTypeParser(Number(oid), fn);
    const pool = new pg.Pool({ connectionString: url, max: parseInt(process.env.DB_POOL_MAX || '10', 10) });
    pool.on('connect', (client) => client.query(tzSql).catch((e) => console.error('[db] timezone', e.message)));
    impl = {
      driver: 'pg',
      query: (text, params) => pool.query(text, params),
      exec: (sql) => pool.query(sql),
      async tx(fn) {
        const client = await pool.connect();
        try {
          await client.query('BEGIN');
          const result = await fn({ query: (t, p) => client.query(t, p) });
          await client.query('COMMIT');
          return result;
        } catch (e) {
          await client.query('ROLLBACK').catch(() => {});
          throw e;
        } finally {
          client.release();
        }
      },
      close: () => pool.end(),
    };
  } else {
    const { PGlite } = await import('@electric-sql/pglite');
    if (dir) fs.mkdirSync(dir, { recursive: true });
    const lite = new PGlite(dir || undefined, { parsers: PARSERS });
    await lite.waitReady;
    await lite.exec(tzSql).catch(() => lite.exec(`SET TIME ZONE 'UTC'`));
    impl = {
      driver: 'pglite',
      query: (text, params) => lite.query(text, params, { parsers: PARSERS }),
      exec: (sql) => lite.exec(sql),
      tx: (fn) => lite.transaction((tx) => fn({ query: (t, p) => tx.query(t, p, { parsers: PARSERS }) })),
      close: () => lite.close(),
      lite,
    };
  }
  return impl;
}

/** Re-throw driver errors as plain Errors (keeps pg error code/constraint/detail, drops noisy WASM stacks). */
class DbError extends Error {
  constructor(e, text) {
    super(e.message);
    this.name = 'DbError';
    for (const k of ['code', 'constraint', 'detail', 'table', 'column', 'hint']) if (e[k] !== undefined) this[k] = e[k];
    this.query = text?.replace(/\s+/g, ' ').slice(0, 300);
  }
}

async function run(q, text, params) {
  try {
    return (await q.query(text, params)).rows;
  } catch (e) {
    throw new DbError(e, text);
  }
}

function wrap(q) {
  return {
    query: (text, params = []) => run(q, text, params),
    one: async (text, params = []) => (await run(q, text, params))[0] || null,
    many: (text, params = []) => run(q, text, params),
  };
}

/** Use `db.many/one/query` for single statements; `db.tx(async t => ...)` for atomic work. */
export const db = {
  get driver() {
    return impl?.driver;
  },
  query: (t, p) => wrap(getImpl()).query(t, p),
  one: (t, p) => wrap(getImpl()).one(t, p),
  many: (t, p) => wrap(getImpl()).many(t, p),
  exec: async (sql) => {
    try {
      return await getImpl().exec(sql);
    } catch (e) {
      throw new DbError(e, sql);
    }
  },
  tx: (fn) => getImpl().tx((client) => fn(wrap(client))),
  close: async () => {
    if (impl) await impl.close();
    impl = null;
  },
};

function getImpl() {
  if (!impl) throw new Error('Database not initialised. Call initDb() first.');
  return impl;
}

/** JSON helper: always bind JSON as text and cast in SQL ($n::text::jsonb) for driver parity. */
export const json = (v) => (v === undefined ? null : JSON.stringify(v));
