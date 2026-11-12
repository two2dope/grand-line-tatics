// Critic probe, stage 6 (artifact-build). Isolated copy of dist/grand-line-tactics.html, opened over
// file:// and over a one-file http server; logs every request; compares each embedded WebP against the
// original JPG (downscaled to the same size in the same canvas) and screenshots portraits/charts/blessings.
import fs from 'fs';
import os from 'os';
import path from 'path';
import http from 'http';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

import { fileURLToPath } from 'url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SRC = path.join(ROOT, 'dist', 'grand-line-tactics.html');
const OUT = path.join(ROOT, 'shots', 'critic', 's6');
fs.mkdirSync(OUT, { recursive: true });
const iso = fs.mkdtempSync(path.join(os.tmpdir(), 'glt-critic-iso-'));
const FILE = path.join(iso, 'grand-line-tactics.html');
fs.copyFileSync(SRC, FILE);
console.log('size bytes', fs.statSync(FILE).size, (fs.statSync(FILE).size / 1048576).toFixed(2), 'MiB; iso', iso);
const ALLOWED = new Set(['cdnjs.cloudflare.com', 'fonts.googleapis.com', 'fonts.gstatic.com']);
const sleep = ms => new Promise(r => setTimeout(r, ms));

const httpLog = [];
const srv = http.createServer((req, res) => {
  httpLog.push(req.url);
  if (req.url === '/' || req.url.startsWith('/grand-line-tactics.html')) {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(fs.readFileSync(FILE));
  } else { res.writeHead(404); res.end('nf'); }
});
await new Promise(r => srv.listen(0, '127.0.0.1', r));
const PORT = srv.address().port;

const args = ['--use-gl=angle', '--enable-webgl', '--ignore-gpu-blocklist'];
let browser;
try { browser = await chromium.launch({ channel: 'chrome', headless: true, args }); } catch { browser = await chromium.launch({ headless: true, args }); }

async function session(label, url, ctxOpts, body) {
  const ctx = await browser.newContext(ctxOpts);
  const page = await ctx.newPage();
  const reqs = [], fails = [], errs = [];
  page.on('request', r => { const u = r.url(); if (!/^(data|blob):/.test(u)) reqs.push(u.slice(0, 140)); });
  page.on('requestfailed', r => fails.push(r.url().slice(0, 140) + ' ' + (r.failure() && r.failure().errorText)));
  page.on('response', r => { if (r.status() >= 400) fails.push('HTTP ' + r.status() + ' ' + r.url().slice(0, 140)); });
  page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') errs.push(m.type() + ': ' + m.text().slice(0, 200)); });
  page.on('pageerror', e => errs.push('pageerror: ' + e.message));
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForFunction('Boolean(window.GLT && GLT.ui && document.getElementById("glt-app"))', null, { timeout: 30000 });
  await sleep(2000);
  if (body) await body(page, label);
  const hosts = {};
  for (const u of reqs) { const h = u.startsWith('file:') ? 'file' : new URL(u).host; hosts[h] = (hosts[h] || 0) + 1; }
  const bad = Object.keys(hosts).filter(h => h !== 'file' && h !== '127.0.0.1:' + PORT && !ALLOWED.has(h));
  console.log(`\n=== ${label} ===\nhosts`, JSON.stringify(hosts), '\nbad hosts', bad, '\nfailed', fails, '\nconsole errors/warnings', errs);
  console.log('requests:\n  ' + reqs.join('\n  '));
  await ctx.close();
}

async function exercise(page, label) {
  const tag = label.replace(/\W+/g, '_');
  await page.screenshot({ path: path.join(OUT, tag + '-setup.png'), fullPage: false });
  // list visible buttons for navigation
  const btns = await page.evaluate(() => Array.from(document.querySelectorAll('button')).filter(b => b.offsetParent).map(b => (b.id || '') + '|' + b.textContent.trim().slice(0, 40)));
  console.log(label, 'buttons:', btns.slice(0, 40).join(' ;; '));
  // chart
  const chart = await page.$('#btn-open-nautical-chart');
  if (chart) {
    await chart.click(); await sleep(1200);
    await page.screenshot({ path: path.join(OUT, tag + '-chart.png') });
    // click the island tabs, sail to each (exercises sky biome texture on http)
    const tabs = await page.$$('[class*="island-tab"], [role="tab"]');
    console.log(label, 'chart tabs', tabs.length);
    for (let i = 0; i < Math.min(tabs.length, 5); i++) {
      try { await tabs[i].click(); await sleep(500); } catch (e) {}
      if (i === 1) await page.screenshot({ path: path.join(OUT, tag + '-chart-island.png') });
      const sail = await page.$('.glt-btn-sail-here');
      if (sail && i === tabs.length - 1) { try { await sail.click(); await sleep(1500); } catch (e) {} }
    }
    await page.keyboard.press('Escape'); await sleep(400);
  }
  // blessings: scroll all lazy blessing images into view and check they load
  const lazy = await page.evaluate(async () => {
    const imgs = Array.from(document.images).filter(i => i.loading === 'lazy');
    for (const i of imgs) { i.loading = 'eager'; }
    await new Promise(r => setTimeout(r, 1500));
    return imgs.map(i => ({ ok: i.complete && i.naturalWidth > 0, w: i.naturalWidth, c: i.className }));
  });
  console.log(label, 'lazy imgs', lazy.length, 'loaded', lazy.filter(x => x.ok).length);
  const card = await page.$('.blessing-card-art, .blessing-badge');
  if (card) { try { await card.scrollIntoViewIfNeeded(); await card.click(); await sleep(800); } catch (e) {} }
  await page.screenshot({ path: path.join(OUT, tag + '-blessing.png') });
  const insp = await page.$('.blessing-inspector-img');
  if (insp && await insp.isVisible()) await insp.screenshot({ path: path.join(OUT, tag + '-blessing-inspector.png') });
  await page.keyboard.press('Escape'); await sleep(300);
  // sky biome state (http only)
  const sky = await page.evaluate(() => { try { let m = null; return JSON.stringify(Object.keys(window.GLT || {}).slice(0, 30)); } catch (e) { return String(e); } });
  console.log(label, 'GLT keys', sky);
}

await session('file desktop', 'file:///' + FILE.replace(/\\/g, '/'), { viewport: { width: 1280, height: 800 } }, exercise);
await session('http desktop', `http://127.0.0.1:${PORT}/grand-line-tactics.html`, { viewport: { width: 1280, height: 800 } }, exercise);
await session('http phone', `http://127.0.0.1:${PORT}/grand-line-tactics.html`, { viewport: { width: 375, height: 667 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }, exercise);
console.log('\nhttp server saw', httpLog);

// ---- quantitative compression damage: embedded webp vs original jpg at the webp's size
{
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto(`http://127.0.0.1:${PORT}/grand-line-tactics.html`, { waitUntil: 'load' });
  await page.waitForFunction('Boolean(window.GLT_ASSET_DATA)');
  const keys = await page.evaluate(() => Object.keys(window.GLT_ASSET_DATA));
  const rows = [];
  for (const k of keys) {
    const orig = path.join(ROOT, k);
    if (!fs.existsSync(orig)) { rows.push({ k, err: 'no original' }); continue; }
    const b64 = fs.readFileSync(orig).toString('base64');
    const r = await page.evaluate(async ({ k, b64 }) => {
      const load = src => new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = src; });
      const w = await load(window.GLT_ASSET_DATA[k]);
      const o = await load('data:image/jpeg;base64,' + b64);
      const W = w.naturalWidth, H = w.naturalHeight;
      const c = document.createElement('canvas'); c.width = W; c.height = H;
      const g = c.getContext('2d', { willReadFrequently: true });
      g.imageSmoothingQuality = 'high';
      g.drawImage(o, 0, 0, W, H); const a = g.getImageData(0, 0, W, H).data;
      g.clearRect(0, 0, W, H); g.drawImage(w, 0, 0); const b = g.getImageData(0, 0, W, H).data;
      let se = 0, n = 0, maxd = 0;
      for (let i = 0; i < a.length; i += 4) for (let j = 0; j < 3; j++) { const d = a[i + j] - b[i + j]; se += d * d; n++; if (Math.abs(d) > maxd) maxd = Math.abs(d); }
      const mse = se / n; const psnr = 10 * Math.log10(255 * 255 / Math.max(mse, 1e-9));
      return { ow: o.naturalWidth, oh: o.naturalHeight, W, H, psnr: +psnr.toFixed(2), maxd };
    }, { k, b64 });
    rows.push({ k, ...r, origKB: Math.round(fs.statSync(orig).size / 1024), webpKB: Math.round((await page.evaluate(k => window.GLT_ASSET_DATA[k].length, k)) * 0.75 / 1024) });
  }
  rows.sort((a, b) => (a.psnr || 0) - (b.psnr || 0));
  console.log('\n=== PSNR webp vs original (downscaled to webp size), worst first ===');
  for (const r of rows) console.log(`${(r.psnr ?? r.err)}\t${r.ow}x${r.oh} -> ${r.W}x${r.H}\t${r.origKB}KB -> ${r.webpKB}KB\t${r.k}`);
  // display-size check: rendered css size * dpr vs natural width for every visible <img>
  await ctx.close();
}
await browser.close();
srv.close();
