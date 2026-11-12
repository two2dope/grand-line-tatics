// Critic probe stage 6: dev/LAN build still loads external assets/ through the LAN server.
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const url = process.argv[2] || 'http://127.0.0.1:18731/';
const args = ['--use-gl=angle', '--enable-webgl', '--ignore-gpu-blocklist'];
let b; try { b = await chromium.launch({ channel: 'chrome', headless: true, args }); } catch { b = await chromium.launch({ headless: true, args }); }
const page = await (await b.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
const reqs = [], fails = [], errs = [];
page.on('request', r => { if (!/^(data|blob):/.test(r.url())) reqs.push(r.url()); });
page.on('requestfailed', r => fails.push(r.url() + ' ' + (r.failure() && r.failure().errorText)));
page.on('response', r => { if (r.status() >= 400) fails.push('HTTP ' + r.status() + ' ' + r.url()); });
page.on('console', m => { if (m.type() === 'error') errs.push(m.text().slice(0, 200)); });
page.on('pageerror', e => errs.push('pageerror ' + e.message));
await page.goto(url, { waitUntil: 'load' });
await page.waitForFunction('Boolean(window.GLT && GLT.ui && document.getElementById("glt-app"))', null, { timeout: 30000 });
await new Promise(r => setTimeout(r, 2500));
const info = await page.evaluate(() => ({
  hasTable: typeof window.GLT_ASSET_DATA, portrait: Object.values((GLT.assets || {}).portraits || {})[0],
  imgs: Array.from(document.images).filter(i => i.loading !== 'lazy').map(i => i.complete && i.naturalWidth > 0)
}));
const assetReqs = reqs.filter(u => /\/assets\//.test(u));
console.log(JSON.stringify({ url, info: { ...info, imgsOk: info.imgs.filter(Boolean).length, imgsTotal: info.imgs.length, imgs: undefined }, totalReqs: reqs.length, assetReqs: assetReqs.length, sampleAsset: assetReqs[0], fails, errs }, null, 1));
await page.screenshot({ path: process.argv[3] || 'shots/critic/s6/lan-dev.png' });
await b.close();
