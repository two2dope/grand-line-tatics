// Critic probe: projection of cell (3,5) right when cameraController.transitioning turns false after mira->panorama,
// vs 0.15/0.5/1/3 s later; plus panorama cell width in px (12x12).
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
const P = () => page.evaluate(() => { const ui=GLT.ui, ps=ui.platesSystem, sp=ps.seaPlates, cam=ps.camera, cv=ui.dom.canvas, R=cv.getBoundingClientRect(); const opp=ui.getMyPlatesIndices().oppPlate; const pr=(r,c,dx)=>{const w=sp.cellToWorld(opp,r,c); w.x+=dx*sp.cellSize; const p=w.project(cam); return [R.left+(p.x+1)/2*R.width, R.top+(1-p.y)/2*R.height];}; const a=pr(3,5,0), b=pr(3,5,0.5), m=pr(3,5,-0.5); return { c:a.map(v=>+v.toFixed(1)), cellPx:+(Math.hypot(b[0]-m[0],b[1]-m[1])).toFixed(1) }; });
for (let rep = 0; rep < 2; rep++) {
  await page.evaluate(() => GLT.ui.setCameraPreset('mira_inimiga'));
  await page.waitForFunction(() => !GLT.ui.platesSystem.cameraController.transitioning, null, { timeout: 60000, polling: 100 });
  await page.waitForTimeout(1000);
  await page.evaluate(() => GLT.ui.setCameraPreset('panorama'));
  await page.waitForFunction(() => !GLT.ui.platesSystem.cameraController.transitioning, null, { timeout: 60000, polling: 50 });
  const s = [['t0', await P()]];
  for (const d of [150, 350, 500, 2000]) { await page.waitForTimeout(d); s.push(['+' + d, await P()]); }
  console.log(JSON.stringify(s));
}
await browser.close();
