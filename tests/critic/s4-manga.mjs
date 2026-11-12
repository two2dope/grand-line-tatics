// Stage 4 probe: real-time play (not stepped) of a miss, a hit and a technique, with and without
// prefers-reduced-motion, checking the manga onomatopoeia lands over the target cell, the cut-in banner shows,
// and no console errors.   node tests/critic/s4-manga.mjs [--reduced]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from 'playwright';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const reduced = process.argv.includes('--reduced');
const OUT = path.join(ROOT, 'shots', 'critic', 's4-fx', reduced ? 'manga-reduced' : 'manga');
fs.mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ headless: true, args: ['--use-angle=swiftshader', '--use-gl=angle', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--hide-scrollbars', '--allow-file-access-from-files'] });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 }, reducedMotion: reduced ? 'reduce' : 'no-preference' });
await ctx.route(/cdnjs\.cloudflare\.com\/ajax\/libs\/three\.js\/r128\/three\.min\.js/, (r) => r.fulfill({ status: 200, contentType: 'application/javascript', body: fs.readFileSync(path.join(ROOT, 'tools', 'vendor', 'three.min.js')) }));
await ctx.route(/fonts\.(googleapis|gstatic)\.com|cdn\.jsdelivr\.net/, (r) => r.abort());
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error' && !/fonts\.(googleapis|gstatic)|jsdelivr|ERR_FAILED|net::/.test(m.text())) errors.push('console: ' + m.text()); });
await page.goto(pathToFileURL(path.join(ROOT, 'index.html')).href, { waitUntil: 'load' });
await page.waitForFunction(() => window.GLT && GLT.ui && GLT.ui.platesSystem, null, { timeout: 60000 });

async function battle(crew) {
  await page.evaluate(async (crew) => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const ui = GLT.ui;
    ui.hideModal();
    if (ui.gamePhase !== 'SETUP' && ui.returnToSetupPhase) ui.returnToSetupPhase();
    Object.assign(ui.matchConfig, { boardId: 'escaramuca', format: 'escaramuca', mode: 'tatico', difficulty: 'grumete', seriesLength: 1, turnTimer: 0, sea: 'mar_calmo', crewId: crew, enemyCrewId: crew === 'marines' ? 'straw_hats' : 'marines' });
    ui.autoPlacePlayerFleet();
    ui.startMatchWithCoinToss();
    for (let i = 0; i < 200 && ui.gamePhase !== 'BATTLE'; i++) await sleep(100);
    ui.clearTurnTimers && ui.clearTurnTimers();
    ui.triggerCpuTurn = function () {};            // the CPU stays quiet
    ui.matchState.turn = 0;
    ui.setCameraPreset('duas_aguas');
    await sleep(1200);
  }, crew);
}

// fire at a cell, wait for the onomatopoeia, report where it is vs where the cell projects
async function fire(name, pick) {
  const res = await page.evaluate(async (pick) => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const ui = GLT.ui, ms = ui.matchState;
    const occ = new Set(); ms.players[1].fleet.forEach((s) => s.cells.forEach((c) => occ.add(c.r + ',' + c.c)));
    let cell = null;
    for (let r = 2; r < ms.boardSize && !cell; r++) for (let c = 2; c < ms.boardSize && !cell; c++) {
      const k = r + ',' + c;
      if (ms.players[1].shotsTaken[k]) continue;
      if ((pick === 'hit') === occ.has(k)) cell = { r, c };
    }
    document.querySelectorAll('.glt-manga-impact').forEach((e) => e.remove());
    ms.turn = 0; ui.shotInFlight = false;
    ui.selectAimCoordinate(cell.r, cell.c); ui.confirmFireShot();
    let el = null;
    for (let i = 0; i < 80 && !el; i++) { await sleep(25); el = document.querySelector('.glt-manga-impact'); }
    if (!el) return { cell, found: false };
    const vp = document.getElementById('glt-viewport-container').getBoundingClientRect();
    const w = ui.platesSystem.seaPlates.cellToWorld(1, cell.r, cell.c).clone();
    w.project(ui.platesSystem.camera);
    return { cell, found: true, text: el.textContent, at: [parseFloat(el.style.left), parseFloat(el.style.top)],
      cellPx: [Math.round((w.x * 0.5 + 0.5) * vp.width), Math.round((-w.y * 0.5 + 0.5) * vp.height)] };
  }, pick);
  await page.screenshot({ path: path.join(OUT, name + '.png') });
  return res;
}

const report = { reduced };
await battle('straw_hats');
report.miss = await fire('miss', 'miss');
await page.waitForTimeout(1500);
report.hit = await fire('hit', 'hit');
await page.waitForTimeout(1500);
// technique: banner (cut-in) shows, the 3D fx plays
report.tech = await page.evaluate(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const ui = GLT.ui;
  ui.matchState.turn = 0; ui.shotInFlight = false; ui.isUsingTechnique = true;
  ui.executePlayerTechnique(4, 4);
  let b = null;
  for (let i = 0; i < 40 && !b; i++) { await sleep(25); b = document.getElementById('glt-technique-banner'); }
  return { banner: !!b, text: b ? b.textContent.trim().slice(0, 80) : null };
});
await page.waitForTimeout(400);
await page.screenshot({ path: path.join(OUT, 'tech.png') });
await page.waitForTimeout(2500);
report.reducedPref = await page.evaluate(() => GLT.sea.prefs.reducedMotion());
report.errors = errors;
fs.writeFileSync(path.join(OUT, '_report.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
await browser.close();
