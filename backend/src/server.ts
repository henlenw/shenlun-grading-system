import { PrismaClient } from '@prisma/client';
import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { startWorker } from './jobs.js';
import { createDatabase } from './database.js';
const config = loadConfig();
const db = await createDatabase(config);
const app = await buildApp({ db, config, logger: true });
await app.listen({ port: config.port, host: config.host });
const stop = startWorker(db, config);
for (const signal of ['SIGINT', 'SIGTERM'] as const)
  process.on(signal, async () => {
    await app.close();
    await stop();
    await db.$disconnect();
    process.exit(0);
  });
