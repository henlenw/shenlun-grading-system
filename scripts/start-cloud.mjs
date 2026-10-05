import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { checkCloudEnv } from './check-cloud-env.mjs';
checkCloudEnv();
const require = createRequire(import.meta.url);
if (!process.env.APP_URL?.startsWith('https://'))
  throw Error('APP_URL must be the actual public HTTPS origin');
if (!['s3', 'cloudbase-pg'].includes(process.env.STORAGE_PROVIDER))
  throw Error('Cloud mode requires private S3/COS or CloudBase PG storage');
const port = process.env.PORT || '8080',
  children = [];
let exiting = false;
function stop(code = 0) {
  if (exiting) return;
  exiting = true;
  for (const c of children) c.kill('SIGTERM');
  setTimeout(() => process.exit(code), 1500).unref();
}
if (process.env.DATABASE_PROVIDER === 'postgres') {
  const migrate = spawn(
    process.execPath,
    [require.resolve('../backend/node_modules/prisma/build/index.js'), 'migrate', 'deploy'],
    { cwd: new URL('../backend/', import.meta.url), stdio: 'inherit', env: process.env },
  );
  const code = await new Promise((r) => migrate.on('exit', r));
  if (code !== 0) process.exit(1);
} else {
  // Schema migration is an explicit deployment step through the management API. Runtime keys
  // remain server-side, and application startup never depends on a PostgreSQL TCP socket.
  const { createDatabase } = await import('../backend/dist/database.js');
  const { loadConfig } = await import('../backend/dist/config.js');
  const db = await createDatabase(loadConfig());
  await db.$queryRaw`SELECT 1`;
  await db.user.count();
  await db.$disconnect();
}
function run(file, args, cwd, env) {
  const c = spawn(process.execPath, [file, ...args], {
    cwd,
    env: { ...process.env, ...env },
    stdio: 'inherit',
  });
  children.push(c);
  c.on('exit', (code) => stop(code || 1));
  c.on('error', () => stop(1));
}
run('dist/server.js', [], new URL('../backend/', import.meta.url), {
  PORT: '4000',
  HOST: '127.0.0.1',
});
run(
  'node_modules/next/dist/bin/next',
  ['start', '--hostname', '0.0.0.0', '--port', port],
  new URL('../teacher-admin/', import.meta.url),
  { PORT: port },
);
process.on('SIGINT', () => stop());
process.on('SIGTERM', () => stop());
