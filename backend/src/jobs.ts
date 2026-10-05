import type { PrismaClient } from '@prisma/client';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';
import type { Config } from './config.js';
import { audit } from './security.js';
import { withLocalObject } from './object-store.js';
import { createOCRProvider } from './ocr-provider.js';
import { createAIProvider, type AIProvider } from './ai.js';
import { snapshot } from './training.js';
import { pdfPage } from './preview.js';
const exec = promisify(execFile);
export async function extractAttachment(file: any, c: Config) {
  return withLocalObject(c, file.filePath, async (p) => {
    const ext = path.extname(p);
    if (file.mimeType.startsWith('image/')) {
      if (!c.ocrEnabled) throw Error('未开启 OCR，请老师查看附件人工批改');
      return ocrImage(await readFile(p), file.mimeType, file.fileName, c);
    }
    const isTs = import.meta.url.endsWith('.ts');
    const worker = fileURLToPath(
      new URL(isTs ? './extract-worker.ts' : './extract-worker.js', import.meta.url),
    );
    const { stdout } = await exec(
      process.execPath,
      [...(isTs ? ['--import', 'tsx'] : []), worker, p, ext],
      { timeout: 45000, maxBuffer: 1024 * 1024, windowsHide: true },
    );
    const text = JSON.parse(stdout).text as string;
    if (ext === '.pdf' && !text.trim() && c.ocrEnabled) {
      const first = await pdfPage(p, 1);
      if (first.total > 10) throw Error('扫描 PDF 超过自动识别的 10 页上限，请在原稿上人工批改');
      const pages = [];
      for (let n = 1; n <= first.total; n++) {
        const rendered = n === 1 ? first : await pdfPage(p, n);
        pages.push(
          await ocrImage(Buffer.from(rendered.data, 'base64'), 'image/png', 'page.png', c),
        );
      }
      return pages.join('\n\n').slice(0, 30000);
    }
    return text;
  });
}
async function ocrImage(bytes: Buffer, mimeType: string, fileName: string, c: Config) {
  return createOCRProvider(c).extract(bytes, mimeType, fileName);
}
export async function processOneJob(
  db: PrismaClient,
  c: Config,
  provider: AIProvider = createAIProvider(c),
) {
  const candidate = await db.gradingJob.findFirst({
    where: { OR: [{ status: 'QUEUED' }, { status: 'RUNNING', leaseUntil: { lt: new Date() } }] },
    orderBy: { createdAt: 'asc' },
  });
  if (!candidate) return false;
  const lease = await db.gradingJob.updateMany({
    where: { id: candidate.id, updatedAt: candidate.updatedAt },
    data: {
      status: 'RUNNING',
      leaseUntil: new Date(Date.now() + 10 * 60000),
      tries: { increment: 1 },
    },
  });
  if (!lease.count) return true;
  const attemptId = candidate.attemptId;
  try {
    const a = await db.submissionAttempt.findUniqueOrThrow({
      where: { id: attemptId },
      include: {
        attachments: { orderBy: { createdAt: 'asc' } },
        submission: { include: { assignment: true } },
        aiGrade: true,
      },
    });
    if (a.aiGrade || ['PUBLISHED', 'REVISION_REQUESTED', 'ARCHIVED', 'DRAFT'].includes(a.status)) {
      await db.gradingJob.update({
        where: { id: candidate.id },
        data: { status: 'DONE', leaseUntil: null },
      });
      return true;
    }
    await db.submissionAttempt.updateMany({
      where: { id: attemptId, status: { in: ['SUBMITTED', 'TEACHER_REVIEWING', 'PROCESSING'] } },
      data: { status: 'PROCESSING' },
    });
    let text = a.text || a.extractedText;
    if (!text.trim()) {
      const texts: string[] = [];
      for (const f of a.attachments) texts.push(await extractAttachment(f, c));
      text = texts.join('\n\n').slice(0, 30000);
      if (!text.trim()) throw Error('未提取到可用文字，请老师查看原附件人工处理');
      await db.submissionAttempt.update({
        where: { id: attemptId },
        data: { extractedText: text },
      });
      await db.oCRResult.upsert({
        where: { attemptId },
        create: { attemptId, status: 'SUCCEEDED', text },
        update: { status: 'SUCCEEDED', text, error: '' },
      });
    }
    const currentJob = await db.gradingJob.findUnique({ where: { id: candidate.id } });
    if (currentJob?.status !== 'RUNNING') return true;
    if (c.aiProvider === 'disabled' || c.aiProvider === 'manual')
      throw Error('AI 已关闭，等待教师人工批改');
    const { result, raw } = await provider.gradeEssay({
      text,
      question: snapshot(a),
    });
    await db.$transaction(async (tx) => {
      const locked = await tx.submissionAttempt.updateMany({
        where: { id: attemptId, status: 'PROCESSING' },
        data: { status: 'AI_GRADED', processingMessage: '' },
      });
      if (!locked.count) throw Error('作业状态已更改');
      await tx.aIGrade.create({
        data: {
          attemptId,
          model: c.ollamaModel,
          estimatedScore: result.estimatedScore,
          confidence: result.confidence,
          resultJson: JSON.stringify(result),
          rawResponse: raw,
          annotations: { create: result.annotations },
        },
      });
      await tx.gradingJob.update({
        where: { id: candidate.id },
        data: { status: 'DONE', leaseUntil: null, error: null },
      });
      await audit(tx, null, 'ai_grade', attemptId);
    });
  } catch (e) {
    // Do not expose connection details, model output or internal prompts to students.
    const reason =
      e instanceof Error && !/fetch|ENOTFOUND|ECONN|timeout|Abort|Zod/i.test(e.message)
        ? e.message.slice(0, 300)
        : '本地 AI/OCR 不可用或输出不合格，可直接人工批改，稍后重试';
    const source = await db.submissionAttempt.findUnique({
      where: { id: attemptId },
      select: { text: true, extractedText: true },
    });
    if (source && !source.text.trim() && !source.extractedText.trim())
      await db.oCRResult.upsert({
        where: { attemptId },
        create: { attemptId, status: 'FAILED', error: '未能自动提取文字，可查看原稿人工批改' },
        update: {},
      });
    await db.gradingJob.updateMany({
      where: { id: candidate.id, status: 'RUNNING' },
      data: { status: 'FAILED', leaseUntil: null, error: reason },
    });
    await db.submissionAttempt.updateMany({
      where: { id: attemptId, status: { in: ['SUBMITTED', 'PROCESSING'] } },
      data: { status: 'TEACHER_REVIEWING', processingMessage: '等待老师人工批改' },
    });
  }
  return true;
}
export function startWorker(db: PrismaClient, c: Config) {
  // Manual review and a separate local worker never poll the cloud database.
  if (c.aiProvider !== 'ollama') return async () => {};
  let stopped = false,
    active = false;
  const tick = async () => {
    if (stopped || active) return;
    active = true;
    try {
      if (c.aiProvider !== 'remote-worker') await processOneJob(db, c);
    } catch (e) {
      console.error('任务队列暂时不可用');
    } finally {
      active = false;
    }
  };
  const interval = setInterval(tick, 30000);
  void tick();
  return async () => {
    stopped = true;
    clearInterval(interval);
    while (active) await new Promise((resolve) => setTimeout(resolve, 100));
  };
}
