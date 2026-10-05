import dotenv from 'dotenv';
import { PrismaClient } from '@prisma/client';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdir, cp, writeFile } from 'node:fs/promises';
import path from 'node:path';
dotenv.config({ path: '../.env', quiet: true });
if (process.env.DATABASE_PROVIDER === 'postgres') {
  const resolver = createRequire(import.meta.url);
  const r = spawnSync(
    process.execPath,
    [resolver.resolve('prisma/build/index.js'), 'migrate', 'deploy'],
    { stdio: 'inherit', windowsHide: true },
  );
  process.exit(r.status ?? 1);
}
const db = new PrismaClient();
await db.$queryRaw`SELECT 1`;
const tables =
  await db.$queryRaw`SELECT name FROM sqlite_master WHERE type='table' AND name='User'`;
if (tables.length) {
  const target = path.resolve(
    process.env.BACKUP_PATH || '../backups',
    'before-migrate-' + new Date().toISOString().replace(/[:.]/g, '-'),
  );
  await mkdir(target, { recursive: true });
  const database = path.join(target, 'data.db').replaceAll('\\', '/').replaceAll("'", "''");
  await db.$executeRawUnsafe("VACUUM INTO '" + database + "'");
  const storage = path.resolve('..', process.env.STORAGE_PATH || 'storage');
  await cp(storage, path.join(target, 'storage'), { recursive: true }).catch((e) => {
    if (e.code !== 'ENOENT') throw e;
  });
  await writeFile(
    path.join(target, 'RESTORE.txt'),
    'Stop API before restoration. Restore data.db to DATABASE_URL and storage/ to STORAGE_PATH. Keep the original SESSION_SECRET and OCR_TOKEN separately.\n',
  );
  console.log('Migration backup: ' + target);
}
await db.$disconnect();
const require = createRequire(import.meta.url);
const result = spawnSync(
  process.execPath,
  [require.resolve('prisma/build/index.js'), 'migrate', 'deploy'],
  { stdio: 'inherit', windowsHide: true },
);
process.exit(result.status ?? 1);
