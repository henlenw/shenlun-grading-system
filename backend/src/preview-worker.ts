import { readFile } from 'node:fs/promises';
import { PDFParse } from 'pdf-parse';
const [file, pageArg] = process.argv.slice(2),
  page = Number(pageArg);
try {
  const pdf = new PDFParse({ data: await readFile(file) });
  try {
    const info = await pdf.getInfo();
    if (page < 1 || page > info.total || page > 100) throw Error('Page out of range');
    const result = await pdf.getScreenshot({
      partial: [page],
      desiredWidth: 1400,
      imageDataUrl: false,
      imageBuffer: true,
    });
    const p = result.pages[0];
    if (!p) throw Error('Missing page');
    process.stdout.write(
      JSON.stringify({
        total: info.total,
        width: p.width,
        height: p.height,
        data: Buffer.from(p.data).toString('base64'),
      }),
    );
  } finally {
    await pdf.destroy();
  }
} catch {
  process.stderr.write('PDF 页面暂时无法预览，请下载原稿查看');
  process.exitCode = 1;
}
