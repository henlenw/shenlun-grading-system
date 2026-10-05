import { chromium } from '@playwright/test';
import fs from 'node:fs/promises';
const b = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const page = await b.newPage({ viewport: { width: 900, height: 300 }, deviceScaleFactor: 2 });
  for (const [name, w, h] of [
    ['logo', 750, 192],
    ['logo-icon', 512, 512],
  ]) {
    const svg = await fs.readFile('assets/brand/' + name + '.svg', 'utf8');
    await page.setViewportSize({ width: w, height: h });
    await page.setContent(
      '<html><body style="margin:0;background:transparent">' + svg + '</body></html>',
    );
    await page
      .locator('svg')
      .first()
      .screenshot({ path: 'assets/brand/' + name + '.png', omitBackground: true });
    await fs.copyFile(
      'assets/brand/' + name + '.png',
      'teacher-admin/public/brand/' + name + '.png',
    );
  }
  const icon = await fs.readFile('assets/brand/logo-icon.svg', 'utf8');
  for (const size of [192, 512]) {
    await page.setViewportSize({ width: size, height: size });
    await page.setContent(
      '<html><body style="margin:0">' +
        icon.replace('width="512" height="512"', 'width="' + size + '" height="' + size + '"') +
        '</body></html>',
    );
    // Explicit CSS size and scale 1 for installable PWA icon dimensions.
    const single = await b.newPage({
      viewport: { width: size, height: size },
      deviceScaleFactor: 1,
    });
    await single.setContent(
      '<html><body style="margin:0">' +
        icon.replace('width="512" height="512"', 'width="' + size + '" height="' + size + '"') +
        '</body></html>',
    );
    await single.screenshot({
      path: 'teacher-admin/public/brand/icon-' + size + '.png',
      omitBackground: true,
    });
    await single.close();
  }
  await fs.copyFile('assets/brand/logo.png', 'miniprogram/assets/brand/logo.png');
  await fs.copyFile('assets/brand/logo-icon.png', 'miniprogram/assets/brand/logo-icon.png');
  console.log('Logo SVG/PNG and PWA icons generated');
} finally {
  await b.close();
}
