import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import type { Config } from './config.js';
import { equal, fail, digest, opaque, audit } from './security.js';
import { snapshot } from './training.js';
import { objectStore } from './object-store.js';
import { validateAIResult } from './ai.js';
const key = (id: string) => 'worker-lease:' + id;
export function registerRemoteWorker(app: FastifyInstance, db: PrismaClient, c: Config) {
  const preHandler = async (req: FastifyRequest) => {
    if (c.aiProvider !== 'remote-worker' || c.remoteWorkerToken.length < 32)
      fail(503, '远程工作进程未启用');
    if (!equal(req.headers.authorization || '', 'Bearer ' + c.remoteWorkerToken))
      fail(401, '工作进程凭证无效');
  };
  const options = { preHandler, config: { rateLimit: { max: 120, timeWindow: '1 minute' } } };
  async function lease(tx: any, id: string, token: string) {
    const job = await tx.gradingJob.findUnique({ where: { id } });
    const proof = await tx.systemSetting.findUnique({ where: { id: key(id) } });
    if (
      !job ||
      job.status !== 'RUNNING' ||
      !job.leaseUntil ||
      job.leaseUntil < new Date() ||
      !proof ||
      !equal(proof.value, digest(token, c.secret))
    )
      fail(409, '工作任务已失效或由老师接管');
    return job;
  }
  app.post('/api/worker/claim', options, async () => {
    const heartbeat = await db.systemSetting.findUnique({ where: { id: 'worker-last-seen' } });
    if (!heartbeat || Date.now() - Date.parse(heartbeat.value) > 30000)
      await db.systemSetting.upsert({
        where: { id: 'worker-last-seen' },
        create: { id: 'worker-last-seen', value: new Date().toISOString() },
        update: { value: new Date().toISOString() },
      });
    // Expired leases have bounded retries; an offline desktop cannot leave an attempt permanently processing.
    const exhausted = await db.gradingJob.findMany({
      where: { status: 'RUNNING', leaseUntil: { lt: new Date() }, tries: { gte: 3 } },
    });
    for (const job of exhausted)
      await db.$transaction(async (tx) => {
        const n = await tx.gradingJob.updateMany({
          where: { id: job.id, status: 'RUNNING', leaseUntil: { lt: new Date() } },
          data: { status: 'FAILED', leaseUntil: null, error: '本地工作进程多次离线，请人工处理' },
        });
        if (n.count)
          await tx.submissionAttempt.updateMany({
            where: { id: job.attemptId, status: 'PROCESSING' },
            data: { status: 'TEACHER_REVIEWING' },
          });
      });
    return db.$transaction(async (tx) => {
      const job = await tx.gradingJob.findFirst({
        where: {
          OR: [
            { status: 'QUEUED' },
            { status: 'RUNNING', leaseUntil: { lt: new Date() }, tries: { lt: 3 } },
          ],
        },
        orderBy: { createdAt: 'asc' },
      });
      if (!job) return { job: null };
      const changed = await tx.gradingJob.updateMany({
        where: { id: job.id, updatedAt: job.updatedAt },
        data: {
          status: 'RUNNING',
          tries: { increment: 1 },
          leaseUntil: new Date(Date.now() + 10 * 60000),
        },
      });
      if (!changed.count) return { job: null };
      const a = await tx.submissionAttempt.findUniqueOrThrow({
        where: { id: job.attemptId },
        include: {
          attachments: true,
          aiGrade: true,
          submission: { include: { assignment: true } },
        },
      });
      if (a.aiGrade || !['SUBMITTED', 'PROCESSING', 'TEACHER_REVIEWING'].includes(a.status)) {
        await tx.gradingJob.update({
          where: { id: job.id },
          data: { status: 'DONE', leaseUntil: null },
        });
        return { job: null };
      }
      await tx.submissionAttempt.update({ where: { id: a.id }, data: { status: 'PROCESSING' } });
      const token = opaque();
      await tx.systemSetting.upsert({
        where: { id: key(job.id) },
        create: { id: key(job.id), value: digest(token, c.secret) },
        update: { value: digest(token, c.secret) },
      });
      return {
        job: {
          id: job.id,
          attemptId: a.id,
          leaseToken: token,
          text: a.text || a.extractedText,
          question: snapshot(a),
          attachments: a.attachments.map((f) => ({
            id: f.id,
            filePath: f.filePath,
            fileName: f.fileName,
            mimeType: f.mimeType,
            size: f.size,
          })),
        },
      };
    });
  });
  app.get('/api/worker/:id/files/:fileId', options, async (req, reply) => {
    const { id, fileId } = z
      .object({ id: z.string().max(100), fileId: z.string().max(100) })
      .parse(req.params);
    const job = await lease(db, id, String(req.headers['x-job-lease'] || ''));
    const f = await db.attachment.findFirst({ where: { id: fileId, attemptId: job.attemptId } });
    if (!f) fail(404, '原稿不存在');
    return reply.type(f!.mimeType).send(await objectStore(c).read(f!.filePath));
  });
  app.post('/api/worker/:id/complete', options, async (req) => {
    const { id } = z.object({ id: z.string().max(100) }).parse(req.params);
    const b = z
      .object({
        leaseToken: z.string().max(100),
        text: z.string().max(30000),
        result: z.unknown(),
        model: z.string().max(100),
        raw: z.string().max(100000).default(''),
      })
      .parse(req.body);
    await db.$transaction(async (tx) => {
      const job = await lease(tx, id, b.leaseToken);
      const a = await tx.submissionAttempt.findUniqueOrThrow({
        where: { id: job.attemptId },
        include: { submission: { include: { assignment: true } } },
      });
      const text = a.text || a.extractedText || b.text;
      if (!text.trim() || b.text !== text) fail(400, '识别结果与已有作答不一致');
      let result!: ReturnType<typeof validateAIResult>;
      try {
        result = validateAIResult({ text, question: snapshot(a) }, b.result);
      } catch {
        fail(400, 'AI 输出未通过评分或批注校验，可重新处理或人工批改');
      }
      const changed = await tx.submissionAttempt.updateMany({
        where: { id: a.id, status: 'PROCESSING' },
        data: {
          status: 'AI_GRADED',
          extractedText: a.text ? a.extractedText : text,
          processingMessage: '',
        },
      });
      if (!changed.count) fail(409, '老师已接管任务');
      await tx.aIGrade.create({
        data: {
          attemptId: a.id,
          model: b.model,
          estimatedScore: result.estimatedScore,
          confidence: result.confidence,
          resultJson: JSON.stringify(result),
          rawResponse: b.raw,
          annotations: { create: result.annotations },
        },
      });
      if (!a.text)
        await tx.oCRResult.upsert({
          where: { attemptId: a.id },
          create: { attemptId: a.id, status: 'SUCCEEDED', text },
          update: { status: 'SUCCEEDED', text, error: '' },
        });
      await tx.gradingJob.update({
        where: { id },
        data: { status: 'DONE', leaseUntil: null, error: null },
      });
      await tx.systemSetting.deleteMany({ where: { id: key(id) } });
      await audit(tx, null, 'local_worker_grade', a.id);
    });
    return { ok: true };
  });
  app.post('/api/worker/:id/fail', options, async (req) => {
    const { id } = z.object({ id: z.string().max(100) }).parse(req.params);
    const b = z.object({ leaseToken: z.string().max(100) }).parse(req.body);
    await db.$transaction(async (tx) => {
      const job = await lease(tx, id, b.leaseToken);
      await tx.gradingJob.update({
        where: { id },
        data: {
          status: 'FAILED',
          leaseUntil: null,
          error: '本地 AI/OCR 处理失败，可人工批改或重试',
        },
      });
      await tx.submissionAttempt.updateMany({
        where: { id: job.attemptId, status: 'PROCESSING' },
        data: { status: 'TEACHER_REVIEWING', processingMessage: '等待老师人工批改' },
      });
      await tx.systemSetting.deleteMany({ where: { id: key(id) } });
    });
    return { ok: true };
  });
}
