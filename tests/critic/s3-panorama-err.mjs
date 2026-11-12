// Critic probe: does simply pressing the Panorama camera button throw in the render loop?
import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath, pathToFileURL } from 'node:url'; import { chromium } from 'playwright';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const browser = await chromium.launch({ headless: true, args: ['--use-angle=swiftshader', '--use-gl=angle', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl', '--hide-scrollbars', '--allow-file-access-from-files'] });
for (const phase of ['setup', 'battle']) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  await ctx.route(/three\.min\.js/, (r) => r.fulfill({ status: 200, contentType: 'application/javascript', body: fs.readFileSync(path.join(ROOT, 'tools/vendor/three.min.js')) }));
  await ctx.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
  const page = await ctx.newPage();
  const errs = []; page.on('pageerror', (e) => errs.push(e.message)); page.on('console', (m) => { if (m.type() === 'error') errs.push('console: ' + m.text()); });
  await page.goto(pathToFileURL(path.join(ROOT, 'index.html')).href, { waitUntil: 'load' });
  await page.waitForFunction(() => window.GLT && GLT.ui && GLT.ui.dom && GLT.ui.dom.canvas, null, { timeout: 30000 });
  if (phase === 'battle') await page.evaluate(async () => { const ui = GLT.ui; Object.assign(ui.matchConfig, { boardId: 'escaramuca', mode: 'classico' }); ui.autoPlacePlayerFleet(); ui.startMatchWithCoinToss(); for (let i = 0; i < 100 && ui.gamePhase !== 'BATTLE'; i++) await new Promise((r) => setTimeout(r, 100)); });
  await page.waitForTimeout(2000);
  const before = errs.length;
  // press the real on-screen button
  await page.getByRole('button', { name: 'Panorama da Grand Line' }).click();
  await page.waitForTimeout(8000);
  await page.screenshot({ path: path.join(ROOT, 'shots/critic/s3-sweep/panorama-' + phase + '.png') });
  console.log(phase, 'errors before', before, 'after panorama', errs.length - before, errs.slice(-1)[0] || '');
  await ctx.close();
}
await browser.close();
