import { PrismaClient } from '@prisma/client';
import { CloudbasePgAdapter } from '../src/cloudbase-db.js';
export async function fixtureDatabase(file: string): Promise<PrismaClient> {
  const schema = process.env.CLOUDBASE_TEST_SCHEMA;
  if (!schema) return new PrismaClient({ datasourceUrl: 'file:' + file.replaceAll('\\', '/') });
  if (!/^kaoba_test_[a-f0-9]{32}$/.test(schema)) throw Error('Tests require an isolated schema');
  const modulePath = '../generated/cloudbase/index.js';
  const { PrismaClient: CloudClient } = await import(modulePath);
  return new CloudClient({
    adapter: new CloudbasePgAdapter(
      process.env.CLOUDBASE_ENV_ID!,
      process.env.CLOUDBASE_API_KEY!,
      fetch,
      schema,
    ),
    transactionOptions: { timeout: 120000 },
    errorFormat: 'minimal',
  }) as PrismaClient;
}
