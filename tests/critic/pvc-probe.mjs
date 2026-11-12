// Critic probe: open built index.html over file:// in default Chrome, play a few PvC turns, collect errors.
import { chromium } from 'playwright';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const file = process.argv[2] || 'index.html';
const url = pathToFileURL(path.join(root, file)).href;
const browser = await chromium.launch({ executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', headless: true });
const page = await browser.newPage({ viewport: { width: 1366, height: 800 } });
const errs = [];
page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') errs.push(m.type() + ': ' + m.text().slice(0, 200)); });
page.on('pageerror', e => errs.push('pageerror: ' + e.message));
page.on('requestfailed', r => errs.push('requestfailed: ' + r.url().slice(-80) + ' ' + (r.failure() && r.failure().errorText)));
await page.goto(url);
await page.waitForFunction(() => window.GLT && GLT.ui && GLT.ui.gamePhase === 'SETUP', null, { timeout: 30000 });
await page.waitForTimeout(1500);
// Click through any intro modal via UI if present
const res = await page.evaluate(async () => {
  try { GLT.ui.hideModal && GLT.ui.hideModal(); } catch (e) {}
  GLT.ui.matchConfig.format = 'classica';
  GLT.ui.matchConfig.difficulty = 'capitao';
  GLT.ui.autoPlacePlayerFleet();
  GLT.ui.startMatchWithCoinToss();
  for (let i = 0; i < 80 && GLT.ui.gamePhase !== 'BATTLE'; i++) await new Promise(r => setTimeout(r, 200));
  const out = { phase: GLT.ui.gamePhase, shots: [] };
  let fired = 0, ticks = 0;
  const N = GLT.ui.matchState.boardSize || 10;
  while (fired < 6 && ticks < 600 && GLT.ui.gamePhase === 'BATTLE') {
    ticks++;
    if (GLT.ui.matchState.turn === 0 && !GLT.ui.shotInFlight && !GLT.ui.isCpuThinking) {
      for (let k = fired * 7; k < N * N; k++) {
        const r = Math.floor(k / N), c = k % N;
        if (!GLT.ui.matchState.players[1].shotsTaken[r + ',' + c]) {
          GLT.ui.selectAimCoordinate(r, c); GLT.ui.confirmFireShot(); fired++;
          out.shots.push(r + ',' + c); break;
        }
      }
    }
    await new Promise(r => setTimeout(r, 150));
  }
  out.after = {
    phase: GLT.ui.gamePhase,
    playerShots: Object.keys(GLT.ui.matchState.players[1].shotsTaken).length,
    cpuShots: Object.keys(GLT.ui.matchState.players[0].shotsTaken).length,
    turn: GLT.ui.matchState.turn,
  };
  return out;
});
await page.waitForTimeout(2000);
await page.screenshot({ path: path.join(root, 'shots/critic/pvc-probe.png') });
const visibleText = await page.evaluate(() => document.body.innerText.slice(0, 600));
console.log(JSON.stringify({ url, res, errs, visibleText }, null, 1));
await browser.close();
