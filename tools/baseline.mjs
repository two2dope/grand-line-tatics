#!/usr/bin/env node
// Baseline screenshots of the game (pilot look) for later blind comparisons.
//   node tools/baseline.mjs [--html index.html] [--out shots/baseline] [--only setup,battle,...]
// Drives the real UI through GLT.ui (same entry points the E2E suite uses). Headless Chromium + SwiftShader WebGL,
// three.js r128 served from tools/vendor. Writes PNGs and shots/baseline/_report.json (console errors per scene).
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf('--' + k); return i >= 0 ? argv[i + 1] : d; };
const html = path.resolve(ROOT, opt('html', 'index.html'));
const outDir = path.resolve(ROOT, opt('out', 'shots/baseline'));
const only = opt('only', '') ? opt('only', '').split(',') : null;
fs.mkdirSync(outDir, { recursive: true });
const vendorThree = path.join(ROOT, 'tools', 'vendor', 'three.min.js');

const browser = await chromium.launch({
  headless: true,
  args: ['--use-angle=swiftshader', '--use-gl=angle', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl', '--disable-dev-shm-usage', '--hide-scrollbars', '--allow-file-access-from-files'],
});
const report = [];

async function open(viewport, name) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: 1, hasTouch: viewport.width < 900 });
  await ctx.route(/cdnjs\.cloudflare\.com\/ajax\/libs\/three\.js\/r128\/three\.min\.js/, (r) => r.fulfill({ status: 200, contentType: 'application/javascript', body: fs.readFileSync(vendorThree) }));
  await ctx.route(/fonts\.(googleapis|gstatic)\.com/, async (r) => {
    try { const res = await r.fetch({ timeout: 6000 }); await r.fulfill({ response: res }); }
    catch { if (/googleapis/.test(r.request().url())) await r.fulfill({ status: 200, contentType: 'text/css', body: '/* offline */' }); else await r.abort(); }
  });
  // GLT_FORCE_GLB only mattered for the pilot's glTF ships (shots/baseline). Since stage 2 the ships are our voxel
  // models and nothing is loaded, so the flag is a no-op kept for re-running the old baseline from the pilot.
  await ctx.addInitScript(() => { window.GLT_FORCE_GLB = true; });
  const page = await ctx.newPage();
  const rec = { name, errors: [], pageErrors: [] };
  page.on('console', (m) => { if (m.type() === 'error' && !/fonts\.(googleapis|gstatic)/.test(m.text() + (m.location().url || ''))) rec.errors.push(m.text()); });
  page.on('pageerror', (e) => rec.pageErrors.push(e.message));
  await page.goto(pathToFileURL(html).href, { waitUntil: 'load' });
  await page.waitForFunction(() => window.GLT && GLT.ui && GLT.ui.dom && GLT.ui.dom.canvas, null, { timeout: 30000 });
  await page.waitForTimeout(1500);
  report.push(rec);
  return { ctx, page, rec };
}

// 120 s: SwiftShader compiles every shader on the first frame, which can exceed Playwright's 30 s default.
const shot = async (page, name) => { await page.screenshot({ path: path.join(outDir, name + '.png'), timeout: 120000 }); console.error('shot', name); };

// Camera preset + wait for its tween to end. The game clamps dt to 0.1 s, so under SwiftShader (a few fps) a fixed
// 1.5 s wait could shoot mid-tween and show the previous preset.
const setCam = async (page, preset, settleMs) => {
  await page.evaluate((p) => GLT.ui.setCameraPreset(p), preset);
  await page.waitForFunction(() => { const ps = GLT.ui.platesSystem; const c = ps && ps.cameraController; return !c || !c.transitioning; }, null, { timeout: 60000, polling: 100 });
  await page.waitForTimeout(settleMs);
};

// In-page helpers --------------------------------------------------------------------------------------------
const startBattle = (cfg) => `(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  Object.assign(GLT.ui.matchConfig, ${JSON.stringify(cfg)});
  GLT.ui.matchConfig.seriesLength = 1;
  // what the sea selector does in the real UI (the stage-1 baseline skipped it, so its night/storm looked like day)
  const ps = GLT.ui.platesSystem, sea = GLT.ui.matchConfig.sea;
  if (ps && sea && GLT.ui.seaToEnvProfile) ps.setEnvironment(GLT.ui.seaToEnvProfile(sea), 0, sea);
  GLT.ui.animSpeed = 4;
  GLT.ui.autoPlacePlayerFleet();
  GLT.ui.startMatchWithCoinToss();
  for (let i = 0; i < 60 && GLT.ui.gamePhase !== 'BATTLE'; i++) await sleep(100);
  return GLT.ui.gamePhase;
})()`;

// Fire at: 2 misses, then every cell of the first enemy ship (=> sunk), then 1 cell of the second ship (a hit).
const playHitsAndSunk = `(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const ui = GLT.ui, N = ui.getActiveBoardSize ? ui.getActiveBoardSize() : 8;
  const fleet = ui.matchState.players[1].fleet;
  const occ = new Set(); fleet.forEach((s) => s.cells.forEach((c) => occ.add(c.r + ',' + c.c)));
  const plan = [];
  for (let r = 0; r < N && plan.length < 2; r++) for (let c = 0; c < N && plan.length < 2; c++) if (!occ.has(r + ',' + c)) plan.push({ r, c });
  fleet[0].cells.forEach((c) => plan.push({ r: c.r, c: c.c }));
  plan.push({ r: fleet[1].cells[0].r, c: fleet[1].cells[0].c });
  let i = 0, guard = 0;
  while (i < plan.length && ui.gamePhase === 'BATTLE' && guard++ < 400) {
    if (ui.matchState.turn === 0 && !ui.shotInFlight && !ui.isCpuThinking) {
      const mv = plan[i++];
      if (!ui.matchState.players[1].shotsTaken[mv.r + ',' + mv.c]) { ui.selectAimCoordinate(mv.r, mv.c); ui.confirmFireShot(); }
    }
    await sleep(80);
  }
  for (let k = 0; k < 120 && (ui.shotInFlight || ui.isCpuThinking || ui.matchState.turn !== 0); k++) await sleep(80);
  await sleep(900);
  return { sunk: ui.matchState.players[1].fleet.filter((s) => s.isSunk).length, ghosts: ui.enemyGhostShips ? ui.enemyGhostShips.length : -1, phase: ui.gamePhase };
})()`;

const playToCeremony = `(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const ui = GLT.ui, N = ui.getActiveBoardSize ? ui.getActiveBoardSize() : 8;
  const plan = []; ui.matchState.players[1].fleet.forEach((s) => s.cells.forEach((c) => plan.push({ r: c.r, c: c.c })));
  let i = 0, guard = 0;
  while (ui.gamePhase === 'BATTLE' && guard++ < 600) {
    if (ui.matchState.turn === 0 && !ui.shotInFlight && !ui.isCpuThinking && i < plan.length) {
      const mv = plan[i++];
      if (!ui.matchState.players[1].shotsTaken[mv.r + ',' + mv.c]) { ui.selectAimCoordinate(mv.r, mv.c); ui.confirmFireShot(); }
    }
    await sleep(80);
  }
  for (let k = 0; k < 80 && ui.gamePhase !== 'CEREMONY'; k++) await sleep(100);
  await sleep(3500);
  return ui.gamePhase;
})()`;

const want = (n) => !only || only.includes(n);
const desktop = { width: 1280, height: 720 };
const phone = { width: 390, height: 844 };
const tablet = { width: 1024, height: 768 };
const BATTLE = { format: 'escaramuca', mode: 'tatico', difficulty: 'capitao' };

try {
  if (want('setup')) {
    const { ctx, page } = await open(desktop, 'setup');
    await shot(page, 'setup-desktop');
    await ctx.close();
  }
  if (want('battle')) {
    const { ctx, page, rec } = await open(desktop, 'battle');
    rec.phase = await page.evaluate(startBattle({ ...BATTLE, sea: 'mar_calmo' }));
    rec.play = await page.evaluate(playHitsAndSunk);
    await setCam(page, 'duas_aguas', 1200);
    await shot(page, 'battle-hits-sunk-day');
    await setCam(page, 'mira_inimiga', 1200);
    await shot(page, 'battle-hits-sunk-day-mira');
    await ctx.close();
  }
  for (const [name, sea] of [['night', 'novo_mundo'], ['storm', 'tempestade']]) {
    if (!want(name)) continue;
    const { ctx, page, rec } = await open(desktop, name);
    rec.phase = await page.evaluate(startBattle({ ...BATTLE, sea }));
    rec.play = await page.evaluate(playHitsAndSunk);
    await setCam(page, 'duas_aguas', 1500);
    await shot(page, `battle-${name}`);
    await ctx.close();
  }
  if (want('scenes')) {
    // Scene harness (scripts/scene-preview.html): the pilot's backdrop/plates at fixed weather, no UI chrome.
    const ctx = await browser.newContext({ viewport: desktop, deviceScaleFactor: 1 });
    await ctx.route(/cdnjs\.cloudflare\.com\/ajax\/libs\/three\.js\/r128\/three\.min\.js/, (r) => r.fulfill({ status: 200, contentType: 'application/javascript', body: fs.readFileSync(vendorThree) }));
    await ctx.addInitScript(() => { window.GLT_FORCE_GLB = true; });
    const page = await ctx.newPage();
    const rec = { name: 'scenes', errors: [], pageErrors: [] };
    page.on('console', (m) => { if (m.type() === 'error' && !/fonts\./.test(m.text())) rec.errors.push(m.text()); });
    page.on('pageerror', (e) => rec.pageErrors.push(e.message));
    page.on('requestfailed', (r) => rec.errors.push('requestfailed ' + r.url()));
    await page.goto(pathToFileURL(path.join(ROOT, 'scripts', 'scene-preview.html')).href, { waitUntil: 'commit', timeout: 120000 });
    await page.waitForFunction(() => !!window.HARNESS, null, { timeout: 240000 });
    const scenes = [
      ['scene-day', { env: 'day', camera: 'duas_aguas', lift: true, fireShot: true, steps: 20 }],
      ['scene-night', { env: 'night', camera: 'minhas_aguas', lift: true, steps: 25 }],
      ['scene-storm', { env: 'storm', camera: 'panorama', lift: false, steps: 25 }],
      ['scene-ceremony', { env: 'dusk', camera: 'duas_aguas', lift: false, ceremony: true, steps: 15 }],
    ];
    for (const [n, cfg] of scenes) {
      await page.evaluate((c) => window.HARNESS.setScenario(c), cfg);
      await page.waitForTimeout(400);
      await shot(page, n);
    }
    report.push(rec);
    await ctx.close();
  }
  if (want('ceremony')) {
    const { ctx, page, rec } = await open(desktop, 'ceremony');
    rec.phase = await page.evaluate(startBattle({ ...BATTLE, sea: 'mar_calmo' }));
    rec.final = await page.evaluate(playToCeremony);
    await shot(page, 'ceremony-wanted');
    await ctx.close();
  }
  if (want('phone')) {
    const { ctx, page, rec } = await open(phone, 'phone');
    await shot(page, 'phone-setup');
    rec.phase = await page.evaluate(startBattle({ ...BATTLE, sea: 'mar_calmo' }));
    rec.play = await page.evaluate(playHitsAndSunk);
    await page.waitForTimeout(800);
    await shot(page, 'phone-battle');
    await ctx.close();
  }
  if (want('tablet')) {
    const { ctx, page, rec } = await open(tablet, 'tablet');
    rec.phase = await page.evaluate(startBattle({ ...BATTLE, sea: 'grand_line' }));
    rec.play = await page.evaluate(playHitsAndSunk);
    await page.waitForTimeout(800);
    await shot(page, 'tablet-battle');
    await page.evaluate(() => GLT.ui.toggleSidePanelCollapse && GLT.ui.toggleSidePanelCollapse(true));
    await page.waitForTimeout(900);
    await shot(page, 'tablet-battle-panel-collapsed');
    await ctx.close();
  }
} finally {
  const rp = path.join(outDir, '_report.json');
  let prev = []; try { prev = JSON.parse(fs.readFileSync(rp, 'utf8')); } catch {}
  const merged = prev.filter((p) => !report.some((r) => r.name === p.name)).concat(report);
  fs.writeFileSync(rp, JSON.stringify(merged, null, 2));
  await browser.close();
}
const bad = report.filter((r) => r.errors.length || r.pageErrors.length);
console.error(bad.length ? 'baseline: console errors in ' + bad.map((b) => b.name).join(', ') : 'baseline: OK, zero console errors');
process.exit(bad.length ? 1 : 0);
