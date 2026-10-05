import type { PrismaClient } from '@prisma/client';
import { Prisma } from '@prisma/client';
import { writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import type { Config } from './config.js';
import { objectStore } from './object-store.js';
export async function cloudBackup(db: PrismaClient, c: Config, folder: string) {
  const models = Prisma.dmmf.datamodel.models;
  const snapshot = await db.$transaction(
    async (tx) => {
      const tables: Record<string, unknown> = {};
      for (const model of models) {
        const delegate = model.name[0].toLowerCase() + model.name.slice(1);
        tables[model.name] = await (tx as any)[delegate].findMany();
      }
      return { format: 'kaoba167-logical-backup-v1', createdAt: new Date(), tables };
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 120000 },
  );
  const files = (snapshot.tables.Attachment as any[]) || [];
  const unique = new Map(files.map((f) => [f.filePath, f]));
  const total = [...unique.values()].reduce((n, f) => n + f.size, 0);
  if (total > 1024 * 1024 * 1024) throw Error('原稿超过在线打包上限，请使用数据库备份和存储桶导出');
  await writeFile(path.join(folder, 'database.json'), JSON.stringify(snapshot));
  const dir = path.join(folder, 'storage', 'submissions');
  await mkdir(dir, { recursive: true });
  const store = objectStore(c),
    missing: string[] = [];
  for (const f of unique.values()) {
    if (await store.exists(f.filePath))
      await writeFile(path.join(dir, f.filePath), await store.read(f.filePath));
    else missing.push(f.filePath);
  }
  await writeFile(
    path.join(folder, 'RESTORE.txt'),
    'Use scripts/restore-cloud.mjs with an empty database and the original SESSION_SECRET. Originals may have expired under retention policy.\nMissing: ' +
      missing.join(', '),
  );
}
