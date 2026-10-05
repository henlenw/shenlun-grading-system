import type { Prisma, PrismaClient } from '@prisma/client';
import { fail } from './security.js';
type DB = PrismaClient | Prisma.TransactionClient;
export const withPoints = { scoringPoints: { orderBy: { position: 'asc' as const } } };
export const snapshot = (a: any) =>
  JSON.parse(a.questionSnapshot || a.submission.assignment.questionSnapshot);
export async function requirePermission(db: DB, studentId: string, questionId: string) {
  const permission = await db.permission.findUnique({
    where: { studentId_questionId: { studentId, questionId } },
  });
  if (!permission || permission.revokedAt)
    fail(403, '你尚未获得这道题的作答权限，请联系老师或兑换试卷');
  return permission!;
}
export async function requireAttemptPermission(db: DB, id: string, studentId: string) {
  const a = await db.submissionAttempt.findFirst({ where: { id, studentId } });
  if (!a) fail(404, '作答不存在');
  if (a!.roundNo > 3) fail(409, '本题已超过三次训练，历史记录仅供查看');
  await requirePermission(db, studentId, a!.questionId);
  return a!;
}
export async function grantQuestions(
  db: DB,
  studentId: string,
  questionIds: string[],
  source: string,
) {
  for (const questionId of [...new Set(questionIds)]) {
    const q = await db.question.findUniqueOrThrow({
      where: { id: questionId },
      include: withPoints,
    });
    await db.permission.upsert({
      where: { studentId_questionId: { studentId, questionId } },
      create: { studentId, questionId, teacherId: q.teacherId, source },
      update: { revokedAt: null, source },
    });
    const existing = await db.assignment.findFirst({
      where: { questionId, recipients: { some: { studentId } }, dueAt: { gt: new Date() } },
      orderBy: { createdAt: 'desc' },
    });
    if (!existing)
      await db.assignment.create({
        data: {
          teacherId: q.teacherId,
          questionId,
          title: q.title,
          questionSnapshot: JSON.stringify(q),
          dueAt: new Date('2099-12-31T23:59:59Z'),
          recipients: { create: { studentId } },
        },
      });
  }
}
export async function grantCourses(db: DB, studentId: string, courseIds: string[], source: string) {
  for (const courseId of [...new Set(courseIds)]) {
    const c = await db.course.findUniqueOrThrow({ where: { id: courseId } });
    await db.coursePermission.upsert({
      where: { courseId_studentId: { courseId, studentId } },
      create: { courseId, studentId, teacherId: c.teacherId, source },
      update: { revokedAt: null, source },
    });
  }
}
export async function startAttempt(db: PrismaClient, assignmentId: string, studentId: string) {
  return db.$transaction(async (tx) => {
    const assignment = await tx.assignment.findFirst({
      where: { id: assignmentId, recipients: { some: { studentId } } },
    });
    if (!assignment) fail(404, '题目不存在或未授权');
    await requirePermission(tx, studentId, assignment!.questionId);
    const latest = await tx.submissionAttempt.findFirst({
      where: { studentId, questionId: assignment!.questionId },
      orderBy: { roundNo: 'desc' },
      include: {
        attachments: { orderBy: [{ position: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }] },
        finalGrade: true,
      },
    });
    if (latest?.status === 'DRAFT' && latest.roundNo <= 3) return latest;
    if (latest && latest.roundNo >= 3) fail(409, '本题已完成三次训练，不能进行第四次作答');
    if (latest && latest.finalGrade?.status !== 'PUBLISHED')
      fail(409, '请等待老师发布上一次批改结果后再开始下一次训练');
    if ((latest?.revisionDueAt || assignment!.dueAt) < new Date())
      fail(409, '已过截止时间，请联系老师延长截止时间');
    const sub = await tx.submission.upsert({
      where: { assignmentId_studentId: { assignmentId, studentId } },
      create: { assignmentId, studentId },
      update: {},
    });
    const local = await tx.submissionAttempt.aggregate({
      where: { submissionId: sub.id },
      _max: { attemptNo: true },
    });
    const first = await tx.submissionAttempt.findFirst({
      where: { studentId, questionId: assignment!.questionId },
      orderBy: { roundNo: 'asc' },
    });
    const q = first?.questionSnapshot
      ? JSON.parse(first.questionSnapshot)
      : await tx.question.findUniqueOrThrow({
          where: { id: assignment!.questionId },
          include: withPoints,
        });
    return tx.submissionAttempt.create({
      data: {
        submissionId: sub.id,
        studentId,
        questionId: assignment!.questionId,
        roundNo: (latest?.roundNo || 0) + 1,
        attemptNo: (local._max.attemptNo || 0) + 1,
        questionSnapshot: JSON.stringify(q),
        answerType: '',
      },
      include: { attachments: true, finalGrade: true },
    });
  });
}
export function dayBounds(now = new Date(), offsetMinutes = 480) {
  const shifted = new Date(now.getTime() + offsetMinutes * 60000);
  const start = new Date(
    Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate()) -
      offsetMinutes * 60000,
  );
  return { gte: start, lt: new Date(start.getTime() + 86400000) };
}
