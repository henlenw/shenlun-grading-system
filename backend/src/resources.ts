import type { FastifyInstance } from 'fastify';
import type { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import type { Config } from './config.js';
import { auth, audit } from './security.js';
const key = 'resource-usage-snapshot';
export const resourceSnapshot = z.object({
  used: z.number().min(0).max(1e9),
  quota: z.number().positive().max(1e9),
  periodEnd: z.string().datetime(),
  checkedAt: z.string().datetime(),
  source: z.enum(['cloudbase-cli', 'admin-record']),
});
export function resourceState(value: unknown, now = Date.now()) {
  const parsed = resourceSnapshot.safeParse(value);
  if (!parsed.success) return { snapshot: null, stale: true, warning: '' };
  const s = parsed.data;
  const stale = now - Date.parse(s.checkedAt) > 86400000 || now > Date.parse(s.periodEnd);
  return {
    snapshot: s,
    stale,
    warning: s.used >= s.quota * 0.8 ? '当前资源即将达到免费额度，请处理。' : '',
  };
}
export function registerResources(app: FastifyInstance, db: PrismaClient, c: Config) {
  const admin = auth(db, c, ['ADMIN']);
  app.get('/api/admin/resources', { preHandler: admin }, async () => {
    const saved = await db.systemSetting.findUnique({ where: { id: key } });
    let value;
    try {
      value = JSON.parse(saved?.value || 'null');
    } catch {
      value = null;
    }
    return {
      ...resourceState(value),
      consoleUrl: c.cloudbaseEnvId
        ? `https://tcb.cloud.tencent.com/dev?envId=${encodeURIComponent(c.cloudbaseEnvId)}#/env/package-usage`
        : null,
    };
  });
  app.put(
    '/api/admin/resources',
    { preHandler: admin, config: { rateLimit: { max: 6, timeWindow: '1 minute' } } },
    async (req) => {
      const body = resourceSnapshot.omit({ checkedAt: true, source: true }).parse(req.body);
      const value = JSON.stringify({
        ...body,
        checkedAt: new Date().toISOString(),
        source: 'admin-record',
      });
      await db.$transaction(async (tx) => {
        await tx.systemSetting.upsert({
          where: { id: key },
          create: { id: key, value },
          update: { value },
        });
        await audit(tx, req.actor.id, 'record_resource_usage', key);
      });
      return resourceState(JSON.parse(value));
    },
  );
}
