import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { PrismaClient } from '@prisma/client';
import { startAttempt } from '../src/training.js';
test('增量迁移保留历史五次作答和成绩，跨作业回填轮次及授权，禁止新增第四轮', async () => {
  const dir = await mkdtemp(path.join(process.cwd(), 'test-migration-')),
    file = path.join(dir, 'legacy.db'),
    sqlite = new DatabaseSync(file);
  let db: PrismaClient | undefined;
  try {
    sqlite.exec(await readFile('prisma/migrations/202610040001_initial/migration.sql', 'utf8'));
    const now = Date.now(),
      q = JSON.stringify({ title: '旧题', maxScore: 100, referenceAnswer: '保留原答案' });
    sqlite
      .prepare('INSERT INTO User(id,name,role,updatedAt) VALUES(?,?,?,?)')
      .run('teacher', '教师', 'TEACHER', now);
    sqlite
      .prepare('INSERT INTO User(id,name,role,updatedAt) VALUES(?,?,?,?)')
      .run('student', '学生', 'STUDENT', now);
    sqlite
      .prepare('INSERT INTO StudentProfile(id,userId,teacherId,updatedAt) VALUES(?,?,?,?)')
      .run('profile', 'student', 'teacher', now);
    sqlite
      .prepare(
        'INSERT INTO Question(id,teacherId,title,type,materials,prompt,requirements,wordLimit,maxScore,rubric,updatedAt) VALUES(?,?,?,?,?,?,?,?,?,?,?)',
      )
      .run('question', 'teacher', '旧题', '大作文', '材料', '问题', '要求', 1000, 100, '标准', now);
    for (let k = 1; k <= 2; k++) {
      sqlite
        .prepare(
          'INSERT INTO Assignment(id,teacherId,questionId,title,questionSnapshot,dueAt,updatedAt) VALUES(?,?,?,?,?,?,?)',
        )
        .run(
          'assignment' + k,
          'teacher',
          'question',
          '旧作业',
          q,
          new Date('2099-12-31').getTime(),
          now,
        );
      sqlite
        .prepare('INSERT INTO AssignmentRecipient(id,assignmentId,studentId) VALUES(?,?,?)')
        .run('recipient' + k, 'assignment' + k, 'student');
      sqlite
        .prepare('INSERT INTO Submission(id,assignmentId,studentId,updatedAt) VALUES(?,?,?,?)')
        .run('submission' + k, 'assignment' + k, 'student', now);
    }
    for (let i = 1; i <= 5; i++)
      sqlite
        .prepare(
          'INSERT INTO SubmissionAttempt(id,submissionId,attemptNo,status,text,createdAt,updatedAt) VALUES(?,?,?,?,?,?,?)',
        )
        .run(
          'attempt' + i,
          i <= 3 ? 'submission1' : 'submission2',
          i <= 3 ? i : i - 3,
          'PUBLISHED',
          '旧答案' + i,
          now + i,
          now + i,
        );
    const feedback = JSON.stringify({ summary: '旧评语', annotations: [] });
    sqlite
      .prepare(
        'INSERT INTO FinalGrade(id,attemptId,finalScore,feedbackJson,publishedBy,updatedAt) VALUES(?,?,?,?,?,?)',
      )
      .run('grade', 'attempt1', 78, feedback, 'teacher', now);
    sqlite.exec(await readFile('prisma/migrations/202610040002_kaoba167/migration.sql', 'utf8'));
    sqlite
      .prepare(
        'INSERT INTO Attachment(id,attemptId,fileName,filePath,mimeType,size,checksum,createdAt) VALUES(?,?,?,?,?,?,?,?)',
      )
      .run('photo-b', 'attempt1', 'b.jpg', 'original-b.jpg', 'image/jpeg', 120, 'old-b', now + 2);
    sqlite
      .prepare(
        'INSERT INTO Attachment(id,attemptId,fileName,filePath,mimeType,size,checksum,createdAt) VALUES(?,?,?,?,?,?,?,?)',
      )
      .run('photo-a', 'attempt1', 'a.jpg', 'original-a.jpg', 'image/jpeg', 130, 'old-a', now + 1);
    sqlite.exec(
      await readFile('prisma/migrations/202610050001_material_answers/migration.sql', 'utf8'),
    );
    sqlite.close();
    db = new PrismaClient({ datasourceUrl: 'file:' + file.replaceAll('\\', '/') });
    const attempts = await db.submissionAttempt.findMany({ orderBy: { roundNo: 'asc' } });
    assert.deepEqual(
      attempts.map((a) => a.roundNo),
      [1, 2, 3, 4, 5],
    );
    assert.equal(attempts[0].text, '旧答案1');
    assert.equal(attempts[0].answerType, 'mixed');
    assert.equal(attempts[1].answerType, 'text');
    assert.equal(attempts[0].studentAnnotations, '[]');
    assert.equal(attempts[0].annotationsVersion, 0);
    const files = await db.attachment.findMany({ orderBy: { position: 'asc' } });
    assert.deepEqual(
      files.map((f) => [f.id, f.filePath, f.position]),
      [
        ['photo-a', 'original-a.jpg', 0],
        ['photo-b', 'original-b.jpg', 1],
      ],
    );
    assert.equal(attempts[0].questionSnapshot, q);
    assert.equal(
      (await db.finalGrade.findUniqueOrThrow({ where: { id: 'grade' } })).feedbackJson,
      feedback,
    );
    assert.equal(await db.permission.count(), 1);
    assert.equal(
      (await db.question.findUniqueOrThrow({ where: { id: 'question' } })).allowReference,
      true,
    );
    await assert.rejects(startAttempt(db, 'assignment2', 'student'), /三次/);
    assert.equal(await db.submissionAttempt.count(), 5);
  } finally {
    try {
      sqlite.close();
    } catch {}
    await db?.$disconnect();
    await rm(dir, { recursive: true, force: true });
  }
});
