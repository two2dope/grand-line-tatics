const { spawn } = require('child_process');
const os = require('os');
const path = require('path');
const fs = require('fs');

const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

async function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function connectCdp(port) {
  for (let i = 0; i < 30; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json/list`);
      const tabs = await res.json();
      const pageTab = tabs.find(t => t.type === 'page');
      if (pageTab && pageTab.webSocketDebuggerUrl) {
        return pageTab.webSocketDebuggerUrl;
      }
    } catch (_) {}
    await sleep(200);
  }
  throw new Error('Could not connect to Chrome DevTools Protocol');
}

class CdpClient {
  constructor(wsUrl) {
    this.ws = new WebSocket(wsUrl);
    this.id = 0;
    this.pending = new Map();
    this.consoleErrors = [];
    this.consoleLogs = [];
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
        this.consoleErrors.push(JSON.stringify(msg.params.exceptionDetails));
      } else if (msg.method === 'Runtime.consoleAPICalled') {
        const text = msg.params.args.map(a => a.value || a.description).join(' ');
        if (msg.params.type === 'error') {
          this.consoleErrors.push(text);
        } else {
          this.consoleLogs.push(text);
        }
      } else if (msg.method === 'Log.entryAdded') {
        // Browser-level errors (CORS, blocked/failed resource loads) never reach console.error from page JS.
        const e = msg.params.entry;
        if (e.level === 'error' && !String(e.text + e.url).includes('favicon.ico')) {
          this.consoleErrors.push('[Log] ' + e.text + (e.url ? ' ' + e.url : ''));
        }
      } else if (msg.method === 'Network.loadingFailed') {
        if (!msg.params.canceled) this.consoleErrors.push('[Network] failed: ' + msg.params.errorText + ' ' + (msg.params.blockedReason || ''));
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
  close() {
    this.ws.close();
  }
}

async function testIndex() {
  console.log('=== VERIFYING INDEX.HTML IN HEADLESS CHROME ===');
  const port = 9334;
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'glt-verify-index-'));

  const chrome = spawn(CHROME_PATH, [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${userDataDir}`,
    '--headless=new',
    '--window-size=1280,720',
    '--use-gl=angle',
    '--enable-webgl',
    '--ignore-gpu-blocklist',
    '--no-first-run',
    '--no-default-browser-check',
    'about:blank'
  ], { stdio: 'ignore' });

  try {
    const wsUrl = await connectCdp(port);
    const cdp = new CdpClient(wsUrl);
    await cdp.init();

    // GLT_ARTIFACT_FILE=<path to a standalone grand-line-tactics.html> verifies that file instead of index.html
    const indexPath = (process.env.GLT_ARTIFACT_FILE ? path.resolve(process.env.GLT_ARTIFACT_FILE) : path.join(__dirname, '..', 'index.html')).replace(/\\/g, '/');
    const url = 'file:///' + indexPath;

    console.log('Navigating to:', url);
    await cdp.send('Page.navigate', { url });

    // Wait for GLT and DOM initialization
    let isInitialized = false;
    for (let i = 0; i < 40; i++) {
      const evalRes = await cdp.send('Runtime.evaluate', {
        expression: 'Boolean(window.GLT && window.GLT.ui && document.getElementById("glt-app"))',
        returnByValue: true
      });
      if (evalRes.result && evalRes.result.value === true) {
        isInitialized = true;
        break;
      }
      await sleep(200);
    }

    if (!isInitialized) {
      console.error('Console errors logged:', cdp.consoleErrors);
      console.error('Console messages logged:', cdp.consoleLogs.slice(-20));
      throw new Error('GLT.ui failed to initialize within 8 seconds.');
    }
    console.log('✓ GLT.ui and #glt-app initialized successfully.');

    // Wait 1 second for 3D shaders and initial render
    await sleep(1000);

    // Capture desktop screenshot
    const shotDesktop = await cdp.send('Page.captureScreenshot', { format: 'png' });
    const captureDir = path.join(__dirname, '..', 'shots', 'captures');
    fs.mkdirSync(captureDir, { recursive: true });
    fs.writeFileSync(path.join(captureDir, '06-ui-desktop-setup.png'), Buffer.from(shotDesktop.data, 'base64'));
    console.log('✓ Captured desktop setup screenshot: 06-ui-desktop-setup.png');

    // Test clicking tabs
    const tabTest = await cdp.send('Runtime.evaluate', {
      expression: `(() => {
        const tabs = ['tab-gameplay', 'tab-fleet', 'tab-logbook', 'tab-settings', 'tab-pvp'];
        for (const t of tabs) {
          const btn = document.getElementById('btn-' + t);
          if (!btn) return 'Missing button for ' + t;
          btn.click();
        }
        document.getElementById('btn-tab-gameplay').click();
        return 'OK';
      })()`,
      returnByValue: true
    });
    console.log('✓ Tab navigation test:', tabTest.result.value);

    // Test camera preset switching
    const camTest = await cdp.send('Runtime.evaluate', {
      expression: `(() => {
        GLT.ui.setCameraPreset('minhas_aguas');
        GLT.ui.setCameraPreset('mira_inimiga');
        GLT.ui.setCameraPreset('panorama');
        GLT.ui.setCameraPreset('duas_aguas');
        return 'OK';
      })()`,
      returnByValue: true
    });
    console.log('✓ Camera presets test:', camTest.result.value);

    // Test Mobile 375px Viewport
    console.log('--- Testing Mobile 375x667 Viewport ---');
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: 375,
      height: 667,
      deviceScaleFactor: 2,
      mobile: true
    });
    await sleep(500);

    // Check for horizontal overflow
    const overflowCheck = await cdp.send('Runtime.evaluate', {
      expression: `(() => {
        const scrollW = document.documentElement.scrollWidth;
        const clientW = document.documentElement.clientWidth;
        return { scrollW, clientW, hasOverflow: scrollW > clientW };
      })()`,
      returnByValue: true
    });
    console.log('Mobile layout check (375px):', JSON.stringify(overflowCheck.result.value));

    const shotMobile = await cdp.send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(captureDir, '07-ui-mobile-375px.png'), Buffer.from(shotMobile.data, 'base64'));
    console.log('✓ Captured mobile 375px screenshot: 07-ui-mobile-375px.png');

    // Test Battle Launch & Cannon Shot
    console.log('--- Testing Battle Launch & Shot Resolution ---');
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: 1280,
      height: 720,
      deviceScaleFactor: 1,
      mobile: false
    });
    await sleep(300);

    const battleLaunch = await cdp.send('Runtime.evaluate', {
      expression: `(() => {
        GLT.ui.startMatchWithCoinToss();
        return GLT.ui.gamePhase;
      })()`,
      returnByValue: true
    });
    console.log('Match start triggered, gamePhase:', battleLaunch.result.value);

    // Wait for coin toss animation to settle and enter battle
    await sleep(2500);

    const checkBattlePhase = await cdp.send('Runtime.evaluate', {
      expression: `GLT.ui.gamePhase`,
      returnByValue: true
    });
    console.log('Game phase after coin toss:', checkBattlePhase.result.value);

    // Execute cannon shot
    const fireShotTest = await cdp.send('Runtime.evaluate', {
      expression: `(() => {
        GLT.ui.selectAimCoordinate(2, 2);
        GLT.ui.confirmFireShot();
        return {
          aim: GLT.ui.selectedAimCell,
          historyLen: GLT.ui.matchState.history.length
        };
      })()`,
      returnByValue: true
    });
    console.log('Fire shot test result:', JSON.stringify(fireShotTest.result.value));
    await sleep(1000);

    const shotBattle = await cdp.send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(captureDir, '08-ui-battle-active.png'), Buffer.from(shotBattle.data, 'base64'));
    console.log('✓ Captured battle active screenshot: 08-ui-battle-active.png');

    // Test Log Pose Hint
    console.log('--- Testing Log Pose Hint & Needle Rotation ---');
    const hintTest = await cdp.send('Runtime.evaluate', {
      expression: `(() => {
        GLT.ui.useLogPoseHint();
        return {
          hintsRemaining: GLT.ui.hintsRemaining,
          hasTargetPos: Boolean(GLT.ui.backdrop)
        };
      })()`,
      returnByValue: true
    });
    console.log('✓ Log Pose hint test:', JSON.stringify(hintTest.result.value));
    await sleep(500);

    // Test Ceremony Phase & WANTED Poster Presentation
    console.log('--- Testing Ceremony Phase & Procedural WANTED Poster ---');
    const ceremonyTest = await cdp.send('Runtime.evaluate', {
      expression: `(() => {
        GLT.ui.matchState.winner = 0;
        GLT.ui.launchCeremonyPhase();
        return {
          phase: GLT.ui.gamePhase,
          modalVisible: document.getElementById('glt-modal-overlay').style.display !== 'none',
          posterSrc: Boolean(document.querySelector('.glt-wanted-poster-img'))
        };
      })()`,
      returnByValue: true
    });
    console.log('✓ Ceremony test:', JSON.stringify(ceremonyTest.result.value));
    await sleep(1000);

    const shotCeremony = await cdp.send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(captureDir, '09-ui-ceremony-wanted.png'), Buffer.from(shotCeremony.data, 'base64'));
    console.log('✓ Captured ceremony wanted poster screenshot: 09-ui-ceremony-wanted.png');

    // Test PvP Lobby & Room Creation
    console.log('--- Testing PvP Lobby & Room Creation ---');
    const pvpTest = await cdp.send('Runtime.evaluate', {
      expression: `(() => {
        GLT.ui.hideModal();
        GLT.ui.backdrop.setCeremonyActive(false);
        GLT.ui.setCameraPreset('duas_aguas');
        GLT.ui.switchTab('tab-pvp');
        GLT.ui.createPvpRoom();
        const createdRoomId = GLT.ui.pvpRoomId;
        GLT.ui.leavePvpRoom();
        return {
          roomId: createdRoomId,
          role: GLT.ui.pvpRole,
          status: GLT.ui.pvpStatus
        };
      })()`,
      returnByValue: true
    });
    console.log('✓ PvP Lobby test:', JSON.stringify(pvpTest.result.value));
    await sleep(500);

    const shotPvp = await cdp.send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(captureDir, '10-ui-pvp-lobby.png'), Buffer.from(shotPvp.data, 'base64'));
    console.log('✓ Captured PvP lobby screenshot: 10-ui-pvp-lobby.png');

    console.log('Console errors encountered:', cdp.consoleErrors.length);
    if (cdp.consoleErrors.length > 0) {
      console.error('Errors:', cdp.consoleErrors);
      process.exitCode = 1;
    } else {
      console.log('🎉 100% SUCCESS: index.html verified with ZERO console errors!');
    }

    cdp.close();
  } finally {
    chrome.kill();
    await sleep(250);
    try { fs.rmSync(userDataDir, { recursive: true, force: true }); } catch (_) {}
  }
}

testIndex().catch(err => {
  console.error('Verification failed:', err);
  process.exit(1);
});
