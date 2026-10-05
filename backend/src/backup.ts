import type { FastifyInstance } from 'fastify';
import type { PrismaClient } from '@prisma/client';
import archiver from 'archiver';
import { mkdtemp, rm, copyFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { root, type Config } from './config.js';
import { auth, audit } from './security.js';
import { lockStorage } from './storage-lock.js';
import { cloudBackup } from './cloud-backup.js';
export function registerBackup(app: FastifyInstance, db: PrismaClient, c: Config) {
  app.post(
    '/api/admin/backup',
    { preHandler: auth(db, c, ['ADMIN']), config: { rateLimit: { max: 3, timeWindow: '1 hour' } } },
    async (req, reply) => {
      const release = await lockStorage();
      let folder = '';
      try {
        folder = await mkdtemp(path.join(tmpdir(), 'shenlun-backup-'));
        const snapshot = path.join(folder, 'database.db');
        const postgres = ['postgres', 'cloudbase-http'].includes(c.databaseProvider);
        if (postgres) await cloudBackup(db, c, folder);
        else await db.$executeRaw`VACUUM INTO ${snapshot}`;
        await copyFile(path.join(root, '.env.example'), path.join(folder, 'env.example'));
        await audit(db, req.actor.id, 'backup');
        const archive = archiver('zip', { zlib: { level: 6 } });
        const cleanup = () => {
          release();
          void rm(folder, { recursive: true, force: true });
        };
        archive.on('error', () => {
          archive.abort();
          cleanup();
        });
        reply.raw.on('close', cleanup);
        if (postgres) {
          archive.file(path.join(folder, 'database.json'), { name: 'database.json' });
          archive.file(path.join(folder, 'RESTORE.txt'), { name: 'RESTORE.txt' });
          archive.directory(path.join(folder, 'storage'), 'storage');
        } else archive.file(snapshot, { name: 'database.db' });
        archive.file(path.join(folder, 'env.example'), { name: '.env.example' });
        if (!postgres) archive.directory(c.storage, 'storage');
        reply
          .header(
            'content-disposition',
            'attachment; filename="backup-' +
              new Date().toISOString().replace(/[:.]/g, '-') +
              '.zip"',
          )
          .type('application/zip');
        void archive.finalize().catch(() => {
          archive.abort();
          cleanup();
        });
        return reply.send(archive);
      } catch (e) {
        release();
        if (folder) await rm(folder, { recursive: true, force: true });
        throw e;
      }
    },
  );
}
