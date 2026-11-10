// Builds the React client (../client -> ../client/dist) so the API can serve the website.
// Runs automatically after `npm install` on Render (RENDER=true) or when BUILD_CLIENT=true,
// so a Render service whose build command only installs the server still gets the frontend.
// Skipped when client/dist already exists (e.g. the build command built it first) unless FORCE=1.
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const clientDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'client');
const manual = process.argv.includes('--force');
const enabled = manual || process.env.RENDER === 'true' || process.env.BUILD_CLIENT === 'true';

if (!enabled) process.exit(0);
if (!fs.existsSync(path.join(clientDir, 'package.json'))) {
  console.log('[build-client] no client folder found, skipping');
  process.exit(0);
}
if (!manual && fs.existsSync(path.join(clientDir, 'dist', 'index.html'))) {
  console.log('[build-client] client/dist already built, skipping');
  process.exit(0);
}

const run = (cmd, NODE_ENV) => {
  console.log(`[build-client] ${cmd}`);
  execSync(cmd, { cwd: clientDir, stdio: 'inherit', env: { ...process.env, NODE_ENV } });
};
// Install with NODE_ENV=development: under production npm would skip the devDependencies (vite, typescript).
run(fs.existsSync(path.join(clientDir, 'package-lock.json')) ? 'npm ci --include=dev' : 'npm install --include=dev', 'development');
// Build with NODE_ENV=production so Vite emits an optimised production bundle.
run('npm run build', 'production');
console.log('[build-client] done');
