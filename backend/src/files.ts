import type { FastifyInstance } from 'fastify';
import type { PrismaClient } from '@prisma/client';
import { createHash, randomUUID } from 'node:crypto';
import { objectStore, localPath, withLocalObject } from './object-store.js';

import path from 'node:path';
import { fileTypeFromBuffer } from 'file-type';
import yauzl from 'yauzl';
import type { Config } from './config.js';
import { auth, fail, teacherScope, audit } from './security.js';
import { idParam } from './schemas.js';
import { lockStorage } from './storage-lock.js';
import { requireAttemptPermission } from './training.js';
import { pdfPage } from './preview.js';
import { z } from 'zod';
export const MAX_FILE_BYTES = 10 * 1024 * 1024;
export async function validateUpload(name: string, bytes: Buffer) {
  if (!name || name.length > 180 || /[\\/\x00-\x1f]/.test(name) || name.includes('..'))
    fail(400, '文件名不合法');
  if (!bytes.length || bytes.length > MAX_FILE_BYTES) fail(400, '单个文件应为 1 字节至 10 MB');
  const ext = path.extname(name).toLowerCase();
  const allowed: Record<string, string> = {
    '.pdf': 'application/pdf',
    '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.txt': 'text/plain',
  };
  if (!allowed[ext]) fail(400, '支持 PDF、DOCX、TXT、JPG、PNG');
  if (allowed[ext].startsWith('image/') && bytes.length > 2 * 1024 * 1024)
    fail(400, '照片压缩后不能超过 2 MB，请裁剪或分成多张上传');
  if (ext === '.txt') {
    try {
      new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    } catch {
      fail(400, 'TXT 请使用 UTF-8 编码');
    }
    if (bytes.includes(0)) fail(400, 'TXT 包含二进制内容');
  } else {
    const type = await fileTypeFromBuffer(bytes);
    if (!type || type.mime !== allowed[ext]) fail(400, '文件内容与扩展名不匹配');
  }
  if (ext === '.docx') await validateZip(bytes);
  return { ext, mime: allowed[ext] };
}
async function validateZip(bytes: Buffer) {
  await new Promise<void>((resolve, reject) =>
    yauzl.fromBuffer(bytes, { lazyEntries: true }, (err, zip) => {
      if (err || !zip) return reject(Error('DOCX 文件损坏'));
      let total = 0,
        count = 0,
        hasDocument = false;
      zip.on('entry', (e) => {
        total += e.uncompressedSize;
        count++;
        if (e.fileName === 'word/document.xml') hasDocument = true;
        if (
          total > 25 * 1024 * 1024 ||
          count > 2000 ||
          /(^|\/)\.\.(\/|$)/.test(e.fileName) ||
          e.generalPurposeBitFlag & 1
        ) {
          zip.close();
          return reject(Error('DOCX 压缩内容超限或不安全'));
        }
        zip.readEntry();
      });
      zip.on('end', () => (hasDocument ? resolve() : reject(Error('无效 DOCX 文档'))));
      zip.on('error', reject);
      zip.readEntry();
    }),
  ).catch(() => fail(400, 'DOCX 损坏、加密或解压后过大'));
}
export const storedPath = localPath;
export function registerFiles(app: FastifyInstance, db: PrismaClient, c: Config) {
  const store = objectStore(c);
  app.post(
    '/api/student/attempts/:id/files',
    {
      preHandler: auth(db, c, ['STUDENT']),
      config: { rateLimit: { max: 15, timeWindow: '1 minute' } },
    },
    async (req) => {
      const release = await lockStorage();
      try {
        const { id } = idParam.parse(req.params);
        const a = await db.submissionAttempt.findFirst({
          where: { id, status: 'DRAFT', submission: { studentId: req.actor.id } },
        });
        if (!a) fail(404, '草稿不存在');
        await requireAttemptPermission(db, id, req.actor.id);
        const upload = await req.file({
          limits: { files: 1, fileSize: MAX_FILE_BYTES, fields: 0 },
        });
        if (!upload) fail(400, '请选择文件');
        const originalName = (req.query as { name?: string }).name || upload!.filename;
        if (typeof originalName !== 'string') fail(400, '文件名不合法');
        const bytes = await upload!.toBuffer();
        const { ext, mime } = await validateUpload(originalName, bytes);
        const checksum = createHash('sha256').update(bytes).digest('hex');
        const duplicate = await db.attachment.findFirst({ where: { attemptId: id, checksum } });
        if (duplicate)
          return {
            id: duplicate.id,
            fileName: duplicate.fileName,
            size: duplicate.size,
            mimeType: duplicate.mimeType,
            position: duplicate.position,
            version: a!.version,
          };
        const existing = await db.attachment.findFirst({
          where: { checksum, mimeType: mime, size: bytes.length },
        });
        const reusable = existing && (await store.exists(existing.filePath));
        const filePath = reusable ? existing!.filePath : randomUUID() + ext;
        if (!reusable) await store.put(filePath, bytes, mime);
        try {
          return await db.$transaction(async (tx) => {
            await requireAttemptPermission(tx, id, req.actor.id);
            const lock = await tx.submissionAttempt.updateMany({
              where: { id, status: 'DRAFT', version: a!.version },
              data: { version: { increment: 1 } },
            });
            if (!lock.count) fail(409, '草稿已更新，请重新上传');
            const count = await tx.attachment.count({ where: { attemptId: id } });
            if (count >= 5) fail(400, '每次作答最多 5 个附件');
            const last = await tx.attachment.aggregate({
              where: { attemptId: id },
              _max: { position: true },
            });
            const file = await tx.attachment.create({
              data: {
                attemptId: id,
                filePath,
                fileName: originalName,
                mimeType: mime,
                size: bytes.length,
                checksum,
                position: (last._max.position ?? -1) + 1,
              },
            });
            await audit(tx, req.actor.id, 'upload_file', file.id);
            return {
              id: file.id,
              fileName: file.fileName,
              size: file.size,
              mimeType: file.mimeType,
              position: file.position,
              version: a!.version + 1,
            };
          });
        } catch (e) {
          if (!reusable) await store.remove(filePath);
          throw e;
        }
      } finally {
        release();
      }
    },
  );
  app.put(
    '/api/student/attempts/:id/files/order',
    { preHandler: auth(db, c, ['STUDENT']) },
    async (req) => {
      const { id } = idParam.parse(req.params);
      const body = z
        .object({
          version: z.number().int().nonnegative(),
          ids: z.array(z.string().min(1).max(100)).max(5),
        })
        .parse(req.body);
      return db.$transaction(async (tx) => {
        const a = await requireAttemptPermission(tx, id, req.actor.id);
        const files = await tx.attachment.findMany({
          where: { attemptId: id },
          select: { id: true },
        });
        if (a.status !== 'DRAFT') fail(409, '本轮已提交，图片顺序不能修改');
        if (
          body.ids.length !== files.length ||
          new Set(body.ids).size !== files.length ||
          files.some((f) => !body.ids.includes(f.id))
        )
          fail(400, '图片列表已改变，请重新载入');
        const updated = await tx.submissionAttempt.updateMany({
          where: { id, studentId: req.actor.id, status: 'DRAFT', version: body.version },
          data: { version: { increment: 1 } },
        });
        if (!updated.count) fail(409, '草稿已在其他设备更新，请重新载入');
        for (let position = 0; position < body.ids.length; position++)
          await tx.attachment.update({ where: { id: body.ids[position] }, data: { position } });
        return { version: body.version + 1, ids: body.ids };
      });
    },
  );
  app.delete('/api/student/files/:id', { preHandler: auth(db, c, ['STUDENT']) }, async (req) => {
    const release = await lockStorage();
    try {
      const { id } = idParam.parse(req.params);
      const f = await db.attachment.findFirst({
        where: { id, attempt: { status: 'DRAFT', submission: { studentId: req.actor.id } } },
      });
      if (!f) fail(404, '附件不存在');
      const version = await db.$transaction(async (tx) => {
        await requireAttemptPermission(tx, f!.attemptId, req.actor.id);
        const n = await tx.submissionAttempt.updateMany({
          where: { id: f!.attemptId, status: 'DRAFT' },
          data: { version: { increment: 1 } },
        });
        if (!n.count) fail(409, '作业已提交');
        await tx.attachment.delete({ where: { id } });
        return (await tx.submissionAttempt.findUniqueOrThrow({ where: { id: f!.attemptId } }))
          .version;
      });
      if (!(await db.attachment.count({ where: { filePath: f!.filePath } })))
        await store.remove(f!.filePath).catch(() => {});
      return { version };
    } finally {
      release();
    }
  });
  app.get('/api/files/:id', { preHandler: auth(db, c) }, async (req, reply) => {
    const { id } = idParam.parse(req.params);
    const where =
      req.actor.role === 'STUDENT'
        ? { submission: { studentId: req.actor.id } }
        : { submission: { assignment: teacherScope(req.actor) } };
    const f = await db.attachment.findFirst({ where: { id, attempt: where } });
    if (!f) fail(404, '文件不存在');
    if (!(await store.exists(f!.filePath))) fail(410, '原稿已到保存期限或不可用，请联系老师');
    return reply
      .header(
        'Content-Disposition',
        `attachment; filename="submission${path.extname(f!.fileName)}"; filename*=UTF-8''${encodeURIComponent(f!.fileName)}`,
      )
      .header('X-Content-Type-Options', 'nosniff')
      .type(f!.mimeType)
      .send(await store.read(f!.filePath));
  });
  const cache = new Map<string, { at: number; value: Awaited<ReturnType<typeof pdfPage>> }>();
  app.get(
    '/api/files/:id/preview',
    { preHandler: auth(db, c), config: { rateLimit: { max: 90, timeWindow: '1 minute' } } },
    async (req, reply) => {
      const { id } = idParam.parse(req.params),
        { page, info } = z
          .object({
            page: z.coerce.number().int().min(1).max(100).default(1),
            info: z.enum(['true', 'false']).default('false'),
          })
          .parse(req.query);
      const where =
        req.actor.role === 'STUDENT'
          ? { submission: { studentId: req.actor.id } }
          : { submission: { assignment: teacherScope(req.actor) } };
      const f = await db.attachment.findFirst({ where: { id, attempt: where } });
      if (!f) fail(404, '文件不存在');
      if (!(await store.exists(f!.filePath))) fail(410, '原稿已到保存期限或不可用，请联系老师');
      if (f!.mimeType.startsWith('image/')) {
        if (page !== 1) fail(404, '页码不存在');
        if (info === 'true') return { total: 1 };
        return reply.type(f!.mimeType).send(await store.read(f!.filePath));
      }
      if (f!.mimeType !== 'application/pdf') fail(400, '此文件请下载查看；图片和 PDF 支持原稿批注');
      const key = f!.checksum + ':' + page;
      let rendered = cache.get(key)?.value;
      if (!rendered || Date.now() - cache.get(key)!.at > 10 * 60000) {
        try {
          rendered = await withLocalObject(c, f!.filePath, (p) => pdfPage(p, page));
        } catch {
          fail(422, 'PDF 页面暂时无法预览，请下载原稿查看');
        }
        cache.set(key, { at: Date.now(), value: rendered! });
        let bytes = [...cache.values()].reduce((s, x) => s + x.value.data.length, 0);
        while (bytes > 24 * 1024 * 1024 && cache.size > 1) {
          const first = cache.keys().next().value!;
          bytes -= cache.get(first)!.value.data.length;
          cache.delete(first);
        }
      }
      if (info === 'true')
        return {
          total: Math.min(rendered!.total, 100),
          actualTotal: rendered!.total,
          width: rendered!.width,
          height: rendered!.height,
        };
      return reply.type('image/png').send(Buffer.from(rendered!.data, 'base64'));
    },
  );
}
