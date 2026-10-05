import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
const root = path.resolve('miniprogram');
const app = JSON.parse(await readFile(path.join(root, 'app.json'), 'utf8'));
const known = new Set([
  'view',
  'text',
  'button',
  'input',
  'textarea',
  'block',
  'checkbox-group',
  'checkbox',
  'label',
  'canvas',
  'image',
  'scroll-view',
  'navigator',
]);
let count = 0;
for (const page of app.pages) {
  const source = await readFile(path.join(root, page + '.wxml'), 'utf8');
  await readFile(path.join(root, page + '.ts'), 'utf8');
  const tags = [...source.matchAll(/<\/?([a-zA-Z][\w-]*)\b/g)].map((m) => m[1]);
  for (const tag of tags) assert.ok(known.has(tag), '不支持的小程序标签 ' + tag + ' in ' + page);
  for (const route of [...source.matchAll(/url="([^"]+)"/g)])
    if (route[1].startsWith('/pages/'))
      assert.ok(app.pages.includes(route[1].split('?')[0].slice(1)));
  const controller = await readFile(path.join(root, page + '.ts'), 'utf8');
  for (const match of source.matchAll(/(?:bind|catch)(?:tap|input|change|submit)="(\w+)"/g))
    assert.ok(
      new RegExp('\\b' + match[1] + '\\s*\\(').test(controller),
      '缺少事件处理 ' + match[1] + ' in ' + page,
    );
  count++;
}
for (const tab of app.tabBar.list) assert.ok(app.pages.includes(tab.pagePath));
console.log(
  'PASS: ' +
    count +
    ' pages, tab routes, native component names and bound event handlers. This is a static check, not the official WeChat compiler.',
);
