// Critic probe: does the camera move after the preset tween ends? Samples camera pos/quaternion + projected cell centre.
import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath, pathToFileURL } from 'node:url'; import { chromium } from 'playwright';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const browser = await chromium.launch({ headless: true, args: ['--use-angle=swiftshader', '--use-gl=angle', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl', '--hide-scrollbars', '--allow-file-access-from-files'] });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
await ctx.route(/cdnjs\.cloudflare\.com\/ajax\/libs\/three\.js\/r128\/three\.min\.js/, (r) => r.fulfill({ status: 200, contentType: 'application/javascript', body: fs.readFileSync(path.join(ROOT, 'tools/vendor/three.min.js')) }));
await ctx.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
const page = await ctx.newPage();
await page.goto(pathToFileURL(path.join(ROOT, 'index.html')).href, { waitUntil: 'load' });
await page.waitForFunction(() => window.GLT && GLT.ui && GLT.ui.dom && GLT.ui.dom.canvas, null, { timeout: 30000 });
await page.evaluate(async () => { const s=(ms)=>new Promise(r=>setTimeout(r,ms)); const ui=GLT.ui; Object.assign(ui.matchConfig,{boardId:'grand_line',mode:'classico',difficulty:'grumete',seriesLength:1,turnTimer:0}); ui.animSpeed=4; ui.autoPlacePlayerFleet(); ui.startMatchWithCoinToss(); for(let i=0;i<100&&ui.gamePhase!=='BATTLE';i++) await s(100); });
for (const mode of ['panorama', 'duas_aguas', 'mira_inimiga']) {
  await page.evaluate((p) => GLT.ui.setCameraPreset(p), mode);
  await page.waitForFunction(() => { const c = GLT.ui.platesSystem.cameraController; return !c || !c.transitioning; }, null, { timeout: 60000, polling: 100 });
  const samples = [];
  for (let i = 0; i < 6; i++) {
    samples.push(await page.evaluate(() => { const ui=GLT.ui, ps=ui.platesSystem, sp=ps.seaPlates, cam=ps.camera, cv=ui.dom.canvas, r=cv.getBoundingClientRect(); const opp=ui.getMyPlatesIndices().oppPlate; const w=sp.cellToWorld(opp,3,5).project(cam); return { t: performance.now()|0, pos: cam.position.toArray().map(v=>+v.toFixed(3)), px: [+(r.left+(w.x+1)/2*r.width).toFixed(1), +(r.top+(1-w.y)/2*r.height).toFixed(1)] }; }));
    await page.waitForTimeout(400);
  }
  console.log(mode, JSON.stringify(samples));
}
await browser.close();
