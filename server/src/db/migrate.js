import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { db, initDb } from './index.js';
import { syncRbac } from '../rbac.js';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'migrations');

/** Applies pending *.sql migrations in filename order, each inside its own transaction. */
export async function migrate({ log = console.log } = {}) {
  await db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    name VARCHAR(200) PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())`);
  const applied = new Set((await db.many('SELECT name FROM schema_migrations')).map((r) => r.name));
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = fs.readFileSync(path.join(dir, file), 'utf8');
    await db.exec(`BEGIN;\n${sql}\nINSERT INTO schema_migrations(name) VALUES ('${file.replace(/'/g, "''")}');\nCOMMIT;`).catch(async (e) => {
      await db.exec('ROLLBACK').catch(() => {});
      throw new Error(`Migration ${file} failed: ${e.message}`);
    });
    log(`  applied ${file}`);
  }
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
