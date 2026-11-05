/**
 * Ad-hoc read query against the configured MongoDB (Atlas via MONGODB_URI, or the local dev database).
 *
 *   npm run query                                      (lists collections with document counts)
 *   npm run query -- users                             (first 20 documents)
 *   npm run query -- users "{\"role_id\": 5}"          (filter as JSON)
 *   npm run query -- orders "{\"status\":\"pending\"}" 50   (filter + limit)
 *
 * For Atlas you can also use mongosh:  mongosh "<MONGODB_URI>"  then  db.users.find()
 * The local dev database is single-process: stop the API server first.
 */
import { db, initDb } from '../src/db/index.js';

const [name, filterJson = '{}', limit = '20'] = process.argv.slice(2);

await initDb();
try {
  if (!name) {
    const cols = (await db.col('counters').db.listCollections({}, { nameOnly: true }).toArray()).map((c) => c.name).sort();
    const rows = [];
    for (const c of cols) rows.push({ collection: c, documents: await db.count(c) });
    console.table(rows);
  } else {
    const rows = await db.find(name, JSON.parse(filterJson), { sort: { id: 1 }, limit: parseInt(limit, 10) || 20 });
    if (rows.length) console.table(rows);
    console.log(`${rows.length} document(s)`);
  }
} catch (e) {
  console.error('Error:', e.message);
  process.exitCode = 1;
} finally {
  await db.close();
}
