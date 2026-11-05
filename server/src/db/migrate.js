import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { db, initDb, ensureIndexes } from './index.js';
import { syncRbac } from '../rbac.js';

/** Creates collections + indexes declared in schema.js (idempotent) and syncs roles/permissions. */
export async function migrate({ log = console.log } = {}) {
  await ensureIndexes();
  log('  collections and indexes up to date');
  await syncRbac(db);
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  await initDb();
  console.log('Running migrations...');
  await migrate();
  console.log('Done.');
  await db.close();
}
