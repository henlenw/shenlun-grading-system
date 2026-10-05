import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import archiver from 'archiver';
import { OllamaProvider } from '../src/ai.js';
import { loadConfig } from '../src/config.js';
import { WechatApi } from '../src/auth.js';
import { DraftSync } from '../../miniprogram/utils/draft-sync.js';
import { validateUpload } from '../src/files.js';
const exec = promisify(execFile);
test('Ollama HTTP 协议与 schema 验证（测试 HTTP 服务，不代表模型质量验证）', async () => {
  const result = {
    estimatedScore: 12,
    confidence: 0.5,
    summary: '测试协议',
    strengths: [],
    weaknesses: [],
    pointsCovered: [],
    pointsMissing: [],
    structureAnalysis: '',
    languageAnalysis: '',
    annotations: [],
    suggestions: [],
  };
  let payload: any,
    mode = 'valid';
  const server = createServer(async (req, res) => {
    let raw = '';
    for await (const chunk of req) raw += chunk;
    payload = JSON.parse(raw);
    assert.equal(req.url, '/api/chat');
    res.setHeader('content-type', 'application/json');
    res.end(
      JSON.stringify({
        message: {
          content:
            mode === 'valid'
              ? JSON.stringify(result)
              : JSON.stringify({ ...result, estimatedScore: 500 }),
        },
      }),
    );
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  try {
    const port = (server.address() as any).port;
    const provider = new OllamaProvider({ ...loadConfig(), ollamaUrl: 'http://127.0.0.1:' + port });
    const out = await provider.gradeEssay({ text: '原文', question: { maxScore: 100 } });
    assert.equal(out.result.estimatedScore, 12);
    assert.equal(payload.stream, false);
    assert.equal(payload.format.type, 'object');
    assert.ok(payload.messages[0].content.includes('最终评分由教师决定'));
    mode = 'invalid';
    await assert.rejects(provider.gradeEssay({ text: '原文', question: { maxScore: 100 } }));
  } finally {
    server.close();
    await once(server, 'close');
  }
});
test('未配置微信密钥时明确报错，不伪造登录', async () => {
  const api = new WechatApi({ ...loadConfig(), wechatAppId: '', wechatSecret: '' });
  await assert.rejects(api.exchange('code'), /尚未配置/);
});
test('草稿写入串行化，输入期间的后续内容不会被旧响应覆盖', async () => {
  const calls: any[] = [],
    local: any[] = [];
  let resolveSave!: (v: { version: number }) => void;
  const sync = new DraftSync(
    '',
    0,
    async (text, version) => {
      calls.push({ text, version });
      if (calls.length === 1)
        return new Promise((resolve) => {
          resolveSave = resolve;
        });
      return { version: version + 1 };
    },
    (text, version) => local.push({ text, version }),
    () => {},
  );
  sync.change('第一句');
  const flushing = sync.flush();
  sync.change('第一句，再加一句');
  resolveSave({ version: 1 });
  await flushing;
  assert.deepEqual(calls, [
    { text: '第一句', version: 0 },
    { text: '第一句，再加一句', version: 1 },
  ]);
  assert.equal(sync.version, 2);
  assert.equal(local.at(-1).text, '第一句，再加一句');
  sync.dispose();
});
test('网络失败保留本机草稿，重试可恢复云端同步', async () => {
  let failing = true,
    local = '';
  const sync = new DraftSync(
    '',
    0,
    async () => {
      if (failing) throw Error('offline');
      return { version: 1 };
    },
    (text) => {
      local = text;
    },
    () => {},
  );
  sync.change('离线文字');
  await assert.rejects(sync.flush(), /offline/);
  assert.equal(local, '离线文字');
  assert.equal(sync.version, 0);
  failing = false;
  await sync.flush();
  assert.equal(sync.version, 1);
  sync.dispose();
});
async function zip(entries: Record<string, string>) {
  const archive = archiver('zip');
  const chunks: Buffer[] = [];
  archive.on('data', (c) => chunks.push(c));
  for (const [name, text] of Object.entries(entries)) archive.append(text, { name });
  await archive.finalize();
  return Buffer.concat(chunks);
}
function pdf() {
  const content = 'BT /F1 12 Tf 50 700 Td (Essay text extraction works.) Tj ET';
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    '<< /Length ' + content.length + ' >>\nstream\n' + content + '\nendstream',
  ];
  let text = '%PDF-1.4\n',
    offsets = [0];
  objects.forEach((obj, i) => {
    offsets.push(Buffer.byteLength(text));
    text += i + 1 + ' 0 obj\n' + obj + '\nendobj\n';
  });
  const xref = Buffer.byteLength(text);
  text +=
    'xref\n0 6\n0000000000 65535 f \n' +
    offsets
      .slice(1)
      .map((n) => String(n).padStart(10, '0') + ' 00000 n \n')
      .join('') +
    'trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n' +
    xref +
    '\n%%EOF';
  return Buffer.from(text);
}
test('真实 TXT / DOCX / PDF 提取子进程与文件识别', async () => {
  const dir = await mkdtemp(path.join(process.cwd(), 'test-extract-'));
  try {
    const docx = await zip({
      '[Content_Types].xml':
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
      '_rels/.rels':
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
      'word/document.xml':
        '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>中文作答提取验证</w:t></w:r></w:p></w:body></w:document>',
    });
    for (const [ext, bytes, expected] of [
      ['.txt', Buffer.from('中文作答提取验证'), '中文作答提取验证'],
      ['.docx', docx, '中文作答提取验证'],
      ['.pdf', pdf(), 'Essay text extraction works.'],
    ] as const) {
      await validateUpload('answer' + ext, bytes);
      const file = path.join(dir, 'answer' + ext);
      await writeFile(file, bytes);
      const { stdout } = await exec(
        process.execPath,
        ['--import', 'tsx', 'src/extract-worker.ts', file, ext],
        { timeout: 45000, maxBuffer: 1024 * 1024, windowsHide: true },
      );
      assert.ok(JSON.parse(stdout).text.includes(expected), stdout);
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
