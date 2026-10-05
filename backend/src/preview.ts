import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
const exec = promisify(execFile);
let active = 0;
const waiting: (() => void)[] = [];
export async function pdfPage(
  file: string,
  page: number,
): Promise<{ total: number; width: number; height: number; data: string }> {
  if (active >= 1) await new Promise<void>((resolve) => waiting.push(resolve));
  else active++;
  try {
    const ts = import.meta.url.endsWith('.ts'),
      worker = fileURLToPath(
        new URL(ts ? './preview-worker.ts' : './preview-worker.js', import.meta.url),
      );
    const { stdout } = await exec(
      process.execPath,
      [...(ts ? ['--import', 'tsx'] : []), worker, file, String(page)],
      { timeout: 45000, maxBuffer: 16 * 1024 * 1024, windowsHide: true },
    );
    return JSON.parse(stdout);
  } finally {
    const next = waiting.shift();
    if (next) next();
    else active--;
  }
}
