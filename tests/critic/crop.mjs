// Critic helper: crop + nearest-neighbour upscale a PNG. node tests/critic/crop.mjs in.png out.png x y w h scale
import fs from 'node:fs';
import { chromium } from 'playwright';
const [inp, out, x, y, w, h, s] = process.argv.slice(2);
const b = await chromium.launch({ headless: true });
const p = await b.newPage();
const d = await p.evaluate(async ({ src, x, y, w, h, s }) => {
  const i = new Image(); await new Promise((r) => { i.onload = r; i.src = src; });
  const c = document.createElement('canvas'); c.width = w * s; c.height = h * s;
  const g = c.getContext('2d'); g.imageSmoothingEnabled = false; g.drawImage(i, x, y, w, h, 0, 0, w * s, h * s);
  return c.toDataURL('image/png');
}, { src: 'data:image/png;base64,' + fs.readFileSync(inp).toString('base64'), x: +x, y: +y, w: +w, h: +h, s: +s });
fs.writeFileSync(out, Buffer.from(d.split(',')[1], 'base64'));
await b.close();
