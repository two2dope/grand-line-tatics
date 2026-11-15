/**
 * Grand Line Tactics — Cross-Device Wi-Fi / LAN Server E2E Verification
 *
 * Spawns TWO completely separate Chrome processes with isolated user-data-dirs
 * (zero shared localStorage or BroadcastChannel — simulating PC + Smartphone on Wi-Fi!)
 * connected exclusively via scripts/lan-server.js over HTTP + Server-Sent Events (SSE).
 *
 * Verifies:
 * 1. Device A & Device B detect `lanRelay` backend and render LAN Share Card.
 * 2. Device A creates a room -> Device B immediately sees it in SALAS ABERTAS over SSE!
 * 3. XSS hardening: malicious HTML nickname (`<img src=x onerror=window.__xss=1>`) renders strictly as safe text.
 * 4. Device B joins room, exchanges Den Den Mushi reaction with Device A, commits SHA-256 fleet,
 *    enters live PvP BATTLE, and synchronizes cannon shots across isolated devices!
 * 5. Room deletion (`Excluir Sala`) by the host removes the room across both devices in real time;
 *    the other device gets no delete button for a room it did not open.
 */

'use strict';

const http = require('http');
const net = require('net');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');
const { createLanServer } = require('../scripts/lan-server.js');

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

function findChromeBinary() {
  const candidates = [
    process.env.CHROME_PATH,
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'
  ].filter(Boolean);
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  throw new Error('No Chromium binary found.');
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

function listCdpTargets(port) {
  return new Promise((resolve, reject) => {
    const req = http.get(`http://127.0.0.1:${port}/json/list`, res => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
  });
}

class CdpSession {
  constructor(wsUrl, label) {
    this.wsUrl = wsUrl;
    this.label = label;
    this.ws = null;
    this.nextId = 1;
    this.pending = new Map();
    this.errors = [];
  }

  async init() {
    this.ws = new WebSocket(this.wsUrl);
    await new Promise((resolve, reject) => {
      this.ws.addEventListener('open', resolve, { once: true });
      this.ws.addEventListener('error', reject, { once: true });
    });

    this.ws.addEventListener('message', ev => {
      const msg = JSON.parse(typeof ev.data === 'string' ? ev.data : ev.data.toString());
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(JSON.stringify(msg.error)));
        else resolve(msg.result);
      } else if (msg.method === 'Runtime.exceptionThrown') {
        const details = msg.params.exceptionDetails;
        const text = (details.exception && details.exception.description) || details.text || 'Exception';
        this.errors.push(`[${this.label}] ${text}`);
      } else if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
        const text = (msg.params.args || []).map(a => a.value || a.description || '').join(' ');
        if (!text.includes('favicon.ico')) {
          this.errors.push(`[${this.label}:console.error] ${text}`);
        }
      } else if (msg.method === 'Log.entryAdded') {
        const e = msg.params.entry;
        if (e.level === 'error' && !String(e.text + (e.url || '')).includes('favicon.ico')) {
          this.errors.push(`[${this.label}:log] ${e.text} ${e.url || ''}`);
        }
      } else if (msg.method === 'Network.loadingFailed' && !msg.params.canceled) {
        this.errors.push(`[${this.label}:network] ${msg.params.errorText} ${msg.params.blockedReason || ''}`);
      }
    });

    await this.send('Runtime.enable');
    await this.send('Page.enable');
    await this.send('Log.enable');
    await this.send('Network.enable');
  }

  send(method, params = {}) {
    const id = this.nextId++;
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
      throw new Error(`Eval error (${this.label}): ${res.exceptionDetails.text}`);
    }
    return res.result ? res.result.value : undefined;
  }

  close() {
    try { if (this.ws) this.ws.close(); } catch (_) {}
  }
}

async function spawnIsolatedDevice(chromeBin, cdpPort, profileDir, url, label) {
  const proc = spawn(chromeBin, [
    `--remote-debugging-port=${cdpPort}`,
    `--user-data-dir=${profileDir}`,
    '--headless=new',
    '--window-size=1280,800',
    '--use-gl=angle',
    '--enable-webgl',
    '--ignore-gpu-blocklist',
    '--no-first-run',
    '--no-default-browser-check',
    url
  ], { stdio: 'ignore' });

  let targets = null;
  for (let i = 0; i < 60; i++) {
    try {
      targets = await listCdpTargets(cdpPort);
      if (targets && targets.some(t => t.type === 'page' && t.webSocketDebuggerUrl)) break;
    } catch (_) {}
    await sleep(250);
  }
  const page = targets && targets.find(t => t.type === 'page' && t.webSocketDebuggerUrl);
  if (!page) {
    try { proc.kill(); } catch (_) {}
    throw new Error(`Failed to attach CDP to ${label}`);
  }
  const session = new CdpSession(page.webSocketDebuggerUrl, label);
  await session.init();

  for (let i = 0; i < 40; i++) {
    const ready = await session.eval('Boolean(window.GLT && window.GLT.ui)');
    if (ready) break;
    await sleep(200);
  }
  return { proc, session };
}

async function runLanE2E() {
  let passed = 0;
  let failed = 0;
  function check(name, cond, detail = '') {
    if (cond) {
      passed++;
      console.log(`  [PASS] ${name}`);
    } else {
      failed++;
      console.error(`  [FAIL] ${name}${detail ? ' -> ' + detail : ''}`);
    }
  }

  console.log('==============================================================');
  console.log(' GRAND LINE TACTICS — 2-DEVICE WI-FI / LAN RELAY E2E SUITE');
  console.log('==============================================================');

  const lanServer = createLanServer();
  await new Promise(r => lanServer.listen(0, '127.0.0.1', r));
  const lanPort = lanServer.address().port;
  const lanUrl = `http://127.0.0.1:${lanPort}/`;

  const chromeBin = findChromeBinary();
  const profileA = fs.mkdtempSync(path.join(os.tmpdir(), 'glt-devA-'));
  const profileB = fs.mkdtempSync(path.join(os.tmpdir(), 'glt-devB-'));

  let devA = null;
  let devB = null;

  try {
    const portA = await getFreePort();
    devA = await spawnIsolatedDevice(chromeBin, portA, profileA, lanUrl, 'DeviceA_PC');
    await sleep(300);
    const portB = await getFreePort();
    devB = await spawnIsolatedDevice(chromeBin, portB, profileB, lanUrl, 'DeviceB_Phone');

    // 1. Both isolated devices detect lanRelay backend
    const backendA = await devA.session.eval('GLT.ui.pvpLobbyTransport.getBackendType()');
    const backendB = await devB.session.eval('GLT.ui.pvpLobbyTransport.getBackendType()');
    check('Isolated Device A & Device B both activate lanRelay backend', backendA === 'lanRelay' && backendB === 'lanRelay', `${backendA} / ${backendB}`);

    // 2. Device A sets an XSS-probe nickname & creates room -> Device B sees it safely in SALAS ABERTAS!
    const roomCode = await devA.session.eval(`(() => {
      GLT.ui.switchTab('tab-pvp');
      GLT.ui.saveStoredNickname('Luffy <img src=x onerror="window.__xss=1">');
      return GLT.ui.createPvpRoom();
    })()`);
    check('Device A created 5-char Wi-Fi room', typeof roomCode === 'string' && roomCode.length === 5, roomCode);

    await devB.session.eval(`GLT.ui.switchTab('tab-pvp')`);
    let seenOnDeviceB = false;
    for (let i = 0; i < 25; i++) {
      const hasRoom = await devB.session.eval(`GLT.ui.pvpOpenRooms.some(r => r.id === '${roomCode}')`);
      if (hasRoom) {
        seenOnDeviceB = true;
        break;
      }
      await sleep(120);
    }
    check('Isolated Device B discovered Device A room live over SSE (SALAS ABERTAS)', seenOnDeviceB);

    const xssCheck = await devB.session.eval(`(() => ({
      xssTriggered: Boolean(window.__xss),
      injectedImgCount: document.querySelectorAll('#content-tab-pvp .open-room-info img').length,
      hasDeleteBtn: Boolean(document.querySelector('#content-tab-pvp .btn-delete-room'))
    }))()`);
    check('Untrusted LAN nickname rendered strictly as textContent (zero DOM XSS)', !xssCheck.xssTriggered && xssCheck.injectedImgCount === 0, JSON.stringify(xssCheck));
    check('Open room card on another device has no Excluir Sala (✕) button', !xssCheck.hasDeleteBtn);

    // 3. Device B joins room via async LAN hydration, sends Den Den Mushi emote to Device A
    await devB.session.eval(`(async () => {
      await GLT.ui.joinPvpRoom('${roomCode}', 'player');
    })()`);
    await sleep(300);

    await devB.session.eval(`(() => {
      const btn = document.querySelector('#content-tab-pvp .glt-reactions-grid button[data-reaction-id="gg"]');
      if (btn) btn.click();
    })()`);

    let reactionArrivedOnA = false;
    for (let i = 0; i < 20; i++) {
      const bubbleA = await devA.session.eval(`GLT.ui.dom.rivalBubble ? GLT.ui.dom.rivalBubble.textContent : ''`);
      if (bubbleA.includes('GG, capitão!')) {
        reactionArrivedOnA = true;
        break;
      }
      await sleep(120);
    }
    check('Den Den Mushi emote transmitted live from Device B -> Device A over Wi-Fi relay', reactionArrivedOnA);

    // 4. Both devices commit SHA-256 fleets -> transition to BATTLE -> fire shot across devices!
    await devA.session.eval(`GLT.ui.readyPvpMatch()`);
    await devB.session.eval(`GLT.ui.readyPvpMatch()`);

    let bothPlaying = false;
    for (let i = 0; i < 30; i++) {
      const pA = await devA.session.eval('GLT.ui.gamePhase');
      const pB = await devB.session.eval('GLT.ui.gamePhase');
      if (pA === 'BATTLE' && pB === 'BATTLE') {
        bothPlaying = true;
        break;
      }
      await sleep(150);
    }
    check('Both isolated devices transitioned to live PvP BATTLE after SHA-256 commits', bothPlaying);

    if (bothPlaying) {
      const aTurn = await devA.session.eval('GLT.ui.isMyPvpTurn()');
      const activeDev = aTurn ? devA.session : devB.session;
      await activeDev.eval(`(() => {
        GLT.ui.selectAimCoordinate(2, 3);
        GLT.ui.confirmFireShot();
      })()`);

      let shotSynced = false;
      for (let i = 0; i < 25; i++) {
        const hA = await devA.session.eval('GLT.ui.pvpClient.state.shotHistory.length');
        const hB = await devB.session.eval('GLT.ui.pvpClient.state.shotHistory.length');
        if (hA === 1 && hB === 1) {
          shotSynced = true;
          break;
        }
        await sleep(120);
      }
      check('Cannon shot & cryptographic answer synced across isolated devices', shotSynced);
    }

    // 5. Room deletion (`deleteOpenPvpRoom`) deletes room on BOTH Device A and Device B!
    await devB.session.eval(`GLT.ui.leavePvpRoom(); GLT.ui.switchTab('tab-pvp');`);
    await devA.session.eval(`GLT.ui.deleteOpenPvpRoom('${roomCode}')`);

    let deletedEverywhere = false;
    for (let i = 0; i < 25; i++) {
      const countA = await devA.session.eval('GLT.ui.pvpOpenRooms.length');
      const countB = await devB.session.eval('GLT.ui.pvpOpenRooms.length');
      if (countA === 0 && countB === 0) {
        deletedEverywhere = true;
        break;
      }
      await sleep(120);
    }
    check('Deleting room removes it live across both Device A and Device B', deletedEverywhere);

    const errs = [...devA.session.errors, ...devB.session.errors];
    check('Zero console/runtime errors across both isolated devices', errs.length === 0, errs.join(' | '));

  } finally {
    if (devA) { devA.session.close(); try { devA.proc.kill(); } catch (_) {} }
    if (devB) { devB.session.close(); try { devB.proc.kill(); } catch (_) {} }
    if (typeof lanServer.closeAllConnections === 'function') lanServer.closeAllConnections();
    lanServer.close();
    await sleep(300);
    try { fs.rmSync(profileA, { recursive: true, force: true }); } catch (_) {}
    try { fs.rmSync(profileB, { recursive: true, force: true }); } catch (_) {}
  }

  console.log('\n==============================================================');
  console.log(` LAN E2E SUMMARY: ${passed} PASSED, ${failed} FAILED`);
  console.log('==============================================================');
  if (failed > 0) process.exit(1);
}

runLanE2E().catch(err => {
  console.error('Fatal LAN E2E error:', err);
  process.exit(1);
});
