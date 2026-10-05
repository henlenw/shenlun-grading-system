import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
if (!existsSync(path.join(root, '.env'))) {
  let env = await readFile(path.join(root, '.env.example'), 'utf8');
  env = env.replaceAll('CHANGE_ME_WITH_32_RANDOM_BYTES', () => randomBytes(32).toString('hex'));
  await writeFile(path.join(root, '.env'), env, { mode: 0o600 });
  console.log('已生成本机 .env（包含随机会话密钥、初始化密钥），请勿提交或分享。');
} else console.log('保留已有 .env。');
await mkdir(path.join(root, 'storage', 'submissions'), { recursive: true });
console.log('下一步：pnpm db:generate && pnpm db:migrate && pnpm dev');
