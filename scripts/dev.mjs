import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
process.loadEnvFile(path.join(root, '.env'));
const children = [
  spawn(
    process.execPath,
    [path.join(root, 'backend/node_modules/tsx/dist/cli.mjs'), 'watch', 'src/server.ts'],
    { cwd: path.join(root, 'backend'), stdio: 'inherit', windowsHide: true },
  ),
  spawn(
    process.execPath,
    [
      path.join(root, 'teacher-admin/node_modules/next/dist/bin/next'),
      'dev',
      '--hostname',
      '127.0.0.1',
      '--port',
      '3000',
    ],
    { cwd: path.join(root, 'teacher-admin'), stdio: 'inherit', windowsHide: true },
  ),
];
let closing = false;
function stop(code = 0) {
  if (closing) return;
  closing = true;
  for (const child of children) child.kill();
  process.exitCode = code;
}
for (const child of children) child.on('exit', (code) => stop(code || 0));
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => stop());
