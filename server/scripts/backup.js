/**
 * Database backup.
 *   npm run db:backup                 -> backups/rms-<timestamp>.(sql|tar.gz)
 * - PostgreSQL (DATABASE_URL set): runs pg_dump (must be on PATH) in custom format.
 * - Embedded PGlite: dumps the data directory to a tarball.
 * Restore: pg_restore -d $DATABASE_URL --clean backups/<file>.dump
 *          (PGlite: stop the server and extract the tarball into PGLITE_DIR, or use new PGlite({ loadDataDir }))
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { config } from '../src/config.js';

const dir = path.join(config.root, 'backups');
fs.mkdirSync(dir, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, '-');

if (config.databaseUrl) {
  const file = path.join(dir, `rms-${stamp}.dump`);
  const r = spawnSync('pg_dump', ['--format=custom', '--no-owner', `--file=${file}`, config.databaseUrl], { stdio: 'inherit' });
  if (r.status !== 0) {
    console.error('pg_dump failed. Make sure PostgreSQL client tools are installed and on PATH.');
    process.exit(1);
  }
  console.log(`Backup written to ${file}`);
} else {
  const { PGlite } = await import('@electric-sql/pglite');
  const db = new PGlite(config.pgliteDir);
  const blob = await db.dumpDataDir('gzip');
  const file = path.join(dir, `rms-${stamp}.tar.gz`);
  fs.writeFileSync(file, Buffer.from(await blob.arrayBuffer()));
  await db.close();
  console.log(`Backup written to ${file}`);
}

// Retention: keep the newest 14 backups.
const files = fs.readdirSync(dir).filter((f) => f.startsWith('rms-')).sort().reverse();
for (const f of files.slice(14)) fs.unlinkSync(path.join(dir, f));
