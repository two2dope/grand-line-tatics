// Critic probe: panorama/duas_aguas clicks where the target is re-projected AFTER hover settles (lift on), plus the
// stale-projection delta, to separate a real pick error from a moving-plate artifact. usage: node ... [8|12] [N]
import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath, pathToFileURL } from 'node:url'; import { chromium } from 'playwright';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const boardId = process.argv[2] === '8' ? 'escaramuca' : 'grand_line'; const N = Number(process.argv[3] || 12);
const browser = await chromium.launch({ headless: true, args: ['--use-angle=swiftshader', '--use-gl=angle', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl', '--hide-scrollbars', '--allow-file-access-from-files'] });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
await ctx.route(/cdnjs\.cloudflare\.com\/ajax\/libs\/three\.js\/r128\/three\.min\.js/, (r) => r.fulfill({ status: 200, contentType: 'application/javascript', body: fs.readFileSync(path.join(ROOT, 'tools/vendor/three.min.js')) }));
await ctx.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
const page = await ctx.newPage(); const errors = [];
page.on('pageerror', (e) => errors.push(e.message)); page.on('console', (m) => { if (m.type() === 'error' && !/fonts|ERR_FAILED/.test(m.text())) errors.push(m.text()); });
await page.goto(pathToFileURL(path.join(ROOT, 'index.html')).href, { waitUntil: 'load' });
await page.waitForFunction(() => window.GLT && GLT.ui && GLT.ui.dom && GLT.ui.dom.canvas, null, { timeout: 30000 });
await page.evaluate(async (b) => { const s=(ms)=>new Promise(r=>setTimeout(r,ms)); const ui=GLT.ui; Object.assign(ui.matchConfig,{boardId:b,mode:'classico',difficulty:'grumete',seriesLength:1,turnTimer:0}); ui.animSpeed=4; ui.autoPlacePlayerFleet(); ui.startMatchWithCoinToss(); for(let i=0;i<100&&ui.gamePhase!=='BATTLE';i++) await s(100); }, boardId);
let seed = Number(process.env.SEED||4242); const rnd = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 4294967296);
const proj = (a) => page.evaluate(({ r, c, ox, oz }) => { const ui=GLT.ui, ps=ui.platesSystem, sp=ps.seaPlates, cam=ps.camera, cv=ui.dom.canvas, R=cv.getBoundingClientRect(); const opp=ui.getMyPlatesIndices().oppPlate; const w=sp.cellToWorld(opp,r,c); w.x+=ox*sp.cellSize; w.z+=oz*sp.cellSize; const y=w.y; const p=w.project(cam); return { x:R.left+(p.x+1)/2*R.width, y:R.top+(1-p.y)/2*R.height, wy:+y.toFixed(3) }; }, a);
const out = [];
for (let k = 0; k < N; k++) {
  await page.waitForFunction(() => { const u = GLT.ui; return u.gamePhase !== 'BATTLE' || (u.matchState.turn === 0 && !u.shotInFlight); }, null, { timeout: 120000, polling: 200 });
  if (await page.evaluate(() => GLT.ui.gamePhase !== 'BATTLE')) break;
  const mode = 'panorama';
  await page.evaluate((p) => GLT.ui.setCameraPreset(p), mode);
  await page.waitForFunction(() => { const c = GLT.ui.platesSystem.cameraController; return !c || !c.transitioning; }, null, { timeout: 60000, polling: 100 });
  await page.waitForTimeout(500);
  const cand = await page.evaluate(() => { const ui=GLT.ui, n=ui.platesSystem.seaPlates.boardSize, t=ui.matchState.players[1].shotsTaken, f=[]; for(let r=0;r<n;r++) for(let c=0;c<n;c++) if(!t[r+','+c]) f.push([r,c]); return f; });
  const [r, c] = cand[Math.floor(rnd() * cand.length)]; const ox = (rnd() - 0.5) * 0.7, oz = (rnd() - 0.5) * 0.7;
  const p0 = await proj({ r, c, ox, oz });
  await page.mouse.move(p0.x, p0.y);
  const p1 = await proj({ r, c, ox, oz });
  
  const p2 = await proj({ r, c, ox, oz });
  await page.mouse.click(p2.x, p2.y); await page.waitForTimeout(200);
  const sel = await page.evaluate(() => GLT.ui.selectedAimCell);
  const before = await page.evaluate(() => Object.keys(GLT.ui.matchState.players[1].shotsTaken).length);
  await page.evaluate(() => { const b = document.getElementById('btn-fire-shot'); if (b && !b.disabled) b.click(); else document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' })); });
  await page.waitForFunction((n) => Object.keys(GLT.ui.matchState.players[1].shotsTaken).length > n || GLT.ui.gamePhase !== 'BATTLE', before, { timeout: 30000, polling: 100 });
  out.push({ k, mode, cell: r + ',' + c, off: [ox.toFixed(2), oz.toFixed(2)], sel: sel && sel.r + ',' + sel.c, ok: !!sel && sel.r === r && sel.c === c, staleShiftPx: Math.hypot(p1.x - p0.x, p1.y - p0.y).toFixed(1), settleShiftPx: Math.hypot(p2.x - p1.x, p2.y - p1.y).toFixed(1), wy: [p0.wy, p1.wy, p2.wy] });
  console.log(JSON.stringify(out[out.length - 1]));
}
console.log('fails', out.filter((o) => !o.ok).length, '/', out.length, 'errors', errors.length);
await browser.close();
