import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, writeFile, stat } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { PrismaClient } from '@prisma/client';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { issueSession } from '../src/security.js';
import { dayBounds } from '../src/training.js';
import { processOneJob } from '../src/jobs.js';
import { ManualProvider, createAIProvider } from '../src/ai.js';
import { samplePdf } from './fixtures.js';
import { pdfPage } from '../src/preview.js';
import { fixtureDatabase } from './database-fixture.js';
let db: PrismaClient,
  app: any,
  dir: string,
  c: any,
  admin: any,
  other: any,
  a: any,
  b: any,
  q: any,
  draft: any,
  file: any;
let sequence = 0;
async function request(
  method: string,
  url: string,
  body?: any,
  who?: any,
  status = 200,
  headers: any = {},
) {
  const res = await app.inject({
    method,
    url: '/api' + url,
    payload: body,
    remoteAddress: '127.0.2.' + ((++sequence % 250) + 1),
    headers: {
      ...(who?.cookie
        ? { cookie: who.cookie, origin: c.appUrl, 'x-csrf-token': who.csrfToken }
        : {}),
      ...(who?.token ? { authorization: 'Bearer ' + who.token } : {}),
      ...headers,
    },
  });
  assert.equal(res.statusCode, status, res.body);
  return res;
}
async function json(...args: Parameters<typeof request>) {
  return (await request(...args)).json();
}
const question = (title = '专项题') => ({
  title,
  type: '概括归纳',
  category: '国考',
  year: 2025,
  region: '全国',
  examType: '国考',
  materials: '材料事实',
  prompt: '请概括基层治理举措',
  requirements: '准确完整',
  wordLimit: 300,
  maxScore: 20,
  rubric: 'RUBRIC_SECRET',
  referenceAnswer: 'REFERENCE_SECRET',
  teacherInstructions: 'TEACHER_INSTRUCTION_SECRET',
  aiInstructions: 'AI_INSTRUCTION_SECRET',
  internalNote: 'INTERNAL_SECRET',
  scoringPoints: [
    { label: '群众参与', description: '开展议事协商', points: 8 },
    { label: '落实反馈', description: '明确责任和跟踪落实', points: 12 },
  ],
});
async function createStudent(name: string) {
  const u = await json('POST', '/teacher/students', { name }, admin);
  return { ...(await issueSession(db, c, u.id)), user: u };
}
async function submit(d: any, who: any, text = '群众参与议事，明确责任并及时反馈。') {
  const saved = await json(
    'PUT',
    '/student/attempts/' + d.id + '/draft',
    { text, version: d.version },
    who,
  );
  await json('POST', '/student/attempts/' + d.id + '/submit', { version: saved.version }, who);
}
async function publish(id: string, score: number, pages: any[] = []) {
  await json('POST', '/teacher/submissions/' + id + '/manual', {}, admin);
  const r = await json(
    'PUT',
    '/teacher/submissions/' + id + '/review',
    {
      version: 0,
      finalScore: score,
      summary: '正式反馈',
      internalNote: 'REVIEW_PRIVATE',
      annotations: [],
      pageAnnotations: pages,
    },
    admin,
  );
  await json(
    'POST',
    '/teacher/submissions/' + id + '/publish',
    { reviewVersion: r.version },
    admin,
  );
}
async function upload(id: string, who: any, name: string, bytes: Buffer, status = 200) {
  const boundary = 'kaoba-fixture-boundary';
  const body = Buffer.concat([
    Buffer.from(
      '--' +
        boundary +
        '\r\nContent-Disposition: form-data; name="file"; filename="' +
        name +
        '"\r\nContent-Type: application/pdf\r\n\r\n',
    ),
    bytes,
    Buffer.from('\r\n--' + boundary + '--\r\n'),
  ]);
  return (
    await request('POST', '/student/attempts/' + id + '/files', body, who, status, {
      'content-type': 'multipart/form-data; boundary=' + boundary,
    })
  ).json();
}
before(async () => {
  dir = await mkdtemp(path.join(process.cwd(), 'test-kaoba-'));
  const file = path.join(dir, 'test.db'),
    sqlite = new DatabaseSync(file);
  for (const m of (await readdir('prisma/migrations')).sort())
    if (m !== 'migration_lock.toml')
      sqlite.exec(await readFile('prisma/migrations/' + m + '/migration.sql', 'utf8'));
  sqlite.close();
  db = await fixtureDatabase(file);
  c = {
    ...loadConfig(),
    secret: 'kaoba-integration-secret-0000000000000',
    bootstrapToken: 'kaoba-bootstrap-secret-000000000000000',
    storage: path.join(dir, 'storage'),
    aiProvider: 'manual',
    ollamaUrl: 'http://127.0.0.1:1',
  };
  app = await buildApp({ db, config: c });
  const res = await request('POST', '/auth/setup', {
    bootstrapToken: c.bootstrapToken,
    username: 'kaoba-admin',
    name: '管理员',
    password: 'Test-kaoba-2026',
  });
  admin = { ...res.json(), cookie: res.headers['set-cookie'].split(';')[0] };
  await json(
    'POST',
    '/admin/teachers',
    { username: 'kaoba-other', name: '另一位教师', password: 'Test-kaoba-2026' },
    admin,
  );
  const login = await request('POST', '/auth/login', {
    username: 'kaoba-other',
    password: 'Test-kaoba-2026',
  });
  other = { ...login.json(), cookie: login.headers['set-cookie'].split(';')[0] };
  a = await createStudent('学生甲');
  b = await createStudent('学生乙');
  q = await json('POST', '/teacher/questions', question(), admin);
});
after(async () => {
  await app?.close();
  await db?.$disconnect();
  if (dir) await rm(dir, { recursive: true, force: true });
});
test('题库按权重校验，单题授权不泄漏评分依据或其他学生数据', async () => {
  await json('POST', '/teacher/questions', { ...question('错误分值'), maxScore: 21 }, admin, 400);
  await json(
    'POST',
    '/teacher/permissions',
    { studentIds: [a.user.id], questionIds: [q.id] },
    admin,
  );
  const list = await json('GET', '/student/questions', undefined, a);
  assert.equal(list.length, 1);
  assert.equal((await json('GET', '/student/questions', undefined, b)).length, 0);
  assert.doesNotMatch(
    JSON.stringify(list),
    /SECRET|scoringPoints|teacherInstructions|aiInstructions/,
  );
  await request('GET', '/student/questions/' + q.id, undefined, b, 404);
  await request('POST', '/student/questions/' + q.id + '/start', {}, b, 403);
  await request('GET', '/student/questions/' + q.id + '/reference', undefined, a, 403);
  await request('GET', '/teacher/questions/' + q.id, undefined, other, 200);
  await request(
    'POST',
    '/teacher/permissions',
    { studentIds: [a.user.id], questionIds: [q.id] },
    other,
    200,
  );
});
test('同一题跨作业共享首轮草稿；上传 PDF 并鉴权预览，不公开文件路径', async () => {
  draft = await json('POST', '/student/questions/' + q.id + '/start', {}, a);
  const duplicate = await json(
    'POST',
    '/teacher/assignments',
    { title: '重复布置', questionId: q.id, studentIds: [a.user.id], dueAt: '2099-12-31T00:00:00Z' },
    admin,
  );
  const same = await json('POST', '/student/assignments/' + duplicate.id + '/draft', {}, a);
  assert.equal(same.id, draft.id);
  file = await upload(draft.id, a, 'essay.pdf', samplePdf(2));
  draft.version = file.version;
  const meta = await json('GET', '/files/' + file.id + '/preview?info=true', undefined, admin);
  assert.equal(meta.total, 2);
  const preview = await request('GET', '/files/' + file.id + '/preview?page=2', undefined, a);
  assert.match(preview.headers['content-type'], /image\/png/);
  assert.equal(preview.rawPayload[0], 137);
  await request('GET', '/files/' + file.id + '/preview?page=2', undefined, b, 404);
  await request('GET', '/files/' + file.id + '/preview', undefined, other, 200);
  await request('GET', '/files/' + file.id + '/preview', undefined, undefined, 401);
  const d = await json('GET', '/student/questions/' + q.id, undefined, a);
  assert.doesNotMatch(JSON.stringify(d), /filePath|checksum/);
  await submit(draft, a);
  await request('POST', '/student/questions/' + q.id + '/start', {}, a, 409);
});
test('今日队列按题和轮次分组，教学团队共享；学生看不到未发布批注', async () => {
  const board = await json('GET', '/teacher/today-unreviewed', undefined, admin);
  assert.equal(board.groups[0].questionId, q.id);
  assert.equal(board.groups[0].students[0].roundNo, 1);
  assert.equal(board.counts.todayUnreviewed, 1);
  assert.equal((await json('GET', '/teacher/today-unreviewed', undefined, other)).groups.length, 1);
  await json('POST', '/teacher/submissions/' + draft.id + '/manual', {}, admin);
  const page = {
    id: 'annotation-1',
    fileId: file.id,
    page: 2,
    type: 'rectangle',
    x: 0.1,
    y: 0.2,
    width: 0.5,
    height: 0.1,
    color: '#c53932',
    content: 'PAGE_PRIVATE',
    author: 'forged',
    createdAt: '1990-01-01',
  };
  await json(
    'PUT',
    '/teacher/submissions/' + draft.id + '/review',
    {
      version: 0,
      finalScore: 12,
      summary: 'DRAFT_PRIVATE',
      annotations: [],
      pageAnnotations: [{ ...page, fileId: 'other-file' }],
    },
    admin,
    400,
  );
  await json(
    'PUT',
    '/teacher/submissions/' + draft.id + '/review',
    {
      version: 0,
      finalScore: 12,
      summary: 'DRAFT_PRIVATE',
      annotations: [],
      pageAnnotations: [{ ...page, x: 0.9 }],
    },
    admin,
    400,
  );
  const r = await json(
    'PUT',
    '/teacher/submissions/' + draft.id + '/review',
    {
      version: 0,
      finalScore: 12,
      summary: '正式反馈',
      internalNote: 'REVIEW_PRIVATE',
      annotations: [],
      pageAnnotations: [page],
    },
    admin,
  );
  const hidden = await json('GET', '/student/questions/' + q.id, undefined, a);
  assert.equal(hidden.attempts[0].finalGrade, null);
  assert.doesNotMatch(JSON.stringify(hidden), /PAGE_PRIVATE|DRAFT_PRIVATE|REVIEW_PRIVATE/);
  await request(
    'POST',
    '/teacher/submissions/' + draft.id + '/revision',
    { reason: '再练', requirements: '完善', dueAt: '2099-12-31T00:00:00Z' },
    admin,
    409,
  );
  await json(
    'POST',
    '/teacher/submissions/' + draft.id + '/publish',
    { reviewVersion: r.version },
    admin,
  );
  const final = await json('GET', '/student/questions/' + q.id, undefined, a);
  assert.equal(final.attempts[0].finalGrade.pageAnnotations[0].content, 'PAGE_PRIVATE');
  assert.notEqual(final.attempts[0].finalGrade.pageAnnotations[0].author, 'forged');
  assert.doesNotMatch(JSON.stringify(final), /REVIEW_PRIVATE/);
  const ref = await json('GET', '/student/questions/' + q.id + '/reference', undefined, a);
  assert.equal(ref.referenceAnswer, 'REFERENCE_SECRET');
  assert.equal(ref.scoringPoints.length, 2);
  assert.equal((await json('GET', '/teacher/today-unreviewed', undefined, admin)).groups.length, 0);
});
test('三次训练服务端封顶，编辑题目保留旧快照和三轮已发布历史', async () => {
  const changed = {
    ...question('新版专项题'),
    referenceAnswer: 'NEW_REFERENCE',
    maxScore: 30,
    scoringPoints: [{ label: '新要点', points: 30 }],
  };
  await json('PUT', '/teacher/questions/' + q.id, changed, admin);
  for (const [round, score] of [
    [2, 16],
    [3, 19],
  ]) {
    const d = await json('POST', '/student/questions/' + q.id + '/start', {}, a);
    assert.equal(d.roundNo, round);
    await submit(d, a);
    await request('POST', '/student/questions/' + q.id + '/start', {}, a, 409);
    await publish(d.id, score);
  }
  await request('POST', '/student/questions/' + q.id + '/start', {}, a, 409);
  const again = await json(
    'POST',
    '/teacher/assignments',
    {
      title: '不能绕过次数',
      questionId: q.id,
      studentIds: [a.user.id],
      dueAt: '2099-12-31T00:00:00Z',
    },
    admin,
  );
  await request('POST', '/student/assignments/' + again.id + '/draft', {}, a, 409);
  const d = await json('GET', '/student/questions/' + q.id, undefined, a);
  assert.deepEqual(
    d.scores.map((s: any) => s.score),
    [12, 16, 19],
  );
  assert.equal(d.improvement, 7);
  assert.equal(d.completed, true);
  assert.ok(d.attempts.every((a: any) => a.question.maxScore === 20));
  assert.equal(d.attempts.find((x: any) => x.roundNo === 1).question.maxScore, 20);
  assert.equal(
    (await json('GET', '/student/questions/' + q.id + '/reference', undefined, a)).referenceAnswer,
    'REFERENCE_SECRET',
  );
  const first = await db.submissionAttempt.findUniqueOrThrow({ where: { id: draft.id } });
  assert.equal(JSON.parse(first.questionSnapshot).maxScore, 20);
  await request(
    'PUT',
    '/teacher/submissions/' + draft.id + '/review',
    { version: 1, finalScore: 1, summary: '篡改', annotations: [] },
    admin,
    409,
  );
});
test('撤销授权禁止新提交和修改，已发布历史仍可访问', async () => {
  const q2 = await json('POST', '/teacher/questions', question('可撤销训练'), admin);
  await json(
    'POST',
    '/teacher/permissions',
    { studentIds: [b.user.id], questionIds: [q2.id] },
    admin,
  );
  const d = await json('POST', '/student/questions/' + q2.id + '/start', {}, b);
  const g = await db.permission.findUniqueOrThrow({
    where: { studentId_questionId: { studentId: b.user.id, questionId: q2.id } },
  });
  await json('PATCH', '/teacher/permissions/' + g.id, { revoked: true }, admin);
  await request(
    'PUT',
    '/student/attempts/' + d.id + '/draft',
    { text: '新文字', version: 0 },
    b,
    403,
  );
  await request('POST', '/student/attempts/' + d.id + '/submit', { version: 0 }, b, 403);
  await upload(d.id, b, 'revoked.pdf', samplePdf(), 403);
  const g1 = await db.permission.findUniqueOrThrow({
    where: { studentId_questionId: { studentId: a.user.id, questionId: q.id } },
  });
  await json('PATCH', '/teacher/permissions/' + g1.id, { revoked: true }, admin);
  assert.equal((await json('GET', '/student/questions/' + q.id, undefined, a)).attempts.length, 3);
  await request('POST', '/student/questions/' + q.id + '/start', {}, a, 403);
});

test('并发开始、保存、提交和发布不会生成重复轮次、覆盖草稿或重复成绩', async () => {
  const concurrentQuestion = await json(
    'POST',
    '/teacher/questions',
    question('并发事务测试'),
    admin,
  );
  await json(
    'POST',
    '/teacher/permissions',
    { studentIds: [a.user.id], questionIds: [concurrentQuestion.id] },
    admin,
  );
  const race = async (method: string, url: string, payload: any, who = a) => {
    const responses = await Promise.all(
      [1, 2].map(() =>
        app.inject({
          method,
          url: '/api' + url,
          payload,
          headers: who.cookie
            ? { cookie: who.cookie, origin: c.appUrl, 'x-csrf-token': who.csrfToken }
            : { authorization: 'Bearer ' + who.token },
        }),
      ),
    );
    assert.ok(
      responses.some((r) => r.statusCode === 200),
      responses.map((r) => r.body).join('\n'),
    );
    assert.ok(
      responses.every((r) => [200, 409].includes(r.statusCode)),
      responses.map((r) => r.body).join('\n'),
    );
    return responses;
  };
  await race('POST', '/student/questions/' + concurrentQuestion.id + '/start', {});
  assert.equal(
    await db.submissionAttempt.count({ where: { questionId: concurrentQuestion.id } }),
    1,
  );
  const d = await db.submissionAttempt.findFirstOrThrow({
    where: { questionId: concurrentQuestion.id },
  });
  const saved = await race('PUT', '/student/attempts/' + d.id + '/draft', {
    text: '同一版本只能保存一次。',
    version: 0,
  });
  assert.equal(saved.filter((r) => r.statusCode === 200).length, 1);
  assert.equal((await db.submissionAttempt.findUniqueOrThrow({ where: { id: d.id } })).version, 1);
  await race('POST', '/student/attempts/' + d.id + '/submit', { version: 1 });
  assert.equal(await db.gradingJob.count({ where: { attemptId: d.id } }), 0);
  await json('POST', '/teacher/submissions/' + d.id + '/manual', {}, admin);
  const review = await json(
    'PUT',
    '/teacher/submissions/' + d.id + '/review',
    {
      version: 0,
      finalScore: 16,
      summary: '并发发布测试',
      annotations: [],
      pageAnnotations: [],
    },
    admin,
  );
  await race(
    'POST',
    '/teacher/submissions/' + d.id + '/publish',
    { reviewVersion: review.version },
    admin,
  );
  assert.equal(await db.finalGrade.count({ where: { attemptId: d.id } }), 1);
});
test('试卷包组合课程；一次性兑换原子化，重复和跨学生使用失败', async () => {
  const course = await json(
    'POST',
    '/teacher/courses',
    { name: '申论系统录播', description: '微信领取' },
    admin,
  );
  const pack = await json(
    'POST',
    '/teacher/packages',
    { name: '一套卷与录播', questionIds: [q.id], courseIds: [course.id] },
    admin,
  );
  const codes = await json(
    'POST',
    '/teacher/redemption-codes',
    { packageId: pack.id, expiresAt: '2099-12-31T00:00:00Z' },
    admin,
  );
  assert.equal(codes.length, 1);
  const code = codes[0].code;
  await json('POST', '/student/redeem', { code }, b);
  await request('POST', '/student/redeem', { code }, b, 409);
  await request('POST', '/student/redeem', { code }, a, 409);
  assert.equal(
    (await json('GET', '/student/courses', undefined, b)).courses[0].name,
    '申论系统录播',
  );
  assert.ok(
    (await json('GET', '/student/questions', undefined, b)).some((x: any) => x.id === q.id),
  );
  const records = await json('GET', '/teacher/redemption-codes', undefined, admin);
  assert.doesNotMatch(JSON.stringify(records), /codeHash|"code":/);
  await request('POST', '/student/redeem', { code: 'INVALID' }, a, 400);
  const simultaneous = (
    await json(
      'POST',
      '/teacher/redemption-codes',
      { packageId: pack.id, expiresAt: '2099-12-31T00:00:00Z' },
      admin,
    )
  )[0].code;
  const responses = await Promise.all(
    [a, b].map((w) =>
      app.inject({
        method: 'POST',
        url: '/api/student/redeem',
        payload: { code: simultaneous },
        headers: { authorization: 'Bearer ' + w.token },
      }),
    ),
  );
  assert.equal(responses.filter((r) => r.statusCode === 200).length, 1);
  assert.equal((await db.redemptionCode.findMany({ where: { uses: 1 } })).length, 2);
  await json(
    'PATCH',
    '/teacher/students/' + b.user.id,
    {
      name: '学生乙',
      contact: '',
      disabled: false,
      serviceType: '一对一',
      notes: 'PRIVATE_STUDENT_NOTE',
    },
    admin,
  );
  const access = await json('GET', '/student/courses', undefined, b);
  assert.equal(access.serviceType, '一对一');
  assert.doesNotMatch(JSON.stringify(access), /PRIVATE_STUDENT_NOTE/);
});
test('参考答案关闭自动解锁时须人工授权，关闭开放开关后服务端拒绝', async () => {
  const restricted = await json(
    'POST',
    '/teacher/questions',
    { ...question('手动解锁'), autoUnlockReference: false },
    admin,
  );
  await json(
    'POST',
    '/teacher/permissions',
    { studentIds: [b.user.id], questionIds: [restricted.id] },
    admin,
  );
  const d = await json('POST', '/student/questions/' + restricted.id + '/start', {}, b);
  await submit(d, b);
  await publish(d.id, 15);
  await request('GET', '/student/questions/' + restricted.id + '/reference', undefined, b, 403);
  const g = await db.permission.findUniqueOrThrow({
    where: { studentId_questionId: { studentId: b.user.id, questionId: restricted.id } },
  });
  await json('PATCH', '/teacher/permissions/' + g.id, { referenceUnlocked: true }, admin);
  await json('GET', '/student/questions/' + restricted.id + '/reference', undefined, b);
  await json(
    'PUT',
    '/teacher/questions/' + restricted.id,
    { ...question('手动解锁'), allowReference: false },
    admin,
  );
  await request('GET', '/student/questions/' + restricted.id + '/reference', undefined, b, 403);
});
test('同内容附件复用存储，删除一个引用不破坏其他作答', async () => {
  const q3 = await json('POST', '/teacher/questions', question('文件去重'), admin);
  await json(
    'POST',
    '/teacher/permissions',
    { studentIds: [a.user.id, b.user.id], questionIds: [q3.id] },
    admin,
  );
  const da = await json('POST', '/student/questions/' + q3.id + '/start', {}, a),
    dbb = await json('POST', '/student/questions/' + q3.id + '/start', {}, b);
  const fa = await upload(da.id, a, 'a.pdf', samplePdf()),
    fb = await upload(dbb.id, b, 'b.pdf', samplePdf());
  const files = await db.attachment.findMany({ where: { id: { in: [fa.id, fb.id] } } });
  assert.equal(files[0].filePath, files[1].filePath);
  await json('DELETE', '/student/files/' + fa.id, undefined, a);
  await request('GET', '/files/' + fb.id, undefined, b);
  await json('DELETE', '/student/files/' + fb.id, undefined, b);
  assert.equal(
    await stat(path.join(c.storage, 'submissions', files[0].filePath)).catch(() => null),
    null,
  );
});
test('人工模式直接批改且不创建 AI/OCR 任务；教学团队导出无密钥', async () => {
  const offline = await json('POST', '/teacher/questions', question('人工降级'), admin);
  await json(
    'POST',
    '/teacher/permissions',
    { studentIds: [a.user.id], questionIds: [offline.id] },
    admin,
  );
  const d = await json('POST', '/student/questions/' + offline.id + '/start', {}, a);
  const png = Buffer.from(
    (
      await pdfPage(
        path.join(
          c.storage,
          'submissions',
          (await db.attachment.findUniqueOrThrow({ where: { id: file.id } })).filePath,
        ),
        1,
      )
    ).data,
    'base64',
  );
  const f = await upload(d.id, a, 'answer.png', png);
  await json('POST', '/student/attempts/' + d.id + '/submit', { version: f.version }, a);
  await processOneJob(db, c);
  const after = await db.submissionAttempt.findUniqueOrThrow({
    where: { id: d.id },
    include: { ocrResult: true },
  });
  assert.equal(after.status, 'TEACHER_REVIEWING');
  assert.equal(after.ocrResult, null);
  assert.equal(await db.gradingJob.count({ where: { attemptId: d.id } }), 0);
  await publish(d.id, 10, [
    {
      id: 'offline-note',
      fileId: f.id,
      page: 1,
      type: 'comment',
      x: 0.1,
      y: 0.2,
      width: 0.3,
      height: 0.1,
      color: '#bb3333',
      content: '人工标注',
    },
  ]);
  const out = await json('GET', '/teacher/export', undefined, admin);
  assert.ok(out.attempts.length > 3);
  assert.doesNotMatch(
    JSON.stringify(out),
    /passwordHash|codeHash|bindingHash|SESSION_SECRET|openid/,
  );
  const empty = await json('GET', '/teacher/export', undefined, other);
  assert.equal(empty.attempts.length, out.attempts.length);
  assert.equal(empty.students.length, out.students.length);
  const csv = await request('GET', '/teacher/export?format=csv', undefined, admin);
  assert.match(csv.headers['content-type'], /text\/csv/);
  assert.ok(csv.body.includes('question'));
  await request('GET', '/teacher/export', undefined, a, 403);
  const manual = createAIProvider({ ...c, aiProvider: 'remote' });
  assert.ok(manual instanceof ManualProvider);
  await assert.rejects(manual.gradeEssay({ text: 'test', question: {} }), /人工批改/);
});
test('中国教学日边界正确，队列不包含前一天或次日提交', async () => {
  const bounds = dayBounds(new Date('2026-10-04T00:10:00+08:00'));
  assert.equal(bounds.gte.toISOString(), '2026-10-03T16:00:00.000Z');
  assert.equal(bounds.lt.toISOString(), '2026-10-04T16:00:00.000Z');
  const old = await json('POST', '/teacher/questions', question('昨日题'), admin);
  await json(
    'POST',
    '/teacher/permissions',
    { studentIds: [a.user.id], questionIds: [old.id] },
    admin,
  );
  const d = await json('POST', '/student/questions/' + old.id + '/start', {}, a);
  await submit(d, a);
  await db.submissionAttempt.update({
    where: { id: d.id },
    data: { submittedAt: new Date(dayBounds(new Date()).gte.getTime() - 1) },
  });
  const today = await json('GET', '/teacher/today-unreviewed', undefined, admin);
  assert.ok(!today.rows.some((r: any) => r.id === d.id));
  assert.ok(today.counts.reviewPending > today.counts.todayUnreviewed);
});

test('用量记录仅管理员可维护，临近额度提示且不改变计费设置', async () => {
  await request('GET', '/admin/resources', undefined, undefined, 401);
  await request('GET', '/admin/resources', undefined, a, 403);
  await request('GET', '/admin/resources', undefined, other, 403);
  const recorded = await json(
    'PUT',
    '/admin/resources',
    {
      used: 2400,
      quota: 3000,
      periodEnd: new Date(Date.now() + 86400000).toISOString(),
    },
    admin,
  );
  assert.equal(recorded.warning, '当前资源即将达到免费额度，请处理。');
  const saved = await json('GET', '/admin/resources', undefined, admin);
  assert.equal(saved.snapshot.source, 'admin-record');
  assert.equal(saved.snapshot.used, 2400);
  assert.equal(saved.stale, false);
  await request('PUT', '/admin/resources', { used: 1, quota: 0 }, admin, 400);
});
