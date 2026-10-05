import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { startWorker } from '../src/jobs.js';
import { requireLocalInference } from '../src/local-inference.js';
import { resourceState } from '../src/resources.js';
test('人工模式不访问任务数据库、不启动轮询', async () => {
  const db = new Proxy(
    {},
    {
      get() {
        throw Error('manual mode must not touch database');
      },
    },
  ) as any;
  for (const aiProvider of ['manual', 'disabled', 'remote-worker'])
    await startWorker(db, { ...loadConfig(), aiProvider })();
});
test('健康检查合并数据库探测，刷接口触发限流且不继续查数据库', async () => {
  let health = 0,
    sessions = 0;
  const db = {
    $queryRaw: async () => {
      health++;
      return [];
    },
    session: {
      findUnique: async () => {
        sessions++;
        return null;
      },
    },
  } as any;
  const app = await buildApp({ db, config: loadConfig() });
  try {
    await Promise.all(Array.from({ length: 12 }, () => app.inject('/api/health')));
    assert.equal(health, 1);
    for (let n = 0; n < 120; n++)
      assert.equal(
        (
          await app.inject({
            url: '/api/auth/me',
            headers: { authorization: 'Bearer budget-test' },
          })
        ).statusCode,
        401,
      );
    const blocked = await app.inject({
      url: '/api/auth/me',
      headers: { authorization: 'Bearer budget-test' },
    });
    assert.equal(blocked.statusCode, 429);
    assert.equal(sessions, 120);
    assert.ok(blocked.headers['retry-after']);
  } finally {
    await app.close();
  }
});
test('拒绝云端收费推理地址，允许本机及私网服务', () => {
  for (const endpoint of [
    'http://localhost:11434',
    'http://127.0.0.1:8001',
    'http://ocr:8001',
    'http://192.168.1.2:11434',
  ])
    assert.doesNotThrow(() => requireLocalInference(endpoint));
  for (const endpoint of [
    'https://api.openai.com',
    'https://api.deepseek.com',
    'https://ollama.com',
    'http://user:pass@localhost',
    'http://192.168.999.1',
  ])
    assert.throws(() => requireLocalInference(endpoint));
});
test('80% 额度警示和过期记录不伪装成实时用量', () => {
  const now = Date.now(),
    base = {
      used: 2400,
      quota: 3000,
      checkedAt: new Date(now).toISOString(),
      periodEnd: new Date(now + 86400000).toISOString(),
      source: 'cloudbase-cli',
    };
  assert.equal(resourceState(base, now).warning, '当前资源即将达到免费额度，请处理。');
  assert.equal(resourceState({ ...base, used: 2399 }, now).warning, '');
  assert.equal(resourceState(base, now + 2 * 86400000).stale, true);
  assert.equal(resourceState(null, now).snapshot, null);
});
