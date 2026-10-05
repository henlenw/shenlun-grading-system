import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url),
  { PrismaClient, Prisma } = require('../backend/node_modules/@prisma/client');
if (!process.argv[2] || !process.argv.includes('--apply'))
  throw Error(
    'Usage: node scripts/restore-cloud.mjs PATH_TO_UNZIPPED_BACKUP --apply (empty PostgreSQL only)',
  );
if (
  process.env.DATABASE_PROVIDER !== 'cloudbase-http' &&
  (process.env.DATABASE_PROVIDER !== 'postgres' ||
    !process.env.DATABASE_URL?.startsWith('postgres'))
)
  throw Error('Requires PostgreSQL generated client and DATABASE_URL');
const backup = JSON.parse(await fs.readFile(path.join(process.argv[2], 'database.json'), 'utf8'));
if (backup.format !== 'kaoba167-logical-backup-v1') throw Error('Unsupported backup format');
const models = Prisma.dmmf.datamodel.models,
  ordered = [],
  remaining = [...models];
while (remaining.length) {
  const i = remaining.findIndex((m) =>
    m.fields
      .filter((f) => f.kind === 'object' && f.relationFromFields?.length)
      .every((f) => f.type === m.name || ordered.some((x) => x.name === f.type)),
  );
  if (i < 0) throw Error('Cyclic database dependencies');
  ordered.push(...remaining.splice(i, 1));
}
const db =
  process.env.DATABASE_PROVIDER === 'cloudbase-http'
    ? await (
        await import('../backend/dist/database.js')
      ).createDatabase((await import('../backend/dist/config.js')).loadConfig())
    : new PrismaClient();
try {
  await db.$transaction(
    async (tx) => {
      for (const m of ordered) {
        const d = m.name[0].toLowerCase() + m.name.slice(1);
        if (await tx[d].count()) throw Error('Target is not empty: ' + m.name);
      }
      for (const m of ordered) {
        const delegate = m.name[0].toLowerCase() + m.name.slice(1),
          fields = m.fields.filter((f) => f.kind !== 'object');
        const data = (backup.tables[m.name] || []).map((row) =>
          Object.fromEntries(
            fields
              .filter((f) => row[f.name] !== undefined)
              .map((f) => [
                f.name,
                row[f.name] === null
                  ? null
                  : f.type === 'DateTime'
                    ? new Date(row[f.name])
                    : row[f.name],
              ]),
          ),
        );
        if (data.length) await tx[delegate].createMany({ data });
      }
    },
    { timeout: 120000 },
  );
  console.log(
    'Database restored. Upload storage/submissions/* to your private bucket under submissions/ before opening the site. Preserve the original SESSION_SECRET for existing identities and codes.',
  );
} finally {
  await db.$disconnect();
}
