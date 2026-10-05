import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const schema = (await readFile(new URL('../backend/prisma/schema.prisma', import.meta.url), 'utf8'))
  .replace('provider = "sqlite"', 'provider = "postgresql"')
  .replace(
    'provider = "prisma-client-js"',
    'provider = "prisma-client-js"\n  engineType = "client"\n  output = "../generated/cloudbase"',
  );
await mkdir(new URL('../backend/prisma-cloudbase/', import.meta.url), { recursive: true });
await writeFile(new URL('../backend/prisma-cloudbase/schema.prisma', import.meta.url), schema);
const result = spawnSync(
  process.execPath,
  [
    require.resolve('../backend/node_modules/prisma/build/index.js'),
    'generate',
    '--schema',
    'prisma-cloudbase/schema.prisma',
  ],
  {
    cwd: new URL('../backend/', import.meta.url),
    stdio: 'inherit',
    env: { ...process.env, DATABASE_URL: 'postgresql://unused:unused@localhost/unused' },
  },
);
process.exit(result.status ?? 1);
