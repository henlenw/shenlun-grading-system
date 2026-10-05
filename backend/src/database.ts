import { PrismaClient } from '@prisma/client';
import { CloudbasePgAdapter } from './cloudbase-db.js';
import type { Config } from './config.js';

export async function createDatabase(c: Config): Promise<PrismaClient> {
  if (c.databaseProvider !== 'cloudbase-http') return new PrismaClient();
  // This separately generated client keeps the existing SQLite development/test client intact.
  const modulePath = '../generated/cloudbase/index.js';
  const { PrismaClient: CloudClient } = await import(modulePath);
  return new CloudClient({
    adapter: new CloudbasePgAdapter(c.cloudbaseEnvId, c.cloudbaseApiKey),
    transactionOptions: { maxWait: 15000, timeout: 120000 },
  }) as PrismaClient;
}
