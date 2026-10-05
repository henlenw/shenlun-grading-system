import fs from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url),
  archive = require('../backend/node_modules/archiver');
const root = process.cwd(),
  release = path.resolve(root, 'release'),
  cloud = path.join(release, 'cloud');
// This directory only contains generated staging files. Verify before replacing it.
if (path.dirname(cloud) !== release || !release.startsWith(root + path.sep))
  throw Error('Unsafe release path');
const old = await fs.lstat(cloud).catch((e) => {
  if (e.code !== 'ENOENT') throw e;
});
if (old?.isSymbolicLink()) throw Error('Release staging must not be a symlink');
if (old) await fs.rm(cloud, { recursive: true, force: true });
await fs.mkdir(cloud, { recursive: true });
const excluded = new Set([
  'node_modules',
  '.next',
  'dist',
  'generated',
  '.git',
  '.secrets',
  'storage',
  'backups',
  'release',
  'test-results',
  'project.private.config.json',
  'build-miniprogram.mjs',
  'check-miniprogram.mjs',
]);
const skip = (name) =>
  excluded.has(name) ||
  /^test-(ui|portal|kaoba|work|extract|mobile|material|migration)-/.test(name) ||
  /\.db(?:-|$)|\.tsbuildinfo$|\.log$/.test(name) ||
  (name.startsWith('.env') && name !== '.env.example') ||
  name === 'cloud.env';
async function copy(source, dest) {
  await fs.mkdir(dest, { recursive: true });
  for (const e of await fs.readdir(source, { withFileTypes: true })) {
    if (skip(e.name) || e.isSymbolicLink()) continue;
    const s = path.join(source, e.name),
      d = path.join(dest, e.name);
    if (e.isDirectory()) await copy(s, d);
    else if (e.isFile()) await fs.copyFile(s, d);
  }
}
for (const d of [
  'backend',
  'teacher-admin',
  'prompts',
  'ocr',
  'deploy',
  'scripts',
  'assets',
  'docs',
])
  await copy(path.join(root, d), path.join(cloud, d));
for (const f of [
  'package.json',
  'pnpm-lock.yaml',
  'pnpm-workspace.yaml',
  '.env.example',
  '.dockerignore',
  '.prettierrc.json',
  '.prettierignore',
  'README.md',
  'DEPLOY.md',
  'DELIVERY.md',
])
  await fs.copyFile(f, path.join(cloud, f));
await fs.copyFile('deploy/Dockerfile.cloud', path.join(cloud, 'Dockerfile'));
async function zip(output, build) {
  const out = createWriteStream(output),
    a = archive('zip', { zlib: { level: 9 } });
  const done = new Promise((resolve, reject) => {
    out.on('close', resolve);
    out.on('error', reject);
    a.on('error', reject);
  });
  a.pipe(out);
  build(a);
  await a.finalize();
  await done;
}
await zip(path.join(release, 'kaoba167-cloud-source.zip'), (a) => a.directory(cloud, false));
await zip(path.join(release, 'kaoba167-delivery.zip'), (a) => {
  a.file(path.join(release, 'kaoba167-cloud-source.zip'), { name: 'kaoba167-cloud-source.zip' });
  for (const file of ['DELIVERY.md', 'DEPLOY.md']) a.file(file, { name: file });
  a.file('docs/MATERIAL-ANSWERS.md', { name: 'MATERIAL-ANSWERS.md' });
  a.directory('assets/brand', 'brand');
});
const manifest = {
  createdAt: new Date(),
  files: [],
};
for (const name of ['kaoba167-cloud-source.zip', 'kaoba167-delivery.zip']) {
  const bytes = await fs.readFile(path.join(release, name));
  manifest.files.push({
    name,
    size: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex'),
  });
  console.log(name + ' ' + (bytes.length / 1024 / 1024).toFixed(2) + ' MiB');
}
await fs.writeFile(path.join(release, 'checksums.json'), JSON.stringify(manifest, null, 2));
