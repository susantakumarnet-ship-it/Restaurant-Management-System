/**
 * Database backup / restore (works with MongoDB Atlas and the local dev database; no mongodump needed).
 *   npm run db:backup                       -> backups/rms-<timestamp>.json.gz (every collection, Extended JSON)
 *   npm run db:restore -- backups/<file>    -> REPLACES all collections with the backup contents
 * Stop the API server first when using the local dev database (it is single-process).
 * Atlas also provides managed snapshots; this script is a portable logical backup.
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { EJSON } from 'mongodb';
import { config } from '../src/config.js';
import { db, initDb, ensureIndexes } from '../src/db/index.js';

const dir = path.join(config.root, 'backups');
const restoreIdx = process.argv.indexOf('--restore');

await initDb();
try {
  if (restoreIdx !== -1) {
    const file = process.argv[restoreIdx + 1];
    if (!file || !fs.existsSync(file)) throw new Error('Usage: npm run db:restore -- <backup file>');
    const dump = EJSON.parse(zlib.gunzipSync(fs.readFileSync(file)).toString('utf8'), { relaxed: false });
    await db.dropAll();
    await ensureIndexes();
    for (const [name, docs] of Object.entries(dump.collections)) {
      if (docs.length) await db.col(name).insertMany(docs, { ordered: false });
      console.log(`  ${name}: ${docs.length}`);
    }
    console.log(`Restored from ${file}`);
  } else {
    fs.mkdirSync(dir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const names = (await db.col('counters').db.listCollections({}, { nameOnly: true }).toArray()).map((c) => c.name).sort();
    const collections = {};
    for (const name of names) collections[name] = await db.col(name).find({}).toArray();
    const file = path.join(dir, `rms-${stamp}.json.gz`);
    fs.writeFileSync(file, zlib.gzipSync(EJSON.stringify({ created_at: new Date(), db: config.mongoDbName, collections }, { relaxed: false })));
    console.log(`Backup written to ${file} (${names.length} collections)`);

    // Retention: keep the newest 14 backups.
    const files = fs.readdirSync(dir).filter((f) => f.startsWith('rms-')).sort().reverse();
    for (const f of files.slice(14)) fs.unlinkSync(path.join(dir, f));
  }
} finally {
  await db.close();
}
