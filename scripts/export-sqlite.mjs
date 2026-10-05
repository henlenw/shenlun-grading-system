import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url),
  { Prisma } = require('../backend/node_modules/@prisma/client');
if (!process.argv[2] || !process.argv[3])
  throw Error(
    'Usage: node scripts/export-sqlite.mjs SOURCE_DB EMPTY_OUTPUT_FOLDER. Stop the source API first.',
  );
const output = path.resolve(process.argv[3]);
await fs.mkdir(output, { recursive: true });
try {
  await fs.access(path.join(output, 'database.json'));
  throw Error('Refusing to overwrite existing snapshot');
} catch (e) {
  if (e.code !== 'ENOENT') throw e;
}
const db = new DatabaseSync(path.resolve(process.argv[2]), { readOnly: true });
try {
  const tables = {};
  db.exec('BEGIN');
  for (const m of Prisma.dmmf.datamodel.models) {
    const rows = db.prepare('SELECT * FROM "' + m.name + '"').all();
    const scalar = m.fields.filter((f) => f.kind !== 'object');
    tables[m.name] = rows.map((row) =>
      Object.fromEntries(
        scalar
          .filter((f) => row[f.name] !== undefined)
          .map((f) => {
            let v = row[f.name];
            if (v !== null && f.type === 'DateTime') v = new Date(v).toISOString();
            if (v !== null && f.type === 'Boolean') v = !!v;
            return [f.name, v];
          }),
      ),
    );
  }
  db.exec('COMMIT');
  await fs.writeFile(
    path.join(output, 'database.json'),
    JSON.stringify({ format: 'kaoba167-logical-backup-v1', createdAt: new Date(), tables }),
    { flag: 'wx' },
  );
  console.log(
    'Read-only database export completed. Copy storage/submissions into this backup separately while API remains stopped. Keep the original SESSION_SECRET securely.',
  );
} finally {
  db.close();
}
