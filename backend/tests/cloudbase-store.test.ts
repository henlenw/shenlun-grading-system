import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cloudbaseObjectStore } from '../src/cloudbase-store.js';

const key = '00000000-0000-4000-8000-000000000001.txt';
const validate = (value: string) => {
  if (value !== key) throw Error('invalid key');
};
test('CloudBase 原稿仅访问固定 HTTPS 环境，拒绝覆盖和重定向，存储错误不暴露密钥', async () => {
  const calls: { url: string; init: RequestInit }[] = [];
  let status = 200;
  const request = (async (url: string | URL | Request, init: RequestInit) => {
    calls.push({ url: String(url), init });
    return new Response('original text', { status });
  }) as typeof fetch;
  const store = cloudbaseObjectStore(
    'kaoba-test-env',
    'submissions',
    'private-test-key',
    validate,
    request,
  );
  await store.put(key, Buffer.from('original text'), 'text/plain');
  assert.equal(
    calls[0].url,
    `https://kaoba-test-env.api.tcloudbasegateway.com/v1/storages/object/submissions/${key}`,
  );
  assert.equal(calls[0].init.redirect, 'error');
  assert.equal((calls[0].init.headers as Record<string, string>)['x-upsert'], 'false');
  assert.equal(
    (calls[0].init.headers as Record<string, string>).Authorization,
    'Bearer private-test-key',
  );
  assert.equal((await store.read(key)).toString(), 'original text');
  status = 404;
  assert.equal(await store.exists(key), false);
  status = 403;
  await assert.rejects(
    store.exists(key),
    (e) =>
      e instanceof Error && e.message.includes('403') && !e.message.includes('private-test-key'),
  );
  const before = calls.length;
  await assert.rejects(store.read('../secret'));
  await assert.rejects(store.put(key, Buffer.alloc(10 * 1024 * 1024 + 1), 'text/plain'));
  assert.equal(calls.length, before);
  status = 200;
  await store.remove(key);
  assert.equal(calls.at(-1)?.init.method, 'DELETE');
  assert.deepEqual(JSON.parse(calls.at(-1)?.init.body as string), { prefixes: [key] });
});
test('CloudBase 存储拒绝任意域名和遗漏凭证', () => {
  assert.throws(() => cloudbaseObjectStore('evil.example/', 'submissions', 'secret', validate));
  assert.throws(() => cloudbaseObjectStore('kaoba-test-env', '../other', 'secret', validate));
  assert.throws(() => cloudbaseObjectStore('kaoba-test-env', 'submissions', '', validate));
});
