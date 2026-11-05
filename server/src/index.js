import { config } from './config.js';
import { db, initDb } from './db/index.js';
import { migrate } from './db/migrate.js';
import { createApp } from './app.js';
import { startScheduler } from './services/scheduler.js';

await initDb();
await migrate({ log: (m) => console.log(m) });

// First run on an empty local (non-Atlas) database: load demo data automatically.
if (db.driver !== 'mongodb') {
  if ((await db.count('restaurants')) === 0) {
    const { seed } = await import('./db/seed.js');
    console.log('Empty database detected - loading demo data...');
    await seed();
  }
}

const app = createApp();
const server = app.listen(config.port, () => {
  console.log(`\n  Smart RMS API ready on http://localhost:${config.port}  (db: ${db.driver}, payments: ${config.payments.mode})\n`);
});
if (config.schedulerEnabled) startScheduler();

const shutdown = async () => {
  server.close();
  await db.close();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
