import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import path from 'node:path';
const require = createRequire(import.meta.url),
  yauzl = require('../backend/node_modules/yauzl');
async function inspect(file) {
  const names = await new Promise((resolve, reject) =>
    yauzl.open(file, { lazyEntries: true }, (e, z) => {
      if (e || !z) return reject(e);
      const names = [];
      z.on('entry', (entry) => {
        names.push(entry.fileName);
        z.readEntry();
      });
      z.on('error', reject);
      z.on('end', () => resolve(names));
      z.readEntry();
    }),
  );
  for (const name of names)
    if (
      /(^|\/)(\.env|\.env\.cloud|\.secrets|generated|dev\.db|node_modules|storage|backups)(\/|$)/.test(
        name,
      ) ||
      /\.db-(wal|shm)$/.test(name)
    )
      throw Error('Private/local data found: ' + name);
  return names;
}
const cloud = await inspect('release/kaoba167-cloud-source.zip');
if (
  !cloud.includes('Dockerfile') ||
  !cloud.includes('backend/prisma-postgres/migrations/202610040001_cloud_initial/migration.sql') ||
  !cloud.includes('backend/prisma-postgres/migrations/202610050001_material_answers/migration.sql') ||
  !cloud.includes('teacher-admin/components/student/MaterialReader.tsx')
)
  throw Error('Cloud entry files missing');
if (cloud.some((name) => name.startsWith('miniprogram/')))
  throw Error('Mini-program must not be in website release');
console.log('PASS: website-only archive, no credentials, cloud entry and migrations verified.');
