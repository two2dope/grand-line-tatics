// Contact sheet: node tests/critic/sheet.mjs out.png cols scale file1.png file2.png ...  (labels = file names)
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright';
const [out, cols, scale, ...files] = process.argv.slice(2);
const k = Number(scale) || 0.5;
const cells = files.map((f) => `<figure><img src="${pathToFileURL(path.resolve(f)).href}"><figcaption>${path.basename(path.dirname(f))}/${path.basename(f)}</figcaption></figure>`).join('');
const htmlDoc = `<!doctype html><meta charset="utf-8"><style>body{margin:0;background:#111;color:#eee;font:12px sans-serif}
.g{display:grid;grid-template-columns:repeat(${Number(cols) || 2},auto);gap:4px;padding:4px}figure{margin:0}img{display:block;zoom:${k};image-rendering:pixelated}</style><div class="g">${cells}</div>`;
const tmp = path.resolve(out + '.html');
fs.writeFileSync(tmp, htmlDoc);
const b = await chromium.launch({ args: ['--allow-file-access-from-files'] });
const p = await b.newPage({ viewport: { width: 400, height: 300 } });
await p.goto(pathToFileURL(tmp).href);
await p.waitForTimeout(300);
await p.screenshot({ path: out, fullPage: true });
await b.close();
fs.unlinkSync(tmp);
