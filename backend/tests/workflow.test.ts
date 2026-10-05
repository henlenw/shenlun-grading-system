import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { PrismaClient } from '@prisma/client';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { processOneJob } from '../src/jobs.js';
import { validateUpload, MAX_FILE_BYTES } from '../src/files.js';
import { aiSchema } from '../src/schemas.js';
import type { AIProvider } from '../src/ai.js';
import { fixtureDatabase } from './database-fixture.js';
let dir: string,
  db: PrismaClient,
  app: any,
  config: any,
  admin: any,
  teacher: any,
  studentA: any,
  studentB: any,
  question: any,
  assignment: any,
  attempt: any,
  aiOriginal: string;
type Credential = { cookie?: string; csrfToken?: string; token?: string; user?: any };
let ip = 0;
async function request(
  method: string,
  url: string,
  body?: any,
  who?: Credential,
  status = 200,
  extra: any = {},
) {
  const headers: any = { ...extra.headers };
  if (who?.cookie) {
    headers.cookie = who.cookie;
    headers.origin = config.appUrl;
    headers['x-csrf-token'] = who.csrfToken;
  }
  if (who?.token) headers.authorization = 'Bearer ' + who.token;
  const response = await app.inject({
    method,
    url: '/api' + url,
    payload: body,
    remoteAddress: '127.0.1.' + ((++ip % 250) + 1),
    ...extra,
    headers,
  });
  assert.equal(response.statusCode, status, response.body);
  return response;
}
const json = async (...args: Parameters<typeof request>) => (await request(...args)).json();
async function login(username: string, password = 'Testing-password-2026') {
  const res = await request('POST', '/auth/login', { username, password });
  return { ...res.json(), cookie: res.headers['set-cookie'].split(';')[0] };
}
async function bind(name: string, mentor: any, code: string) {
  const student = await json('POST', '/teacher/students', { name }, mentor);
  const ticket = await json('POST', '/auth/wechat', { code });
  const s = await json('POST', '/auth/wechat/bind', {
    bindToken: ticket.bindToken,
    bindingCode: student.bindingCode,
  });
  return { ...s, student };
}
const sampleText = '基层治理需要群众参与。\n让群众参与议事，以公开透明的程序回应真实诉求。';
const annotation = {
  startOffset: 0,
  endOffset: 4,
  selectedText: '基层治理',
  category: 'CONTENT',
  severity: 'MEDIUM',
  comment: '需要联系材料说明治理的具体问题。',
  suggestion: '补充具体的材料依据。',
};
const aiResult = {
  estimatedScore: 65,
  confidence: 0.6,
  summary: 'AI_PRIVATE_MARKER',
  strengths: ['有主题'],
  weaknesses: ['材料不足'],
  pointsCovered: ['参与'],
  pointsMissing: ['机制'],
  structureAnalysis: '需完善',
  languageAnalysis: '基本规范',
  annotations: [annotation],
  suggestions: ['联系材料'],
};
const fixtureProvider: AIProvider = {
  async gradeEssay() {
    return { result: aiSchema.parse(aiResult), raw: 'PRIVATE_RAW_RESPONSE' };
  },
  async analyzeEssay() {
    return aiSchema.parse(aiResult);
  },
  async generateMaterial() {
    return { title: 'fixture', summary: 'fixture', status: 'DRAFT' };
  },
};
before(async () => {
  dir = await mkdtemp(path.join(process.cwd(), 'test-work-'));
  const database = path.join(dir, 'test.db');
  const sqlite = new DatabaseSync(database);
  sqlite.exec(
    await readFile(
      path.join(process.cwd(), 'prisma/migrations/202610040001_initial/migration.sql'),
      'utf8',
    ),
  );
  sqlite.exec(
    await readFile(
      path.join(process.cwd(), 'prisma/migrations/202610040002_kaoba167/migration.sql'),
      'utf8',
    ),
  );
  sqlite.exec(await readFile('prisma/migrations/202610050001_material_answers/migration.sql', 'utf8'));
  sqlite.close();
  db = await fixtureDatabase(database);
  config = {
    ...loadConfig(),
    secret: 'integration-session-secret-000000000000000',
    bootstrapToken: 'integration-bootstrap-token-0000000000000',
    storage: path.join(dir, 'storage'),
    appUrl: 'http://localhost:3000',
    aiProvider: 'ollama',
    ollamaUrl: 'http://127.0.0.1:1',
  };
  app = await buildApp({
    db,
    config,
    wechat: {
      async exchange(code) {
        if (!code.startsWith('test-code-')) throw Error('invalid test code');
        return 'test-openid-' + code;
      },
    },
  });
});
after(async () => {
  await app?.close();
  await db?.$disconnect();
  await rm(dir, { recursive: true, force: true });
});
test('初始化只有密钥持有者可执行，初始化一次后关闭', async () => {
  assert.equal((await json('GET', '/auth/setup')).needsSetup, true);
  const body = {
    username: 'admin',
    password: 'Testing-password-2026',
    name: '测试管理员',
    bootstrapToken: 'incorrect',
  };
  await request('POST', '/auth/setup', body, undefined, 403);
  const res = await request('POST', '/auth/setup', {
    ...body,
    bootstrapToken: config.bootstrapToken,
  });
  admin = { ...res.json(), cookie: res.headers['set-cookie'].split(';')[0] };
  assert.match(res.headers['set-cookie'], /HttpOnly/);
  assert.match(res.headers['set-cookie'], /SameSite=Strict/);
  await request(
    'POST',
    '/auth/setup',
    { ...body, bootstrapToken: config.bootstrapToken },
    undefined,
    409,
  );
  assert.equal((await json('GET', '/auth/setup')).needsSetup, false);
  const stored = await db.user.findUniqueOrThrow({ where: { id: admin.user.id } });
  assert.notEqual(stored.passwordHash, body.password);
  assert.match(stored.passwordHash!, /:/);
});
test('教师密码认证、CSRF 和来源保护', async () => {
  await request(
    'POST',
    '/auth/login',
    { username: 'admin', password: 'wrong-password' },
    undefined,
    401,
  );
  admin = await login('admin');
  await request('POST', '/teacher/students', { name: '非法创建' }, undefined, 401);
  await request('POST', '/teacher/students', { name: '跨站创建' }, undefined, 403, {
    headers: {
      cookie: admin.cookie,
      origin: 'https://evil.example',
      'x-csrf-token': admin.csrfToken,
    },
  });
  await request('POST', '/teacher/students', { name: '缺少校验' }, undefined, 403, {
    headers: { cookie: admin.cookie, origin: config.appUrl },
  });
  await json(
    'POST',
    '/admin/teachers',
    { name: '第二位老师', username: 'teacher2', password: 'Testing-password-2026' },
    admin,
  );
  teacher = await login('teacher2');
});
test('真实绑定业务：一次性绑定码绑定学生，微信再次登录复用身份', async () => {
  studentA = await bind('学生甲', admin, 'test-code-a');
  studentB = await bind('学生乙', teacher, 'test-code-b');
  const again = await json('POST', '/auth/wechat', { code: 'test-code-a' });
  assert.equal(again.needsBinding, false);
  assert.equal(again.user.id, studentA.user.id);
  const record = await db.studentProfile.findUniqueOrThrow({ where: { userId: studentA.user.id } });
  assert.equal(record.bindingHash, null);
  const ticket = await json('POST', '/auth/wechat', { code: 'test-code-c' });
  await request(
    'POST',
    '/auth/wechat/bind',
    { bindToken: ticket.bindToken, bindingCode: studentA.student.bindingCode },
    undefined,
    400,
  );
});
test('绑定票据限制错误次数，过期绑定码不可用', async () => {
  const s = await json('POST', '/teacher/students', { name: '未绑定学生' }, admin);
  const ticket = await json('POST', '/auth/wechat', { code: 'test-code-tries' });
  const body = { bindToken: ticket.bindToken, bindingCode: '000000' };
  for (let i = 0; i < 5; i++) await request('POST', '/auth/wechat/bind', body, undefined, 400);
  await request(
    'POST',
    '/auth/wechat/bind',
    { ...body, bindingCode: s.bindingCode },
    undefined,
    401,
  );
  const next = await json('POST', '/auth/wechat', { code: 'test-code-expired' });
  await db.studentProfile.update({
    where: { userId: s.id },
    data: { bindingExpiresAt: new Date(0) },
  });
  await request(
    'POST',
    '/auth/wechat/bind',
    { bindToken: next.bindToken, bindingCode: s.bindingCode },
    undefined,
    400,
  );
});
test('学生不能进入教师/管理员接口，教学团队可以管理全部学生', async () => {
  await request('GET', '/teacher/students', undefined, studentA, 403);
  await request('GET', '/admin/status', undefined, studentA, 403);
  await request(
    'POST',
    '/teacher/students/' + studentA.user.id + '/binding-code',
    {},
    teacher,
    409,
  );
  const visible = await json('GET', '/teacher/students', undefined, teacher);
  assert.equal(visible.length, await db.studentProfile.count());
  assert.ok(visible.some((s: any) => s.id === studentB.user.id));
});
test('创建题目、作业和服务端题目投影：不泄露参考答案与评分备注', async () => {
  question = await json(
    'POST',
    '/teacher/questions',
    {
      title: '基层治理训练',
      type: '大作文',
      materials: '社区设置议事厅，邀请居民参与讨论。',
      prompt: '结合材料说明基层治理如何吸纳群众参与。',
      requirements: '联系材料，条理清晰。',
      wordLimit: 1000,
      maxScore: 100,
      rubric: 'PRIVATE_RUBRIC',
      referenceAnswer: 'PRIVATE_REFERENCE',
      internalNote: 'PRIVATE_QUESTION_NOTE',
    },
    admin,
  );
  assignment = await json(
    'POST',
    '/teacher/assignments',
    {
      title: '第一周申论作业',
      questionId: question.id,
      studentIds: [studentA.user.id],
      dueAt: new Date(Date.now() + 86400000).toISOString(),
    },
    admin,
  );
  const res = await request('GET', '/student/assignments/' + assignment.id, undefined, studentA);
  assert.ok(!res.body.includes('PRIVATE_'));
  assert.equal(res.json().question.prompt, question.prompt);
  await request('GET', '/student/assignments/' + assignment.id, undefined, studentB, 404);
  await request(
    'POST',
    '/teacher/assignments',
    {
      title: '教学团队共同布置',
      questionId: question.id,
      studentIds: [studentA.user.id],
      dueAt: new Date(Date.now() + 86400000).toISOString(),
    },
    teacher,
    200,
  );
});
test('草稿自动保存与版本冲突，学生互相隔离', async () => {
  attempt = await json('POST', '/student/assignments/' + assignment.id + '/draft', {}, studentA);
  assert.equal(attempt.attemptNo, 1);
  const saved = await json(
    'PUT',
    '/student/attempts/' + attempt.id + '/draft',
    { text: sampleText, version: 0 },
    studentA,
  );
  assert.equal(saved.version, 1);
  attempt.version = 1;
  await request(
    'PUT',
    '/student/attempts/' + attempt.id + '/draft',
    { text: '过时内容', version: 0 },
    studentA,
    409,
  );
  await request(
    'PUT',
    '/student/attempts/' + attempt.id + '/draft',
    { text: '越权内容', version: 1 },
    studentB,
    404,
  );
  const a = await db.submissionAttempt.findUniqueOrThrow({ where: { id: attempt.id } });
  await request('GET', '/student/submissions/' + a.submissionId, undefined, studentB, 404);
  assert.equal(
    (await json('GET', '/student/assignments/' + assignment.id, undefined, studentA)).attempts[0]
      .text,
    sampleText,
  );
});
test('TXT 上传、随机文件名、鉴权下载和文件删除', async () => {
  const boundary = 'test-boundary';
  const body = Buffer.from(
    '--' +
      boundary +
      '\r\nContent-Disposition: form-data; name="file"; filename="answer.txt"\r\nContent-Type: text/plain\r\n\r\n作业附件\r\n--' +
      boundary +
      '--\r\n',
  );
  const res = await json(
    'POST',
    '/student/attempts/' + attempt.id + '/files',
    body,
    studentA,
    200,
    { headers: { 'content-type': 'multipart/form-data; boundary=' + boundary } },
  );
  const stored = await db.attachment.findUniqueOrThrow({ where: { id: res.id } });
  assert.match(stored.filePath, /^[a-f0-9-]{36}\.txt$/);
  assert.equal(stored.checksum.length, 64);
  await request('GET', '/files/' + res.id, undefined, studentB, 404);
  await request('GET', '/files/' + res.id, undefined, teacher, 200);
  const downloaded = await request('GET', '/files/' + res.id, undefined, studentA);
  assert.equal(downloaded.body, '作业附件');
  const removed = await json('DELETE', '/student/files/' + res.id, undefined, studentA);
  attempt.version = removed.version;
});
test('恶意扩展名、伪装类型、路径穿越、超限大小被拒绝', async () => {
  for (const name of ['../test.txt', '..\\test.txt', 'evil.html', 'bad.exe'])
    await assert.rejects(validateUpload(name, Buffer.from('test')));
  await assert.rejects(validateUpload('fake.pdf', Buffer.from('<script>bad</script>')));
  await assert.rejects(validateUpload('too-large.txt', Buffer.alloc(MAX_FILE_BYTES + 1)));
  await assert.rejects(validateUpload('binary.txt', Buffer.from([0, 1, 2])));
});
test('提交具有幂等性，并冻结学生原文', async () => {
  const p = '/student/attempts/' + attempt.id + '/submit';
  await json('POST', p, { version: attempt.version }, studentA);
  await json('POST', p, { version: attempt.version }, studentA);
  assert.equal(await db.gradingJob.count({ where: { attemptId: attempt.id } }), 1);
  await request(
    'PUT',
    '/student/attempts/' + attempt.id + '/draft',
    { version: attempt.version, text: '提交后篡改' },
    studentA,
    409,
  );
  await request('POST', '/student/assignments/' + assignment.id + '/draft', {}, studentA, 409);
});
test('AIGrade 独立保存，不进入学生 API；教师只能看授权提交', async () => {
  await processOneJob(db, config, fixtureProvider);
  const a = await db.aIGrade.findUniqueOrThrow({ where: { attemptId: attempt.id } });
  aiOriginal = JSON.stringify(a);
  const visible = await request(
    'GET',
    '/student/assignments/' + assignment.id,
    undefined,
    studentA,
  );
  assert.ok(!visible.body.includes('AI_PRIVATE_MARKER'));
  assert.ok(!visible.body.includes('estimatedScore'));
  assert.ok(!visible.body.includes('confidence'));
  assert.equal(visible.json().attempts[0].finalGrade, null);
  await request('GET', '/teacher/submissions/' + attempt.id, undefined, teacher, 200);
  assert.ok(
    (await request('GET', '/teacher/submissions/' + attempt.id, undefined, admin)).body.includes(
      'AI_PRIVATE_MARKER',
    ),
  );
});
test('教师可增改删批注，未发布教师反馈也不可见', async () => {
  const body = {
    ...{
      version: 0,
      finalScore: 76,
      summary: 'TEACHER_UNPUBLISHED',
      strengths: '有中心',
      weaknesses: '需补充材料',
      nextFocus: '具体论证',
      recommendedResources: '课堂笔记',
      internalNote: 'PRIVATE_TEACHER_NOTE',
    },
    annotations: [annotation],
  };
  let review = await json('PUT', '/teacher/submissions/' + attempt.id + '/review', body, admin);
  await request('PUT', '/teacher/submissions/' + attempt.id + '/review', body, admin, 409);
  await request(
    'PUT',
    '/teacher/submissions/' + attempt.id + '/review',
    { ...body, version: review.version, annotations: [{ ...annotation, selectedText: '不匹配' }] },
    admin,
    400,
  );
  review = await json(
    'PUT',
    '/teacher/submissions/' + attempt.id + '/review',
    { ...body, version: review.version, annotations: [] },
    admin,
  );
  review = await json(
    'PUT',
    '/teacher/submissions/' + attempt.id + '/review',
    {
      ...body,
      version: review.version,
      annotations: [{ ...annotation, comment: '教师修改后的批注' }],
    },
    admin,
  );
  const result = await request('GET', '/student/assignments/' + assignment.id, undefined, studentA);
  assert.ok(!result.body.includes('TEACHER_UNPUBLISHED'));
  assert.ok(!result.body.includes('PRIVATE_TEACHER_NOTE'));
  assert.equal(
    JSON.stringify(await db.aIGrade.findUniqueOrThrow({ where: { attemptId: attempt.id } })),
    aiOriginal,
  );
});
test('学生无法修改/发布最终成绩；教师确认发布生成唯一正式成绩及通知', async () => {
  const review = await db.teacherReview.findUniqueOrThrow({ where: { attemptId: attempt.id } });
  await request(
    'POST',
    '/teacher/submissions/' + attempt.id + '/publish',
    { reviewVersion: review.version },
    studentA,
    403,
  );
  await request(
    'POST',
    '/teacher/submissions/' + attempt.id + '/publish',
    { reviewVersion: review.version - 1 },
    admin,
    409,
  );
  await json(
    'POST',
    '/teacher/submissions/' + attempt.id + '/publish',
    { reviewVersion: review.version },
    admin,
  );
  await request(
    'POST',
    '/teacher/submissions/' + attempt.id + '/publish',
    { reviewVersion: review.version },
    admin,
    409,
  );
  const res = await request('GET', '/student/assignments/' + assignment.id, undefined, studentA);
  const final = res.json().attempts[0].finalGrade;
  assert.equal(final.finalScore, 76);
  assert.equal(final.annotations[0].comment, '教师修改后的批注');
  assert.ok(!res.body.includes('PRIVATE_'));
  assert.equal((await json('GET', '/student/notifications', undefined, studentA)).length, 1);
  await request(
    'PUT',
    '/teacher/submissions/' + attempt.id + '/review',
    { version: review.version, finalScore: 0, summary: '修改已发布成绩', annotations: [] },
    admin,
    409,
  );
});
test('重做保留 Attempt 1 的正式成绩，创建 Attempt 2', async () => {
  await json(
    'POST',
    '/teacher/submissions/' + attempt.id + '/revision',
    {
      reason: '请补充材料',
      requirements: '补充议事机制的实际做法',
      dueAt: new Date(Date.now() + 86400000 * 2).toISOString(),
    },
    admin,
  );
  const second = await json(
    'POST',
    '/student/assignments/' + assignment.id + '/draft',
    {},
    studentA,
  );
  assert.equal(second.attemptNo, 2);
  await json(
    'PUT',
    '/student/attempts/' + second.id + '/draft',
    { version: 0, text: '第二次作答' },
    studentA,
  );
  await json('POST', '/student/attempts/' + second.id + '/submit', { version: 1 }, studentA);
  const detail = await json('GET', '/student/assignments/' + assignment.id, undefined, studentA);
  assert.equal(detail.attempts.length, 2);
  assert.equal(detail.attempts[1].finalGrade.finalScore, 76);
});
test('本地 AI 不可用时降级人工复核并可发布', async () => {
  await processOneJob(db, { ...config, aiProvider: 'disabled' });
  const detail = await json('GET', '/student/assignments/' + assignment.id, undefined, studentA);
  const a = detail.attempts[0];
  assert.equal(a.status, 'TEACHER_REVIEWING');
  const review = await json(
    'PUT',
    '/teacher/submissions/' + a.id + '/review',
    { version: 0, finalScore: 82, summary: '已补充材料，继续保持。', annotations: [] },
    admin,
  );
  await json(
    'POST',
    '/teacher/submissions/' + a.id + '/publish',
    { reviewVersion: review.version },
    admin,
  );
  assert.equal(await db.aIGrade.count({ where: { attemptId: a.id } }), 0);
  const stats = await json('GET', '/student/stats', undefined, studentA);
  assert.deepEqual(
    stats.scores.map((s: any) => s.score),
    [76, 82],
  );
  assert.equal(stats.completed, 0); // A question completes only after all three rounds are published.
});
test('停用学生立即使已有会话失效', async () => {
  await json(
    'PATCH',
    '/teacher/students/' + studentA.user.id,
    { name: '学生甲', contact: '', disabled: true },
    admin,
  );
  await request('GET', '/student/assignments', undefined, studentA, 401);
  await json(
    'PATCH',
    '/teacher/students/' + studentA.user.id,
    { name: '学生甲', contact: '', disabled: false },
    admin,
  );
  studentA = await json('POST', '/auth/wechat', { code: 'test-code-a' });
});
test('管理员备份为 ZIP，不打包真实环境密钥', async () => {
  const res = await request('POST', '/admin/backup', undefined, admin);
  assert.equal(res.rawPayload.subarray(0, 2).toString(), 'PK');
  assert.match(res.headers['content-disposition'], /backup-/);
  assert.ok(!res.rawPayload.includes(Buffer.from(config.secret)));
});
test('核心操作都有审计记录；注销会话不可重用', async () => {
  const rows = await db.auditLog.findMany();
  for (const action of [
    'create_user',
    'login',
    'bind_wechat',
    'submit_assignment',
    'ai_grade',
    'teacher_edit_grade',
    'teacher_edit_annotation',
    'publish_grade',
    'request_revision',
    'disable_user',
    'backup',
  ])
    assert.ok(
      rows.some((r) => r.action === action),
      action,
    );
  await json('POST', '/auth/logout', undefined, teacher);
  await request('GET', '/teacher/questions', undefined, teacher, 401);
});
