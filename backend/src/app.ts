import Fastify, { LogController } from 'fastify';
import cookie from '@fastify/cookie';
import helmet from '@fastify/helmet';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import { PrismaClient, Prisma } from '@prisma/client';
import { ZodError } from 'zod';
import { loadConfig, type Config } from './config.js';
import { registerAuth, WechatApi, type WechatGateway } from './auth.js';
import { registerStudent } from './student.js';
import { registerTeacher } from './teacher.js';
import { registerFiles, MAX_FILE_BYTES } from './files.js';
import { HttpError } from './security.js';
import { registerBackup } from './backup.js';
import { registerPermissions } from './permissions.js';
import { registerWorkbench } from './workbench.js';
import { registerRemoteWorker } from './remote-worker.js';
import { registerStudentAuth } from './student-auth.js';
import { createDatabase } from './database.js';
import { CloudbaseDatabaseError } from './cloudbase-db.js';
import { registerResourceGuards } from './resource-guards.js';
import { registerResources } from './resources.js';
import { registerMaterialAnnotations } from './material-annotations.js';
export async function buildApp(
  opts: { db?: PrismaClient; config?: Config; wechat?: WechatGateway; logger?: boolean } = {},
) {
  const c = opts.config || loadConfig();
  const db = opts.db || (await createDatabase(c));
  const app = Fastify({
    logger: opts.logger
      ? {
          redact: [
            'req.headers.authorization',
            'req.headers.cookie',
            'req.headers.x-job-lease',
            'res.headers.set-cookie',
          ],
        }
      : false,
    bodyLimit: 1024 * 1024,
    trustProxy: false,
    logController: new LogController({ disableRequestLogging: c.production }),
  });
  await app.register(cookie);
  await app.register(helmet);
  await app.register(multipart, { limits: { fileSize: MAX_FILE_BYTES, files: 1, fields: 0 } });
  await app.register(rateLimit, { max: 600, timeWindow: '1 minute' });
  registerResourceGuards(app, db, c);
  app.addHook('onRequest', async (req, reply) => {
    reply.header('Cache-Control', 'no-store');
    if (
      !['GET', 'HEAD', 'OPTIONS'].includes(req.method) &&
      req.headers.origin &&
      req.headers.origin !== c.appUrl
    )
      return reply.code(403).send({ message: '来源校验失败' });
  });
  app.setErrorHandler((error: any, req, reply) => {
    if (error instanceof ZodError)
      return reply.code(400).send({
        message: '输入格式不正确',
        issues: error.issues.map((i) => ({ field: i.path.join('.'), message: i.message })),
      });
    if (error instanceof HttpError)
      return reply.code(error.statusCode).send({ message: error.message });
    if (error instanceof CloudbaseDatabaseError) {
      if (['P2034', 'P2002'].includes(error.code))
        return reply.code(409).send({ message: '记录已存在或同时发生了更新，请刷新后重试' });
      return reply.code(503).send({ message: '数据库暂时不可用，请稍后重试' });
    }
    if (
      error instanceof Prisma.PrismaClientKnownRequestError ||
      error.name === 'PrismaClientKnownRequestError'
    ) {
      if (['P2002', 'P2034'].includes(error.code))
        return reply.code(409).send({ message: '记录已存在或同时发生了更新，请刷新后重试' });
      if (error.code === 'P2025') return reply.code(404).send({ message: '记录不存在' });
    }
    if (error.statusCode && error.statusCode < 500)
      return reply.code(error.statusCode).send({
        message:
          error.statusCode === 413
            ? '上传文件不能超过 10 MB'
            : error.statusCode === 429
              ? '操作过于频繁，请稍后重试'
              : '请求无法处理',
      });
    req.log.error({ name: error.name, code: error.code }, 'request failed');
    return reply.code(500).send({ message: '服务器暂时无法处理，请稍后重试' });
  });
  let healthCheckedAt = 0;
  let healthCheck: Promise<unknown> | undefined;
  app.get(
    '/api/health',
    { config: { rateLimit: { max: 120, timeWindow: '1 minute' } } },
    async () => {
      if (Date.now() - healthCheckedAt > 60000) {
        healthCheck ??= Promise.resolve(db.$queryRaw`SELECT 1`)
          .then(() => {
            healthCheckedAt = Date.now();
          })
          .finally(() => {
            healthCheck = undefined;
          });
        await healthCheck;
      }
      return { ok: true };
    },
  );
  registerAuth(app, db, c, opts.wechat || new WechatApi(c));
  registerStudentAuth(app, db, c);
  registerRemoteWorker(app, db, c);
  registerStudent(app, db, c);
  registerTeacher(app, db, c);
  registerFiles(app, db, c);
  registerBackup(app, db, c);
  registerPermissions(app, db, c);
  registerWorkbench(app, db, c);
  registerResources(app, db, c);
  registerMaterialAnnotations(app, db, c);
  return app;
}
