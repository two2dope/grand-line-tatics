// Critic probe (stage 3, sea-scene). Independent of the builder's picking.mjs.
//  1. 10 real Playwright mouse clicks (page.mouse) on random enemy cells, rotating through the 4 camera presets and with a
//     random offset inside the cell, then the real FOGO button; the cell recorded in shotsTaken must equal the cell clicked.
//  2. Camera azimuth sweep, 8 steps of 45 deg in 'duas_aguas' with lift ON: ray from the camera to every cell centre of both
//     plates against every visible mesh in the game scene; any non-plate mesh hit closer than the cell = occlusion.
// usage: node tests/critic/s3-critic.mjs [8|12]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from 'playwright';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const OUT = path.join(ROOT, 'shots', 'critic', 's3-sweep');
fs.mkdirSync(OUT, { recursive: true });
const boardId = process.argv[2] === '12' ? 'grand_line' : 'escaramuca';
const vendorThree = path.join(ROOT, 'tools', 'vendor', 'three.min.js');
const browser = await chromium.launch({ headless: true, args: ['--use-angle=swiftshader', '--use-gl=angle', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl', '--hide-scrollbars', '--allow-file-access-from-files'] });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
await ctx.route(/cdnjs\.cloudflare\.com\/ajax\/libs\/three\.js\/r128\/three\.min\.js/, (r) => r.fulfill({ status: 200, contentType: 'application/javascript', body: fs.readFileSync(vendorThree) }));
await ctx.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
const page = await ctx.newPage();
const errors = [];
let phase = 'load';
page.on('pageerror', (e) => errors.push(phase + ' pageerror: ' + e.message + ' @ ' + String(e.stack || '').split(/\n/).slice(1, 4).join(' / ')));
page.on('console', (m) => { if (m.type() === 'error' && !/fonts\.(googleapis|gstatic)|ERR_FAILED/.test(m.text())) errors.push('console: ' + m.text()); });
await page.goto(pathToFileURL(path.join(ROOT, 'index.html')).href, { waitUntil: 'load' });
await page.waitForFunction(() => window.GLT && GLT.ui && GLT.ui.dom && GLT.ui.dom.canvas, null, { timeout: 30000 });
await page.evaluate(async (boardId) => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const ui = GLT.ui;
  Object.assign(ui.matchConfig, { boardId, mode: 'classico', difficulty: 'grumete', seriesLength: 1 });
  ui.animSpeed = 4; ui.autoPlacePlayerFleet(); ui.startMatchWithCoinToss();
  for (let i = 0; i < 100 && ui.gamePhase !== 'BATTLE'; i++) await sleep(100);
}, boardId);

// ---------------------------------------------------------------- 1. clicks
let seed = 12345;
const rnd = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 4294967296);
const MODES = ['duas_aguas', 'mira_inimiga', 'panorama', 'duas_aguas'];
const clicks = [];
phase = 'clicks';
for (let k = 0; k < 10; k++) {
  await page.waitForFunction(() => { const u = GLT.ui; return u.gamePhase !== 'BATTLE' || (u.matchState && u.matchState.turn === 0 && !u.shotInFlight); }, null, { timeout: 90000, polling: 200 });
  if (await page.evaluate(() => GLT.ui.gamePhase !== 'BATTLE')) { clicks.push({ k, note: 'battle ended' }); break; }
  const mode = MODES[k % MODES.length];
  await page.evaluate((p) => GLT.ui.setCameraPreset(p), mode);
  await page.waitForFunction(() => { const c = GLT.ui.platesSystem.cameraController; return !c || !c.transitioning; }, null, { timeout: 60000, polling: 100 });
  await page.waitForTimeout(500);
  const ox = (rnd() - 0.5) * 0.7, oz = (rnd() - 0.5) * 0.7;
  const target = await page.evaluate(({ ox, oz, pick }) => {
    const ui = GLT.ui, ps = ui.platesSystem, sp = ps.seaPlates, cam = ps.camera, cv = ui.dom.canvas;
    const rect = cv.getBoundingClientRect(), n = sp.boardSize, opp = ui.getMyPlatesIndices().oppPlate;
    const taken = ui.matchState.players[1].shotsTaken;
    const free = [];
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (!taken[r + ',' + c]) {
      const w = sp.cellToWorld(opp, r, c); w.x += ox * sp.cellSize; w.z += oz * sp.cellSize;
      const p = w.clone().project(cam);
      const x = rect.left + (p.x + 1) / 2 * rect.width, y = rect.top + (1 - p.y) / 2 * rect.height;
      const el = document.elementFromPoint(x, y);
      free.push({ r, c, x, y, onCanvas: el === cv });
    }
    const vis = free.filter((f) => f.onCanvas);
    const covered = free.length - vis.length;
    const f = vis[Math.floor(pick * vis.length)];
    return f ? Object.assign({ covered, freeN: free.length }, f) : { covered, freeN: free.length };
  }, { ox, oz, pick: rnd() });
  if (target.r == null) { clicks.push({ k, mode, note: 'no visible free cell', target }); continue; }
  await page.mouse.move(target.x, target.y);
  await page.mouse.click(target.x, target.y);
  await page.waitForTimeout(150);
  const sel = await page.evaluate(() => GLT.ui.selectedAimCell);
  const before = await page.evaluate(() => Object.keys(GLT.ui.matchState.players[1].shotsTaken));
  const fireVisible = await page.evaluate(() => { const b = document.getElementById('btn-fire-shot'); return !!(b && b.offsetParent && !b.disabled); });
  // the side panel re-renders every tick, so Playwright's actionability wait chases a detached node: dispatch the DOM click
  if (fireVisible) await page.evaluate(() => document.getElementById('btn-fire-shot').click()); else await page.keyboard.press('Enter');
  await page.waitForFunction((n) => Object.keys(GLT.ui.matchState.players[1].shotsTaken).length > n || GLT.ui.gamePhase !== 'BATTLE', before.length, { timeout: 30000, polling: 100 });
  const after = await page.evaluate(() => Object.keys(GLT.ui.matchState.players[1].shotsTaken));
  const fired = after.filter((x) => !before.includes(x));
  const ok = sel && sel.r === target.r && sel.c === target.c && fired.length >= 1 && fired[0] === target.r + ',' + target.c;
  clicks.push({ k, mode, cell: target.r + ',' + target.c, offset: [ox.toFixed(2), oz.toFixed(2)], selected: sel && sel.r + ',' + sel.c, fired, ok, covered: target.covered, via: fireVisible ? 'FOGO btn' : 'Enter' });
}
console.log('CLICKS');
clicks.forEach((c) => console.log(JSON.stringify(c)));

// ---------------------------------------------------------------- 2. azimuth sweep, lift on
await page.evaluate(() => GLT.ui.setCameraPreset('duas_aguas'));
await page.waitForFunction(() => !GLT.ui.platesSystem.cameraController.transitioning, null, { timeout: 60000, polling: 100 });
const liftOn = await page.evaluate(() => { const ps = GLT.ui.platesSystem; return GLT.sea && GLT.sea.backdrop ? GLT.sea.backdrop.enabled ? GLT.sea.backdrop.enabled() : 'n/a' : 'n/a'; });
const sweep = [];
phase = 'sweep';
const WAIT = +(process.env.WAIT || 2500);
for (let k = 0; k < 8; k++) {
  if (k > 0) await page.evaluate(() => GLT.ui.platesSystem.cameraController.orbit(Math.PI / 4, 0));
  await page.waitForTimeout(WAIT); // lift runs on real time, ~0.85 s
  const res = await page.evaluate(() => {
    const ui = GLT.ui, ps = ui.platesSystem, sp = ps.seaPlates, cam = ps.camera, scene = ui.scene;
    scene.updateMatrixWorld(true);
    const n = sp.boardSize, rc = new THREE.Raycaster();
    const meshes = [];
    scene.traverseVisible((m) => { if (m.isMesh) meshes.push(m); });
    const underPlates = (o) => { for (let p = o; p; p = p.parent) if (p.name === 'world-plates') return true; return false; };
    const chainOf = (o) => { const ch = []; for (let p = o; p && ch.length < 5; p = p.parent) ch.push(p.name || p.type); return ch.join('<'); };
    const cand = meshes.filter((m) => !underPlates(m));
    const occ = {}; let nOcc = 0, nOut = 0;
    for (const pi of [0, 1]) for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
      const w = sp.cellToWorld(pi, r, c);
      const p = w.clone().project(cam);
      if (Math.abs(p.x) > 1 || Math.abs(p.y) > 1) { nOut++; continue; }
      rc.setFromCamera(new THREE.Vector2(p.x, p.y), cam);
      const d = rc.ray.origin.distanceTo(w);
      const hits = rc.intersectObjects(cand, false).filter((h) => h.distance < d * 0.995);
      if (hits.length) { nOcc++; const key = chainOf(hits[0].object); (occ[key] = occ[key] || []).push(pi + ':' + r + ',' + c); }
    }
    const g = ps.cameraController;
    return { az: +(g.azimuth * 180 / Math.PI).toFixed(1), el: +(g.elevation * 180 / Math.PI).toFixed(1), nOcc, nOut, occ: Object.fromEntries(Object.entries(occ).map(([k, v]) => [k, v.length + ' ' + v.slice(0, 6).join(' ')])) };
  });
  await page.screenshot({ path: path.join(OUT, `${boardId}-az${k}.png` ) });
  sweep.push(res);
  console.log('SWEEP', JSON.stringify(res));
}
console.log('lift', liftOn, 'errors', errors.length);
errors.slice(0, 6).forEach((e) => console.log('  ', e));
await browser.close();
