/**
 * Grand Line Tactics: builds the images the game loads (assets/) from the originals
 * (assets-src/), each one no larger than the biggest size it is shown at.
 *
 * Why: the originals are up to 1376 px and 1 MB each (64 files, 47 MB). A phone decodes every
 * one of them at full size (a 1024x1024 portrait shown at 48 px still takes 4 MB of memory), and
 * next to the 3D scene that was enough for the browser to close the tab.
 *
 * Usage: npm run assets            (rebuild every image)
 *        npm run assets -- --check (exit 1 when an image in assets/ is missing or out of date)
 *
 * Resizing runs in Chrome through Playwright (devDependency): no image library to install.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'assets-src');
const OUT = path.join(ROOT, 'assets');

// Longest edge in pixels, per folder: the largest size the image is drawn at, with room for
// a 2x screen where it matters.
const MAX_EDGE = {
  portraits: 384,   // crew cards 38-48 px, wanted poster about 270 px
  emblems: 256,     // seal stamps 22 px
  officers: 256,    // officer cards 50 px
  ships: 640,
  props: 640,
  hazards: 960,
  techniques: 640,  // banner 88 px, cards
  blessings: 720,   // inspector 240x320
  backgrounds: 1376, // sky texture and island previews: only recompressed
  maps: 1376        // nautical chart: only recompressed
};
const QUALITY = 0.82;

function listSources() {
  const out = [];
  for (const folder of Object.keys(MAX_EDGE)) {
    const dir = path.join(SRC, folder);
    if (!fs.existsSync(dir)) continue;
    for (const name of fs.readdirSync(dir)) {
      if (/\.(jpe?g|png)$/i.test(name)) out.push({ folder, name, src: path.join(dir, name), dst: path.join(OUT, folder, name) });
    }
  }
  return out;
}

function isStale(item) {
  if (!fs.existsSync(item.dst)) return true;
  return fs.statSync(item.dst).mtimeMs < fs.statSync(item.src).mtimeMs;
}

async function main() {
  const check = process.argv.includes('--check');
  const items = listSources();
  if (items.length === 0) {
    console.error('No originals found in assets-src/.');
    process.exit(1);
  }
  if (check) {
    const stale = items.filter(isStale);
    stale.forEach(i => console.error('out of date: assets/' + i.folder + '/' + i.name));
    console.log(stale.length === 0 ? `assets/ is up to date (${items.length} images).` : `${stale.length} image(s) need npm run assets.`);
    process.exit(stale.length === 0 ? 0 : 1);
  }

  const { chromium } = require('playwright');
  const channel = process.env.GLT_BROWSER_CHANNEL !== undefined ? process.env.GLT_BROWSER_CHANNEL : 'chrome';
  const browser = await chromium.launch(channel ? { channel } : {});
  const page = await browser.newPage();
  let before = 0;
  let after = 0;

  for (const item of items) {
    const input = fs.readFileSync(item.src);
    const isPng = /\.png$/i.test(item.name);
    const mime = isPng ? 'image/png' : 'image/jpeg';
    const result = await page.evaluate(async ({ b64, mime, maxEdge, quality }) => {
      const img = new Image();
      img.src = 'data:' + mime + ';base64,' + b64;
      await img.decode();
      const scale = Math.min(1, maxEdge / Math.max(img.naturalWidth, img.naturalHeight));
      const w = Math.round(img.naturalWidth * scale);
      const h = Math.round(img.naturalHeight * scale);
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(img, 0, 0, w, h);
      const url = canvas.toDataURL(mime, quality);
      return { data: url.slice(url.indexOf(',') + 1), w, h, from: [img.naturalWidth, img.naturalHeight] };
    }, { b64: input.toString('base64'), mime, maxEdge: MAX_EDGE[item.folder], quality: QUALITY });

    let output = Buffer.from(result.data, 'base64');
    if (output.length >= input.length && result.w === result.from[0]) output = input; // never make one bigger
    fs.mkdirSync(path.dirname(item.dst), { recursive: true });
    fs.writeFileSync(item.dst, output);
    before += input.length;
    after += output.length;
    console.log(`${item.folder}/${item.name}: ${result.from.join('x')} -> ${result.w}x${result.h}, ${(input.length / 1024).toFixed(0)} KB -> ${(output.length / 1024).toFixed(0)} KB`);
  }

  await browser.close();
  console.log(`\n${items.length} images: ${(before / 1e6).toFixed(1)} MB -> ${(after / 1e6).toFixed(1)} MB`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
