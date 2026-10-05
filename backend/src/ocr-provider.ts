import type { Config } from './config.js';
import { requireLocalInference } from './local-inference.js';
export interface OCRProvider {
  extract(bytes: Buffer, mimeType: string, fileName: string): Promise<string>;
}
export class ManualOCRProvider implements OCRProvider {
  async extract(): Promise<string> {
    throw Error('未开启 OCR，请老师查看原稿人工批改');
  }
}
export class PaddleOCRProvider implements OCRProvider {
  constructor(private config: Config) {}
  async extract(bytes: Buffer, mimeType: string, fileName: string) {
    requireLocalInference(this.config.ocrUrl);
    const form = new FormData();
    form.append('file', new Blob([new Uint8Array(bytes)], { type: mimeType }), fileName);
    const res = await fetch(this.config.ocrUrl + '/extract', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + this.config.ocrToken },
      body: form,
      signal: AbortSignal.timeout(45000),
      redirect: 'error',
    });
    if (!res.ok) throw Error('本次未能自动识别，请老师人工处理');
    const data = (await res.json()) as any;
    if (typeof data.text !== 'string') throw Error('OCR 返回格式不正确');
    return data.text.slice(0, 30000);
  }
}
export function createOCRProvider(c: Config): OCRProvider {
  return c.ocrEnabled ? new PaddleOCRProvider(c) : new ManualOCRProvider();
}
