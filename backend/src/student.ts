import type { FastifyInstance } from 'fastify';
import type { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import type { Config } from './config.js';
import { auth, audit, fail } from './security.js';
import { idParam, publicQuestion } from './schemas.js';
import {
  requirePermission,
  requireAttemptPermission,
  startAttempt,
  withPoints,
} from './training.js';
const includeAttempt = {
  attachments: {
    orderBy: [{ position: 'asc' as const }, { createdAt: 'asc' as const }, { id: 'asc' as const }],
  },
  finalGrade: true,
};
export function studentAttempt(a: any) {
  const final =
    a.finalGrade?.status === 'PUBLISHED'
      ? {
          id: a.finalGrade.id,
          finalScore: a.finalGrade.finalScore,
          publishedAt: a.finalGrade.publishedAt,
          ...JSON.parse(a.finalGrade.feedbackJson),
        }
      : null;
  // Only immutable, published feedback enters the student DTO.
  return {
    id: a.id,
    attemptNo: a.roundNo || a.attemptNo,
    roundNo: a.roundNo || a.attemptNo,
    version: a.version,
    status: a.status,
    text: a.text,
    answer_type: a.answerType,
    answer_text: a.text,
    student_annotations: JSON.parse(a.studentAnnotations || '[]'),
    annotationsVersion: a.annotationsVersion || 0,
    answer_images: (a.attachments || [])
      .filter((f: any) => f.mimeType.startsWith('image/'))
      .map((f: any) => ({
        id: f.id,
        fileName: f.fileName,
        mimeType: f.mimeType,
        size: f.size,
        position: f.position,
      })),
    extractedText: a.extractedText,
    submittedAt: a.submittedAt,
    updatedAt: a.updatedAt,
    revisionReason: a.revisionReason,
    revisionRequirements: a.revisionRequirements,
    revisionDueAt: a.revisionDueAt,
    attachments: (a.attachments || []).map((f: any) => ({
      id: f.id,
      fileName: f.fileName,
      size: f.size,
      mimeType: f.mimeType,
      position: f.position,
    })),
    finalGrade: final,
    question: a.questionSnapshot ? publicQuestion(a.questionSnapshot) : undefined,
  };
}
export function registerStudent(app: FastifyInstance, db: PrismaClient, c: Config) {
  const student = auth(db, c, ['STUDENT']);
  async function assigned(id: string, userId: string) {
    const a = await db.assignment.findFirst({
      where: { id, recipients: { some: { studentId: userId } } },
    });
    if (!a) fail(404, '题目不存在或未分配给你');
    return a!;
  }
  async function detail(questionId: string, studentId: string) {
    const permission = await db.permission.findUnique({
      where: { studentId_questionId: { studentId, questionId } },
    });
    const attempts = await db.submissionAttempt.findMany({
      where: { studentId, questionId },
      orderBy: { roundNo: 'desc' },
      include: includeAttempt,
    });
    const authorized = !!permission && !permission.revokedAt;
    if (!authorized && !attempts.some((a) => a.submittedAt)) fail(404, '题目不存在或未授权');
    const q = await db.question.findUniqueOrThrow({
      where: { id: questionId },
      include: withPoints,
    });
    const assignment = await db.assignment.findFirst({
      where: { questionId, recipients: { some: { studentId } } },
      orderBy: { createdAt: 'desc' },
    });
    const published = attempts
      .filter((a) => a.finalGrade?.status === 'PUBLISHED')
      .sort((a, b) => a.roundNo - b.roundNo);
    const scores = published.map((a) => ({
      round: a.roundNo,
      score: a.finalGrade!.finalScore,
      publishedAt: a.finalGrade!.publishedAt,
    }));
    const trainingQuestion = attempts.at(-1)?.questionSnapshot || JSON.stringify(q);
    return {
      id: q.id,
      title: JSON.parse(trainingQuestion).title,
      question: publicQuestion(trainingQuestion),
      assignmentId: assignment?.id,
      dueAt: assignment?.dueAt,
      authorized,
      attempts: attempts.filter((a) => authorized || a.submittedAt).map(studentAttempt),
      scores,
      improvement: scores.length > 1 ? scores[scores.length - 1].score - scores[0].score : 0,
      referenceUnlocked:
        !!published.length &&
        q.allowReference &&
        (q.autoUnlockReference || !!permission?.referenceUnlocked),
      completed: published.some((a) => a.roundNo >= 3),
      maxAttempts: 3,
    };
  }
  app.get('/api/student/questions', { preHandler: student }, async (req) => {
    const [grants, history] = await Promise.all([
      db.permission.findMany({
        where: { studentId: req.actor.id, revokedAt: null },
        select: { questionId: true },
      }),
      db.submissionAttempt.findMany({
        where: { studentId: req.actor.id, submittedAt: { not: null } },
        select: { questionId: true },
        distinct: ['questionId'],
      }),
    ]);
    const ids = [...new Set([...grants, ...history].map((x) => x.questionId))];
    return Promise.all(
      ids.map(async (id) => {
        const d = await detail(id, req.actor.id);
        return { ...d, latest: d.attempts[0] || null, attempts: undefined };
      }),
    );
  });
  app.get('/api/student/questions/:id', { preHandler: student }, (req) =>
    detail(idParam.parse(req.params).id, req.actor.id),
  );
  app.get('/api/student/questions/:id/reference', { preHandler: student }, async (req) => {
    const id = idParam.parse(req.params).id,
      d = await detail(id, req.actor.id);
    if (!d.referenceUnlocked) fail(403, '参考答案尚未解锁，请等待老师发布首轮结果或联系老师');
    const first = await db.submissionAttempt.findFirst({
      where: { studentId: req.actor.id, questionId: id, finalGrade: { status: 'PUBLISHED' } },
      orderBy: { roundNo: 'asc' },
    });
    const q = first?.questionSnapshot
      ? JSON.parse(first.questionSnapshot)
      : await db.question.findUniqueOrThrow({ where: { id }, include: withPoints });
    return {
      referenceAnswer: q.referenceAnswer,
      rubric: q.rubric,
      scoringPoints: (q.scoringPoints || []).map((p: any) => ({
        label: p.label,
        description: p.description,
        points: p.points,
      })),
      maxScore: q.maxScore,
    };
  });
  app.post('/api/student/questions/:id/start', { preHandler: student }, async (req) => {
    const id = idParam.parse(req.params).id;
    await requirePermission(db, req.actor.id, id);
    const assignment = await db.assignment.findFirst({
      where: { questionId: id, recipients: { some: { studentId: req.actor.id } } },
      orderBy: { createdAt: 'desc' },
    });
    if (!assignment) fail(409, '授权记录尚无作业，请联系老师重新授权');
    const a = await startAttempt(db, assignment!.id, req.actor.id);
    const sub = await db.submission.findUniqueOrThrow({ where: { id: a.submissionId } });
    return { ...studentAttempt(a), assignmentId: sub.assignmentId };
  });
  app.get('/api/student/assignments', { preHandler: student }, async (req) => {
    const rows = await db.assignment.findMany({
      where: { recipients: { some: { studentId: req.actor.id } } },
      orderBy: { createdAt: 'desc' },
    });
    const out = [];
    for (const a of rows) {
      const grant = await db.permission.findUnique({
        where: { studentId_questionId: { studentId: req.actor.id, questionId: a.questionId } },
      });
      const latest = await db.submissionAttempt.findFirst({
        where: { studentId: req.actor.id, questionId: a.questionId },
        orderBy: { roundNo: 'desc' },
        include: includeAttempt,
      });
      const authorized = !!grant && !grant.revokedAt;
      if (authorized || latest?.submittedAt)
        out.push({
          id: a.id,
          questionId: a.questionId,
          title: a.title,
          dueAt: a.dueAt,
          createdAt: a.createdAt,
          authorized,
          question: publicQuestion(a.questionSnapshot),
          latest: latest ? studentAttempt(latest) : null,
        });
    }
    return out;
  });
  app.get('/api/student/assignments/:id', { preHandler: student }, async (req) => {
    const a = await assigned(idParam.parse(req.params).id, req.actor.id);
    const d = await detail(a.questionId, req.actor.id);
    return { ...d, id: a.id, questionId: a.questionId, title: a.title, dueAt: a.dueAt };
  });
  app.get('/api/student/submissions/:id', { preHandler: student }, async (req) => {
    const sub = await db.submission.findFirst({
      where: { id: idParam.parse(req.params).id, studentId: req.actor.id },
      include: { attempts: { include: includeAttempt, orderBy: { roundNo: 'desc' } } },
    });
    if (!sub) fail(404, '提交记录不存在');
    return {
      id: sub!.id,
      assignmentId: sub!.assignmentId,
      attempts: sub!.attempts.map(studentAttempt),
    };
  });
  app.post('/api/student/assignments/:id/draft', { preHandler: student }, async (req) =>
    studentAttempt(await startAttempt(db, idParam.parse(req.params).id, req.actor.id)),
  );
  app.put('/api/student/attempts/:id/draft', { preHandler: student }, async (req) => {
    const { id } = idParam.parse(req.params),
      body = z
        .object({
          text: z.string().max(30000),
          version: z.number().int().nonnegative(),
          answer_type: z.enum(['text', 'image', 'mixed']).optional(),
        })
        .parse(req.body);
    await db.$transaction(async (tx) => {
      await requireAttemptPermission(tx, id, req.actor.id);
      const r = await tx.submissionAttempt.updateMany({
        where: { id, status: 'DRAFT', version: body.version, studentId: req.actor.id },
        data: {
          text: body.text,
          ...(body.answer_type ? { answerType: body.answer_type } : {}),
          version: { increment: 1 },
        },
      });
      if (!r.count)
        fail(409, '草稿已在其他设备更新，或已经提交。请重新载入，当前文字仍保存在本机。');
    });
    return { version: body.version + 1, savedAt: new Date() };
  });
  app.post('/api/student/attempts/:id/submit', { preHandler: student }, async (req) => {
    const { id } = idParam.parse(req.params),
      { version } = z.object({ version: z.number().int().nonnegative() }).parse(req.body);
    return db.$transaction(async (tx) => {
      const a = await tx.submissionAttempt.findFirst({
        where: { id, studentId: req.actor.id },
        include: { attachments: true, submission: { include: { assignment: true } } },
      });
      if (!a) fail(404, '作业不存在');
      if (a!.status !== 'DRAFT') return { id, status: a!.status };
      await requirePermission(tx, req.actor.id, a!.questionId);
      if (a!.roundNo > 3) fail(409, '本题最多三次训练');
      const previous = await tx.submissionAttempt.findFirst({
        where: { studentId: req.actor.id, questionId: a!.questionId, roundNo: a!.roundNo - 1 },
        include: { finalGrade: true },
      });
      if (a!.roundNo > 1 && previous?.finalGrade?.status !== 'PUBLISHED')
        fail(409, '请等待老师发布上一次结果');
      if ((previous?.revisionDueAt || a!.submission.assignment.dueAt) < new Date())
        fail(409, '已过截止时间，请联系老师延长截止时间');
      if (!a!.text.trim() && !a!.attachments.length) fail(400, '请填写答案或上传作业');
      const manual = !['ollama', 'remote-worker'].includes(c.aiProvider);
      const status = manual ? 'TEACHER_REVIEWING' : 'SUBMITTED';
      const changed = await tx.submissionAttempt.updateMany({
        where: { id, status: 'DRAFT', version },
        data: {
          status,
          answerType: a!.attachments.length ? (a!.text.trim() ? 'mixed' : 'image') : 'text',
          submittedAt: new Date(),
          version: { increment: 1 },
          processingMessage: manual ? '等待老师人工批改' : '',
        },
      });
      if (!changed.count) fail(409, '草稿版本已更新，请重新载入');
      if (!manual) await tx.gradingJob.create({ data: { attemptId: id } });
      await audit(tx, req.actor.id, 'submit_assignment', id);
      return { id, status };
    });
  });
  app.get('/api/student/notifications', { preHandler: student }, (req) =>
    db.notification.findMany({
      where: { userId: req.actor.id },
      orderBy: { createdAt: 'desc' },
      take: 100,
    }),
  );
  app.post('/api/student/notifications/read', { preHandler: student }, async (req) => {
    await db.notification.updateMany({
      where: { userId: req.actor.id, readAt: null },
      data: { readAt: new Date() },
    });
    return { ok: true };
  });
  app.get('/api/student/courses', { preHandler: student }, async (req) => {
    const rows = await db.coursePermission.findMany({
      where: { studentId: req.actor.id, revokedAt: null },
      include: { course: true },
    });
    const profile = await db.studentProfile.findUnique({ where: { userId: req.actor.id } });
    return {
      serviceType: profile?.serviceType,
      courses: rows.map((p) => ({
        id: p.courseId,
        name: p.course.name,
        description: p.course.description,
        delivery: '录播资料由老师通过微信发送',
      })),
    };
  });
  app.get('/api/student/stats', { preHandler: student }, async (req) => {
    const grades = await db.finalGrade.findMany({
      where: { status: 'PUBLISHED', attempt: { studentId: req.actor.id } },
      include: { attempt: { include: { submission: { include: { assignment: true } } } } },
      orderBy: { publishedAt: 'asc' },
    });
    const weakness: Record<string, number> = {};
    const scores = grades.map((g) => {
      const f = JSON.parse(g.feedbackJson);
      for (const a of f.annotations || []) weakness[a.category] = (weakness[a.category] || 0) + 1;
      return {
        score: g.finalScore,
        maxScore: publicQuestion(
          g.attempt.questionSnapshot || g.attempt.submission.assignment.questionSnapshot,
        ).maxScore,
        title: g.attempt.submission.assignment.title,
        date: g.publishedAt,
        assignmentId: g.attempt.submission.assignmentId,
        questionId: g.attempt.questionId,
        round: g.attempt.roundNo,
      };
    });
    const grants = await db.permission.findMany({
        where: { studentId: req.actor.id, revokedAt: null },
        select: { questionId: true },
      }),
      active = new Set(grants.map((g) => g.questionId));
    return {
      scores,
      weakness,
      total: active.size,
      completed: new Set(
        grades
          .filter((g) => g.attempt.roundNo >= 3 && active.has(g.attempt.questionId))
          .map((g) => g.attempt.questionId),
      ).size,
      submissionCount: await db.submissionAttempt.count({
        where: { studentId: req.actor.id, submittedAt: { not: null } },
      }),
    };
  });
}
