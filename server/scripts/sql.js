/**
 * Run an ad-hoc SQL query against the configured database (PGlite or DATABASE_URL).
 *
 *   npm run sql -- "SELECT * FROM users LIMIT 5"
 *   npm run sql                       (no query: lists all tables)
 *
 * PGlite allows only one process to open the data folder: stop the API server first.
 */
import { initDb, db } from '../src/db/index.js';

const sql =
  process.argv.slice(2).join(' ').trim() ||
  "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name";

try {
  await initDb();
  const rows = await db.query(sql);
  if (rows.length) console.table(rows);
  console.log(`${rows.length} row(s)`);
} catch (e) {
  console.error('Error:', e.message);
  process.exitCode = 1;
} finally {
  await db.close();
}
