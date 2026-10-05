import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, readdir } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { PrismaClient } from '@prisma/client';
import { fixtureDatabase } from './database-fixture.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { issueSession } from '../src/security.js';
import { createServer } from 'node:http';
import { objectStore, withLocalObject } from '../src/object-store.js';
import { purgeExpiredOriginals } from '../src/retention.js';
let dir: string,
  db: PrismaClient,
  app: any,
  c: any,
  teacher: any,
  web: any,
  mini: any,
  student: any,
  q: any,
  attempt: any;
let seq = 0;
const password = 'Student-password-2026';
async function req(
  url: string,
  method = 'GET',
  payload?: any,
  who: any = teacher,
  status = 200,
  extra: any = {},
) {
  const r = await app.inject({
    method,
    url: '/api' + url,
    payload,
    remoteAddress: '127.3.0.' + ((++seq % 250) + 1),
    headers: {
      ...(who?.token ? { authorization: 'Bearer ' + who.token } : {}),
      ...(who?.cookie
        ? { cookie: who.cookie, origin: c.appUrl, 'x-csrf-token': who.csrfToken }
        : {}),
      ...extra,
    },
  });
  assert.equal(r.statusCode, status, r.body);
  return r;
}
const json = async (...args: Parameters<typeof req>) => (await req(...args)).json();
before(async () => {
  dir = await mkdtemp(path.join(process.cwd(), 'test-portal-'));
  const file = path.join(dir, 'data.db'),
    sql = new DatabaseSync(file);
  for (const m of (await readdir('prisma/migrations')).filter((x) => /^\d/.test(x)).sort())
    sql.exec(await readFile('prisma/migrations/' + m + '/migration.sql', 'utf8'));
  sql.close();
  db = await fixtureDatabase(file);
  c = {
    ...loadConfig(),
    storage: path.join(dir, 'storage'),
    aiProvider: 'remote-worker',
    remoteWorkerToken: 'worker-secret-'.repeat(4),
    fileRetentionDays: 30,
  };
  app = await buildApp({
    db,
    config: c,
    wechat: {
      async exchange(code: string) {
        return 'portal-openid-' + code;
      },
    },
  });
  const u = await db.user.create({
    data: { name: '测试老师', role: 'ADMIN', teacher: { create: {} } },
  });
  teacher = await issueSession(db, c, u.id);
  student = await json('/teacher/students', 'POST', { name: '跨端学生' });
  q = await json('/teacher/questions', 'POST', {
    title: '网页专项训练',
    type: '概括',
    materials: '材料',
    prompt: '概括材料',
    requirements: '准确',
    wordLimit: 300,
    maxScore: 20,
    rubric: '不得向学生提前公开',
    referenceAnswer: '参考',
  });
  await json('/teacher/permissions', 'POST', { studentIds: [student.id], questionIds: [q.id] });
});
after(async () => {
  await app?.close();
  await db?.$disconnect();
  await rm(dir, { recursive: true, force: true });
});
test('网页激活复用老师档案，一次性码不可重复，登录及 CSRF 隔离', async () => {
  const r = await req(
    '/auth/student/activate',
    'POST',
    { username: 'Portal-Student', password, bindingCode: student.bindingCode },
    null,
  );
  web = { cookie: String(r.headers['set-cookie']).split(';')[0], csrfToken: r.json().csrfToken };
  assert.equal(r.json().user.id, student.id);
  assert.equal(await db.user.count({ where: { role: 'STUDENT' } }), 1);
  await req(
    '/auth/student/activate',
    'POST',
    { username: 'another', password, bindingCode: student.bindingCode },
    null,
    400,
  );
  await req(
    '/auth/student/login',
    'POST',
    { username: 'portal-student', password: 'invalid-password' },
    null,
    401,
  );
  await req('/student/questions/' + q.id + '/start', 'POST', {}, web, 403, { 'x-csrf-token': '' });
  await req('/teacher/questions', 'GET', undefined, web, 403);
  attempt = await json('/student/questions/' + q.id + '/start', 'POST', {}, web);
  const saved = await json(
    '/student/attempts/' + attempt.id + '/draft',
    'PUT',
    { text: '网页写下的答案', version: attempt.version },
    web,
  );
  attempt.version = saved.version;
});
test('已有网页账号绑定微信后，共享草稿、授权、账号与提交', async () => {
  const ticket = await json('/auth/wechat', 'POST', { code: 'a' }, null);
  await req(
    '/auth/wechat/link',
    'POST',
    { bindToken: ticket.bindToken, username: 'portal-student', password: 'invalid-password' },
    null,
    401,
  );
  mini = await json(
    '/auth/wechat/link',
    'POST',
    { bindToken: ticket.bindToken, username: 'portal-student', password },
    null,
  );
  assert.equal(mini.user.id, student.id);
  assert.equal(await db.user.count({ where: { role: 'STUDENT' } }), 1);
  const d = await json('/student/questions/' + q.id, 'GET', undefined, mini);
  assert.equal(d.attempts[0].text, '网页写下的答案');
  await req(
    '/auth/wechat/link',
    'POST',
    { bindToken: ticket.bindToken, username: 'portal-student', password },
    null,
    401,
  );
  const again = await json('/auth/wechat', 'POST', { code: 'a' }, null);
  assert.equal(again.user.id, student.id);
  const saved = await json(
    '/student/attempts/' + attempt.id + '/draft',
    'PUT',
    { text: '小程序续写的答案', version: attempt.version },
    mini,
  );
  const webView = await json('/student/questions/' + q.id, 'GET', undefined, web);
  assert.equal(webView.attempts[0].text, '小程序续写的答案');
  await json(
    '/student/attempts/' + attempt.id + '/submit',
    'POST',
    { version: saved.version },
    web,
  );
});
test('本地工作进程需要独立密钥与任务租约，非法结果拒绝，AI 草稿不向学生公开', async () => {
  await req('/worker/claim', 'POST', {}, null, 401);
  const worker = { token: c.remoteWorkerToken },
    job = (await json('/worker/claim', 'POST', {}, worker)).job;
  assert.equal(job.attemptId, attempt.id);
  assert.equal(job.text, '小程序续写的答案');
  await req('/worker/' + job.id + '/files/fake', 'GET', undefined, worker, 409, {
    'x-job-lease': 'wrong',
  });
  const result = {
    estimatedScore: 15,
    confidence: 0.8,
    summary: 'PRIVATE_AI_DRAFT',
    strengths: [],
    weaknesses: [],
    pointsCovered: [],
    pointsMissing: [],
    structureAnalysis: '',
    languageAnalysis: '',
    annotations: [],
    suggestions: [],
    pointAssessments: [],
  };
  await req(
    '/worker/' + job.id + '/complete',
    'POST',
    { leaseToken: 'wrong', text: job.text, result, model: 'test' },
    worker,
    409,
  );
  await req(
    '/worker/' + job.id + '/complete',
    'POST',
    {
      leaseToken: job.leaseToken,
      text: job.text,
      result: { ...result, estimatedScore: 30 },
      model: 'test',
    },
    worker,
    400,
  );
  await json(
    '/worker/' + job.id + '/complete',
    'POST',
    { leaseToken: job.leaseToken, text: job.text, result, model: 'test' },
    worker,
  );
  const d = await json('/student/questions/' + q.id, 'GET', undefined, web);
  assert.equal(d.attempts[0].finalGrade, null);
  assert.ok(!JSON.stringify(d).includes('PRIVATE_AI_DRAFT'));
  await req(
    '/worker/' + job.id + '/complete',
    'POST',
    { leaseToken: job.leaseToken, text: job.text, result, model: 'test' },
    worker,
    409,
  );
});
test('重置网页账号立即注销旧会话，保留微信身份及训练；重新激活恢复原档案', async () => {
  const reset = await json('/teacher/students/' + student.id + '/reset-web-account', 'POST', {});
  await req('/student/questions', 'GET', undefined, web, 401);
  await req('/student/questions', 'GET', undefined, mini, 401);
  const r = await req(
    '/auth/student/activate',
    'POST',
    { bindingCode: reset.bindingCode, username: 'portal-student', password },
    null,
  );
  assert.equal(r.json().user.id, student.id);
  const wx = await json('/auth/wechat', 'POST', { code: 'a' }, null);
  assert.equal(wx.user.id, student.id);
  assert.equal((await json('/student/questions/' + q.id, 'GET', undefined, wx)).attempts.length, 1);
});
test('文件过期清理默认只预览，只清理所有引用均为已发布旧记录的原稿', async () => {
  const store = objectStore(c),
    key = '12345678-1234-1234-1234-123456789012.txt';
  await store.put(key, Buffer.from('answer'), 'text/plain');
  await db.attachment.create({
    data: {
      attemptId: attempt.id,
      filePath: key,
      fileName: 'answer.txt',
      mimeType: 'text/plain',
      size: 6,
      checksum: 'checksum',
    },
  });
  assert.equal((await purgeExpiredOriginals(db, c, true)).removed, 0);
  await db.submissionAttempt.update({ where: { id: attempt.id }, data: { status: 'PUBLISHED' } });
  await db.finalGrade.create({
    data: {
      attemptId: attempt.id,
      finalScore: 15,
      feedbackJson: '{}',
      publishedBy: 'test',
      publishedAt: new Date(Date.now() - 31 * 86400000),
    },
  });
  assert.equal((await purgeExpiredOriginals(db, c)).candidates, 1);
  assert.equal(await store.exists(key), true);
  assert.equal((await purgeExpiredOriginals(db, c, true)).removed, 1);
  assert.equal(await store.exists(key), false);
  assert.equal(await db.attachment.count({ where: { attemptId: attempt.id } }), 1);
  assert.equal(await db.finalGrade.count({ where: { attemptId: attempt.id } }), 1);
});
test('S3 适配器通过签名 HTTP 读写私有对象；临时预览文件使用后清理（协议桩）', async () => {
  const objects = new Map<string, Buffer>();
  let signed = 0;
  const server = createServer(async (req, res) => {
    if (req.headers.authorization?.startsWith('AWS4-HMAC-SHA256')) signed++;
    const key = req.url!.split('?')[0];
    if (req.method === 'PUT') {
      const chunks = [];
      for await (const b of req) chunks.push(b);
      objects.set(key, Buffer.concat(chunks));
      res.end();
    } else if (req.method === 'DELETE') {
      objects.delete(key);
      res.statusCode = 204;
      res.end();
    } else if (!objects.has(key)) {
      res.statusCode = 404;
      res.end();
    } else {
      res.setHeader('Content-Length', objects.get(key)!.length);
      res.end(req.method === 'HEAD' ? undefined : objects.get(key));
    }
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const address = server.address() as any;
  try {
    const cfg = {
      ...c,
      storageProvider: 's3',
      s3Bucket: 'private-test',
      s3Region: 'local',
      s3Endpoint: 'http://127.0.0.1:' + address.port,
      s3AccessKey: 'testing-key',
      s3SecretKey: 'testing-secret',
      s3PathStyle: true,
    };
    const store = objectStore(cfg),
      key = '12345678-1234-1234-1234-123456789013.txt';
    assert.equal(await store.exists(key), false);
    await store.put(key, Buffer.from('private content'), 'text/plain');
    assert.equal((await store.read(key)).toString(), 'private content');
    let temp = '';
    await withLocalObject(cfg, key, async (p) => {
      temp = p;
      assert.equal(await readFile(p, 'utf8'), 'private content');
    });
    await assert.rejects(readFile(temp));
    await store.remove(key);
    assert.equal(await store.exists(key), false);
    assert.ok(signed >= 6);
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
  }
});
