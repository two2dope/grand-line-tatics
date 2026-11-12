// Stage 4 (fx) probe: the same shot moments in our build and in the pilot, at exact game times.
// The game's update loop is paused (GLT.ui.isPaused) and stepped by hand, so SwiftShader's low frame rate does not
// change what a frame shows. The CPU never plays on its own: its shots are forced onto a chosen cell.
//   node tests/critic/s4-fx-moments.mjs [ours|pilot] [--only miss,hit,sink,cpu,tech,ceremony]
// Writes shots/critic/s4-fx/<label>/*.png and _report.json (console + page errors). The pilot is only opened (file://),
// never written to.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from 'playwright';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const label = process.argv[2] === 'pilot' ? 'pilot' : 'ours';
const onlyArg = process.argv.indexOf('--only');
const only = onlyArg > 0 ? process.argv[onlyArg + 1].split(',') : null;
const want = (k) => !only || only.includes(k);
const html = label === 'pilot' ? path.resolve(ROOT, '..', 'grand-line-shot', 'index.html') : path.join(ROOT, 'index.html');
const CAM = process.env.CAM || 'duas_aguas';
const OUT = path.join(ROOT, 'shots', 'critic', 's4-fx', label + (CAM === 'duas_aguas' ? '' : '-' + CAM));
fs.mkdirSync(OUT, { recursive: true });
const vendorThree = path.join(ROOT, 'tools', 'vendor', 'three.min.js');

const browser = await chromium.launch({ headless: true, args: ['--use-angle=swiftshader', '--use-gl=angle', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl', '--hide-scrollbars', '--allow-file-access-from-files'] });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
await ctx.route(/cdnjs\.cloudflare\.com\/ajax\/libs\/three\.js\/r128\/three\.min\.js/, (r) => r.fulfill({ status: 200, contentType: 'application/javascript', body: fs.readFileSync(vendorThree) }));
await ctx.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
await ctx.route(/cdn\.jsdelivr\.net/, (r) => r.abort());
const page = await ctx.newPage();
const errors = [];
let phase = 'load';
page.on('pageerror', (e) => errors.push(phase + ' pageerror: ' + e.message + ' @ ' + String(e.stack || '').split(/\n/).slice(1, 3).join(' / ')));
page.on('console', (m) => { if (m.type() === 'error' && !/fonts\.(googleapis|gstatic)|jsdelivr|ERR_FAILED|net::/.test(m.text())) errors.push(phase + ' console: ' + m.text()); });
await page.goto(pathToFileURL(html).href, { waitUntil: 'load' });
await page.waitForFunction(() => window.GLT && GLT.ui && GLT.ui.dom && GLT.ui.dom.canvas && GLT.ui.platesSystem, null, { timeout: 60000 });

// in-page helpers: manual stepping, forced CPU, start a battle
await page.evaluate(() => {
  const ui = GLT.ui;
  window.__step = (sec, h) => {
    h = h || 1 / 30;
    const n = Math.max(1, Math.round(sec / h));
    for (let i = 0; i < n; i++) {
      ui.simTime += h;
      ui.platesSystem.update(h, ui.simTime, ui.postPipeline.renderTarget.height);
      ui.playerShipMeshes.forEach((m) => GLT.shipsVoxel.updateShip(m, h, ui.simTime));
      ui.enemyGhostShipMeshes.forEach((m) => GLT.shipsVoxel.updateShip(m, h, ui.simTime));
      if (ui.backdrop) ui.backdrop.update(ui.platesSystem.camera, h, ui.simTime);
      if (ui.fx) ui.fx.update(h, ui.simTime);
    }
    ui.postPipeline.render(ui.simTime);
  };
  window.__cpuQueue = [];
  const realTrigger = ui.triggerCpuTurn;
  ui.triggerCpuTurn = function () {
    if (!window.__cpuQueue.length) return;          // the CPU waits for the probe
    const cell = window.__cpuQueue.shift();
    const ai = this.aiPlayer;
    const orig = ai && ai.chooseAction;
    if (ai) ai.chooseAction = () => ({ type: 'shot', r: cell.r, c: cell.c });
    realTrigger.call(this);
    setTimeout(() => { if (ai) ai.chooseAction = orig; }, 5000);
  };
});

async function startBattle(cfg) {
  await page.evaluate(async (cfg) => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const ui = GLT.ui;
    ui.isPaused = false;
    ui.hideModal();
    if (ui.gamePhase !== 'SETUP' && ui.returnToSetupPhase) ui.returnToSetupPhase();
    Object.assign(ui.matchConfig, { boardId: 'escaramuca', format: 'escaramuca', mode: cfg.mode || 'classico', difficulty: 'grumete', seriesLength: 1, turnTimer: 0, sea: 'mar_calmo', crewId: cfg.crew || 'straw_hats', enemyCrewId: cfg.enemy || 'marines' });
    ui.animSpeed = 4;
    ui.autoPlacePlayerFleet();
    ui.startMatchWithCoinToss();
    for (let i = 0; i < 200 && ui.gamePhase !== 'BATTLE'; i++) await sleep(100);
    ui.clearTurnTimers && ui.clearTurnTimers();
    ui.matchState.turn = 0;
    ui.animSpeed = 1;
  }, cfg);
  await page.waitForTimeout(800);
}

async function setCam(preset) {
  // paused + stepped: the 0.6 s camera tween runs in game time, whatever SwiftShader's frame rate
  await page.evaluate((p) => { GLT.ui.isPaused = true; GLT.ui.setCameraPreset(p); window.__step(1.2); }, preset);
}

const viewportClip = async () => page.evaluate(() => { const r = document.getElementById('glt-viewport-container').getBoundingClientRect(); return { x: r.left, y: r.top, width: r.width, height: r.height }; });
async function snap(name, full) {
  const clip = full ? undefined : await viewportClip();
  await page.screenshot({ path: path.join(OUT, name + '.png'), clip, timeout: 120000 });
  console.error('shot', label, name);
}

// pause, run `fire` (in page), wait for the real-time outcome timer, then step game time and shoot at each mark
async function moment(name, fire, marks) {
  phase = name;
  await page.evaluate(() => { GLT.ui.isPaused = true; });
  await page.evaluate(fire);
  await page.waitForTimeout(900);                     // ui.js applies the outcome after 560 ms (pilot 320 ms) real time
  let t = 0;
  for (const m of marks) {
    await page.evaluate((d) => window.__step(d), m - t);
    t = m;
    await snap(name + '-t' + String(Math.round(m * 100)).padStart(3, '0'));
  }
}

const cellsOf = () => page.evaluate(() => {
  const ms = GLT.ui.matchState;
  const enemy = ms.players[1].fleet.map((s) => ({ id: s.id, len: s.length, cells: s.cells.map((c) => ({ r: c.r, c: c.c })) }));
  const mine = ms.players[0].fleet.map((s) => ({ id: s.id, len: s.length, cells: s.cells.map((c) => ({ r: c.r, c: c.c })) }));
  const occ = new Set(); enemy.forEach((s) => s.cells.forEach((c) => occ.add(c.r + ',' + c.c)));
  const occMine = new Set(); mine.forEach((s) => s.cells.forEach((c) => occMine.add(c.r + ',' + c.c)));
  const water = []; const waterMine = [];
  for (let r = 0; r < ms.boardSize; r++) for (let c = 0; c < ms.boardSize; c++) {
    if (!occ.has(r + ',' + c)) water.push({ r, c });
    if (!occMine.has(r + ',' + c)) waterMine.push({ r, c });
  }
  return { enemy, mine, water, waterMine };
});
const fireAt = (cell) => `(() => { const ui = GLT.ui; ui.clearTurnTimers && ui.clearTurnTimers(); ui.matchState.turn = 0; ui.shotInFlight = false; ui.selectAimCoordinate(${cell.r}, ${cell.c}); ui.confirmFireShot(); })()`;

await startBattle({});
let F = await cellsOf();
// shortest enemy ship for the sinking, a longer one for the single hit; a mid-board water cell for the miss
const byLen = F.enemy.slice().sort((a, b) => a.len - b.len);
const sinkShip = byLen[0], hitShip = byLen[byLen.length - 1];
const water = F.water.sort((a, b) => (Math.abs(a.r - 3.5) + Math.abs(a.c - 3.5)) - (Math.abs(b.r - 3.5) + Math.abs(b.c - 3.5)))[0];
const hitCell = hitShip.cells[Math.floor(hitShip.cells.length / 2)];

await setCam(CAM);
if (want('miss')) await moment('miss', fireAt(water), [0.25, 0.7, 1.2]);
if (want('hit')) await moment('hit', fireAt(hitCell), [0.3, 0.75, 1.6, 3.0]);
if (want('sink')) {
  for (const c of sinkShip.cells.slice(0, -1)) { await page.evaluate(fireAt(c)); await page.waitForTimeout(900); await page.evaluate(() => window.__step(1)); }
  await moment('sink', fireAt(sinkShip.cells[sinkShip.cells.length - 1]), [0.7, 1.6, 3.0, 4.2]);
}
if (want('cpu')) {
  // the CPU hits then sinks one of my ships
  await setCam('minhas_aguas');
  const mineShip = F.mine.slice().sort((a, b) => a.len - b.len)[0];
  for (let i = 0; i < mineShip.cells.length; i++) {
    const c = mineShip.cells[i];
    const last = i === mineShip.cells.length - 1;
    await moment(last ? 'cpu-sink' : 'cpu-hit-' + i, `(() => { window.__cpuQueue.push(${JSON.stringify(c)}); const ui = GLT.ui; ui.isCpuThinking = false; ui.shotInFlight = false; ui.matchState.turn = 1; ui.triggerCpuTurn(); })()`, last ? [0.3, 0.8, 1.8, 3.4] : [0.8]);
    await page.waitForTimeout(1500);
  }
}
if (want('ceremony')) {
  phase = 'ceremony';
  await setCam('duas_aguas');
  await page.evaluate(() => { GLT.ui.isPaused = false; GLT.ui.animSpeed = 4; });
  F = await cellsOf();
  const left = [];
  const taken = await page.evaluate(() => Object.keys(GLT.ui.matchState.players[1].shotsTaken));
  F.enemy.forEach((s) => s.cells.forEach((c) => { if (!taken.includes(c.r + ',' + c.c)) left.push(c); }));
  for (const c of left.slice(0, -1)) { await page.evaluate(fireAt(c)); await page.waitForTimeout(350); }
  await page.waitForTimeout(1500);
  await page.evaluate(() => { GLT.ui.animSpeed = 1; });
  await moment('ceremony', fireAt(left[left.length - 1]), [0.6]);
  await page.waitForTimeout(700);                     // ceremony starts 650 ms after the last outcome (real time)
  // the beat is 2 s of real time at 1x, during which the modal is still transparent (CSS): SwiftShader screenshots take
  // longer than that, so hide the modal while stepping the 3D through the same 2 s of game time
  await page.evaluate(() => { const o = GLT.ui.dom.modalOverlay; o.dataset.probe = o.getAttribute('style') || ''; o.style.visibility = 'hidden'; });
  await page.evaluate(() => window.__step(1.0));
  await snap('ceremony-beat-a', true);
  await page.evaluate(() => window.__step(1.0));
  await snap('ceremony-beat-b', true);
  await page.evaluate(() => { GLT.ui.dom.modalOverlay.style.visibility = ''; });
  await page.evaluate(() => { GLT.ui.isPaused = false; });
  await page.waitForTimeout(3500);
  await snap('ceremony-modal', true);
}
if (want('tech') && label === 'ours') {
  const crews = [['straw_hats', 'bazooka'], ['whitebeard', 'tremor'], ['red_haired', 'haki'], ['heart', 'room'], ['blackbeard', 'vortice'], ['marines', 'observacao']];
  for (const [crew, tech] of crews) {
    phase = 'tech-' + tech;
    await startBattle({ crew, enemy: crew === 'marines' ? 'straw_hats' : 'marines', mode: 'tatico' });
    await setCam(tech === 'vortice' ? 'duas_aguas' : 'mira_inimiga');
    const f = await cellsOf();
    const tgt = f.enemy[0].cells[0];
    const act = tech === 'room'
      ? `(() => { const ui = GLT.ui; ui.matchState.turn = 0; ui.executePlayerTechnique({ axis: 'row', index: ${tgt.r} }); })()`
      : `(() => { const ui = GLT.ui; ui.matchState.turn = 0; ui.isUsingTechnique = true; ui.executePlayerTechnique(${tgt.r}, ${tgt.c}); })()`;
    await moment('tech-' + tech, act, [0.3, 0.7, 1.3]);
    await page.evaluate(() => { const b = document.getElementById('glt-technique-banner'); if (b) b.remove(); });
  }
}

const stats = await page.evaluate(() => (GLT.sea && GLT.sea.particles ? GLT.sea.particles.stats() : null));
fs.writeFileSync(path.join(OUT, '_report.json'), JSON.stringify({ label, html, errors, particles: stats }, null, 2));
console.log(JSON.stringify({ label, errors: errors.length, first: errors.slice(0, 8), particles: stats }, null, 2));
await browser.close();
