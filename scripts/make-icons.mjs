#!/usr/bin/env node
// Rasterises public/icons/icon.svg into the PNG sizes the manifest needs. Requires Playwright (not a project dependency):
//   node scripts/make-icons.mjs
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const { chromium } = createRequire(import.meta.url)('playwright');

const dir = new URL('../public/icons/', import.meta.url);
const svg = readFileSync(new URL('icon.svg', dir), 'utf8');
const browser = await chromium.launch();
const page = await browser.newPage();
// [file, size, maskable (full-bleed square with the glyph inside the safe zone)]
for (const [file, size, maskable] of [['icon-192.png', 192], ['icon-512.png', 512], ['apple-touch-icon.png', 180, true], ['icon-maskable-512.png', 512, true]]) {
  await page.setViewportSize({ width: size, height: size });
  const art = maskable ? svg.replace('rx="112"', 'rx="0"').replace('font-size="300"', 'font-size="250"').replace('y="356"', 'y="340"') : svg;
  await page.setContent(`<body style="margin:0;background:transparent">${art.replace('<svg ', `<svg width="${size}" height="${size}" `)}</body>`);
  await page.screenshot({ path: new URL(file, dir).pathname, omitBackground: true });
}
await browser.close();
