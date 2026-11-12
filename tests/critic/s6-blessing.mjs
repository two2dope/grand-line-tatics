// Critic probe stage 6: blessings inspector + portraits zoom on the isolated single file (file://).
import fs from 'fs'; import os from 'os'; import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const OUT = path.join(ROOT, 'shots', 'critic', 's6');
const iso = fs.mkdtempSync(path.join(os.tmpdir(), 'glt-critic-b-'));
const FILE = path.join(iso, 'grand-line-tactics.html');
fs.copyFileSync(path.join(ROOT, 'dist', 'grand-line-tactics.html'), FILE);
const args = ['--use-gl=angle', '--enable-webgl', '--ignore-gpu-blocklist'];
let b; try { b = await chromium.launch({ channel: 'chrome', headless: true, args }); } catch { b = await chromium.launch({ headless: true, args }); }
const page = await (await b.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2 })).newPage();
const errs = [];
page.on('console', m => { if (m.type() === 'error') errs.push(m.text().slice(0, 200)); });
page.on('pageerror', e => errs.push('pageerror ' + e.message));
page.on('requestfailed', r => errs.push('failed ' + r.url().slice(0, 100)));
await page.goto('file:///' + FILE.replace(/\\/g, '/'));
await page.waitForFunction('Boolean(window.GLT && GLT.ui && document.getElementById("glt-app"))', null, { timeout: 30000 });
await new Promise(r => setTimeout(r, 1500));
const crew = await page.$('.glt-crew-grid, [class*="crew-card"]');
if (crew) await crew.screenshot({ path: path.join(OUT, 'b-crews-dpr2.png') });
await page.click('#btn-tab-logbook');
await new Promise(r => setTimeout(r, 1000));
const thumbs = await page.$$('.glt-blessing-card-thumb');
console.log('thumbs', thumbs.length);
if (thumbs[0]) { await thumbs[0].scrollIntoViewIfNeeded().catch(e => console.log('scroll', e.message.slice(0, 80))); await new Promise(r => setTimeout(r, 800)); }
await page.screenshot({ path: path.join(OUT, 'b-diario-dpr2.png') });
const st = await page.evaluate(() => Array.from(document.querySelectorAll('.glt-blessing-card-thumb img, img.blessing-card-art')).map(i => ({ ok: i.complete && i.naturalWidth > 0, nw: i.naturalWidth, cw: i.clientWidth })));
console.log('thumb imgs', JSON.stringify(st));
if (thumbs[1]) { await thumbs[1].click(); await new Promise(r => setTimeout(r, 1000)); }
const insp = await page.$('.blessing-inspector-img, .blessing-inspector-card');
if (insp) { await insp.screenshot({ path: path.join(OUT, 'b-inspector-dpr2.png') }); console.log('inspector', await page.evaluate(() => { const i = document.querySelector('.blessing-inspector-img'); return i && { nw: i.naturalWidth, nh: i.naturalHeight, cw: i.clientWidth, ch: i.clientHeight, tag: i.tagName, bg: getComputedStyle(i).backgroundImage.slice(0, 30) }; })); }
else console.log('no inspector');
console.log('errs', errs);
await b.close();
