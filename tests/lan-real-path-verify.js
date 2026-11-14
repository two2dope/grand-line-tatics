/**
 * Grand Line Tactics: the path a real player takes over Wi-Fi.
 *
 * tests/lan-e2e-verify.js drives the game through its JS API on 127.0.0.1. That misses what
 * broke in practice, so this suite does what two people do:
 *  - the guest device reaches the game by the LAN IP (not a secure context: no crypto.subtle);
 *  - the guest opens the exact URL the host's QR Code carries;
 *  - every action is a real click / tap on the visible button;
 *  - every request to a host outside this machine is blocked, as on a Wi-Fi without internet.
 *
 * Needs a build (`npm run build`) and Chrome. Environment:
 *   GLT_BROWSER_CHANNEL  Playwright channel (default "chrome"; "" = Playwright's own Chromium)
 *   GLT_CHROME_ARGS      extra Chrome flags, space separated (replaces the per-OS GL defaults)
 */

'use strict';

const { chromium } = require('playwright');
const { createLanServer, detectLanUrls } = require('../scripts/lan-server.js');

// Two 3D game instances on one machine are slow (a page load can take 30 s): generous limits.
const WATCHDOG_MS = 540000;
const STEP_TIMEOUT = 60000;
const NAV_TIMEOUT = 120000;

function browserArgs() {
  if (process.env.GLT_CHROME_ARGS) return process.env.GLT_CHROME_ARGS.split(/\s+/).filter(Boolean);
  // The game needs WebGL. Windows: real GPU through ANGLE/D3D11. Elsewhere (CI): software GL.
  return process.platform === 'win32'
    ? ['--enable-gpu', '--use-angle=d3d11', '--ignore-gpu-blocklist']
    : ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];
}

async function launch() {
  const channel = process.env.GLT_BROWSER_CHANNEL !== undefined ? process.env.GLT_BROWSER_CHANNEL : 'chrome';
  const options = { args: browserArgs() };
  if (channel) options.channel = channel;
  return chromium.launch(options);
}

async function run() {
  let passed = 0;
  let failed = 0;
  function check(name, cond, detail) {
    if (cond) {
      passed++;
      console.log(`  [PASS] ${name}`);
    } else {
      failed++;
      console.error(`  [FAIL] ${name}${detail ? ' -> ' + detail : ''}`);
    }
  }

  console.log('==============================================================');
  console.log(' GRAND LINE TACTICS: WI-FI REAL PATH (LAN IP + QR URL + CLICKS)');
  console.log('==============================================================');

  const server = createLanServer();
  await new Promise(r => server.listen(0, '0.0.0.0', r));
  const port = server.address().port;
  const lanBase = detectLanUrls(port)[0] || '';
  const hostBase = `http://localhost:${port}`;
  const guestBase = lanBase || `http://127.0.0.1:${port}`;
  if (!lanBase) {
    console.warn('  [WARN] No LAN IPv4 address on this machine: guest falls back to 127.0.0.1 (secure context), insecure-context check skipped.');
  }

  const localHosts = new Set(['localhost', '127.0.0.1']);
  if (lanBase) localHosts.add(new URL(lanBase).hostname);
  const externalRequests = [];
  const pageErrors = [];
  const isExternal = url => {
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
    return !localHosts.has(url.hostname);
  };

  const browsers = [];
  async function openDevice(label, contextOptions) {
    const browser = await launch();
    browsers.push(browser);
    const context = await browser.newContext(contextOptions);
    // A Wi-Fi without internet: anything outside this machine never answers.
    await context.route(isExternal, route => {
      externalRequests.push(label + ' ' + new URL(route.request().url()).host);
      return route.abort();
    });
    const page = await context.newPage();
    page.setDefaultTimeout(STEP_TIMEOUT);
    page.setDefaultNavigationTimeout(NAV_TIMEOUT);
    page.on('pageerror', e => pageErrors.push(label + ' ' + String(e.message || e)));
    return page;
  }
  const lobbyReady = page => page.waitForFunction(
    () => window.GLT && GLT.ui && GLT.ui.pvpStatus === 'connected', null, { timeout: NAV_TIMEOUT });
  const serverJson = async pathAndQuery => (await fetch(`http://127.0.0.1:${port}${pathAndQuery}`)).json();

  try {
    const host = await openDevice('host', { viewport: { width: 1024, height: 640 }, reducedMotion: 'reduce' });
    const guest = await openDevice('guest', {
      viewport: { width: 360, height: 720 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true, reducedMotion: 'reduce'
    });

    // ---- 1. Host opens the Online tab and creates a room by clicking ----
    await host.goto(hostBase + '/', { waitUntil: 'domcontentloaded' });
    await lobbyReady(host);
    await host.click('#btn-tab-pvp');
    await host.waitForSelector('#btn-pvp-create');
    check('Host lobby shows no QR Code before a room exists',
      !(await host.$('.glt-qr-code-wrapper')));

    // A first room, closed again: closing asks twice.
    await host.click('#btn-pvp-create');
    await host.waitForSelector('.btn-delete-active-room');
    const firstRoom = await host.evaluate(() => GLT.ui.pvpRoomId);
    await host.click('.btn-delete-active-room');
    const afterOneClick = await host.evaluate(() => ({
      room: GLT.ui.pvpRoomId,
      armed: (document.querySelector('.btn-delete-active-room') || { getAttribute: () => null }).getAttribute('data-armed')
    }));
    check('First click on "Excluir Sala" only asks for confirmation',
      afterOneClick.room === firstRoom && afterOneClick.armed === '1', JSON.stringify(afterOneClick));
    await host.click('.btn-delete-active-room');
    await host.waitForFunction(() => !GLT.ui.pvpRoomId);
    check('Second click closes the host room',
      !(await serverJson('/api/glt-lan/info')).openRooms.some(r => r.id === firstRoom));

    // The room the match is played in.
    await host.click('#btn-pvp-create');
    await host.waitForSelector('#qr-room-wrapper');
    const roomId = await host.evaluate(() => GLT.ui.pvpRoomId);
    const qrUrl = (await host.textContent('.glt-lan-url-code')).trim();
    check('Host room shows the QR Code with the room link',
      /^[A-Z0-9]{5}$/.test(roomId) && qrUrl.endsWith('?room=' + roomId), qrUrl);
    if (lanBase) check('QR link uses the LAN IP, not localhost', qrUrl.startsWith(lanBase + '/'), qrUrl);

    // ---- 2. Second device browsing the lobby: sees the room, cannot close anything ----
    await guest.goto(guestBase + '/', { waitUntil: 'domcontentloaded' });
    await lobbyReady(guest);
    if (lanBase) {
      check('Guest device runs outside a secure context (like a phone on http://LAN-IP)',
        await guest.evaluate(() => window.isSecureContext === false));
    }
    await guest.tap('#btn-tab-pvp');
    await guest.waitForSelector('.open-room-card');
    const guestLobby = await guest.evaluate(() => ({
      cards: document.querySelectorAll('.open-room-card').length,
      deleteButtons: document.querySelectorAll('.btn-delete-room').length,
      clearButton: !!document.getElementById('btn-clear-open-rooms'),
      qr: !!document.querySelector('.glt-qr-code-wrapper')
    }));
    check('Guest lobby lists the host room without delete / clear controls',
      guestLobby.cards === 1 && guestLobby.deleteButtons === 0 && !guestLobby.clearButton && !guestLobby.qr,
      JSON.stringify(guestLobby));

    const forged = await guest.evaluate(async id => {
      const viaUi = GLT.ui.pvpLobbyTransport.deleteRoom(id);
      const one = await fetch('/api/glt-lan/rooms?id=' + id, { method: 'DELETE' });
      const all = await fetch('/api/glt-lan/rooms?all=1', { method: 'DELETE' });
      return { viaUi, one: one.status, all: all.status };
    }, roomId);
    check('Guest device cannot close the host room or clear the list',
      forged.viaUi === false && forged.one === 403 && forged.all === 403 &&
      (await serverJson('/api/glt-lan/info')).openRooms.some(r => r.id === roomId), JSON.stringify(forged));

    // ---- 3. Guest opens the QR Code URL ----
    await guest.goto(qrUrl, { waitUntil: 'domcontentloaded' });
    await lobbyReady(guest);
    await guest.waitForSelector('#glt-pvp-guest-title');
    const guestView = await guest.evaluate(() => ({
      room: GLT.ui.pvpRoomId,
      seat: GLT.ui.pvpClient && GLT.ui.pvpClient.playerIndex,
      qr: !!document.querySelector('.glt-qr-code-wrapper'),
      del: !!document.querySelector('.btn-delete-active-room'),
      copy: !!document.querySelector('#content-tab-pvp .btn-copy'),
      lanCard: !!document.querySelector('.glt-lan-share-card'),
      create: !!document.getElementById('btn-pvp-create')
    }));
    check('QR link lands the guest in the room, seat 2', guestView.room === roomId && guestView.seat === 1, JSON.stringify(guestView));
    check('Guest instance has no host controls (QR, copy link, delete, share card, create room)',
      !guestView.qr && !guestView.del && !guestView.copy && !guestView.lanCard && !guestView.create, JSON.stringify(guestView));

    await host.waitForFunction(() => {
      const st = GLT.ui.pvpClient && GLT.ui.pvpClient.state;
      return !!(st && st.players[1] && st.players[1].id);
    });
    check('Host stops showing the QR Code once the rival is seated', !(await host.$('#qr-room-wrapper')));

    // ---- 4. Both commit their fleets with real clicks ----
    const countRenders = page => page.evaluate(() => new Promise(resolve => {
      const original = GLT.ui.renderPvpTab;
      let n = 0;
      GLT.ui.renderPvpTab = function() { n++; return original.apply(this, arguments); };
      setTimeout(() => { GLT.ui.renderPvpTab = original; resolve(n); }, 7000);
    }));
    // The first presence of each seat legitimately redraws the tab once (absent -> present).
    // Let one heartbeat period (3 s) pass, then watch a window that spans two more.
    await host.waitForTimeout(4000);
    const renders = await Promise.all([countRenders(host), countRenders(guest)]);
    check('Online tab is not rebuilt while both players idle in the room (presence is silent)',
      renders[0] === 0 && renders[1] === 0, renders.join('/'));

    await host.click('#btn-pvp-ready');
    await guest.tap('#btn-pvp-ready');
    let phases = [];
    for (let i = 0; i < 60; i++) {
      phases = [await host.evaluate(() => GLT.ui.gamePhase), await guest.evaluate(() => GLT.ui.gamePhase)];
      if (phases[0] === 'BATTLE' && phases[1] === 'BATTLE') break;
      await host.waitForTimeout(250);
    }
    check('"Comprometer Frota" clicked on both devices starts the battle on both',
      phases[0] === 'BATTLE' && phases[1] === 'BATTLE', phases.join('/'));

    const log = (await serverJson('/api/glt-lan/read?key=' + roomId)).events.map(e => e.type);
    check('Server room log holds the match events and no presence',
      log.filter(t => t === 'READY_COMMIT').length === 2 && !log.includes('HEARTBEAT'), log.join(','));
    let listedAfterStart = true;
    for (let i = 0; i < 20 && listedAfterStart; i++) {
      listedAfterStart = (await serverJson('/api/glt-lan/info')).openRooms.some(r => r.id === roomId);
      if (listedAfterStart) await host.waitForTimeout(200);
    }
    check('Started room leaves "Salas Abertas"', !listedAfterStart);

    // ---- 5. Nothing came from outside this machine ----
    check('Game loaded and played with every external host blocked (no CDN needed)',
      externalRequests.length === 0, Array.from(new Set(externalRequests)).join(' | '));
    check('No page errors on either device', pageErrors.length === 0, pageErrors.join(' | '));
  } finally {
    await Promise.all(browsers.map(b => b.close().catch(() => {})));
    if (typeof server.closeAllConnections === 'function') server.closeAllConnections();
    server.close();
  }

  console.log('\n==============================================================');
  console.log(` LAN REAL PATH SUMMARY: ${passed} PASSED, ${failed} FAILED`);
  console.log('==============================================================');
  return failed;
}

const watchdog = setTimeout(() => {
  console.error('Fatal: LAN real path suite exceeded ' + WATCHDOG_MS + ' ms');
  process.exit(2);
}, WATCHDOG_MS);

run().then(failed => {
  clearTimeout(watchdog);
  process.exit(failed > 0 ? 1 : 0);
}).catch(err => {
  console.error('Fatal LAN real path error:', String(err && err.message ? err.message : err).split('\n').slice(0, 8).join('\n'));
  process.exit(1);
});
