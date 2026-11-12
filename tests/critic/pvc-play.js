// Critic probe: load a built HTML headless, play several PvC turns via UI API, report errors.
const path = require('path');
const { chromium } = require('playwright');
const file = process.argv[2] || 'index.html';
(async () => {
  const browser = await chromium.launch({ executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors = [], failed = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  page.on('requestfailed', r => failed.push(r.url().slice(-80) + ' ' + (r.failure() && r.failure().errorText)));
  const url = 'file:///' + path.resolve(__dirname, '..', '..', file).replace(/\\/g, '/');
  await page.goto(url);
  await page.waitForFunction(() => window.GLT && GLT.ui && GLT.ui.gamePhase, null, { timeout: 30000 });
  const startPhase = await page.evaluate(() => GLT.ui.gamePhase);
  await page.evaluate(() => GLT.ui.startMatchWithCoinToss());
  await page.waitForFunction(() => GLT.ui.gamePhase === 'BATTLE', null, { timeout: 30000 });
  const log = [];
  let fired = 0;
  for (let t = 0; t < 400 && fired < 8; t++) {
    const st = await page.evaluate(() => ({ turn: GLT.ui.matchState.turn, phase: GLT.ui.gamePhase, h: GLT.ui.matchState.history.length, over: GLT.ui.matchState.gameOver }));
    if (st.phase !== 'BATTLE' || st.over) { log.push('stop ' + JSON.stringify(st)); break; }
    if (st.turn === 0) {
      const r = Math.floor(fired / 4) * 3 + 1, c = (fired % 4) * 2 + 1;
      await page.evaluate(([r, c]) => { GLT.ui.selectAimCoordinate(r, c); GLT.ui.confirmFireShot(); }, [r, c]);
      fired++;
      await page.waitForTimeout(700);
      const after = await page.evaluate(() => ({ turn: GLT.ui.matchState.turn, h: GLT.ui.matchState.history.length }));
      log.push(`P shot (${r},${c}) hist ${st.h}->${after.h} turn->${after.turn}`);
    } else {
      await page.waitForTimeout(250);
    }
  }
  const fin = await page.evaluate(() => ({
    phase: GLT.ui.gamePhase,
    history: GLT.ui.matchState.history.length,
    cpuShots: GLT.ui.matchState.history.filter(h => h.player === 1 || h.shooter === 1 || h.by === 1).length,
    sample: JSON.stringify(GLT.ui.matchState.history.slice(-2)).slice(0, 400)
  }));
  await page.screenshot({ path: path.resolve(__dirname, '..', '..', 'shots', 'critic', 'pvc-' + path.basename(file, '.html') + '.png') });
  console.log(JSON.stringify({ file, startPhase, fired, fin, log, errors, failed: failed.slice(0, 15), failedCount: failed.length }, null, 1));
  await browser.close();
})().catch(e => { console.error('PROBE FAIL', e); process.exit(2); });
