// Critic probe: repeat picking.mjs's tablet 12x12 setup R times with per-step timeouts, to see whether the game can freeze.
import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath, pathToFileURL } from 'node:url'; import { chromium } from 'playwright';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const R = Number(process.argv[2] || 6);
const browser = await chromium.launch({ headless: true, args: ['--use-angle=swiftshader', '--use-gl=angle', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl', '--hide-scrollbars', '--allow-file-access-from-files'] });
const T = (p, ms, tag) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('TIMEOUT ' + tag)), ms))]);
for (let i = 0; i < R; i++) {
  const ctx = await browser.newContext({ viewport: { width: 1024, height: 768 }, deviceScaleFactor: 1 });
  await ctx.route(/cdnjs\.cloudflare\.com\/ajax\/libs\/three\.js\/r128\/three\.min\.js/, (r) => r.fulfill({ status: 200, contentType: 'application/javascript', body: fs.readFileSync(path.join(ROOT, 'tools/vendor/three.min.js')) }));
  await ctx.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
  const page = await ctx.newPage(); const errs = [];
  page.on('pageerror', (e) => errs.push(e.message)); page.on('crash', () => errs.push('CRASH'));
  const t0 = Date.now(); let step = 'goto';
  try {
    await T(page.goto(pathToFileURL(path.join(ROOT, 'index.html')).href, { waitUntil: 'load' }), 90000, step);
    step = 'ready'; await page.waitForFunction(() => window.GLT && GLT.ui && GLT.ui.dom && GLT.ui.dom.canvas, null, { timeout: 60000 });
    step = 'start'; await T(page.evaluate(async () => { const s=(ms)=>new Promise(r=>setTimeout(r,ms)); const ui=GLT.ui; Object.assign(ui.matchConfig,{boardId:'grand_line',mode:'classico',difficulty:'capitao',seriesLength:1}); ui.animSpeed=4; ui.autoPlacePlayerFleet(); ui.startMatchWithCoinToss(); for(let i=0;i<60&&ui.gamePhase!=='BATTLE';i++) await s(100); return ui.gamePhase; }), 90000, step);
    for (const m of ['duas_aguas', 'minhas_aguas', 'mira_inimiga', 'panorama']) {
      step = 'preset ' + m; await T(page.evaluate((p) => GLT.ui.setCameraPreset(p), m), 60000, step);
      await page.waitForFunction(() => !GLT.ui.platesSystem.cameraController.transitioning, null, { timeout: 60000, polling: 100 });
      step = 'ping ' + m; await T(page.evaluate(() => GLT.ui.gamePhase + ' turn ' + (GLT.ui.matchState && GLT.ui.matchState.turn)), 60000, step);
    }
    console.log('run', i, 'ok', ((Date.now() - t0) / 1000).toFixed(1) + 's', 'errs', errs.length, errs.slice(0, 2).join(' | '));
  } catch (e) { console.log('run', i, 'FAIL at', step, e.message.split('\n')[0], ((Date.now() - t0) / 1000).toFixed(1) + 's', errs.join(' | ')); }
  await ctx.close().catch(() => {});
}
await browser.close();
