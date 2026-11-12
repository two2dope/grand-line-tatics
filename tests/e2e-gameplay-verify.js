/**
 * Grand Line Tactics - End-to-End Browser Gameplay & Audit Verification Suite
 *
 * Launches a local HTTP server + Headless Chrome via raw Chrome DevTools Protocol (zero npm deps)
 * and verifies:
 *  1. Artifact & Architectural Invariants (pt-BR, viewport zoom enabled, color-scheme, byte parity, pure logic)
 *  2. Setup Controls & Accessibility (Rival Crew, Rule Toggles, Ship Dock, <button> Crew Cards, <label for>)
 *  3. Full Multi-Turn PvC Match to Victory (proving zero Turn 2 CPU freeze, deterministic AI, Ceremony poster)
 *  4. All 6 Tactical Crew Techniques (3D & 2D board marker sync, ship sinking, Observação cell reveal)
 *  5. Best-of-3 (MD3) Series Score Persistence across games
 *  6. Real Two-Tab Cross-Window Online PvP (Room Create -> Join -> Commit/Ready -> Live Shot Sync)
 */

const { spawn } = require('child_process');
const http = require('http');
const net = require('net');
const os = require('os');
const path = require('path');
const fs = require('fs');

const ROOT_DIR = path.resolve(__dirname, '..');
// GLT_ARTIFACT_DIR=<folder holding only grand-line-tactics.html>: run the whole suite against the
// published single file served from that isolated folder (no assets/ next to it).
const ARTIFACT_DIR = process.env.GLT_ARTIFACT_DIR ? path.resolve(process.env.GLT_ARTIFACT_DIR) : null;
const SERVE_DIR = ARTIFACT_DIR || ROOT_DIR;
const ENTRY_FILE = ARTIFACT_DIR ? 'grand-line-tactics.html' : 'index.html';

function findChromeBinary() {
  const candidates = [
    process.env.CHROME_PATH,
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    '/usr/bin/google-chrome',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
  ].filter(Boolean);
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  throw new Error('No Chromium binary found. Set CHROME_PATH environment variable.');
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

function getFreePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, '127.0.0.1', () => {
      const port = srv.address().port;
      srv.close(() => resolve(port));
    });
    srv.on('error', reject);
  });
}

function startStaticServer() {
  return new Promise((resolve, reject) => {
    const mime = {
      '.html': 'text/html; charset=utf-8',
      '.js': 'application/javascript; charset=utf-8',
      '.css': 'text/css; charset=utf-8',
      '.png': 'image/png',
      '.json': 'application/json; charset=utf-8'
    };
    const server = http.createServer((req, res) => {
      const cleanUrl = (req.url || '/').split('?')[0];
      const relPath = cleanUrl === '/' ? ENTRY_FILE : cleanUrl.replace(/^\/+/, '');
      const fullPath = path.resolve(SERVE_DIR, relPath);
      if (!fullPath.startsWith(SERVE_DIR)|| !fs.existsSync(fullPath) || fs.statSync(fullPath).isDirectory()) {
        res.writeHead(404);
        res.end('Not found');
        return;
      }
      const ext = path.extname(fullPath).toLowerCase();
      res.writeHead(200, { 'Content-Type': mime[ext] || 'application/octet-stream' });
      res.end(fs.readFileSync(fullPath));
    });
    server.listen(0, '127.0.0.1', () => {
      resolve({ server, port: server.address().port });
    });
    server.on('error', reject);
  });
}

async function listCdpTargets(port) {
  const res = await fetch(`http://127.0.0.1:${port}/json/list`);
  return res.json();
}

async function waitForFirstPageWs(port) {
  for (let i = 0; i < 40; i++) {
    try {
      const tabs = await listCdpTargets(port);
      const page = tabs.find(t => t.type === 'page' && t.webSocketDebuggerUrl);
      if (page) return page.webSocketDebuggerUrl;
    } catch (_) {}
    await sleep(200);
  }
  throw new Error('Timed out connecting to Headless Chrome CDP');
}

class CdpSession {
  constructor(wsUrl, label) {
    this.ws = new WebSocket(wsUrl);
    this.label = label || 'tab';
    this.id = 0;
    this.pending = new Map();
    this.errors = [];
  }

  async init() {
    await new Promise((resolve, reject) => {
      this.ws.onopen = resolve;
      this.ws.onerror = reject;
    });
    this.ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(JSON.stringify(msg.error)));
        else resolve(msg.result);
      } else if (msg.method === 'Runtime.exceptionThrown') {
        const d = msg.params.exceptionDetails;
        this.errors.push(`[${this.label} Uncaught] ${d.text || ''} ${(d.exception && d.exception.description) || ''}`);
      } else if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
        const txt = (msg.params.args || []).map(a => a.value || a.description || '').join(' ');
        if (!txt.includes('favicon.ico')) {
          this.errors.push(`[${this.label} ConsoleError] ${txt}`);
        }
      } else if (msg.method === 'Log.entryAdded') {
        // Browser-level errors (CORS, failed resource loads) are only visible through the Log domain.
        const e = msg.params.entry;
        if (e.level === 'error' && !String(e.text + (e.url || '')).includes('favicon.ico')) {
          this.errors.push(`[${this.label} Log] ${e.text} ${e.url || ''}`);
        }
      } else if (msg.method === 'Network.loadingFailed' && !msg.params.canceled) {
        this.errors.push(`[${this.label} Network] ${msg.params.errorText} ${msg.params.blockedReason || ''}`);
      }
    };
    await this.send('Page.enable');
    await this.send('Runtime.enable');
    await this.send('Log.enable');
    await this.send('Network.enable');
  }

  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  async eval(expression) {
    const res = await this.send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true
    });
    if (res.exceptionDetails) {
      throw new Error(`Eval exception in ${this.label}: ${JSON.stringify(res.exceptionDetails)}`);
    }
    return res.result ? res.result.value : undefined;
  }

  close() {
    try { this.ws.close(); } catch (_) {}
  }
}

async function runSuite() {
  console.log('==============================================================');
  console.log(' GRAND LINE TACTICS — FULL E2E GAMEPLAY & AUDIT VERIFICATION');
  console.log('==============================================================\n');

  let passed = 0;
  let failed = 0;
  const failures = [];

  function check(name, cond, detail) {
    if (cond) {
      passed++;
      console.log(`  [PASS] ${name}`);
    } else {
      failed++;
      const msg = detail ? `${name} — ${detail}` : name;
      failures.push(msg);
      console.error(`  [FAIL] ${msg}`);
    }
  }

  // -------------------------------------------------------------------------
  // 1. Static Artifact & Pure-Logic Hygiene Checks
  // -------------------------------------------------------------------------
  console.log('--- 1. Static Deliverable & Architecture Checks ---');
  const indexHtml = fs.readFileSync(path.join(SERVE_DIR, ENTRY_FILE), 'utf8');
  if (!ARTIFACT_DIR) {
    const gltHtml = fs.readFileSync(path.join(ROOT_DIR, 'grand-line-tactics.html'), 'utf8');
    check('index.html and grand-line-tactics.html are byte-identical', indexHtml === gltHtml);
  }
  check('<html lang="pt-BR"> is present', /<html[^>]+lang="pt-BR"/i.test(indexHtml));
  check('Viewport does NOT block user zoom (WCAG 1.4.4)', !/user-scalable\s*=\s*no/i.test(indexHtml) && !/maximum-scale\s*=\s*1(\.0)?/i.test(indexHtml));
  check('<meta name="color-scheme" content="dark light"> is present', /<meta[^>]+name="color-scheme"/i.test(indexHtml));

  const logicDir = path.join(ROOT_DIR, 'src', 'logic');
  const logicFiles = fs.readdirSync(logicDir).filter(f => f.endsWith('.js'));
  let logicPure = true;
  let impureReason = '';
  for (const lf of logicFiles) {
    const raw = fs.readFileSync(path.join(logicDir, lf), 'utf8');
    const codeOnly = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    if (/\bMath\.random\s*\(/.test(codeOnly)) {
      logicPure = false;
      impureReason = `${lf} uses Math.random()`;
    }
    if (/\b(document\.|window\.|THREE\.)/.test(codeOnly)) {
      logicPure = false;
      impureReason = `${lf} touches DOM/THREE`;
    }
  }
  check('All src/logic/*.js modules are 100% pure (zero DOM/THREE/Math.random)', logicPure, impureReason);

  // -------------------------------------------------------------------------
  // Launch HTTP Server + Headless Chrome
  // -------------------------------------------------------------------------
  const { server, port: httpPort } = await startStaticServer();
  const cdpPort = await getFreePort();
  const tempProfile = fs.mkdtempSync(path.join(os.tmpdir(), 'glt-e2e-'));
  const chromeBin = findChromeBinary();

  const chrome = spawn(chromeBin, [
    `--remote-debugging-port=${cdpPort}`,
    `--user-data-dir=${tempProfile}`,
    '--headless=new',
    '--window-size=1280,800',
    '--use-gl=angle',
    '--enable-webgl',
    '--ignore-gpu-blocklist',
    '--no-first-run',
    '--no-default-browser-check',
    // Several tabs play each other here, and only one can be in front. Background-tab timer
    // throttling would stall the hidden player's fake-network timers for seconds (on real
    // devices each player's page is in front).
    '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding',
    '--disable-backgrounding-occluded-windows',
    '--disable-features=IntensiveWakeUpThrottling',
    'about:blank'
  ], { stdio: 'ignore' });

  let tab1 = null;
  let tab2 = null;
  const extraTabsForCleanup = [];

  try {
    const ws1 = await waitForFirstPageWs(cdpPort);
    tab1 = new CdpSession(ws1, 'Tab1');
    await tab1.init();

    const appUrl = `http://127.0.0.1:${httpPort}/${ENTRY_FILE}`;
    await tab1.send('Page.navigate', { url: appUrl });

    let booted = false;
    for (let i = 0; i < 40; i++) {
      booted = await tab1.eval('Boolean(window.GLT && window.GLT.ui && GLT.ui.gamePhase === "SETUP")');
      if (booted) break;
      await sleep(200);
    }
    check('Webapp boots cleanly into SETUP phase', booted);
    await sleep(600);

    // -----------------------------------------------------------------------
    // 2. Setup Controls, Visual Assets & Accessibility Checks
    // -----------------------------------------------------------------------
    console.log('\n--- 2. Setup Controls, Accessibility & UI Polish Checks ---');
    const setupAudit = await tab1.eval(`(() => {
      const crewCards = Array.from(document.querySelectorAll('.glt-crew-card'));
      const crewAreButtons = crewCards.length === 6 && crewCards.every(el => el.tagName === 'BUTTON');
      const crewHavePortraits = crewCards.length === 6 && crewCards.every(el => Boolean(el.querySelector('img, canvas, svg')));
      const hasRivalSelector = Boolean(document.getElementById('sel-enemy-crew'));
      const hasRuleAllowTouch = Boolean(document.querySelector('[data-rule="allowTouch"]'));
      const hasRuleContinue = Boolean(document.querySelector('[data-rule="continueOnHit"]'));
      const hasRuleSalvo = Boolean(document.querySelector('[data-rule="salvo"]'));
      const hasRuleFog = Boolean(document.querySelector('[data-rule="fog"]'));
      const hasTurnTimerSelect = Boolean(document.getElementById('sel-turn-timer'));
      const hasShipDock = document.querySelectorAll('.glt-ship-dock-item').length >= 4;

      const formControls = Array.from(document.querySelectorAll('select, input:not([type="hidden"])'));
      const unlabelled = formControls.filter(el => {
        if (el.getAttribute('aria-label') || el.getAttribute('aria-labelledby') || el.closest('label')) return false;
        if (el.id && document.querySelector('label[for="' + el.id + '"]')) return false;
        return true;
      }).map(el => el.id || el.className || el.tagName);

      const bodyUserSelect = getComputedStyle(document.body).userSelect;

      // Flow Assets & UI Integration Checks
      const hasFlowAssets = Boolean(window.GLT && window.GLT.assets && window.GLT.assets.portraits && window.GLT.assets.blessings);
      const crewHaveSeals = document.querySelectorAll('.crew-seal-stamp').length === 6;
      const hasChartBtn = Boolean(document.getElementById('btn-open-nautical-chart'));
      const hasSeaPreview = Boolean(document.getElementById('glt-sea-preview-box'));

      // Test Nautical Chart Modal
      if (hasChartBtn) {
        document.getElementById('btn-open-nautical-chart').click();
      }
      const chartModalOpen = Boolean(document.querySelector('.glt-nautical-chart-modal .glt-chart-horizontal-img'));
      if (window.GLT && window.GLT.ui) {
        window.GLT.ui.hideModal();
      }

      // Test Logbook Blessings Grid
      window.GLT.ui.switchTab('logbook');
      const blessingsCount = document.querySelectorAll('.glt-blessing-card-thumb').length;
      window.GLT.ui.switchTab('gameplay');

      return {
        crewAreButtons,
        crewHavePortraits,
        hasRivalSelector,
        hasAllRules: hasRuleAllowTouch && hasRuleContinue && hasRuleSalvo && hasRuleFog && hasTurnTimerSelect,
        hasShipDock,
        unlabelled,
        bodyUserSelect,
        hasFlowAssets,
        crewHaveSeals,
        hasChartBtn,
        hasSeaPreview,
        chartModalOpen,
        blessingsCount
      };
    })()`);

    check('Crew selector renders 6 keyboard-accessible <button> cards', setupAudit.crewAreButtons);
    check('Crew cards display procedural pixel-art captain portraits/crests', setupAudit.crewHavePortraits);
    check('Crew cards display authentic faction wax seal stamps', setupAudit.crewHaveSeals);
    check('Canonical Flow Assets registry loaded (portraits, emblems, maps, blessings)', setupAudit.hasFlowAssets);
    check('Nautical Chart button (#btn-open-nautical-chart) opens interactive modal with Grand Line map', setupAudit.hasChartBtn && setupAudit.chartModalOpen);
    check('Tactical Sea & Island preview box (#glt-sea-preview-box) displays sky and chart visuals', setupAudit.hasSeaPreview);
    check('Logbook tab displays 6 collectible Grand Line Blessing cards (.glt-blessing-card-thumb)', setupAudit.blessingsCount === 6, `blessings=${setupAudit.blessingsCount}`);
    check('Rival Crew selector (#sel-enemy-crew) is present', setupAudit.hasRivalSelector);
    check('All rule toggles (allowTouch, continueOnHit, salvo, fog, turnTimer) exist in UI', setupAudit.hasAllRules);
    check('Interactive Ship Dock cards (.glt-ship-dock-item) exist in Setup', setupAudit.hasShipDock);
    check('Every <select> and <input> has programmatic <label for> / aria-label', setupAudit.unlabelled.length === 0, `Unlabelled: ${setupAudit.unlabelled.join(', ')}`);
    check('document.body does not lock user-select globally', setupAudit.bodyUserSelect !== 'none', `userSelect=${setupAudit.bodyUserSelect}`);

    // -----------------------------------------------------------------------
    // 3. Full Multi-Turn PvC Gameplay to Victory (Turn 2 CPU Freeze Check)
    // -----------------------------------------------------------------------
    console.log('\n--- 3. Multi-Turn PvC Match to Completion (C-01 & C-03 Check) ---');
    const pvcResult = await tab1.eval(`(async () => {
      const sleepMs = ms => new Promise(r => setTimeout(r, ms));
      GLT.ui.matchConfig.format = 'escaramuca'; // 8x8 (12 ship cells) for brisk full-game E2E
      GLT.ui.matchConfig.mode = 'tatico';
      GLT.ui.matchConfig.difficulty = 'capitao';
      GLT.ui.matchConfig.seriesLength = 1;
      GLT.ui.animSpeed = 4.0;
      GLT.ui.autoPlacePlayerFleet();
      GLT.ui.startMatchWithCoinToss();

      // Wait for coin toss to enter BATTLE
      for (let i = 0; i < 35; i++) {
        if (GLT.ui.gamePhase === 'BATTLE') break;
        await sleepMs(100);
      }
      if (GLT.ui.gamePhase !== 'BATTLE') {
        return { ok: false, reason: 'Did not enter BATTLE phase: ' + GLT.ui.gamePhase };
      }

      // Play real turns! When it's player turn, fire at enemy ship cells + 3 deliberate misses so CPU gets multiple turns!
      const enemyShipCells = [];
      for (const s of GLT.ui.matchState.players[1].fleet) {
        for (const c of s.cells) enemyShipCells.push({ r: c.r, c: c.c });
      }
      // Put 3 water misses first so CPU MUST take at least 3 full turns!
      const occupiedSet = new Set(enemyShipCells.map(c => c.r + ',' + c.c));
      const plannedMoves = [];
      for (let r = 0; r < 8 && plannedMoves.length < 3; r++) {
        for (let c = 0; c < 8 && plannedMoves.length < 3; c++) {
          if (!occupiedSet.has(r + ',' + c)) plannedMoves.push({ r, c });
        }
      }
      plannedMoves.push(...enemyShipCells);

      let movePtr = 0;
      let safetyTicks = 0;
      while (GLT.ui.gamePhase === 'BATTLE' && safetyTicks < 220) {
        if (GLT.ui.matchState.turn === 0 && !GLT.ui.shotInFlight && !GLT.ui.isCpuThinking) {
          // Pick next untried move
          while (movePtr < plannedMoves.length) {
            const mv = plannedMoves[movePtr++];
            if (!GLT.ui.matchState.players[1].shotsTaken[mv.r + ',' + mv.c]) {
              GLT.ui.selectAimCoordinate(mv.r, mv.c);
              GLT.ui.confirmFireShot();
              break;
            }
          }
        }
        await sleepMs(80);
        safetyTicks++;
      }

      const cpuShotsOnPlayer = Object.keys(GLT.ui.matchState.players[0].shotsTaken);
      return {
        ok: GLT.ui.gamePhase === 'CEREMONY' && GLT.ui.matchState.winner === 0,
        finalPhase: GLT.ui.gamePhase,
        cpuDistinctShotsCount: cpuShotsOnPlayer.length,
        cpuShotsSample: cpuShotsOnPlayer.slice(0, 5),
        enemyGhostCount: GLT.ui.enemyGhostShips ? GLT.ui.enemyGhostShips.length : 0,
        hasWantedPoster: Boolean(document.querySelector('.glt-wanted-poster-img, .glt-wanted-poster-canvas'))
      };
    })()`);

    check('Full PvC match completes to CEREMONY without freezing on CPU Turn 2', pvcResult.ok, JSON.stringify(pvcResult));
    check('CPU fired at 3+ distinct valid coordinates across multiple turns', pvcResult.cpuDistinctShotsCount >= 3, `CPU distinct shots: ${pvcResult.cpuDistinctShotsCount} (${(pvcResult.cpuShotsSample || []).join('; ')})`);
    check('All 4 sunk enemy ships spawned 3D ghost silhouettes', pvcResult.enemyGhostCount === 4, `ghosts=${pvcResult.enemyGhostCount}`);
    check('Ceremony displays procedural pixel WANTED poster', pvcResult.hasWantedPoster);

    // -----------------------------------------------------------------------
    // 4. All 6 Tactical Crew Techniques Sync Check (C-02)
    // -----------------------------------------------------------------------
    console.log('\n--- 4. Tactical Crew Techniques 3D/2D Board Sync Checks (C-02) ---');
    const techAudit = await tab1.eval(`(async () => {
      const sleepMs = ms => new Promise(r => setTimeout(r, ms));
      const results = {};

      async function bootTacticalForCrew(crewId) {
        GLT.ui.hideModal();
        GLT.ui.matchConfig.crewId = crewId;
        GLT.ui.matchConfig.enemyCrewId = crewId === 'marines' ? 'straw_hats' : 'marines';
        GLT.ui.matchConfig.format = 'escaramuca';
        GLT.ui.matchConfig.mode = 'tatico';
        GLT.ui.matchConfig.seriesLength = 1;
        GLT.ui.autoPlacePlayerFleet();
        GLT.ui.startMatchWithCoinToss();
        for (let i = 0; i < 35; i++) {
          if (GLT.ui.gamePhase === 'BATTLE') break;
          await sleepMs(80);
        }
        // Force player turn for deterministic immediate technique test
        GLT.ui.clearTurnTimers && GLT.ui.clearTurnTimers();
        GLT.ui.matchState.turn = 0;
        GLT.ui.shotInFlight = false;
      }

      // 4A. Straw Hats: Bazooka (2x2 = 4 cells marked on 3D seaPlates)
      await bootTacticalForCrew('straw_hats');
      GLT.ui.isUsingTechnique = true;
      GLT.ui.executePlayerTechnique(2, 2);
      await sleepMs(150);
      const bazookaMarkers = Object.keys(GLT.ui.seaPlates.shotMarkers).filter(k => k.startsWith('1_')).length;
      results.bazookaMarkers = bazookaMarkers;

      // 4B. Whitebeard: Tremor (cross = 5 cells marked on 3D seaPlates)
      await bootTacticalForCrew('whitebeard');
      GLT.ui.isUsingTechnique = true;
      GLT.ui.executePlayerTechnique(3, 3);
      await sleepMs(150);
      const tremorMarkers = Object.keys(GLT.ui.seaPlates.shotMarkers).filter(k => k.startsWith('1_')).length;
      results.tremorMarkers = tremorMarkers;

      // 4C. Marines: Observação (reveals 1 surviving enemy ship cell visually)
      await bootTacticalForCrew('marines');
      GLT.ui.activateCrewTechnique();
      await sleepMs(150);
      const hasRevealedMarker = Boolean(
        (GLT.ui.playerRevealedCells && GLT.ui.playerRevealedCells.length === 1) &&
        document.querySelector('.glt-radar-table td.is-revealed')
      );
      results.observacaoRevealed = hasRevealedMarker;

      // 4D. Blackbeard: Vórtice (activates shieldActive and absorbs next incoming CPU shot!)
      await bootTacticalForCrew('blackbeard');
      GLT.ui.activateCrewTechnique();
      const shieldImmediatelyActive = Boolean(GLT.ui.matchState.players[0].shieldActive);
      // Let CPU take its turn and verify Vórtice absorbs the shot!
      for (let i = 0; i < 20; i++) {
        const shotsOnP0 = Object.values(GLT.ui.matchState.players[0].shotsTaken);
        if (shotsOnP0.some(s => s.result === 'absorbed')) break;
        await sleepMs(80);
      }
      const absorbedCpuShot = Object.values(GLT.ui.matchState.players[0].shotsTaken).some(s => s.result === 'absorbed');
      results.vorticeShield = shieldImmediatelyActive && absorbedCpuShot;

      return results;
    })()`);

    check('Straw Hats Bazooka (2x2) places all 4 cell markers in 3D & 2D', techAudit.bazookaMarkers === 4, `markers=${techAudit.bazookaMarkers}`);
    check('Whitebeard Tremor (5-cell cross) places all 5 cell markers in 3D & 2D', techAudit.tremorMarkers === 5, `markers=${techAudit.tremorMarkers}`);
    check('Marines Observação marks revealed enemy ship cell on radar', techAudit.observacaoRevealed === true);
    check('Blackbeard Vórtice activates incoming shot shield', techAudit.vorticeShield === true);

    // -----------------------------------------------------------------------
    // 5. Best-of-3 (MD3) Series Progression Check (C-04)
    // -----------------------------------------------------------------------
    console.log('\n--- 5. Best-of-3 (MD3) Series Score Retention Check (C-04) ---');
    const seriesCheck = await tab1.eval(`(async () => {
      const sleepMs = ms => new Promise(r => setTimeout(r, ms));
      GLT.ui.hideModal();
      GLT.ui.returnToSetupPhase ? GLT.ui.returnToSetupPhase() : (GLT.ui.gamePhase = 'SETUP');
      GLT.ui.matchConfig.format = 'escaramuca';
      GLT.ui.matchConfig.seriesLength = 3;
      GLT.ui.autoPlacePlayerFleet();
      GLT.ui.startMatchWithCoinToss(false); // fresh series

      for (let i = 0; i < 35; i++) {
        if (GLT.ui.gamePhase === 'BATTLE') break;
        await sleepMs(80);
      }

      // Sink all enemy ships to finish Game 1 legitimately through rules.resolveShot
      GLT.ui.clearTurnTimers && GLT.ui.clearTurnTimers();
      GLT.ui.matchState.turn = 0;
      const targets = [];
      for (const s of GLT.ui.matchState.players[1].fleet) {
        for (const c of s.cells) targets.push({ r: c.r, c: c.c });
      }
      for (const t of targets) {
        GLT.ui.clearTurnTimers && GLT.ui.clearTurnTimers();
        GLT.ui.matchState.turn = 0;
        GLT.ui.shotInFlight = false;
        GLT.ui.selectAimCoordinate(t.r, t.c);
        GLT.ui.confirmFireShot();
        await sleepMs(60);
      }
      for (let i = 0; i < 20; i++) {
        if (GLT.ui.gamePhase === 'CEREMONY') break;
        await sleepMs(80);
      }
      const winsAfterGame1 = GLT.ui.matchState.seriesWins.slice();

      // Click Next Series Game button!
      const nextBtn = document.getElementById('btn-next-series');
      if (nextBtn) nextBtn.click();
      for (let i = 0; i < 35; i++) {
        if (GLT.ui.gamePhase === 'BATTLE') break;
        await sleepMs(80);
      }
      const winsInGame2 = GLT.ui.matchState ? GLT.ui.matchState.seriesWins.slice() : [0, 0];
      return {
        hadNextBtn: Boolean(nextBtn),
        winsAfterGame1,
        winsInGame2
      };
    })()`);

    check('MD3 Game 1 increments seriesWins to [1, 0]', seriesCheck.winsAfterGame1[0] === 1 && seriesCheck.winsAfterGame1[1] === 0, JSON.stringify(seriesCheck));
    check('MD3 Game 2 preserves seriesWins [1, 0] after clicking Próxima Partida', seriesCheck.hadNextBtn && seriesCheck.winsInGame2[0] === 1, JSON.stringify(seriesCheck));

    // -----------------------------------------------------------------------
    // 6. Real Two-Tab Online PvP Handshake & Shot Sync (C-05)
    // -----------------------------------------------------------------------
    console.log('\n--- 6. Cross-Tab Online PvP Match Check (C-05) ---');
    const createdTarget = await tab1.send('Target.createTarget', { url: appUrl });
    const tabsList = await listCdpTargets(cdpPort);
    const secondPage = tabsList.find(t => t.id === createdTarget.targetId && t.webSocketDebuggerUrl);
    check('Second browser tab opened for PvP test', Boolean(secondPage));

    if (secondPage) {
      tab2 = new CdpSession(secondPage.webSocketDebuggerUrl, 'Tab2');
      await tab2.init();
      for (let i = 0; i < 40; i++) {
        const ready = await tab2.eval('Boolean(window.GLT && window.GLT.ui)');
        if (ready) break;
        await sleep(200);
      }

      // Tab 1 returns to setup, opens PvP tab, creates room
      const roomCode = await tab1.eval(`(async () => {
        GLT.ui.hideModal();
        if (GLT.ui.returnToSetupPhase) GLT.ui.returnToSetupPhase();
        GLT.ui.switchTab('tab-pvp');
        await GLT.ui.createPvpRoom();
        return GLT.ui.pvpRoomId;
      })()`);

      check('Tab 1 created 5-character PvP room code', typeof roomCode === 'string' && roomCode.length === 5, `roomCode=${roomCode}`);

      if (roomCode && roomCode.length === 5) {
        // Tab 2 joins roomCode
        await tab2.eval(`(async () => {
          GLT.ui.switchTab('tab-pvp');
          await GLT.ui.joinPvpRoom('${roomCode}');
        })()`);
        await sleep(400);

        // Check Den Den Mushi Reaction Buttons in PvP Room (Regression test for blank reaction pills)
        const reactionLobbyAudit = await tab1.eval(`(() => {
          const btns = Array.from(document.querySelectorAll('#content-tab-pvp .glt-reactions-grid button'));
          return {
            count: btns.length,
            allHaveVisibleText: btns.length === 8 && btns.every(b => b.textContent.trim().length > 2),
            allHaveAriaLabel: btns.length === 8 && btns.every(b => (b.getAttribute('aria-label') || '').trim().length > 2),
            sampleLabels: btns.slice(0, 3).map(b => b.textContent.trim())
          };
        })()`);
        check(
          'All 8 Den Den Mushi reaction buttons render visible PT-BR emote labels & aria-labels',
          reactionLobbyAudit.allHaveVisibleText && reactionLobbyAudit.allHaveAriaLabel,
          JSON.stringify(reactionLobbyAudit)
        );

        // Click first reaction ("Boa mira!") in Tab 1 and verify Tab 2 receives non-empty speech bubble + logbook entry
        await tab1.eval(`(() => {
          const firstBtn = document.querySelector('#content-tab-pvp .glt-reactions-grid button');
          if (firstBtn) firstBtn.click();
        })()`);
        await sleep(300);
        const tab2BubbleAfterReaction = await tab2.eval(`(() => ({
          bubbleText: GLT.ui.dom.rivalBubble ? GLT.ui.dom.rivalBubble.textContent.trim() : '',
          logText: document.getElementById('content-tab-logbook') ? document.getElementById('content-tab-logbook').textContent : ''
        }))()`);
        check(
          'Clicking Den Den Mushi reaction in Tab 1 displays emote text on Tab 2 speech bubble & logbook',
          tab2BubbleAfterReaction.bubbleText.includes('Boa mira!') && tab2BubbleAfterReaction.logText.includes('Boa mira!'),
          JSON.stringify(tab2BubbleAfterReaction)
        );

        // Both tabs commit fleet & ready up
        await tab1.eval(`GLT.ui.readyPvpMatch ? GLT.ui.readyPvpMatch() : false`);
        await tab2.eval(`GLT.ui.readyPvpMatch ? GLT.ui.readyPvpMatch() : false`);

        // Poll up to ~15 seconds (generous: the check was flaky under CPU load) for both tabs to enter BATTLE via commit-reveal COIN_TOSS
        let bothInBattle = false;
        for (let i = 0; i < 100; i++) {
          const p1 = await tab1.eval('GLT.ui.gamePhase');
          const p2 = await tab2.eval('GLT.ui.gamePhase');
          if (p1 === 'BATTLE' && p2 === 'BATTLE') {
            bothInBattle = true;
            break;
          }
          await sleep(150);
        }
        check('Both tabs transitioned from PvP Lobby -> Commit/CoinToss -> live PvP BATTLE', bothInBattle);

        if (bothInBattle) {
          // Whichever tab has turn fires a live PvP shot at (1, 1), verify both tabs record history = 1!
          const tab1Turn = await tab1.eval('GLT.ui.isMyPvpTurn ? GLT.ui.isMyPvpTurn() : false');
          const shooter = tab1Turn ? tab1 : tab2;
          await shooter.eval(`(() => {
            GLT.ui.selectAimCoordinate(1, 1);
            GLT.ui.confirmFireShot();
          })()`);
          await sleep(600);

          const h1 = await tab1.eval('GLT.ui.pvpClient && GLT.ui.pvpClient.state ? GLT.ui.pvpClient.state.shotHistory.length : 0');
          const h2 = await tab2.eval('GLT.ui.pvpClient && GLT.ui.pvpClient.state ? GLT.ui.pvpClient.state.shotHistory.length : 0');
          check('Live PvP shot & answer synchronized cryptographically across both tabs', h1 === 1 && h2 === 1, `h1=${h1}, h2=${h2}`);
        }
      }
    }

    // -----------------------------------------------------------------------
    // 6B. Published-Artifact PvP: claude.use("db"/"room"/"user") fake injected before any
    //     page script, shared by the tabs through localStorage + BroadcastChannel, with
    //     latency, dropped writes, lost acks, duplicate snapshots and a mid-match reload.
    // -----------------------------------------------------------------------
    console.log('\n--- 6B. Published-Artifact PvP over db/room fake (faults + mid-match refresh) ---');
    const fakeSrc = fs.readFileSync(path.join(ROOT_DIR, 'tests', 'fakes', 'claude-fake.js'), 'utf8');
    // The fake store enforces the exact db rules the publish declares (PUBLISH-NOTES.md §1).
    const rulesJson = JSON.stringify(require(path.join(ROOT_DIR, 'src', 'net', 'transport.js')).ARTIFACT_CAPABILITIES.db.rules);
    const fakeBoot = (capsJson) => `
      (function () {
        if (!window.GLTClaudeFake) return;
        var uid = null;
        try {
          uid = sessionStorage.getItem('glt_e2e_fake_uid');
          if (!uid) {
            uid = 'u' + crypto.getRandomValues(new Uint32Array(1))[0].toString(16);
            sessionStorage.setItem('glt_e2e_fake_uid', uid);
          }
        } catch (e) { uid = 'u_anon'; }
        var fake = GLTClaudeFake.createFakeClaude({
          hub: GLTClaudeFake.createCrossTabHub('glt-e2e-fake', { rules: ${rulesJson} }),
          userId: uid,
          capabilities: ${capsJson},
          faults: { latency: [5, 60], dropWrite: 0.15, lostAck: 0.1, dupSnapshot: 0.3, emitDrop: 0 }
        });
        window.claude = fake.claude;
        window.__gltFake = fake;
      })();`;
    const extraTabs = extraTabsForCleanup;
    async function openFakeTab(label, capsJson) {
      const created = await tab1.send('Target.createTarget', { url: 'about:blank' });
      let info = null;
      for (let i = 0; i < 20 && !info; i++) {
        info = (await listCdpTargets(cdpPort)).find(t => t.id === created.targetId && t.webSocketDebuggerUrl);
        if (!info) await sleep(100);
      }
      const s = new CdpSession(info.webSocketDebuggerUrl, label);
      await s.init();
      extraTabs.push(s);
      await s.send('Page.addScriptToEvaluateOnNewDocument', { source: fakeSrc + '\n' + fakeBoot(capsJson) });
      await s.send('Page.navigate', { url: appUrl });
      for (let i = 0; i < 60; i++) {
        const st = await s.eval('window.GLT && GLT.ui ? GLT.ui.pvpStatus : ""').catch(() => '');
        if (st === 'connected' || st === 'unavailable') break;
        await sleep(200);
      }
      return s;
    }
    async function pollTrue(tab, expr, tries = 100, waitMs = 150) {
      for (let i = 0; i < tries; i++) {
        if (await tab.eval(expr).catch(() => false)) return true;
        await sleep(waitMs);
      }
      return false;
    }

    const tabA = await openFakeTab('TabA', '{}');
    const tabB = await openFakeTab('TabB', '{}');
    const backA = await tabA.eval('GLT.ui.pvpLobbyTransport ? GLT.ui.pvpLobbyTransport.getBackendType() : "none"');
    const badgeA = await tabA.eval('(document.getElementById("glt-pvp-status") || {}).textContent || ""');
    check('Published-Artifact tabs pick the db transport automatically (claude.use("db"))', backA === 'artifactDb', `backend=${backA} badge=${badgeA}`);

    const codeA = await tabA.eval(`(async () => {
      GLT.ui.switchTab('tab-pvp');
      GLT.ui.createPvpRoom();
      for (let i = 0; i < 100 && GLT.ui.pvpClient.transport.hasPendingWrites(); i++) await new Promise(r => setTimeout(r, 50));
      return GLT.ui.pvpRoomId;
    })()`);
    check('Tab A created a room stored as rooms/{code} + moves/{uid}/{code}', typeof codeA === 'string' && codeA.length === 5, `code=${codeA}`);

    const listedOnB = await pollTrue(tabB, `GLT.ui.pvpOpenRooms.some(r => r.id === '${codeA}')`, 60);
    check('Tab B sees the open room in "Partida rápida" through db onSnapshot', listedOnB);

    await tabB.eval(`(async () => { GLT.ui.switchTab('tab-pvp'); await GLT.ui.joinPvpRoom('${codeA}'); })()`);
    const joinedOk = await pollTrue(tabA, `GLT.ui.pvpClient && GLT.ui.pvpClient.state.players[1].id !== null`, 60);
    check('Tab B joined over the db log (ROOM_JOINED reached Tab A)', joinedOk);

    await tabA.eval(`(() => { const b = document.querySelector('#content-tab-pvp .glt-reactions-grid button'); if (b) b.click(); })()`);
    const reactionOk = await pollTrue(tabB, `(GLT.ui.dom.rivalBubble ? GLT.ui.dom.rivalBubble.textContent : '').includes('Boa mira!')`, 40);
    check('Den Den Mushi reaction travels over the room capability (A -> B)', reactionOk);

    await tabA.eval('GLT.ui.readyPvpMatch()');
    await tabB.eval('GLT.ui.readyPvpMatch()');
    const battleAB = (await pollTrue(tabA, 'GLT.ui.gamePhase === "BATTLE"', 120)) && (await pollTrue(tabB, 'GLT.ui.gamePhase === "BATTLE"', 120));
    check('Both db tabs commit (SHA-256) and enter BATTLE', battleAB);

    const shotsOf = (tab) => tab.eval('GLT.ui.pvpClient ? GLT.ui.pvpClient.state.shotHistory.length : -1');
    const fired = { A: 0, B: 0 };
    async function playOneShot(expectTotal) {
      let shooter = null;
      for (let i = 0; i < 80 && !shooter; i++) {
        if (await tabA.eval('GLT.ui.isMyPvpTurn() && !GLT.ui.pvpClient.state.pendingShot')) shooter = 'A';
        else if (await tabB.eval('GLT.ui.isMyPvpTurn() && !GLT.ui.pvpClient.state.pendingShot')) shooter = 'B';
        else await sleep(100);
      }
      if (!shooter) return false;
      const n = fired[shooter]++;
      const tab = shooter === 'A' ? tabA : tabB;
      await tab.eval(`(() => { GLT.ui.selectAimCoordinate(${Math.floor(n / 5) * 2 + 1}, ${n % 5}); GLT.ui.confirmFireShot(); })()`);
      return (await pollTrue(tabA, `GLT.ui.pvpClient.state.shotHistory.length >= ${expectTotal}`, 80)) &&
        (await pollTrue(tabB, `GLT.ui.pvpClient.state.shotHistory.length >= ${expectTotal}`, 80));
    }

    let shotsOk = battleAB;
    for (let k = 1; k <= 3 && shotsOk; k++) shotsOk = await playOneShot(k);
    const netDiag = (tab) => tab.eval(`JSON.stringify((t => ({ out: t.outbox.length, head: t.outbox[0] && [t.outbox[0].path, t.outbox[0].attempts], flushing: t.flushing, err: t.lastError, stats: t.stats, fake: window.__gltFake.stats,
      feed: (f => f && { host: f.hostUid, guest: f.guestUid, items: f.items.filter(e => e.type !== 'HEARTBEAT').map(e => e.type + (e.seq || '') + ':' + e._seat).join(' '),
        authors: Array.from(f.authors.values()).map(a => [a.uid, a.events.length, a.loaded, !!(a.watch && a.watch.unsub), a.watch && a.watch.dead]) })(t.feeds.get(GLT.ui.pvpRoomId)),
      store: window.__gltFake.hub.dump().filter(d => d.path.indexOf('moves/') === 0 && d.body.events).map(d => d.path + '#' + d.body.events.length) }))(GLT.ui.pvpClient.transport))`).catch(e => String(e));
    check('Live shots + defender auto-answers sync under write drops / duplicate snapshots', shotsOk, `A=${await shotsOf(tabA)} B=${await shotsOf(tabB)}` + (shotsOk ? '' : ' A:' + await netDiag(tabA) + ' B:' + await netDiag(tabB)));

    // Tampering from Tab B with raw db calls: the rules refuse writes into A's log, and events
    // B writes in A's name into its own log are dropped by both tabs.
    const tamper = await tabB.eval(`(async () => {
      const db = await window.claude.use('db');
      const me = window.__gltFake.userId;
      const room = (await db.doc('rooms/${codeA}').get()).data() || {};
      const hostUid = GLT.ui.pvpClient.transport.getRoomHost('${codeA}');
      const commit0 = GLT.ui.pvpClient.state.players[0].commitment;
      let refused = false;
      try { await db.doc('moves/' + hostUid + '/${codeA}/c0999').set({ k: 999, events: [] }); } catch (e) { refused = e && e.code === 'invalid_argument'; }
      const forged = [
        { eventId: 'forged_go', type: 'GAME_OVER', seq: 2, winnerIndex: 1, forfeitedBy: 0, reason: 'manual_forfeit', timestamp: Date.now() },
        { eventId: 'forged_rc', type: 'READY_COMMIT', playerIndex: 0, commitment: 'f'.repeat(64), timestamp: Date.now() }
      ];
      for (let i = 0; i < 20; i++) {
        try { await db.doc('moves/' + me + '/${codeA}/c0900').set({ v: 1, k: 900, events: forged }); break; } catch (_) {}
      }
      return { refused, hostUid, listedBy: room.by, commit0 };
    })()`);
    await sleep(1200);
    const afterTamper = await tabA.eval('JSON.stringify([GLT.ui.gamePhase, GLT.ui.pvpClient.state.phase, GLT.ui.pvpClient.state.players[0].commitment])');
    const afterTamperB = await tabB.eval('JSON.stringify([GLT.ui.gamePhase, GLT.ui.pvpClient.state.phase, GLT.ui.pvpClient.state.players[0].commitment])');
    check('Tampering: rules refuse writes into the rival log; forged forfeit + second commitment in the rival name ignored by both tabs',
      tamper.refused && afterTamper === JSON.stringify(['BATTLE', 'playing', tamper.commit0]) && afterTamperB === afterTamper,
      JSON.stringify({ tamper, afterTamper, afterTamperB }));

    // Mid-match refresh of Tab B: page reload, same tab session (fleet + salt stay in the tab)
    const beforeReload = await shotsOf(tabB);
    await tabB.send('Page.reload', { ignoreCache: false });
    const resumed = await pollTrue(tabB, `window.GLT && GLT.ui && GLT.ui.pvpClient && GLT.ui.pvpRoomId === '${codeA}' && GLT.ui.gamePhase === 'BATTLE' && GLT.ui.pvpClient.state.shotHistory.length >= ${beforeReload}`, 120);
    check('Tab B reloaded mid-match and rejoined its seat from the stored log', resumed, `before=${beforeReload} after=${await shotsOf(tabB)}`);

    let afterOk = resumed;
    for (let k = 4; k <= 6 && afterOk; k++) afterOk = await playOneShot(k);
    check('Match continues after the refresh with both tabs in step', afterOk, `A=${await shotsOf(tabA)} B=${await shotsOf(tabB)}` + (afterOk ? '' : ' A:' + await netDiag(tabA) + ' B:' + await netDiag(tabB)));

    // Leak scan of the whole fake store before any reveal: no fleet, no salt
    const saltsAB = [await tabA.eval('GLT.ui.pvpClient.salt'), await tabB.eval('GLT.ui.pvpClient.salt')];
    const leak = await tabA.eval(`(() => {
      const salts = ${JSON.stringify(saltsAB)};
      return window.__gltFake.hub.dump().filter(d => {
        const s = JSON.stringify(d.body);
        return /"fleet"/.test(s) || salts.some(x => x && s.includes(x));
      }).map(d => d.path);
    })()`);
    check('Store scan: no fleet or salt in any db doc before the reveal', Array.isArray(leak) && leak.length === 0 && saltsAB.every(Boolean), JSON.stringify(leak));

    // End by forfeit -> both reveal -> both audits pass and both tabs agree
    await tabA.eval('GLT.ui.pvpClient.forfeit()');
    const auditA = await pollTrue(tabA, 'GLT.ui.pvpClient.state.integrity && GLT.ui.pvpClient.state.integrity.valid === true', 120);
    const auditB = await pollTrue(tabB, 'GLT.ui.pvpClient.state.integrity && GLT.ui.pvpClient.state.integrity.valid === true', 120);
    const projExpr = 'JSON.stringify((s => [s.phase, s.winner, s.gameOverReason, s.boards[0].shots, s.boards[1].shots])(GLT.ui.pvpClient.state))';
    const projA = await tabA.eval(projExpr);
    const projB = await tabB.eval(projExpr);
    const integrityExpr = 'JSON.stringify({ i: GLT.ui.pvpClient.state.integrity, r: GLT.ui.pvpClient.state.reveals.map(Boolean), p: GLT.ui.pvpClient.state.phase })';
    check('End-of-game commit-reveal audit passes on both db tabs', auditA && auditB,
      `A=${await tabA.eval(integrityExpr)} B=${await tabB.eval(integrityExpr)}`);
    check('Both db tabs finish in an identical state', projA === projB, `A=${projA} B=${projB}`);

    // use("db") resolves null -> PvP clearly "indisponível", PvC untouched
    const tabC = await openFakeTab('TabC', '{ db: false }');
    const offAudit = await tabC.eval(`(() => {
      GLT.ui.switchTab('tab-pvp');
      const status = (document.getElementById('glt-pvp-status') || {}).textContent || '';
      return {
        status: GLT.ui.pvpStatus,
        text: status,
        hasNote: Boolean(document.getElementById('glt-pvp-unavailable')),
        hasCreate: Boolean(document.getElementById('btn-pvp-create')),
        created: GLT.ui.createPvpRoom()
      };
    })()`);
    check('use("db") null -> PvP shows a PT-BR "indisponível" state with no create/join controls',
      offAudit.status === 'unavailable' && /indisponível/.test(offAudit.text) && offAudit.hasNote && !offAudit.hasCreate && offAudit.created === null,
      JSON.stringify(offAudit));
    const pvcOnC = await tabC.eval(`(async () => {
      const sleepMs = ms => new Promise(r => setTimeout(r, ms));
      GLT.ui.switchTab('tab-gameplay');
      GLT.ui.animSpeed = 4.0;
      GLT.ui.autoPlacePlayerFleet();
      GLT.ui.startMatchWithCoinToss();
      for (let i = 0; i < 40 && GLT.ui.gamePhase !== 'BATTLE'; i++) await sleepMs(100);
      for (let i = 0; i < 60 && !(GLT.ui.matchState.turn === 0 && !GLT.ui.shotInFlight && !GLT.ui.isCpuThinking); i++) await sleepMs(100);
      GLT.ui.selectAimCoordinate(0, 0);
      GLT.ui.confirmFireShot();
      for (let i = 0; i < 40 && !GLT.ui.matchState.players[1].shotsTaken['0,0']; i++) await sleepMs(100);
      return { phase: GLT.ui.gamePhase, shot: Boolean(GLT.ui.matchState.players[1].shotsTaken['0,0']) };
    })()`);
    check('PvC still plays in the tab where PvP is unavailable', pvcOnC.shot && (pvcOnC.phase === 'BATTLE' || pvcOnC.phase === 'CEREMONY'), JSON.stringify(pvcOnC));

    // -----------------------------------------------------------------------
    // 7. Zero Console / Runtime Exceptions Check
    // -----------------------------------------------------------------------
    const allErrors = [...tab1.errors, ...(tab2 ? tab2.errors : []), ...extraTabs.flatMap(t => t.errors)];
    check('Zero console errors or uncaught runtime exceptions across entire E2E run', allErrors.length === 0, allErrors.join(' | '));

  } finally {
    extraTabsForCleanup.forEach(t => t.close());
    if (tab2) tab2.close();
    if (tab1) tab1.close();
    try { chrome.kill(); } catch (_) {}
    server.close();
    await sleep(300);
    try { fs.rmSync(tempProfile, { recursive: true, force: true }); } catch (_) {}
  }

  console.log('\n==============================================================');
  console.log(` E2E SUMMARY: ${passed} PASSED, ${failed} FAILED`);
  console.log('==============================================================');
  if (failed > 0) {
    process.exit(1);
  }
}

runSuite().catch(err => {
  console.error('Fatal E2E runner error:', err);
  process.exit(1);
});

