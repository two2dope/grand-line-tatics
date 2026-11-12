// Critic probe: find the object behind "Cannot read properties of null (reading 'isInterleavedBufferAttribute')".
import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath, pathToFileURL } from 'node:url'; import { chromium } from 'playwright';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const browser = await chromium.launch({ headless: true, args: ['--use-angle=swiftshader', '--use-gl=angle', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl', '--hide-scrollbars', '--allow-file-access-from-files'] });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
await ctx.route(/three\.min\.js/, (r) => r.fulfill({ status: 200, contentType: 'application/javascript', body: fs.readFileSync(path.join(ROOT, 'tools/vendor/three.min.js')) }));
await ctx.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
const page = await ctx.newPage();
const errs = []; page.on('pageerror', (e) => errs.push(e.message));
page.on('console', (m) => { if (/ERRPROBE/.test(m.text())) console.log(m.text()); });
await page.addInitScript(() => {
  // wrap WebGLRenderer.renderBufferDirect once THREE exists, to name the object that throws
  const iv = setInterval(() => {
    if (!window.THREE || !THREE.WebGLRenderer || THREE.WebGLRenderer.__w) return;
    const R = THREE.WebGLRenderer; THREE.WebGLRenderer = function (...a) { R.apply(this, a); const o = this.renderBufferDirect; const seen = new Set();
      this.renderBufferDirect = function (cam, scene, geo, mat, obj, grp) { try { return o.call(this, cam, scene, geo, mat, obj, grp); } catch (e) {
        const ch = []; for (let p = obj; p && ch.length < 6; p = p.parent) ch.push(p.name || p.type);
        const k = ch.join('<'); if (!seen.has(k)) { seen.add(k); console.log('ERRPROBE ' + e.message + ' | ' + k + ' | inst=' + !!obj.isInstancedMesh + ' instColor=' + (obj.instanceColor === null ? 'null' : typeof obj.instanceColor) + ' mat=' + mat.type + ' vc=' + mat.vertexColors); } throw e; } }; };
    THREE.WebGLRenderer.prototype = R.prototype; THREE.WebGLRenderer.__w = true; clearInterval(iv);
  }, 0);
});
await page.addInitScript((e) => { globalThis.__MODE = e.m; globalThis.__HOVER = e.h; }, { m: process.env.MODE || 'cycle', h: !!process.env.HOVER });
await page.goto(pathToFileURL(path.join(ROOT, 'index.html')).href, { waitUntil: 'load' });
await page.waitForFunction(() => window.GLT && GLT.ui && GLT.ui.dom && GLT.ui.dom.canvas, null, { timeout: 30000 });
await page.evaluate(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms)); const ui = GLT.ui;
  Object.assign(ui.matchConfig, { boardId: 'escaramuca', mode: 'classico', difficulty: 'grumete', seriesLength: 1 });
  ui.animSpeed = 4; ui.autoPlacePlayerFleet(); ui.startMatchWithCoinToss();
  for (let i = 0; i < 100 && ui.gamePhase !== 'BATTLE'; i++) await sleep(100);
  const n = 8;
  for (let k = 0; k < 14 && ui.gamePhase === 'BATTLE'; k++) {
    for (let i = 0; i < 300 && !(ui.matchState.turn === 0 && !ui.shotInFlight); i++) await sleep(100);
    const t = ui.matchState.players[1].shotsTaken; let r, c; do { r = (k * 3 + 1) % n; c = (k * 5 + Object.keys(t).length) % n; } while (false);
    for (let q = 0; q < 64; q++) { const rr = (r + Math.floor(q / n)) % n, cc = (c + q) % n; if (!t[rr + ',' + cc]) { r = rr; c = cc; break; } }
    const modes = ['duas_aguas', 'mira_inimiga', 'panorama', 'minhas_aguas']; const md = (globalThis.__MODE || 'cycle');
    ui.setCameraPreset(md === 'cycle' ? modes[k % 3] : md); for (let i = 0; i < 100 && ui.platesSystem.cameraController.transitioning; i++) await sleep(100);
    if (globalThis.__HOVER) { const ps = ui.platesSystem, cv = ui.dom.canvas, rect = cv.getBoundingClientRect(); const p = ps.seaPlates.cellToWorld(ui.getMyPlatesIndices().oppPlate, r, c).project(ps.camera);
      cv.dispatchEvent(new MouseEvent('mousemove', { clientX: rect.left + (p.x + 1) / 2 * rect.width, clientY: rect.top + (1 - p.y) / 2 * rect.height, bubbles: true })); await sleep(300); }
    console.log('ERRPROBE shot ' + k + ' ' + ui.platesSystem.cameraController.currentPresetName);
    ui.selectAimCoordinate(r, c); ui.confirmFireShot(); await sleep(1500);
  }
});
console.log('pageerrors', errs.length);
await browser.close();
