import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { loadConfig } from './config.js';
import { OllamaProvider } from './ai.js';
import { extractAttachment } from './jobs.js';
const c = loadConfig(),
  base = (process.env.WORKER_API_URL || '').replace(/\/$/, ''),
  token = process.env.WORKER_TOKEN || '';
if (!/^https:\/\//.test(base) && !/^http:\/\/(localhost|127\.0\.0\.1):\d+\/api$/.test(base))
  throw Error('WORKER_API_URL requires your public HTTPS /api URL');
if (token.length < 32) throw Error('WORKER_TOKEN must match the server REMOTE_WORKER_TOKEN');
let stopping = false;
process.on('SIGINT', () => {
  stopping = true;
});
process.on('SIGTERM', () => {
  stopping = true;
});
async function call(route: string, body: unknown) {
  const res = await fetch(base + route, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) throw Error('工作服务返回 ' + res.status);
  return (await res.json()) as any;
}
console.log('本地工作进程已启动：主动连接云端，不开放本机端口。');
while (!stopping) {
  let job: any,
    folder = '';
  try {
    job = (await call('/worker/claim', {})).job;
    if (job) {
      folder = await mkdtemp(path.join(tmpdir(), 'kaoba-local-worker-'));
      await mkdir(path.join(folder, 'submissions'));
      const local = { ...c, storage: folder, storageProvider: 'local', aiProvider: 'ollama' };
      let text = job.text;
      if (!text.trim()) {
        const texts = [];
        for (const f of job.attachments) {
          if (!/^[0-9a-f-]{36}\.(pdf|docx|txt|jpg|jpeg|png)$/.test(f.filePath))
            throw Error('原稿路径不合法');
          const response = await fetch(base + '/worker/' + job.id + '/files/' + f.id, {
            headers: { Authorization: 'Bearer ' + token, 'X-Job-Lease': job.leaseToken },
            signal: AbortSignal.timeout(60000),
          });
          if (!response.ok) throw Error('原稿下载失败');
          const bytes = Buffer.from(await response.arrayBuffer());
          if (bytes.length > 10 * 1024 * 1024) throw Error('原稿过大');
          await writeFile(path.join(folder, 'submissions', f.filePath), bytes);
          texts.push(await extractAttachment(f, local));
        }
        text = texts.join('\n\n').slice(0, 30000);
      }
      const { result, raw } = await new OllamaProvider(local).gradeEssay({
        text,
        question: job.question,
      });
      await call('/worker/' + job.id + '/complete', {
        leaseToken: job.leaseToken,
        text,
        result,
        raw: raw.slice(0, 100000),
        model: c.ollamaModel,
      });
      console.log('一份作答已完成 AI 辅助，等待老师复核。');
    }
  } catch {
    console.error('本地处理暂未完成；云端仍可人工批改。');
    if (job)
      await call('/worker/' + job.id + '/fail', { leaseToken: job.leaseToken }).catch(() => {});
  } finally {
    if (folder) await rm(folder, { recursive: true, force: true });
  }
  if (!stopping) await new Promise((r) => setTimeout(r, 5000));
}
