import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { issueSession } from '../src/security.js';
import { fixtureDatabase } from './database-fixture.js';
import { materialText, materialSegments } from '../src/material-text.js';
let db: any,
  app: any,
  dir: string,
  config: any,
  teacher: any,
  student: any,
  other: any,
  question: any,
  draft: any;
let sequence = 0;
const raw = '<p>社区<u>听取居民意见</u>，完善治理。</p><p>公开落实情况，接受监督。😀</p>';
const plain = materialText(raw).text;
const mark = { id: 'mark-1', start: 2, end: 8, type: 'highlight', selectedText: '听取居民意见' };
async function api(
  who: any,
  method: string,
  url: string,
  body?: any,
  status = 200,
  headers: any = {},
) {
  const response = await app.inject({
    method,
    url: '/api' + url,
    payload: body,
    remoteAddress: '127.0.5.' + ((++sequence % 250) + 1),
    headers: { authorization: 'Bearer ' + who.token, ...headers },
  });
  assert.equal(response.statusCode, status, response.body);
  return response.headers['content-type']?.includes('application/json')
    ? response.json()
    : response.rawPayload;
}
async function upload(who: any, id: string, number: number) {
  const bytes = Buffer.concat([
    Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=',
      'base64',
    ),
    Buffer.from([number]),
  ]);
  const boundary = 'material-test-image';
  const payload = Buffer.concat([
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="page-${number}.png"\r\nContent-Type: image/png\r\n\r\n`,
    ),
    bytes,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  return api(who, 'POST', `/student/attempts/${id}/files`, payload, 200, {
    'content-type': 'multipart/form-data; boundary=' + boundary,
  });
}
async function publish(id: string, score: number, fileId?: string) {
  const review = await api(teacher, 'PUT', `/teacher/submissions/${id}/review`, {
    version: 0,
    finalScore: score,
    summary: '正式评语',
    annotations: [],
    pageAnnotations: fileId
      ? [
          {
            id: 'teacher-mark',
            fileId,
            page: 1,
            type: 'circle',
            x: 0.1,
            y: 0.1,
            width: 0.3,
            height: 0.2,
            color: '#ff0000',
            text: '',
          },
        ]
      : [],
  });
  await api(teacher, 'POST', `/teacher/submissions/${id}/publish`, {
    reviewVersion: review.version,
  });
}
before(async () => {
  dir = await mkdtemp(path.join(process.cwd(), 'test-material-'));
  const file = path.join(dir, 'test.db'),
    sqlite = new DatabaseSync(file);
  for (const m of (await readdir('prisma/migrations')).sort())
    if (m !== 'migration_lock.toml')
      sqlite.exec(await readFile('prisma/migrations/' + m + '/migration.sql', 'utf8'));
  sqlite.close();
  db = await fixtureDatabase(file);
  config = {
    ...loadConfig(),
    secret: 'material-answer-tests-secret-2026-long',
    storage: path.join(dir, 'storage'),
    aiProvider: 'manual',
    ocrEnabled: false,
  };
  app = await buildApp({ db, config });
  const t = await db.user.create({
    data: { name: '材料测试教师', role: 'ADMIN', teacher: { create: {} } },
  });
  teacher = await issueSession(db, config, t.id);
  for (const name of ['材料学生甲', '材料学生乙']) {
    const s = await db.user.create({
      data: { name, role: 'STUDENT', student: { create: { teacherId: t.id } } },
    });
    const session = { ...(await issueSession(db, config, s.id)), id: s.id };
    if (!student) student = session;
    else other = session;
  }
  question = await api(teacher, 'POST', '/teacher/questions', {
    title: '材料勾画与图文作答',
    type: '概括归纳',
    materials: raw,
    prompt: '概括主要做法',
    requirements: '清楚完整',
    wordLimit: 5,
    maxScore: 20,
    rubric: '准确',
    referenceAnswer: '参考答案',
    scoringPoints: [],
  });
  await api(teacher, 'POST', '/teacher/permissions', {
    studentIds: [student.id, other.id],
    questionIds: [question.id],
  });
});
after(async () => {
  await app?.close();
  await db?.$disconnect();
  if (dir) await rm(dir, { recursive: true, force: true });
});

test('材料保留原下划线、段落和 Unicode，重叠勾画只拆分文本，不执行 HTML', () => {
  assert.equal(plain, '社区听取居民意见，完善治理。\n公开落实情况，接受监督。😀\n');
  assert.deepEqual(materialText(raw).formatting, [{ start: 2, end: 8, type: 'underline' }]);
  const segments = materialSegments(plain, [
    ...materialText(raw).formatting,
    { start: 4, end: 10, type: 'highlight' },
  ]);
  assert.equal(segments.map((x) => x.text).join(''), plain);
  assert.ok(segments.some((x) => x.styles.includes('underline') && x.styles.includes('highlight')));
  assert.equal(
    materialText('&lt;img src=x onerror=alert(1)&gt; &amp;lt;').text,
    '<img src=x onerror=alert(1)> &lt;',
  );
  assert.deepEqual(
    materialText('<span style="text-decoration: underline">原文</span>').formatting,
    [{ start: 0, end: 2, type: 'underline' }],
  );
});

test('勾画按学生隔离、精确校验选区，独立版本不影响文字草稿，材料快照不被修改', async () => {
  draft = await api(student, 'POST', `/student/questions/${question.id}/start`, {});
  assert.equal(draft.answer_type, '');
  const url = `/student/attempts/${draft.id}/material-annotations`;
  await api(other, 'PUT', url, { version: 0, annotations: [mark] }, 404);
  await api(
    student,
    'PUT',
    url,
    { version: 0, annotations: [{ ...mark, selectedText: '错误文字' }] },
    400,
  );
  await api(student, 'PUT', url, { version: 0, annotations: [mark, mark] }, 400);
  await api(student, 'PUT', url, { version: 0, annotations: [{ ...mark, type: 'script' }] }, 400);
  await api(student, 'PUT', url, { version: 0, annotations: [mark] });
  await api(student, 'PUT', url, { version: 0, annotations: [] }, 409);
  const saved = await api(student, 'PUT', `/student/attempts/${draft.id}/draft`, {
    version: draft.version,
    text: '这份文字答案超过五字建议上限仍可完整保存。',
    answer_type: 'mixed',
  });
  draft.version = saved.version;
  const detail = await api(student, 'GET', `/student/questions/${question.id}`);
  assert.deepEqual(detail.attempts[0].student_annotations, [mark]);
  assert.equal(detail.attempts[0].annotationsVersion, 1);
  assert.equal(detail.attempts[0].answer_text, '这份文字答案超过五字建议上限仍可完整保存。');
  assert.equal(detail.attempts[0].question.materials, raw);
  const b = await api(other, 'POST', `/student/questions/${question.id}/start`, {});
  assert.deepEqual(b.student_annotations, []);
  assert.equal((await db.question.findUnique({ where: { id: question.id } })).materials, raw);
});

let first: any, second: any;
test('多张图片顺序持久保存、重复上传复用，拒绝越权和过期排序，删除可重选', async () => {
  first = await upload(student, draft.id, 1);
  second = await upload(student, draft.id, 2);
  const duplicate = await upload(student, draft.id, 1);
  assert.equal(duplicate.id, first.id);
  assert.equal(duplicate.version, second.version);
  const route = `/student/attempts/${draft.id}/files/order`;
  const ids = [second.id, first.id];
  await api(other, 'PUT', route, { version: second.version, ids }, 404);
  await api(student, 'PUT', route, { version: second.version, ids: [first.id] }, 400);
  await api(student, 'PUT', route, { version: second.version, ids: [first.id, first.id] }, 400);
  await api(student, 'PUT', route, { version: 0, ids }, 409);
  const moved = await api(student, 'PUT', route, { version: second.version, ids });
  draft.version = moved.version;
  const detail = await api(student, 'GET', `/student/questions/${question.id}`);
  assert.deepEqual(
    detail.attempts[0].answer_images.map((f: any) => f.id),
    ids,
  );
  assert.deepEqual(
    (await api(teacher, 'GET', `/teacher/submissions/${draft.id}`)).attachments.map(
      (f: any) => f.id,
    ),
    ids,
  );
  await api(other, 'GET', `/files/${first.id}/preview`, undefined, 404);
  const removed = await api(student, 'DELETE', `/student/files/${first.id}`);
  assert.equal(removed.version, moved.version + 1);
  first = await upload(student, draft.id, 1);
  draft.version = first.version;
  assert.ok(first.position > 0);
});

test('图文一起提交，服务端记录实际方式、冻结勾画和图片；教师分数和批注发布后可读', async () => {
  const saved = await api(student, 'PUT', `/student/attempts/${draft.id}/draft`, {
    version: draft.version,
    text: '超出建议字数的答案仍然可以提交，文字和图片同时保留。',
    answer_type: 'text',
  });
  await api(student, 'POST', `/student/attempts/${draft.id}/submit`, { version: saved.version });
  await api(
    student,
    'PUT',
    `/student/attempts/${draft.id}/material-annotations`,
    { version: 1, annotations: [] },
    409,
  );
  await api(
    student,
    'PUT',
    `/student/attempts/${draft.id}/files/order`,
    { version: saved.version + 1, ids: [second.id, first.id] },
    409,
  );
  await publish(draft.id, 12, first.id);
  const detail = await api(student, 'GET', `/student/questions/${question.id}`);
  assert.equal(detail.attempts[0].answer_type, 'mixed');
  assert.equal(detail.attempts[0].answer_images.length, 2);
  assert.deepEqual(detail.attempts[0].student_annotations, [mark]);
  assert.equal(detail.attempts[0].finalGrade.finalScore, 12);
  assert.equal(detail.attempts[0].finalGrade.pageAnnotations[0].fileId, first.id);
  assert.equal(detail.referenceUnlocked, true);
  assert.equal(
    (await api(student, 'GET', `/student/questions/${question.id}/reference`)).referenceAnswer,
    '参考答案',
  );
});

test('二三轮可分别文字和图片作答，三轮答案、勾画、图片、分数完整独立保存', async () => {
  for (const round of [2, 3]) {
    const d = await api(student, 'POST', `/student/questions/${question.id}/start`, {});
    assert.equal(d.roundNo, round);
    assert.equal(d.answer_type, '');
    assert.deepEqual(d.student_annotations, []);
    assert.deepEqual(d.attachments, []);
    const m = { ...mark, id: 'round-' + round, type: round === 2 ? 'strike' : 'circle' };
    await api(student, 'PUT', `/student/attempts/${d.id}/material-annotations`, {
      version: 0,
      annotations: [m],
    });
    let version = d.version;
    if (round === 2)
      version = (
        await api(student, 'PUT', `/student/attempts/${d.id}/draft`, {
          version,
          text: '第二轮文字答案',
          answer_type: 'text',
        })
      ).version;
    else version = (await upload(student, d.id, 3)).version;
    await api(student, 'POST', `/student/attempts/${d.id}/submit`, { version });
    await publish(d.id, 12 + round);
  }
  const detail = await api(student, 'GET', `/student/questions/${question.id}`);
  assert.equal(detail.completed, true);
  assert.deepEqual(
    detail.attempts.map((a: any) => a.answer_type),
    ['image', 'text', 'mixed'],
  );
  assert.deepEqual(
    detail.attempts.map((a: any) => a.student_annotations[0].type),
    ['circle', 'strike', 'highlight'],
  );
  assert.deepEqual(
    detail.scores.map((a: any) => a.score),
    [12, 14, 15],
  );
  assert.deepEqual(
    detail.attempts.map((a: any) => a.answer_images.length),
    [1, 0, 2],
  );
  await api(student, 'POST', `/student/questions/${question.id}/start`, {}, 409);
  assert.equal((await api(other, 'GET', `/student/questions/${question.id}`)).attempts.length, 1);
});
