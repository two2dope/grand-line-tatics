// Critic probe (stage 2 r2): spawn a sunk ghost for every enemy ship, measure each ghost's box against its cells,
// count draw calls, and shoot the enemy board in Mira Inimiga. usage: node tests/critic/ghost-fit.mjs [outDir]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from 'playwright';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const outDir = path.resolve(ROOT, process.argv[2] || 'shots/critic/ghost-fit');
fs.mkdirSync(outDir, { recursive: true });
const vendorThree = path.join(ROOT, 'tools', 'vendor', 'three.min.js');
const browser = await chromium.launch({ headless: true, args: ['--use-angle=swiftshader', '--use-gl=angle', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl', '--hide-scrollbars', '--allow-file-access-from-files'] });
const errs = [];
const out = {};
for (const enemy of ['marines', 'heart', 'blackbeard']) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
  await ctx.route(/cdnjs\.cloudflare\.com\/ajax\/libs\/three\.js\/r128\/three\.min\.js/, (r) => r.fulfill({ status: 200, contentType: 'application/javascript', body: fs.readFileSync(vendorThree) }));
  await ctx.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
  const page = await ctx.newPage();
  page.on('console', (m) => { if (m.type() === 'error' && !/fonts|ERR_FAILED/.test(m.text())) errs.push(enemy + ': ' + m.text()); });
  page.on('pageerror', (e) => errs.push(enemy + ' pageerror: ' + e.message));
  await page.goto(pathToFileURL(path.join(ROOT, 'index.html')).href, { waitUntil: 'load' });
  await page.waitForFunction(() => window.GLT && GLT.ui && GLT.ui.dom && GLT.ui.dom.canvas, null, { timeout: 30000 });
  await page.waitForTimeout(1000);
  const info = await page.evaluate(async (enemy) => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const ui = GLT.ui;
    Object.assign(ui.matchConfig, { format: 'escaramuca', mode: 'tatico', difficulty: 'capitao', enemyCrewId: enemy, seriesLength: 1 });
    ui.animSpeed = 4; ui.autoPlacePlayerFleet(); ui.startMatchWithCoinToss();
    for (let i = 0; i < 60 && ui.gamePhase !== 'BATTLE'; i++) await sleep(100);
    const fleet = ui.matchState.players[1].fleet;
    fleet.forEach((s) => ui.createEnemyGhostShip(s.id, s.cells));
    const sp = ui.platesSystem.seaPlates, plates = ui.getMyPlatesIndices();
    const res = [];
    ui.enemyGhostShipMeshes.forEach((g, i) => {
      g.updateMatrixWorld(true);
      const b = new THREE.Box3().setFromObject(g);
      const s = fleet[i]; const cs = g.userData.cellSize || 2;
      const xs = s.cells.map((c) => sp.cellToWorld(plates.oppPlate, c.r, c.c));
      const fx0 = Math.min(...xs.map((p) => p.x)) - cs / 2, fx1 = Math.max(...xs.map((p) => p.x)) + cs / 2;
      const fz0 = Math.min(...xs.map((p) => p.z)) - cs / 2, fz1 = Math.max(...xs.map((p) => p.z)) + cs / 2;
      res.push({ id: s.id, len: s.cells.length, cs, overflowCells: [(fx0 - b.min.x) / cs, (b.max.x - fx1) / cs, (fz0 - b.min.z) / cs, (b.max.z - fz1) / cs].map((v) => +v.toFixed(2)), h: +((b.max.y - b.min.y) / cs).toFixed(2) });
    });
    return { phase: ui.gamePhase, ghosts: res };
  }, enemy);
  for (const cam of ['duas_aguas', 'mira_inimiga']) {
    await page.evaluate((p) => GLT.ui.setCameraPreset(p), cam);
    await page.waitForFunction(() => { const c = GLT.ui.platesSystem.cameraController; return !c || !c.transitioning; }, null, { timeout: 60000, polling: 100 });
    await page.waitForTimeout(1200);
    await page.screenshot({ path: path.join(outDir, `${enemy}-${cam}.png`), clip: { x: 0, y: 50, width: 860, height: 620 }, timeout: 120000 });
  }
  info.calls = await page.evaluate(async () => { const R = GLT.ui.renderer; R.info.autoReset = false; R.info.reset(); await new Promise((r) => requestAnimationFrame(r)); R.info.reset(); await new Promise((r) => requestAnimationFrame(r)); const c = R.info.render.calls; R.info.autoReset = true; return c; });
  out[enemy] = info;
  await ctx.close();
}
await browser.close();
fs.writeFileSync(path.join(outDir, '_ghosts.json'), JSON.stringify({ out, errs }, null, 2));
for (const [k, v] of Object.entries(out)) console.log(k, v.phase, 'calls', v.calls, JSON.stringify(v.ghosts));
console.log('errors', JSON.stringify(errs));
