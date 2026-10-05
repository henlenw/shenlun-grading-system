import type { FastifyInstance } from 'fastify';
import type { PrismaClient } from '@prisma/client';
import type { Config } from './config.js';
import { digest } from './security.js';

// Bounded in-process limits: no Redis, database writes, timers or paid service.
export function registerResourceGuards(app: FastifyInstance, db: PrismaClient, c: Config) {
  const windows = new Map<string, { until: number; count: number }>();
  let nextCleanup = 0;
  let cleanup: Promise<unknown> | undefined;
  app.addHook('onRequest', async (req, reply) => {
    const token = req.headers.authorization || req.cookies.shenlun_session;
    const now = Date.now();
    if (windows.size > 2000) for (const [k, v] of windows) if (v.until <= now) windows.delete(k);
    const limits: [string, number][] = [['ip:' + req.ip, 600]];
    if (token) limits.push([digest(token, c.secret), 120]);
    for (const [key, max] of limits) {
      let window = windows.get(key);
      if (!window || window.until <= now) {
        if (windows.size >= 5000) windows.delete(windows.keys().next().value!);
        window = { until: now + 60000, count: 0 };
        windows.set(key, window);
      }
      if (++window.count > max)
        return reply
          .header('Retry-After', Math.ceil((window.until - now) / 1000))
          .code(429)
          .send({ message: '操作过于频繁，请稍后重试' });
    }
  });
  // Maintenance only when an authenticated administrator is already active.
  app.addHook('onResponse', async (req) => {
    if (req.actor?.role !== 'ADMIN' || Date.now() < nextCleanup || cleanup) return;
    nextCleanup = Date.now() + 86400000;
    cleanup = db
      .$transaction([
        db.session.deleteMany({ where: { expiresAt: { lt: new Date() } } }),
        db.bindingTicket.deleteMany({ where: { expiresAt: { lt: new Date() } } }),
        db.auditLog.deleteMany({
          where: { createdAt: { lt: new Date(Date.now() - c.auditRetentionDays * 86400000) } },
        }),
      ])
      .catch(() => {
        nextCleanup = Date.now() + 3600000;
      })
      .finally(() => {
        cleanup = undefined;
      });
  });
  app.addHook('onClose', async () => {
    await cleanup;
    windows.clear();
  });
}
