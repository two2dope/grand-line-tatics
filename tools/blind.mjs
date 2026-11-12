#!/usr/bin/env node
// Blind A/B comparison prep.
//   node tools/blind.mjs <ours.png> <ref.png> <outdir> <swap 0|1> [--size WxH]
// swap=0 -> A=ours, B=ref ; swap=1 -> A=ref, B=ours.
// Both images are decoded and re-encoded through a canvas to the SAME size (default: size of ours,
// reference is cover-cropped), which drops every piece of metadata, file name and format hint.
// Writes outdir/A.png, outdir/B.png, outdir/mapping.json. Look at A and B and decide BEFORE opening mapping.json.
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const argv = process.argv.slice(2);
let size = null;
const pos = [];
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === '--size') size = argv[++i]; else pos.push(argv[i]);
}
if (pos.length !== 4 || !['0', '1'].includes(pos[3])) {
  console.error('usage: node tools/blind.mjs <ours.png> <ref.png> <outdir> <swap 0|1> [--size WxH]');
  process.exit(2);
}
const [oursP, refP, outdir, swapS] = pos;
for (const f of [oursP, refP]) if (!fs.existsSync(f)) { console.error(`blind: missing file ${f}`); process.exit(2); }
const mime = (f) => ({ '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' }[path.extname(f).toLowerCase()] || 'application/octet-stream');
const dataUrl = (f) => `data:${mime(f)};base64,${fs.readFileSync(f).toString('base64')}`;

const browser = await chromium.launch({ headless: true });
let result;
try {
  const page = await browser.newPage();
  result = await page.evaluate(async ({ ours, ref, size }) => {
    const load = (src) => new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('cannot decode image')); i.src = src; });
    const [a, b] = await Promise.all([load(ours), load(ref)]);
    let W = a.naturalWidth, H = a.naturalHeight;
    if (size) { [W, H] = size.split('x').map(Number); }
    const draw = (img) => {
      const c = document.createElement('canvas'); c.width = W; c.height = H;
      const g = c.getContext('2d'); g.imageSmoothingQuality = 'high';
      const s = Math.max(W / img.naturalWidth, H / img.naturalHeight);
      const w = img.naturalWidth * s, h = img.naturalHeight * s;
      g.drawImage(img, (W - w) / 2, (H - h) / 2, w, h);
      return c.toDataURL('image/png');
    };
    return { ours: draw(a), ref: draw(b), W, H, ourSize: [a.naturalWidth, a.naturalHeight], refSize: [b.naturalWidth, b.naturalHeight] };
  }, { ours: dataUrl(oursP), ref: dataUrl(refP), size });
} finally { await browser.close(); }

const swap = swapS === '1';
fs.mkdirSync(outdir, { recursive: true });
const buf = (d) => Buffer.from(d.split(',')[1], 'base64');
fs.writeFileSync(path.join(outdir, 'A.png'), buf(swap ? result.ref : result.ours));
fs.writeFileSync(path.join(outdir, 'B.png'), buf(swap ? result.ours : result.ref));
fs.writeFileSync(path.join(outdir, 'mapping.json'), JSON.stringify({
  A: swap ? 'ref' : 'ours', B: swap ? 'ours' : 'ref', swap: swap ? 1 : 0,
  ours: path.resolve(oursP), ref: path.resolve(refP), size: [result.W, result.H],
  originalSizes: { ours: result.ourSize, ref: result.refSize },
}, null, 2));
console.log(`blind: wrote ${path.join(outdir, 'A.png')} and ${path.join(outdir, 'B.png')} (${result.W}x${result.H}).`);
console.log('blind: judge A vs B first; mapping.json is the answer key - do not open it until you have decided.');
