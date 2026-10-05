// Runs in an isolated child process with a wall-clock timeout and bounded stdout.
import { readFile } from 'node:fs/promises';
import mammoth from 'mammoth';
const [file, extension] = process.argv.slice(2);
try {
  let text = '';
  if (extension === '.txt') text = await readFile(file, 'utf8');
  else if (extension === '.docx') text = (await mammoth.extractRawText({ path: file })).value;
  else if (extension === '.pdf') {
    const { PDFParse } = await import('pdf-parse');
    const p = new PDFParse({ data: await readFile(file) });
    try {
      const result = await p.getText();
      text = result.pages.map((page) => page.text).join('\n\n');
    } finally {
      await p.destroy();
    }
  }
  process.stdout.write(JSON.stringify({ text: text.trim().slice(0, 30000) }));
} catch {
  process.stderr.write('文件无法提取，请老师查看附件人工批改');
  process.exitCode = 1;
}
