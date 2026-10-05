import type { FastifyInstance } from 'fastify';
import type { PrismaClient, Prisma } from '@prisma/client';
import { randomInt } from 'node:crypto';
import { z } from 'zod';
import type { Config } from './config.js';
import { auth, audit, digest, fail, hashPassword, publicUser, teacherScope } from './security.js';
import { idParam, questionSchema, reviewSchema, validOffsets } from './schemas.js';
import { withPoints, snapshot } from './training.js';
export const reviewText = (a: any) => a.text || a.extractedText;
export function registerTeacher(app: FastifyInstance, db: PrismaClient, c: Config) {
  const teacher = auth(db, c, ['ADMIN', 'TEACHER']);
  const admin = auth(db, c, ['ADMIN']);
  const attemptInclude = {
    attachments: { orderBy: [{ position: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }] },
    aiGrade: { include: { annotations: true } },
    review: { include: { annotations: true } },
    finalGrade: true,
    job: true,
    ocrResult: true,
    submission: { include: { student: { select: { id: true, name: true } }, assignment: true } },
  } satisfies Prisma.SubmissionAttemptInclude;
  async function attempt(id: string, actor: any) {
    const a = await db.submissionAttempt.findFirst({
      where: { id, submission: { assignment: teacherScope(actor) } },
      include: attemptInclude,
    });
    if (!a) fail(404, '提交不存在或未授权');
    return a!;
  }
  async function ownedStudent(id: string, actor: any) {
    const s = await db.studentProfile.findFirst({
      where: { userId: id, ...teacherScope(actor) },
      include: { user: true },
    });
    if (!s) fail(404, '学生不存在或未授权');
    return s!;
  }
  async function bindingCode(id: string) {
    for (let i = 0; i < 10; i++) {
      const code = String(randomInt(100000, 1000000));
      const hash = digest(code, c.secret);
      if (await db.studentProfile.findUnique({ where: { bindingHash: hash } })) continue;
      const expiresAt = new Date(Date.now() + 24 * 3600000);
      await db.studentProfile.update({
        where: { userId: id },
        data: { bindingHash: hash, bindingExpiresAt: expiresAt },
      });
      return { bindingCode: code, expiresAt };
    }
    fail(503, '绑定码生成繁忙，请重试');
  }
  app.get('/api/teacher/students', { preHandler: teacher }, async (req) => {
    const users = await db.user.findMany({
      where: { role: 'STUDENT', student: teacherScope(req.actor) },
      include: {
        student: true,
        identity: { select: { id: true } },
        submissions: {
          include: {
            attempts: {
              select: {
                submittedAt: true,
                finalGrade: { select: { finalScore: true, publishedAt: true } },
              },
            },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
    return users.map((u) => {
      const attempts = u.submissions.flatMap((s) => s.attempts),
        grades = attempts
          .flatMap((a) => (a.finalGrade ? [a.finalGrade] : []))
          .sort((a, b) => b.publishedAt.getTime() - a.publishedAt.getTime());
      return {
        ...publicUser(u),
        disabled: u.disabled,
        contact: u.student?.contact,
        serviceType: u.student?.serviceType,
        notes: u.student?.notes,
        createdAt: u.createdAt,
        lastLoginAt: u.lastLoginAt,
        bound: !!u.identity,
        webReady: !!u.passwordHash,
        submissions: attempts.filter((a) => a.submittedAt).length,
        average: grades.length
          ? Math.round((grades.reduce((v, g) => v + g.finalScore, 0) / grades.length) * 10) / 10
          : null,
        latestScore: grades[0]?.finalScore ?? null,
      };
    });
  });
  app.post('/api/teacher/students', { preHandler: teacher }, async (req) => {
    const b = z
      .object({ name: z.string().trim().min(1).max(80), contact: z.string().max(100).default('') })
      .parse(req.body);
    const u = await db.user.create({
      data: {
        name: b.name,
        role: 'STUDENT',
        student: { create: { teacherId: req.actor.id, contact: b.contact } },
      },
    });
    await audit(db, req.actor.id, 'create_user', u.id);
    return { ...publicUser(u), ...(await bindingCode(u.id)) };
  });
  app.patch('/api/teacher/students/:id', { preHandler: teacher }, async (req) => {
    const { id } = idParam.parse(req.params);
    await ownedStudent(id, req.actor);
    const b = z
      .object({
        name: z.string().trim().min(1).max(80),
        contact: z.string().max(100),
        disabled: z.boolean(),
        serviceType: z.string().max(200).optional(),
        notes: z.string().max(5000).optional(),
      })
      .parse(req.body);
    await db.$transaction(async (tx) => {
      await tx.user.update({
        where: { id },
        data: {
          name: b.name,
          disabled: b.disabled,
          student: { update: { contact: b.contact, serviceType: b.serviceType, notes: b.notes } },
        },
      });
      if (b.disabled) await tx.session.deleteMany({ where: { userId: id } });
      await audit(tx, req.actor.id, b.disabled ? 'disable_user' : 'edit_user', id);
    });
    return { ok: true };
  });
  app.post('/api/teacher/students/:id/binding-code', { preHandler: teacher }, async (req) => {
    const { id } = idParam.parse(req.params);
    await ownedStudent(id, req.actor);
    if (await db.wechatIdentity.findUnique({ where: { userId: id } }))
      fail(409, '该学生已绑定微信');
    const result = await bindingCode(id);
    await audit(db, req.actor.id, 'generate_binding_code', id);
    return result;
  });
  app.post('/api/teacher/students/:id/reset-web-account', { preHandler: teacher }, async (req) => {
    const { id } = idParam.parse(req.params);
    await ownedStudent(id, req.actor);
    const code = String(randomInt(100000, 1000000)),
      bindingHash = digest(code, c.secret),
      expiresAt = new Date(Date.now() + 24 * 3600000);
    await db.$transaction(async (tx) => {
      await tx.user.update({ where: { id }, data: { passwordHash: null } });
      await tx.studentProfile.update({
        where: { userId: id },
        data: { bindingHash, bindingExpiresAt: expiresAt },
      });
      await tx.session.deleteMany({ where: { userId: id } });
      await audit(tx, req.actor.id, 'reset_student_web_account', id);
    });
    return { bindingCode: code, expiresAt };
  });
  app.get('/api/teacher/questions', { preHandler: teacher }, async (req) =>
    db.question.findMany({
      where: teacherScope(req.actor),
      include: withPoints,
      orderBy: { createdAt: 'desc' },
    }),
  );
  app.post('/api/teacher/questions', { preHandler: teacher }, async (req) => {
    const { scoringPoints, ...b } = questionSchema.parse(req.body);
    const q = await db.question.create({
      data: {
        ...b,
        teacherId: req.actor.id,
        scoringPoints: { create: scoringPoints.map((p, position) => ({ ...p, position })) },
      },
      include: withPoints,
    });
    await audit(db, req.actor.id, 'create_question', q.id);
    return q;
  });
  app.get('/api/teacher/assignments', { preHandler: teacher }, async (req) =>
    db.assignment.findMany({
      where: teacherScope(req.actor),
      include: { _count: { select: { recipients: true, submissions: true } } },
      orderBy: { createdAt: 'desc' },
    }),
  );
  app.post('/api/teacher/assignments', { preHandler: teacher }, async (req) => {
    const b = z
      .object({
        title: z.string().trim().min(1).max(200),
        questionId: z.string(),
        studentIds: z.array(z.string()).min(1).max(2000),
        dueAt: z.iso.datetime(),
      })
      .parse(req.body);
    if (new Date(b.dueAt) <= new Date()) fail(400, '截止时间必须晚于当前时间');
    const q = await db.question.findFirst({
      where: { id: b.questionId, ...teacherScope(req.actor) },
      include: withPoints,
    });
    if (!q) fail(404, '题目不存在');
    const ids = [...new Set(b.studentIds)];
    const count = await db.user.count({
      where: {
        id: { in: ids },
        role: 'STUDENT',
        disabled: false,
        student: teacherScope(req.actor),
      },
    });
    if (count !== ids.length) fail(403, '包含未授权或已停用学生');
    const a = await db.$transaction(async (tx) => {
      for (const studentId of ids)
        await tx.permission.upsert({
          where: { studentId_questionId: { studentId, questionId: q!.id } },
          create: { studentId, questionId: q!.id, teacherId: q!.teacherId, source: 'ASSIGNMENT' },
          update: { revokedAt: null, source: 'ASSIGNMENT' },
        });
      return tx.assignment.create({
        data: {
          title: b.title,
          teacherId: req.actor.id,
          questionId: q!.id,
          questionSnapshot: JSON.stringify(q),
          dueAt: new Date(b.dueAt),
          recipients: { create: ids.map((studentId) => ({ studentId })) },
        },
      });
    });
    await audit(db, req.actor.id, 'create_assignment', a.id);
    return a;
  });
  app.patch('/api/teacher/assignments/:id', { preHandler: teacher }, async (req) => {
    const { id } = idParam.parse(req.params);
    const { dueAt } = z.object({ dueAt: z.iso.datetime() }).parse(req.body);
    if (new Date(dueAt) <= new Date()) fail(400, '请输入未来时间');
    const x = await db.assignment.updateMany({
      where: { id, ...teacherScope(req.actor) },
      data: { dueAt: new Date(dueAt) },
    });
    if (!x.count) fail(404, '作业不存在');
    await audit(db, req.actor.id, 'extend_assignment', id);
    return { ok: true };
  });
  app.get('/api/teacher/submissions', { preHandler: teacher }, async (req) =>
    db.submissionAttempt.findMany({
      where: { status: { not: 'DRAFT' }, submission: { assignment: teacherScope(req.actor) } },
      include: {
        submission: {
          include: {
            student: { select: { id: true, name: true } },
            assignment: { select: { id: true, title: true } },
          },
        },
        aiGrade: { select: { id: true } },
        finalGrade: { select: { finalScore: true } },
        job: { select: { status: true, error: true } },
      },
      orderBy: { submittedAt: 'desc' },
    }),
  );
  app.get('/api/teacher/submissions/:id', { preHandler: teacher }, async (req) =>
    attempt(idParam.parse(req.params).id, req.actor),
  );
  app.put('/api/teacher/submissions/:id/review', { preHandler: teacher }, async (req) => {
    const { id } = idParam.parse(req.params);
    const a = await attempt(id, req.actor);
    const b = reviewSchema.parse(req.body);
    if (b.finalScore > snapshot(a).maxScore) fail(400, '评分不能超过题目满分');
    if (!validOffsets(b.annotations, reviewText(a)))
      fail(400, '批注选中文字与原文不一致，请重新选择');
    const { version, annotations, pageAnnotations, ...fields } = b;
    const previousPages = JSON.parse(a.review?.pageAnnotations || '[]');
    for (const p of pageAnnotations)
      if (
        !a.attachments.some(
          (f) =>
            f.id === p.fileId &&
            (f.mimeType.startsWith('image/') ? p.page === 1 : f.mimeType === 'application/pdf'),
        )
      )
        fail(400, '原稿批注必须对应本次作答的图片或 PDF 页面');
    if (new Set(pageAnnotations.map((p) => p.id)).size !== pageAnnotations.length)
      fail(400, '批注编号重复');
    const data = {
      ...fields,
      pageAnnotations: JSON.stringify(
        pageAnnotations.map((p) => ({
          ...p,
          author: previousPages.find((x: any) => x.id === p.id)?.author || req.actor.id,
          createdAt:
            previousPages.find((x: any) => x.id === p.id)?.createdAt || new Date().toISOString(),
        })),
      ),
    };
    return db.$transaction(async (tx) => {
      const lock = await tx.submissionAttempt.updateMany({
        where: { id, status: { in: ['SUBMITTED', 'AI_GRADED', 'TEACHER_REVIEWING'] } },
        data: { status: 'TEACHER_REVIEWING' },
      });
      if (!lock.count) fail(409, '作业正在处理、已发布或已要求重做，不能修改此批改');
      let review = await tx.teacherReview.findUnique({ where: { attemptId: id } });
      if (review) {
        const result = await tx.teacherReview.updateMany({
          where: { id: review.id, version },
          data: { ...data, teacherId: req.actor.id, version: { increment: 1 } },
        });
        if (!result.count) fail(409, '另一位老师更新了批改，请刷新后重试');
        await tx.teacherAnnotation.deleteMany({ where: { reviewId: review.id } });
      } else {
        if (version !== 0) fail(409, '批改版本不一致');
        review = await tx.teacherReview.create({
          data: { ...data, attemptId: id, teacherId: req.actor.id },
        });
      }
      for (const annotation of annotations)
        await tx.teacherAnnotation.create({ data: { ...annotation, reviewId: review.id } });
      await audit(tx, req.actor.id, 'teacher_edit_grade', id);
      await audit(tx, req.actor.id, 'teacher_edit_annotation', id);
      return tx.teacherReview.findUnique({
        where: { id: review.id },
        include: { annotations: true },
      });
    });
  });
  app.post('/api/teacher/submissions/:id/publish', { preHandler: teacher }, async (req) => {
    const { id } = idParam.parse(req.params);
    const a = await attempt(id, req.actor);
    const { reviewVersion } = z
      .object({ reviewVersion: z.number().int().positive() })
      .parse(req.body);
    return db.$transaction(async (tx) => {
      const r = await tx.teacherReview.findUnique({
        where: { attemptId: id },
        include: { annotations: true },
      });
      if (!r || r.version !== reviewVersion) fail(409, '请先保存并确认最新的最终分数、评语和批注');
      const locked = await tx.submissionAttempt.updateMany({
        where: { id, status: 'TEACHER_REVIEWING' },
        data: { status: 'PUBLISHED' },
      });
      if (!locked.count) fail(409, '当前状态不能发布，或已发布');
      const { summary, strengths, weaknesses, nextFocus, recommendedResources, annotations } = r!;
      const feedback = {
        pageAnnotations: JSON.parse(r!.pageAnnotations),
        summary,
        strengths,
        weaknesses,
        nextFocus,
        recommendedResources,
        annotations: annotations.map(
          ({ startOffset, endOffset, selectedText, category, severity, comment, suggestion }) => ({
            startOffset,
            endOffset,
            selectedText,
            category,
            severity,
            comment,
            suggestion,
          }),
        ),
      };
      const grade = await tx.finalGrade.create({
        data: {
          attemptId: id,
          finalScore: r!.finalScore,
          feedbackJson: JSON.stringify(feedback),
          publishedBy: req.actor.id,
        },
      });
      await tx.notification.create({
        data: {
          userId: a.submission.studentId,
          title: `你的《${a.submission.assignment.title}》已经批改完成`,
          assignmentId: a.submission.assignmentId,
        },
      });
      await audit(tx, req.actor.id, 'publish_grade', id);
      return grade;
    });
  });
  app.post('/api/teacher/submissions/:id/revision', { preHandler: teacher }, async (req) => {
    const { id } = idParam.parse(req.params);
    const a = await attempt(id, req.actor);
    const b = z
      .object({
        reason: z.string().trim().min(1).max(2000),
        requirements: z.string().trim().min(1).max(3000),
        dueAt: z.iso.datetime(),
      })
      .parse(req.body);
    if (new Date(b.dueAt) < new Date()) fail(400, '重做截止时间必须在未来');
    await db.$transaction(async (tx) => {
      if (!a.finalGrade || a.roundNo >= 3)
        fail(409, '请先发布本次结果；三次训练完成后不能再要求重做');
      const newer = await tx.submissionAttempt.count({
        where: { studentId: a.studentId, questionId: a.questionId, roundNo: { gt: a.roundNo } },
      });
      if (newer) fail(409, '学生已有更新的版本，请处理最新版本');
      const n = await tx.submissionAttempt.updateMany({
        where: {
          id,
          status: {
            in: ['SUBMITTED', 'AI_GRADED', 'TEACHER_REVIEWING', 'PUBLISHED', 'REVISION_REQUESTED'],
          },
        },
        data: {
          status: 'REVISION_REQUESTED',
          revisionReason: b.reason,
          revisionRequirements: b.requirements,
          revisionDueAt: new Date(b.dueAt),
        },
      });
      if (!n.count) fail(409, '作业正在处理或尚未提交');
      await tx.notification.create({
        data: {
          userId: a.submission.studentId,
          title: `请重做《${a.submission.assignment.title}》：${b.reason}`,
          assignmentId: a.submission.assignmentId,
        },
      });
      await audit(tx, req.actor.id, 'request_revision', id);
    });
    return { ok: true };
  });
  app.post('/api/teacher/submissions/:id/retry-ai', { preHandler: teacher }, async (req) => {
    if (!['ollama', 'remote-worker'].includes(c.aiProvider))
      fail(409, '当前为人工批改模式，请直接批改并发布');
    const { id } = idParam.parse(req.params);
    const a = await attempt(id, req.actor);
    if (a.aiGrade || !['SUBMITTED', 'TEACHER_REVIEWING'].includes(a.status))
      fail(409, '只允许重试未生成初批的提交');
    const r = await db.gradingJob.updateMany({
      where: { attemptId: id, status: 'FAILED' },
      data: { status: 'QUEUED', leaseUntil: null, error: null },
    });
    if (!r.count) fail(409, '任务已经在队列中');
    return { ok: true };
  });
  app.get('/api/teacher/dashboard', { preHandler: teacher }, async (req) => {
    const rows = await db.submissionAttempt.groupBy({
      by: ['status'],
      where: { submission: { assignment: teacherScope(req.actor) }, status: { not: 'DRAFT' } },
      _count: { _all: true },
    });
    return {
      counts: Object.fromEntries(rows.map((r) => [r.status, r._count._all])),
      students: await db.studentProfile.count({ where: teacherScope(req.actor) }),
      assignments: await db.assignment.count({ where: teacherScope(req.actor) }),
    };
  });
  app.get('/api/admin/teachers', { preHandler: admin }, async () =>
    db.user.findMany({
      where: { role: { in: ['ADMIN', 'TEACHER'] } },
      select: { id: true, name: true, username: true, role: true, disabled: true },
    }),
  );
  app.post('/api/admin/teachers', { preHandler: admin }, async (req) => {
    const b = z
      .object({
        name: z.string().trim().min(1).max(80),
        username: z.string().trim().min(3).max(100),
        password: z.string().min(10).max(128),
      })
      .parse(req.body);
    const u = await db.user.create({
      data: {
        name: b.name,
        username: b.username.toLowerCase(),
        role: 'TEACHER',
        passwordHash: await hashPassword(b.password),
        teacher: { create: {} },
      },
    });
    await audit(db, req.actor.id, 'create_user', u.id);
    return publicUser(u);
  });
  app.patch('/api/admin/teachers/:id', { preHandler: admin }, async (req) => {
    const { id } = idParam.parse(req.params);
    const b = z
      .object({
        disabled: z.boolean().optional(),
        password: z.string().min(10).max(128).optional(),
      })
      .parse(req.body);
    const u = await db.user.findUnique({ where: { id } });
    if (!u || !['ADMIN', 'TEACHER'].includes(u.role)) fail(404, '教师不存在');
    if (id === req.actor.id && b.disabled) fail(400, '不能停用当前管理员');
    await db.$transaction(async (tx) => {
      await tx.user.update({
        where: { id },
        data: {
          disabled: b.disabled,
          passwordHash: b.password ? await hashPassword(b.password) : undefined,
        },
      });
      await tx.session.deleteMany({ where: { userId: id } });
      await audit(tx, req.actor.id, b.password ? 'reset_password' : 'disable_user', id);
    });
    return { ok: true };
  });
  app.get('/api/admin/status', { preHandler: admin }, async () => ({
    aiProvider: c.aiProvider,
    model: c.ollamaModel,
    ocrEnabled: c.ocrEnabled,
    wechatConfigured: !!(c.wechatAppId && c.wechatSecret),
  }));
  app.get('/api/admin/audit', { preHandler: admin }, async () =>
    db.auditLog.findMany({ orderBy: { createdAt: 'desc' }, take: 100 }),
  );
}
