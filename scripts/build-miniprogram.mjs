import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url),
  ts = require('../miniprogram/node_modules/typescript');
const out = path.resolve('release/miniprogram'),
  src = path.resolve('miniprogram');
const base = process.env.PUBLIC_API_URL,
  appid = process.env.WECHAT_APPID;
if (base && !/^https:\/\/[^/]+\/api$/.test(base))
  throw Error('PUBLIC_API_URL must be https://your-real-host/api');
if (appid && !/^wx[0-9a-f]{16}$/i.test(appid)) throw Error('Invalid WeChat AppID');
await fs.mkdir(out, { recursive: true });
async function walk(dir) {
  for (const e of await fs.readdir(dir, { withFileTypes: true })) {
    if (
      ['node_modules', 'package.json', 'tsconfig.json', 'project.private.config.json'].includes(
        e.name,
      )
    )
      continue;
    const p = path.join(dir, e.name),
      rel = path.relative(src, p);
    if (e.isDirectory()) {
      await fs.mkdir(path.join(out, rel), { recursive: true });
      await walk(p);
      continue;
    }
    if (e.name.endsWith('.ts')) {
      let s = await fs.readFile(p, 'utf8');
      if (rel === 'config.ts' && base)
        s = 'export const API_BASE_URL = ' + JSON.stringify(base) + ';';
      const result = ts.transpileModule(s, {
        compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS },
      });
      await fs.writeFile(path.join(out, rel.replace(/\.ts$/, '.js')), result.outputText);
    } else if (e.name === 'project.config.json') {
      const cfg = JSON.parse(await fs.readFile(p, 'utf8'));
      cfg.appid = appid || cfg.appid;
      cfg.setting.useCompilerPlugins = [];
      cfg.miniprogramRoot = './';
      await fs.writeFile(path.join(out, rel), JSON.stringify(cfg, null, 2));
    } else await fs.copyFile(p, path.join(out, rel));
  }
}
await walk(src);
await fs.copyFile('README-WECHAT.md', path.join(out, 'README-WECHAT.md'));
console.log('Native JavaScript mini program: ' + out);
console.log(
  base
    ? 'Public HTTPS API URL applied.'
    : 'Public API URL pending; local development URL retained.',
);
console.log(
  appid
    ? 'WeChat AppID applied.'
    : 'Real WeChat AppID, domain registration and official review are still required.',
);
