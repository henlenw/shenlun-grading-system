import { chromium, expect } from '@playwright/test';
import { PrismaClient } from '@prisma/client';
import { DatabaseSync } from 'node:sqlite';
import { mkdtemp, readFile, rm, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { processOneJob } from '../src/jobs.js';
import { samplePdf } from '../tests/fixtures.js';
const root = path.resolve('..');
const directory = await mkdtemp(path.join(process.cwd(), 'test-ui-'));
const dbfile = path.join(directory, 'ui.db');
const sqlite = new DatabaseSync(dbfile);
sqlite.exec(await readFile('prisma/migrations/202610040001_initial/migration.sql', 'utf8'));
sqlite.exec(
  await readFile(
    path.join(process.cwd(), 'prisma/migrations/202610040002_kaoba167/migration.sql'),
    'utf8',
  ),
);
  sqlite.exec(await readFile('prisma/migrations/202610050001_material_answers/migration.sql', 'utf8'));
sqlite.close();
const db = new PrismaClient({ datasourceUrl: 'file:' + dbfile.replaceAll('\\', '/') });
const config = {
  ...loadConfig(),
  bootstrapToken: 'ui-smoke-initialization-token-00000000',
  aiProvider: 'disabled',
  storage: path.join(directory, 'storage'),
};
const app = await buildApp({
  db,
  config,
  wechat: {
    async exchange(code) {
      return 'ui-smoke-wechat-fixture-' + code;
    },
  },
});
let browser: any, child: any;
const errors: string[] = [];
try {
  await app.listen({ host: '127.0.0.1', port: 4000 });
  child = spawn(
    process.execPath,
    [
      path.join(root, 'teacher-admin/node_modules/next/dist/bin/next'),
      'start',
      '--hostname',
      '127.0.0.1',
      '--port',
      '3000',
    ],
    {
      cwd: path.join(root, 'teacher-admin'),
      windowsHide: true,
      stdio: 'pipe',
      env: { ...process.env, NEXT_TELEMETRY_DISABLED: '1', NODE_ENV: 'production', PORT: '3000' },
    },
  );
  child.stdout.on('data', (d: Buffer) => process.stdout.write(d));
  child.stderr.on('data', (d: Buffer) => process.stderr.write(d));
  for (let i = 0; i < 60; i++) {
    try {
      if ((await fetch('http://localhost:3000/teacher/login')).ok) break;
    } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage({ viewport: { width: 1536, height: 1100 } });
  page.on('pageerror', (e: Error) => errors.push(e.message));
  await page.goto('http://localhost:3000/teacher/login');
  await page.getByLabel('姓名', { exact: true }).fill('测试老师');
  await page.getByLabel('初始化密钥', { exact: false }).fill(config.bootstrapToken);
  await page.getByLabel('账号 / 邮箱').fill('ui-admin');
  await page.getByLabel('密码（至少 10 位）').fill('Test-password-2026');
  await page.getByRole('button', { name: '创建并进入工作台' }).click();
  await expect(page.getByRole('heading', { name: '今天的教学工作' })).toBeVisible();
  await page.locator('.sidebar').getByRole('link', { name: '学生管理' }).click();
  await page.getByLabel('姓名', { exact: true }).fill('测试学生');
  await page.getByRole('button', { name: '创建并生成绑定码' }).click();
  const bindingCode = (await page.locator('.code').innerText()).trim();
  expect(bindingCode).toMatch(/^\d{6}$/);
  await page.getByRole('link', { name: '申论题库' }).click();
  await page.getByRole('button', { name: '+ 创建题目' }).click();
  await page.getByLabel('题目名称', { exact: true }).fill('基层治理与群众参与（验收测试）');
  await page
    .getByLabel('给定材料', { exact: true })
    .fill('某社区通过居民议事厅协商停车难题，公布方案，定期收集反馈。');
  await page
    .getByLabel('题目 / 问题', { exact: true })
    .fill('请根据材料分析群众参与对基层治理的作用。');
  await page.getByLabel('作答要求', { exact: true }).fill('观点明确，结合材料，语言规范。');
  await page.getByLabel('评分标准', { exact: true }).fill('要点完整、结构清晰、材料运用准确。');
  await page.getByLabel('满分', { exact: true }).fill('100');
  await page
    .getByLabel('参考答案', { exact: true })
    .fill('通过居民议事、公开方案和定期反馈促进基层共治。');
  await page.getByRole('button', { name: '添加得分点', exact: true }).click();
  await page.getByLabel('得分点 1', { exact: true }).fill('群众参与');
  await page.getByLabel('分值 1', { exact: true }).fill('60');
  await page.getByRole('button', { name: '添加得分点', exact: true }).click();
  await page.getByLabel('得分点 2', { exact: true }).fill('落实反馈');
  await page.getByLabel('分值 2', { exact: true }).fill('40');
  await page.getByRole('button', { name: '保存题目', exact: true }).click();
  await expect(page.getByText('基层治理与群众参与（验收测试）', { exact: true })).toBeVisible();
  await page.getByRole('link', { name: '布置作业' }).click();
  await page.getByLabel('作业名称', { exact: true }).fill('第一周 · 基层治理专项训练');
  await page.getByLabel('截止时间', { exact: true }).fill('2026-12-31T18:00');
  await page.getByLabel('选择题目').selectOption({ index: 1 });
  await page.getByRole('checkbox', { name: '测试学生' }).check();
  await page.getByRole('button', { name: '发布作业', exact: true }).click();
  await expect(
    page.getByRole('cell', { name: '第一周 · 基层治理专项训练', exact: true }),
  ).toBeVisible();
  const request = async (url: string, method = 'GET', data?: any, token?: string) => {
    const res = await fetch('http://127.0.0.1:4000/api' + url, {
      method,
      headers: {
        'content-type': 'application/json',
        ...(token ? { Authorization: 'Bearer ' + token } : {}),
      },
      body: data === undefined ? undefined : JSON.stringify(data),
    });
    const value = (await res.json()) as any;
    if (!res.ok) throw Error(JSON.stringify(value));
    return value;
  };
  const ticket = await request('/auth/wechat', 'POST', { code: 'ui-fixture' });
  const student = await request('/auth/wechat/bind', 'POST', {
    bindToken: ticket.bindToken,
    bindingCode,
  });
  const assignment = (await request('/student/assignments', 'GET', undefined, student.token))[0];
  const draft = await request(
    '/student/assignments/' + assignment.id + '/draft',
    'POST',
    {},
    student.token,
  );
  const essay =
    '群众参与是提升基层治理效能的重要途径。\n一方面，居民议事厅让群众表达实际需求，帮助社区精准发现停车难等问题。另一方面，公开方案和定期反馈使居民能够参与监督，形成共同治理的良好氛围。\n因此，应完善议事规则、拓宽参与渠道，并将协商结果落到实处。';
  const saved = await request(
    '/student/attempts/' + draft.id + '/draft',
    'PUT',
    { text: essay, version: draft.version },
    student.token,
  );
  const form = new FormData();
  form.append(
    'file',
    new Blob([new Uint8Array(samplePdf(2))], { type: 'application/pdf' }),
    'essay.pdf',
  );
  const uploaded = await fetch(
    'http://127.0.0.1:4000/api/student/attempts/' + draft.id + '/files',
    { method: 'POST', headers: { Authorization: 'Bearer ' + student.token }, body: form },
  );
  expect(uploaded.ok).toBeTruthy();
  const attached = (await uploaded.json()) as any;
  saved.version = attached.version;
  await request(
    '/student/attempts/' + draft.id + '/submit',
    'POST',
    { version: saved.version },
    student.token,
  );
  await processOneJob(db, config);
  const cookie = (await page.context().cookies('http://localhost:3000/api/auth/me'))
    .map((c: any) => c.name + '=' + c.value)
    .join('; ');
  const me = (await app.inject({ method: 'GET', url: '/api/auth/me', headers: { cookie } })).json();
  async function asTeacher(url: string, body: any, method: 'POST' | 'PUT' = 'POST') {
    const r = await app.inject({
      method,
      url: '/api' + url,
      payload: body,
      headers: { cookie, origin: config.appUrl, 'x-csrf-token': me.csrfToken },
    });
    expect(r.statusCode, r.body).toBe(200);
    return r.json();
  }
  const secondProfile = await asTeacher('/teacher/students', { name: '测试学生乙' });
  const secondTicket = await request('/auth/wechat', 'POST', { code: 'ui-fixture-b' });
  const second = await request('/auth/wechat/bind', 'POST', {
    bindToken: secondTicket.bindToken,
    bindingCode: secondProfile.bindingCode,
  });
  await asTeacher('/teacher/permissions', {
    studentIds: [second.user.id],
    questionIds: [assignment.questionId],
  });
  const secondDraft = await request(
    '/student/questions/' + assignment.questionId + '/start',
    'POST',
    {},
    second.token,
  );
  const secondSaved = await request(
    '/student/attempts/' + secondDraft.id + '/draft',
    'PUT',
    { version: secondDraft.version, text: '群众参与治理，强化反馈与执行。' },
    second.token,
  );
  await request(
    '/student/attempts/' + secondDraft.id + '/submit',
    'POST',
    { version: secondSaved.version },
    second.token,
  );
  await processOneJob(db, config);
  await page.locator('.sidebar').getByRole('link', { name: '今日未批改' }).click();
  await page.getByRole('link', { name: '批改这道题 →' }).click();
  await expect(page.getByRole('heading', { name: '教师最终反馈' })).toBeVisible();
  const original = page.getByAltText('学生原稿，第 1 页');
  await expect(original).toBeVisible();
  await expect
    .poll(
      () => original.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0),
      { timeout: 15000 },
    )
    .toBeTruthy();
  await page.getByRole('button', { name: '矩形', exact: true }).click();
  await page.locator('.original-scroll').scrollIntoViewIfNeeded();
  const svg = page.locator('.original-sheet svg');
  const box = await svg.boundingBox(),
    scroll = await page.locator('.original-scroll').boundingBox();
  const startX = box!.x + box!.width * 0.15,
    startY = Math.max(scroll!.y, box!.y) + 90;
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX + 200, startY + 65, { steps: 8 });
  await page.mouse.up();
  await expect(
    page.getByText('原稿保持不变。共 1 条页面批注，保存并发布后学生才可查看。'),
  ).toBeVisible();
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  await expect(
    page.getByText('原稿保持不变。共 0 条页面批注，保存并发布后学生才可查看。'),
  ).toBeVisible();
  await page.getByRole('button', { name: '重做', exact: true }).click();
  await page.getByLabel('所选原稿批注文字').fill('结合材料，补充协商执行细节。');
  await page.locator('.original-scroll').evaluate((el: HTMLElement) => {
    el.scrollTop = 0;
  });
  await page
    .locator('.original-workspace')
    .evaluate((el: HTMLElement) =>
      window.scrollTo(0, window.scrollY + el.getBoundingClientRect().top - 140),
    );
  await page.screenshot({
    path: path.join(root, 'test-results', 'original-annotations.png'),
    fullPage: false,
  });
  page.once('dialog', (dialog) => dialog.dismiss());
  await page.getByRole('button', { name: '下一份', exact: true }).click();
  await expect(page.getByLabel('所选原稿批注文字')).toHaveValue('结合材料，补充协商执行细节。');
  await page.locator('.essay').evaluate((el: HTMLElement) => {
    const node = el.firstChild!;
    const range = document.createRange();
    range.setStart(node.firstChild || node, 0);
    range.setEnd(node.firstChild || node, 4);
    const s = window.getSelection()!;
    s.removeAllRanges();
    s.addRange(range);
    el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
  });
  await page.getByLabel('人工批注', { exact: true }).fill('开门见山，中心论点明确。');
  await page.getByRole('button', { name: '添加批注', exact: true }).click();
  await page.getByLabel('最终分数', { exact: false }).fill('82');
  await page
    .getByLabel('教师总评 *', { exact: true })
    .fill('观点明确，能够联系社区议事的具体材料。继续补充协商结果的执行机制。');
  await page.getByLabel('得分点', { exact: true }).fill('抓住参与、监督两个作用，结构清晰。');
  await page
    .getByLabel('下一次重点', { exact: true })
    .fill('让对策更具体，说明执行主体和反馈方式。');
  await page.getByRole('button', { name: '保存批改', exact: true }).click();
  await expect(page.getByText('批改已保存，尚未对学生公开', { exact: true })).toBeVisible();
  const before = await request(
    '/student/assignments/' + assignment.id,
    'GET',
    undefined,
    student.token,
  );
  expect(before.attempts[0].finalGrade).toBeNull();
  await mkdir(path.join(root, 'test-results'), { recursive: true });
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: path.join(root, 'test-results', 'teacher-review.png'),
    fullPage: false,
  });
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: '发布并下一份', exact: true }).click();
  await expect(page.getByText(/测试学生乙 · 第 1 \/ 3 次作答/)).toBeVisible();
  await expect(page.getByLabel('最终分数', { exact: false })).toHaveValue('0');
  await page.getByLabel('最终分数', { exact: false }).fill('78');
  await page.getByLabel('教师总评 *', { exact: true }).fill('观点清楚，继续丰富细节。');
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: '发布并下一份', exact: true }).click();
  await expect(page.getByText('本题今日待批改已完成。', { exact: true })).toBeVisible();
  const final = await request(
    '/student/assignments/' + assignment.id,
    'GET',
    undefined,
    student.token,
  );
  expect(final.attempts[0].finalGrade.finalScore).toBe(82);
  expect(final.attempts[0].finalGrade.annotations).toHaveLength(1);
  expect(final.attempts[0].finalGrade.pageAnnotations).toHaveLength(1);
  expect(final.referenceUnlocked).toBeTruthy();
  await page.locator('.sidebar').getByRole('link', { name: '课程权限', exact: true }).click();
  await page.getByLabel('课程名称', { exact: true }).fill('系统录播权益');
  await page.getByRole('button', { name: '添加课程', exact: true }).click();
  await expect(page.getByRole('heading', { name: '系统录播权益', exact: true })).toBeVisible();
  await page.locator('.sidebar').getByRole('link', { name: '试卷兑换码', exact: true }).click();
  await page.getByText('创建试卷包（可组合题目与课程）', { exact: true }).click();
  await page.getByLabel('试卷包名称', { exact: true }).fill('专项训练与录播');
  await page
    .getByRole('checkbox', { name: '包内题目：基层治理与群众参与（验收测试）', exact: true })
    .check();
  await page.getByRole('checkbox', { name: '包内课程：系统录播权益', exact: true }).check();
  await page.getByRole('button', { name: '保存试卷包', exact: true }).click();
  await expect(page.getByText('试卷包已创建', { exact: true })).toBeVisible();
  await page.getByLabel('选择试卷包', { exact: true }).selectOption({ index: 1 });
  await page.getByLabel('有效期至', { exact: true }).fill('2099-12-31T18:00');
  await page.getByRole('button', { name: '生成兑换码', exact: true }).click();
  await expect(page.getByLabel('新兑换码')).toBeVisible();
  const redeemCode = await page.getByLabel('新兑换码').inputValue();
  const redeem = await request('/student/redeem', 'POST', { code: redeemCode }, student.token);
  expect(redeem.ok).toBeTruthy();
  await page.screenshot({
    path: path.join(root, 'test-results', 'redemption-codes.png'),
    fullPage: true,
  });
  await page.getByRole('link', { name: '工作概览' }).click();
  await expect(page.getByRole('heading', { name: '今天的教学工作' })).toBeVisible();
  await page.screenshot({
    path: path.join(root, 'test-results', 'teacher-dashboard.png'),
    fullPage: true,
  });
  await request(
    '/student/account',
    'PUT',
    { username: 'mobile-student', password: 'Student-password-2026' },
    student.token,
  );
  const mobileContext = await browser.newContext({
    viewport: { width: 393, height: 852 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
  });
  const mobile = await mobileContext.newPage();
  mobile.on('pageerror', (e: Error) => errors.push(e.message));
  await mobile.goto('http://localhost:3000/');
  await expect(mobile.getByRole('heading', { level: 1 })).toContainText('每一次练习');
  expect(
    await mobile.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
  ).toBeTruthy();
  await mobile.screenshot({
    path: path.join(root, 'test-results', 'mobile-home.png'),
    fullPage: true,
  });
  await mobile.getByRole('link', { name: '登录我的账号' }).click();
  await mobile.getByLabel('学生账号', { exact: true }).fill('mobile-student');
  await mobile.getByLabel('密码', { exact: true }).fill('Student-password-2026');
  await mobile.getByRole('checkbox').check();
  await mobile.getByRole('button', { name: '登录', exact: true }).click();
  await expect(mobile.getByRole('heading', { name: '我的训练', exact: true })).toBeVisible();
  await mobile.screenshot({
    path: path.join(root, 'test-results', 'mobile-training.png'),
    fullPage: true,
  });
  await mobile.locator('.training-card').first().click();
  await expect(mobile.getByText('老师最终评分', { exact: true })).toBeVisible();
  await expect(mobile.locator('.final-score b')).toContainText('82');
  await mobile.getByRole('button', { name: '查看已解锁参考' }).click();
  await expect(
    mobile.getByText('通过居民议事、公开方案和定期反馈促进基层共治。', { exact: true }),
  ).toBeVisible();
  const studentOriginal = mobile.getByAltText('学生原稿，第 1 页');
  await expect(studentOriginal).toBeVisible();
  await expect
    .poll(() =>
      studentOriginal.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0),
    )
    .toBeTruthy();
  await mobile.getByRole('button', { name: '下一页', exact: true }).click();
  await expect(mobile.getByAltText('学生原稿，第 2 页')).toBeVisible();
  expect(
    await mobile.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
  ).toBeTruthy();
  await mobile.screenshot({
    path: path.join(root, 'test-results', 'mobile-feedback.png'),
    fullPage: true,
  });
  await mobile.getByRole('button', { name: '开始第 2 轮训练', exact: true }).click();
  await mobile
    .getByLabel('我的答案', { exact: true })
    .fill('网页第二轮：建立居民议事机制，公开执行主体和反馈进度。');
  await expect(mobile.getByRole('status')).toHaveText('已自动保存');
  const round2 = await request(
    '/student/questions/' + assignment.questionId,
    'GET',
    undefined,
    student.token,
  );
  expect(round2.attempts[0].text).toContain('网页第二轮');
  // Another device changes the same draft; the browser must preserve, then recover its own unsynced text.
  const concurrent = round2.attempts[0];
  await request(
    '/student/attempts/' + concurrent.id + '/draft',
    'PUT',
    { version: concurrent.version, text: '小程序已保存的新版本' },
    student.token,
  );
  await mobile
    .getByLabel('我的答案', { exact: true })
    .fill('网页保留的未同步答案：明确执行主体与反馈机制。');
  await expect(mobile.locator('.student-error')).toContainText('其他设备更新');
  mobile.once('dialog', (d:any) => d.accept());
  await mobile.getByRole('button', { name: '重新载入云端版本' }).click();
  await mobile.getByRole('button', { name: '继续编辑草稿' }).click();
  await expect(mobile.getByRole('button', { name: '恢复本机草稿' })).toBeVisible();
  const localKey = 'kaoba-draft:' + student.user.id + ':' + concurrent.id;
  expect(await mobile.evaluate((key: string) => localStorage.getItem(key), localKey)).toContain(
    '网页保留',
  );
  await mobile.getByRole('button', { name: '恢复本机草稿' }).click();
  await expect(mobile.getByRole('status')).toHaveText('已自动保存');
  expect(
    (await request('/student/questions/' + assignment.questionId, 'GET', undefined, student.token))
      .attempts[0].text,
  ).toContain('网页保留');
  await mobile
    .getByLabel('上传作答附件')
    .setInputFiles({ name: 'second-round.pdf', mimeType: 'application/pdf', buffer: samplePdf(2) });
  await expect(mobile.getByText('second-round.pdf ↓', { exact: true })).toBeVisible();
  await mobile.screenshot({
    path: path.join(root, 'test-results', 'mobile-draft.png'),
    fullPage: true,
  });
  mobile.once('dialog', (d: any) => d.accept());
  await mobile.getByRole('button', { name: '提交本轮作答', exact: true }).click();
  await expect(mobile.getByText('提交成功，等待老师批改', { exact: true })).toBeVisible();
  const rd = (
    await request('/student/questions/' + assignment.questionId, 'GET', undefined, student.token)
  ).attempts[0];
  expect(rd.roundNo).toBe(2);
  expect(rd.attachments).toHaveLength(1);
  await asTeacher('/teacher/submissions/' + rd.id + '/manual', {});
  const mark = {
    id: 'cross-entry-check',
    fileId: rd.attachments[0].id,
    page: 1,
    type: 'check',
    x: 0.15,
    y: 0.15,
    width: 0.07,
    height: 0.07,
    color: '#c53932',
    content: '第二轮要点清楚',
  };
  const savedReview = await asTeacher(
    '/teacher/submissions/' + rd.id + '/review',
    {
      version: 0,
      finalScore: 88,
      summary: '第二轮进步明确，第三轮继续巩固。',
      annotations: [],
      pageAnnotations: [mark],
    },
    'PUT',
  );
  await asTeacher('/teacher/submissions/' + rd.id + '/publish', {
    reviewVersion: savedReview.version,
  });
  await mobile.getByRole('button', { name: '刷新状态' }).click();
  await expect(mobile.getByText('第二轮进步明确，第三轮继续巩固。', { exact: true })).toBeVisible();
  expect(
    (await request('/student/questions/' + assignment.questionId, 'GET', undefined, student.token))
      .attempts[0].finalGrade.pageAnnotations[0].type,
  ).toBe('check');
  const third = await request(
    '/student/questions/' + assignment.questionId + '/start',
    'POST',
    {},
    student.token,
  );
  const thirdSaved = await request(
    '/student/attempts/' + third.id + '/draft',
    'PUT',
    { version: third.version, text: '小程序第三轮：完善协商、执行、公开和反馈闭环。' },
    student.token,
  );
  await request(
    '/student/attempts/' + third.id + '/submit',
    'POST',
    { version: thirdSaved.version },
    student.token,
  );
  await asTeacher('/teacher/submissions/' + third.id + '/manual', {});
  const thirdReview = await asTeacher(
    '/teacher/submissions/' + third.id + '/review',
    { version: 0, finalScore: 94, summary: '三轮训练完成。', annotations: [], pageAnnotations: [] },
    'PUT',
  );
  await asTeacher('/teacher/submissions/' + third.id + '/publish', {
    reviewVersion: thirdReview.version,
  });
  await mobile.reload();
  await expect(
    mobile.getByText('本题三轮训练已完成。每一轮作答和老师反馈都已保留，随时回来复盘。', {
      exact: true,
    }),
  ).toBeVisible();
  await expect(mobile.locator('.score-journey')).toContainText('82 分 → 88 分 → 94 分');
  await expect(mobile.getByRole('button', { name: /开始第 4 轮/ })).toHaveCount(0);
  const fourth = await fetch(
    'http://127.0.0.1:4000/api/student/questions/' + assignment.questionId + '/start',
    {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + student.token, 'content-type': 'application/json' },
      body: '{}',
    },
  );
  expect(fourth.status).toBe(409);
  await mobile.getByRole('link', { name: '我的', exact: true }).click();
  await expect(mobile.getByRole('heading', { name: '网页与微信共用账号' })).toBeVisible();
  await expect(mobile.getByText('系统录播权益', { exact: true })).toBeVisible();
  expect(
    await mobile.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
  ).toBeTruthy();
  await mobile.screenshot({
    path: path.join(root, 'test-results', 'mobile-profile.png'),
    fullPage: true,
  });
  await mobile.setViewportSize({ width: 1366, height: 900 });
  await mobile.goto('http://localhost:3000/student');
  await expect(mobile.locator('.training-card')).toContainText('3/3 轮已完成');
  expect(
    await mobile.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
  ).toBeTruthy();
  await mobile.screenshot({
    path: path.join(root, 'test-results', 'student-desktop.png'),
    fullPage: true,
  });
  await page.goto('http://localhost:3000/');
  await page.screenshot({
    path: path.join(root, 'test-results', 'home-desktop.png'),
    fullPage: true,
  });
  await mobileContext.close();
  console.log(
    'PASS: Mobile home/login → shared WeChat identity → published PDF annotations → reference → web round 2 autosave/upload/submit → native API round 3 → immutable history and no fourth attempt → profile; desktop/mobile overflow checks passed.',
  );

  expect(errors).toEqual([]);
  console.log(
    'PASS: Browser initialization → weighted question → assignment → same-question batch → PDF annotation undo/redo → teacher review → publish and next → reference unlock → course package → code redemption; student final snapshots verified; no browser runtime errors.',
  );
} finally {
  await browser?.close();
  child?.kill();
  await app.close();
  await db.$disconnect();
  await rm(directory, { recursive: true, force: true });
}
