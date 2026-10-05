import type { PrismaClient } from '@prisma/client';
import type { Config } from './config.js';
import { objectStore } from './object-store.js';
import { lockStorage } from './storage-lock.js';
import { audit } from './security.js';
// Destructive cleanup is off by default and must be explicitly configured and applied by an administrator.
export async function purgeExpiredOriginals(db: PrismaClient, c: Config, apply = false) {
  if (!Number.isFinite(c.fileRetentionDays) || c.fileRetentionDays < 1)
    return { enabled: false, candidates: 0, removed: 0 };
  const release = await lockStorage();
  try {
    const cutoff = new Date(Date.now() - c.fileRetentionDays * 86400000),
      store = objectStore(c);
    const rows = await db.attachment.findMany({ select: { filePath: true } });
    let candidates = 0,
      removed = 0;
    for (const key of new Set(rows.map((f) => f.filePath))) {
      // Every reference must be an old published attempt. Never expire a draft, pending review or an active revision.
      const active = await db.attachment.count({
        where: {
          filePath: key,
          OR: [
            { attempt: { status: { not: 'PUBLISHED' } } },
            { attempt: { finalGrade: null } },
            { attempt: { finalGrade: { publishedAt: { gte: cutoff } } } },
          ],
        },
      });
      if (active || !(await store.exists(key))) continue;
      candidates++;
      if (apply) {
        await store.remove(key);
        await audit(db, null, 'expire_original', undefined, key);
        removed++;
      }
    }
    return { enabled: true, candidates, removed, retentionDays: c.fileRetentionDays };
  } finally {
    release();
  }
}
