import type { FastifyInstance } from 'fastify';
import type { PrismaClient, Prisma } from '@prisma/client';
import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import type { Config } from './config.js';
import { auth, audit, digest, fail, teacherScope } from './security.js';
import { idParam, questionSchema } from './schemas.js';
import { grantQuestions, grantCourses, withPoints } from './training.js';
const ids = z.array(z.string().min(1).max(100)).max(500).default([]);
export function registerPermissions(app: FastifyInstance, db: PrismaClient, c: Config) {
  const teacher = auth(db, c, ['ADMIN', 'TEACHER']),
    student = auth(db, c, ['STUDENT']);
  async function ownStudents(studentIds: string[], actor: any) {
    if (!studentIds.length) fail(400, '请选择学生');
    if (
      (await db.studentProfile.count({
        where: { userId: { in: studentIds }, ...teacherScope(actor), user: { disabled: false } },
      })) !== new Set(studentIds).size
    )
      fail(403, '包含未授权或已停用的学生');
  }
  async function ownItems(questionIds: string[], courseIds: string[], actor: any) {
    if (
      (await db.question.count({ where: { id: { in: questionIds }, ...teacherScope(actor) } })) !==
        new Set(questionIds).size ||
      (await db.course.count({ where: { id: { in: courseIds }, ...teacherScope(actor) } })) !==
        new Set(courseIds).size
    )
      fail(403, '题目或课程未授权');
  }
  app.get('/api/teacher/questions/:id', { preHandler: teacher }, async (req) => {
    const q = await db.question.findFirst({
      where: { id: idParam.parse(req.params).id, ...teacherScope(req.actor) },
      include: withPoints,
    });
    if (!q) fail(404, '题目不存在');
    return q;
  });
  app.put('/api/teacher/questions/:id', { preHandler: teacher }, async (req) => {
    const id = idParam.parse(req.params).id;
    if (!(await db.question.findFirst({ where: { id, ...teacherScope(req.actor) } })))
      fail(404, '题目不存在');
    const { scoringPoints, ...data } = questionSchema.parse(req.body);
    return db.$transaction(async (tx) => {
      await tx.scoringPoint.deleteMany({ where: { questionId: id } });
      const q = await tx.question.update({
        where: { id },
        data: {
          ...data,
          scoringPoints: { create: scoringPoints.map((p, position) => ({ ...p, position })) },
        },
        include: withPoints,
      });
      await audit(tx, req.actor.id, 'edit_question', id);
      return q;
    });
  });
  app.get('/api/teacher/students/:id', { preHandler: teacher }, async (req) => {
    const id = idParam.parse(req.params).id;
    const s = await db.studentProfile.findFirst({
      where: { userId: id, ...teacherScope(req.actor) },
      include: { user: { select: { id: true, name: true, disabled: true, createdAt: true } } },
    });
    if (!s) fail(404, '学生不存在');
    return {
      id: s!.userId,
      name: s!.user.name,
      disabled: s!.user.disabled,
      contact: s!.contact,
      serviceType: s!.serviceType,
      notes: s!.notes,
      permissions: await db.permission.findMany({
        where: { studentId: id, ...teacherScope(req.actor) },
      }),
      courses: await db.coursePermission.findMany({
        where: { studentId: id, ...teacherScope(req.actor) },
        include: { course: true },
      }),
      attempts: await db.submissionAttempt.findMany({
        where: { studentId: id, submission: { assignment: teacherScope(req.actor) } },
        select: {
          id: true,
          questionId: true,
          roundNo: true,
          status: true,
          submittedAt: true,
          finalGrade: { select: { finalScore: true, publishedAt: true } },
        },
        orderBy: { createdAt: 'desc' },
      }),
    };
  });
  app.get('/api/teacher/permissions', { preHandler: teacher }, (req) =>
    db.permission.findMany({ where: teacherScope(req.actor), orderBy: { updatedAt: 'desc' } }),
  );
  app.post('/api/teacher/permissions', { preHandler: teacher }, async (req) => {
    const b = z
      .object({
        studentIds: ids,
        questionIds: ids,
        courseIds: ids,
        packageId: z.string().optional(),
        allQuestions: z.boolean().default(false),
      })
      .parse(req.body);
    await ownStudents(b.studentIds, req.actor);
    let qs = b.questionIds,
      cs = b.courseIds;
    if (b.packageId) {
      const p = await db.permissionPackage.findFirst({
        where: { id: b.packageId, ...teacherScope(req.actor) },
      });
      if (!p) fail(404, '试卷包不存在');
      qs = [...qs, ...JSON.parse(p!.questionIds)];
      cs = [...cs, ...JSON.parse(p!.courseIds)];
    }
    if (b.allQuestions)
      qs = (
        await db.question.findMany({ where: teacherScope(req.actor), select: { id: true } })
      ).map((q) => q.id);
    if (!qs.length && !cs.length) fail(400, '请选择至少一道题或一门课程');
    await ownItems(qs, cs, req.actor);
    await db.$transaction(
      async (tx) => {
        for (const studentId of [...new Set(b.studentIds)]) {
          await grantQuestions(tx, studentId, qs, b.packageId ? 'PACKAGE' : 'MANUAL');
          await grantCourses(tx, studentId, cs, b.packageId ? 'PACKAGE' : 'MANUAL');
        }
        await audit(
          tx,
          req.actor.id,
          'grant_permission',
          undefined,
          JSON.stringify({ studentIds: b.studentIds, questionIds: qs, courseIds: cs }),
        );
      },
      { timeout: 30000 },
    );
    return {
      ok: true,
      students: new Set(b.studentIds).size,
      questions: new Set(qs).size,
      courses: new Set(cs).size,
    };
  });
  app.patch('/api/teacher/permissions/:id', { preHandler: teacher }, async (req) => {
    const id = idParam.parse(req.params).id,
      b = z
        .object({ revoked: z.boolean().optional(), referenceUnlocked: z.boolean().optional() })
        .parse(req.body);
    const n = await db.permission.updateMany({
      where: { id, ...teacherScope(req.actor) },
      data: {
        revokedAt: b.revoked === undefined ? undefined : b.revoked ? new Date() : null,
        referenceUnlocked: b.referenceUnlocked,
      },
    });
    if (!n.count) fail(404, '授权不存在');
    await audit(db, req.actor.id, 'update_permission', id, JSON.stringify(b));
    return { ok: true };
  });
  app.get('/api/teacher/packages', { preHandler: teacher }, (req) =>
    db.permissionPackage.findMany({
      where: teacherScope(req.actor),
      orderBy: { createdAt: 'desc' },
    }),
  );
  app.post('/api/teacher/packages', { preHandler: teacher }, async (req) => {
    const b = z
      .object({
        name: z.string().trim().min(1).max(100),
        description: z.string().max(2000).default(''),
        questionIds: ids,
        courseIds: ids,
      })
      .parse(req.body);
    if (!b.questionIds.length && !b.courseIds.length) fail(400, '试卷包不能为空');
    await ownItems(b.questionIds, b.courseIds, req.actor);
    const p = await db.permissionPackage.create({
      data: {
        ...b,
        teacherId: req.actor.id,
        questionIds: JSON.stringify([...new Set(b.questionIds)]),
        courseIds: JSON.stringify([...new Set(b.courseIds)]),
      },
    });
    await audit(db, req.actor.id, 'create_package', p.id);
    return p;
  });
  app.get('/api/teacher/redemption-codes', { preHandler: teacher }, (req) =>
    db.redemptionCode.findMany({
      where: teacherScope(req.actor),
      select: {
        id: true,
        label: true,
        packageId: true,
        maxUses: true,
        uses: true,
        expiresAt: true,
        disabled: true,
        bindFirstUser: true,
        boundStudentId: true,
        createdAt: true,
        redemptions: { select: { studentId: true, createdAt: true } },
      },
      orderBy: { createdAt: 'desc' },
    }),
  );
  app.post('/api/teacher/redemption-codes', { preHandler: teacher }, async (req) => {
    const b = z
      .object({
        packageId: z.string(),
        label: z.string().trim().max(100).default('试卷兑换'),
        maxUses: z.number().int().min(1).max(1000).default(1),
        bindFirstUser: z.boolean().default(true),
        expiresAt: z.iso.datetime(),
        count: z.number().int().min(1).max(100).default(1),
      })
      .parse(req.body);
    if (new Date(b.expiresAt) <= new Date()) fail(400, '有效期必须在未来');
    if (
      !(await db.permissionPackage.findFirst({
        where: { id: b.packageId, ...teacherScope(req.actor) },
      }))
    )
      fail(404, '试卷包不存在');
    const created = [];
    for (let i = 0; i < b.count; i++) {
      const code = randomBytes(12).toString('hex').toUpperCase();
      const { count, ...data } = b;
      const r = await db.redemptionCode.create({
        data: {
          ...data,
          teacherId: req.actor.id,
          expiresAt: new Date(b.expiresAt),
          codeHash: digest(code, c.secret),
        },
      });
      created.push({ id: r.id, code, label: r.label, expiresAt: r.expiresAt });
    }
    await audit(db, req.actor.id, 'create_redemption_codes', undefined, String(created.length));
    return created;
  });
  app.patch('/api/teacher/redemption-codes/:id', { preHandler: teacher }, async (req) => {
    const id = idParam.parse(req.params).id,
      b = z.object({ disabled: z.boolean() }).parse(req.body);
    const n = await db.redemptionCode.updateMany({
      where: { id, ...teacherScope(req.actor) },
      data: b,
    });
    if (!n.count) fail(404, '兑换码不存在');
    await audit(db, req.actor.id, 'disable_redemption_code', id);
    return { ok: true };
  });
  app.post(
    '/api/student/redeem',
    { preHandler: student, config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
    async (req) => {
      const { code } = z.object({ code: z.string().trim().min(1).max(80) }).parse(req.body);
      const hash = digest(code.replace(/[\s-]/g, '').toUpperCase(), c.secret);
      return db.$transaction(
        async (tx) => {
          const r = await tx.redemptionCode.findUnique({ where: { codeHash: hash } });
          if (!r || r.disabled || r.expiresAt <= new Date()) fail(400, '兑换码无效或已过期');
          if (
            r!.uses >= r!.maxUses ||
            (r!.bindFirstUser && r!.boundStudentId && r!.boundStudentId !== req.actor.id) ||
            (await tx.redemptionUse.findUnique({
              where: { codeId_studentId: { codeId: r!.id, studentId: req.actor.id } },
            }))
          )
            fail(409, '兑换码已使用，不能重复兑换');
          const creator = await tx.user.findUnique({ where: { id: r!.teacherId } });
          const profile = await tx.studentProfile.findUnique({ where: { userId: req.actor.id } });
          if (
            !creator ||
            creator.disabled ||
            (creator.role !== 'ADMIN' && profile?.teacherId !== creator.id)
          )
            fail(403, '该兑换码不适用于你的教师班级');
          const p = await tx.permissionPackage.findUnique({ where: { id: r!.packageId } });
          if (!p) fail(400, '兑换码对应试卷包不存在');
          const n = await tx.redemptionCode.updateMany({
            where: { id: r!.id, uses: r!.uses, disabled: false },
            data: {
              uses: { increment: 1 },
              boundStudentId: r!.bindFirstUser ? req.actor.id : undefined,
            },
          });
          if (!n.count) fail(409, '兑换码正在使用，请刷新查看权限');
          await tx.redemptionUse.create({ data: { codeId: r!.id, studentId: req.actor.id } });
          await grantQuestions(tx, req.actor.id, JSON.parse(p!.questionIds), 'REDEMPTION');
          await grantCourses(tx, req.actor.id, JSON.parse(p!.courseIds), 'REDEMPTION');
          await audit(tx, req.actor.id, 'redeem', r!.id);
          return { ok: true, name: p!.name };
        },
        { timeout: 30000 },
      );
    },
  );
  app.get('/api/teacher/courses', { preHandler: teacher }, (req) =>
    db.course.findMany({
      where: teacherScope(req.actor),
      include: { permissions: true },
      orderBy: { createdAt: 'desc' },
    }),
  );
  app.post('/api/teacher/courses', { preHandler: teacher }, async (req) => {
    const b = z
      .object({
        name: z.string().trim().min(1).max(100),
        description: z.string().max(2000).default(''),
      })
      .parse(req.body);
    const course = await db.course.create({ data: { ...b, teacherId: req.actor.id } });
    await audit(db, req.actor.id, 'create_course', course.id);
    return course;
  });
  app.patch('/api/teacher/course-permissions/:id', { preHandler: teacher }, async (req) => {
    const id = idParam.parse(req.params).id,
      b = z
        .object({ revoked: z.boolean(), note: z.string().max(2000).default('') })
        .parse(req.body);
    const n = await db.coursePermission.updateMany({
      where: { id, ...teacherScope(req.actor) },
      data: { revokedAt: b.revoked ? new Date() : null, note: b.note },
    });
    if (!n.count) fail(404, '课程授权不存在');
    await audit(db, req.actor.id, 'update_course_permission', id);
    return { ok: true };
  });
}
