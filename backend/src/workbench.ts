import type { FastifyInstance } from 'fastify';
import type { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import type { Config } from './config.js';
import { auth, audit, fail, teacherScope } from './security.js';
import { dayBounds, withPoints } from './training.js';
import { idParam } from './schemas.js';
export function registerWorkbench(app: FastifyInstance, db: PrismaClient, c: Config) {
  const teacher = auth(db, c, ['ADMIN', 'TEACHER']);
  async function workbench(actor: any, questionId?: string) {
    const scoped = { submission: { assignment: teacherScope(actor) } },
      today = dayBounds(new Date(), c.businessUtcOffset);
    const pending = {
      ...scoped,
      status: { not: 'DRAFT' },
      finalGrade: { is: null },
      submittedAt: today,
      ...(questionId ? { questionId } : {}),
    };
    const rows = await db.submissionAttempt.findMany({
      where: pending,
      select: {
        id: true,
        studentId: true,
        questionId: true,
        roundNo: true,
        status: true,
        submittedAt: true,
        submission: {
          select: {
            student: { select: { name: true } },
            assignment: { select: { title: true, questionId: true } },
          },
        },
      },
      orderBy: [{ submittedAt: 'asc' }, { id: 'asc' }],
    });
    const groups: any[] = [];
    const questions = await db.question.findMany({
      where: { id: { in: [...new Set(rows.map((r) => r.questionId))] } },
      select: { id: true, title: true, type: true, category: true },
    });
    const questionMap = new Map(questions.map((q) => [q.id, q]));
    for (const row of rows) {
      let g = groups.find((g) => g.questionId === row.questionId);
      if (!g) {
        const q = questionMap.get(row.questionId);
        g = {
          questionId: row.questionId,
          title: q?.title || row.submission.assignment.title,
          type: q?.type,
          category: q?.category,
          count: 0,
          students: [],
        };
        groups.push(g);
      }
      g.count++;
      g.students.push({
        id: row.id,
        studentId: row.studentId,
        name: row.submission.student.name,
        roundNo: row.roundNo,
        status: row.status,
        submittedAt: row.submittedAt,
      });
    }
    const [todayPublished, totalPublished, reviewPending, students] = await Promise.all([
      db.finalGrade.count({ where: { publishedAt: today, attempt: scoped } }),
      db.finalGrade.count({ where: { attempt: scoped } }),
      db.submissionAttempt.count({
        where: {
          ...scoped,
          status: { not: 'DRAFT' },
          finalGrade: { is: null },
          submittedAt: { not: null },
        },
      }),
      db.studentProfile.count({ where: teacherScope(actor) }),
    ]);
    return {
      groups,
      rows,
      counts: {
        todayUnreviewed: rows.length,
        todayPublished,
        totalPublished,
        reviewPending,
        students,
      },
      dayStart: today.gte,
      dayEnd: today.lt,
      utcOffsetMinutes: c.businessUtcOffset,
    };
  }
  app.get('/api/teacher/workbench', { preHandler: teacher }, (req) => workbench(req.actor));
  app.get('/api/teacher/today-unreviewed', { preHandler: teacher }, (req) => {
    const { questionId } = z
      .object({ questionId: z.string().max(100).optional() })
      .parse(req.query);
    return workbench(req.actor, questionId);
  });
  app.get('/api/teacher/ai-status', { preHandler: teacher }, async () => {
    if (c.aiProvider === 'remote-worker') {
      const heartbeat = await db.systemSetting.findUnique({ where: { id: 'worker-last-seen' } });
      const connected = !!heartbeat && Date.now() - Date.parse(heartbeat.value) < 90000;
      return {
        ready: connected,
        provider: 'remote-worker',
        message: connected
          ? '本地工作进程已连接；AI 输出仍需老师复核'
          : '本地工作进程离线，可直接人工批改',
      };
    }
    if (c.aiProvider !== 'ollama')
      return { ready: false, provider: c.aiProvider, message: '人工批改模式，可直接批注并发布' };
    try {
      const res = await fetch(c.ollamaUrl.replace(/\/$/, '') + '/api/tags', {
        signal: AbortSignal.timeout(1800),
      });
      const body = (await res.json()) as any;
      const ready =
        res.ok &&
        body.models?.some(
          (m: any) => m.name === c.ollamaModel || m.name === c.ollamaModel + ':latest',
        );
      return {
        ready: !!ready,
        provider: 'ollama',
        model: c.ollamaModel,
        message: ready ? '本地 AI 已就绪' : '本地模型尚未准备好，可直接人工批改',
      };
    } catch {
      return {
        ready: false,
        provider: 'ollama',
        model: c.ollamaModel,
        message: '本地 AI 暂不可用，可直接人工批改',
      };
    }
  });
  app.post('/api/teacher/submissions/:id/manual', { preHandler: teacher }, async (req) => {
    const id = idParam.parse(req.params).id;
    await db.$transaction(async (tx) => {
      const n = await tx.submissionAttempt.updateMany({
        where: {
          id,
          submission: { assignment: teacherScope(req.actor) },
          status: { in: ['SUBMITTED', 'PROCESSING', 'AI_GRADED', 'TEACHER_REVIEWING'] },
        },
        data: { status: 'TEACHER_REVIEWING', processingMessage: '教师已接管人工批改' },
      });
      if (!n.count) fail(409, '当前状态不能切换人工批改');
      await tx.gradingJob.updateMany({
        where: { attemptId: id, status: { in: ['QUEUED', 'RUNNING', 'FAILED'] } },
        data: { status: 'DONE', leaseUntil: null, error: null },
      });
      await audit(tx, req.actor.id, 'manual_review', id);
    });
    return { ok: true };
  });
  app.get('/api/teacher/export', { preHandler: teacher }, async (req, reply) => {
    const { format } = z
      .object({ format: z.enum(['json', 'csv']).default('json') })
      .parse(req.query);
    const scope = teacherScope(req.actor);
    const [students, questions, permissions, courses, attempts, packages, redemptionCodes] =
      await Promise.all([
        db.studentProfile.findMany({
          where: scope,
          select: {
            userId: true,
            contact: true,
            serviceType: true,
            notes: true,
            user: { select: { name: true, disabled: true, createdAt: true } },
          },
        }),
        db.question.findMany({ where: scope, include: withPoints }),
        db.permission.findMany({ where: scope }),
        db.course.findMany({ where: scope, include: { permissions: true } }),
        db.submissionAttempt.findMany({
          where: { submission: { assignment: scope } },
          include: {
            submission: { select: { assignmentId: true, student: { select: { name: true } } } },
            attachments: {
              orderBy: [{ position: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
              select: { id: true, fileName: true, mimeType: true, size: true, position: true },
            },
            ocrResult: true,
            review: { include: { annotations: true } },
            finalGrade: true,
          },
          orderBy: { createdAt: 'asc' },
        }),
        db.permissionPackage.findMany({ where: scope }),
        db.redemptionCode.findMany({
          where: scope,
          select: {
            id: true,
            packageId: true,
            label: true,
            maxUses: true,
            uses: true,
            bindFirstUser: true,
            boundStudentId: true,
            expiresAt: true,
            disabled: true,
            createdAt: true,
            redemptions: true,
          },
        }),
      ]);
    await audit(db, req.actor.id, 'export_data', undefined, format);
    reply.header('Content-Disposition', 'attachment; filename="kaoba167-export.' + format + '"');
    if (format === 'json')
      return reply.type('application/json').send({
        brand: '考吧167',
        exportedAt: new Date(),
        students,
        questions,
        permissions,
        courses,
        attempts,
        packages,
        redemptionCodes,
      });
    // One portable CSV includes all entities; JSON payload preserves nested rubric and annotation data.
    const escape = (v: any) => {
      let s = String(v ?? '');
      if (/^[=+@\-\t\r]/.test(s)) s = "'" + s;
      return '"' + s.replaceAll('"', '""') + '"';
    };
    const rows: any[] = [['entity', 'id', 'student', 'question', 'round', 'score', 'data']];
    for (const s of students)
      rows.push(['student', s.userId, s.user.name, '', '', '', JSON.stringify(s)]);
    for (const q of questions)
      rows.push(['question', q.id, '', q.title, '', '', JSON.stringify(q)]);
    for (const p of permissions)
      rows.push(['permission', p.id, p.studentId, p.questionId, '', '', JSON.stringify(p)]);
    for (const c of courses) rows.push(['course', c.id, '', '', '', '', JSON.stringify(c)]);
    for (const p of packages) rows.push(['package', p.id, '', '', '', '', JSON.stringify(p)]);
    for (const c of redemptionCodes)
      rows.push(['redemption_code', c.id, c.boundStudentId || '', '', '', '', JSON.stringify(c)]);
    for (const a of attempts)
      rows.push([
        'attempt',
        a.id,
        a.submission.student.name,
        a.questionId,
        a.roundNo,
        a.finalGrade?.finalScore ?? '',
        JSON.stringify(a),
      ]);
    return reply
      .type('text/csv; charset=utf-8')
      .send('\uFEFF' + rows.map((r) => r.map(escape).join(',')).join('\r\n'));
  });
}
