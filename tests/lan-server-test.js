/**
 * Grand Line Tactics: Wi-Fi / LAN relay server rules (no browser needed).
 *
 * Covers what a second device on the network may and may not do:
 *  - only the device that opened a room can close it (owner token);
 *  - nobody can wipe every room at once;
 *  - a room whose host went quiet leaves "Salas Abertas" and comes back with its host;
 *  - presence is relayed but never stored;
 *  - the page is served without any external host (three.js and fonts come from this machine).
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { createLanServer, localizeExternalAssets } = require('../scripts/lan-server.js');

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

async function main() {
  console.log('=== GRAND LINE TACTICS: LAN RELAY SERVER RULES ===');

  const server = createLanServer();
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;

  const publish = (key, event) => fetch(base + '/api/glt-lan/publish', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ key, event })
  });
  const openRooms = async () => (await (await fetch(base + '/api/glt-lan/info')).json()).openRooms;
  const roomLog = async key => (await (await fetch(base + '/api/glt-lan/read?key=' + key)).json()).events;
  const announce = (id, token) => publish('glt_open_rooms', {
    id, host: 'Capitão', crewId: 'straw_hats', format: '10x10', mode: 'tatico', timestamp: Date.now(), ownerToken: token
  });

  try {
    // ---- ownership ----
    const created = await announce('AAAAA', 'host-secret');
    await publish('AAAAA', { type: 'ROOM_CREATED', eventId: 'e1', roomId: 'AAAAA' });
    let rooms = await openRooms();
    check('Host announces a room', created.status === 200 && rooms.some(r => r.id === 'AAAAA'));
    check('Owner token never leaves the server', !JSON.stringify(rooms).includes('host-secret'));

    const hijack = await announce('AAAAA', 'other-secret');
    check('Another device cannot re-announce a room it does not own', hijack.status === 403);

    const noToken = await fetch(base + '/api/glt-lan/rooms?id=AAAAA', { method: 'DELETE' });
    const badToken = await fetch(base + '/api/glt-lan/rooms?id=AAAAA&token=guess', { method: 'DELETE' });
    const viaPublish = await publish('glt_open_rooms', { type: 'ROOM_DELETED', id: 'AAAAA' });
    const fakeStart = await publish('glt_open_rooms', { type: 'ROOM_DELETED', id: 'AAAAA', reason: 'started' });
    rooms = await openRooms();
    check('Delete without / with wrong token is refused (403)',
      noToken.status === 403 && badToken.status === 403 && viaPublish.status === 403 && fakeStart.status === 403,
      [noToken.status, badToken.status, viaPublish.status, fakeStart.status].join(','));
    check('Refused deletes leave the room and its log intact',
      rooms.some(r => r.id === 'AAAAA') && (await roomLog('AAAAA')).length === 1);

    const clearAll = await fetch(base + '/api/glt-lan/rooms?all=1', { method: 'DELETE' });
    const clearEvent = await publish('glt_open_rooms', { type: 'ROOMS_CLEARED' });
    check('Nobody can clear every room at once', clearAll.status === 403 && clearEvent.status === 403 &&
      (await openRooms()).some(r => r.id === 'AAAAA'));

    // ---- presence and idle rooms ----
    await publish('AAAAA', { type: 'HEARTBEAT', playerIndex: 0 });
    check('Presence is relayed but never stored', (await roomLog('AAAAA')).every(e => e.type !== 'HEARTBEAT'));

    server.sweepIdleOpenRooms(Date.now() + 60 * 1000);
    check('A room with a recent host stays listed', (await openRooms()).some(r => r.id === 'AAAAA'));

    server.sweepIdleOpenRooms(Date.now() + 10 * 60 * 1000);
    check('A room whose host went quiet leaves the open list', !(await openRooms()).some(r => r.id === 'AAAAA'));
    check('...but keeps its match log', (await roomLog('AAAAA')).length === 1);

    await publish('AAAAA', { type: 'HEARTBEAT', playerIndex: 0 });
    check('The room is listed again when its host comes back', (await openRooms()).some(r => r.id === 'AAAAA'));

    // ---- start and close by the owner ----
    const started = await publish('glt_open_rooms', { type: 'ROOM_DELETED', id: 'AAAAA', reason: 'started', ownerToken: 'host-secret' });
    check('Owner marks the match as started: off the list, log kept',
      started.status === 200 && !(await openRooms()).some(r => r.id === 'AAAAA') && (await roomLog('AAAAA')).length === 1);

    const stillOwned = await announce('AAAAA', 'other-secret');
    check('A started room code cannot be taken over', stillOwned.status === 403);

    const closed = await fetch(base + '/api/glt-lan/rooms?id=AAAAA&token=host-secret', { method: 'DELETE' });
    check('Owner closes its room: log removed', closed.status === 200 && (await roomLog('AAAAA')).length === 0);

    // ---- nothing external, nothing outside assets/ ----
    const template = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'build.js'), 'utf8');
    const localized = localizeExternalAssets(template);
    check('Served page loads three.js from this machine',
      !localized.includes('cdnjs.cloudflare.com') && localized.includes('/vendor/three.min.js'));
    check('Served page loads fonts from this machine',
      !localized.includes('fonts.googleapis.com') && !localized.includes('fonts.gstatic.com') &&
      localized.includes('/assets/fonts/fonts.css'));

    const three = await fetch(base + '/vendor/three.min.js');
    check('GET /vendor/three.min.js', three.status === 200 && (await three.text()).includes('Three.js Authors'));

    const fontsCss = await fetch(base + '/assets/fonts/fonts.css');
    const cssText = await fontsCss.text();
    const fontFiles = cssText.match(/url\(([^)]+\.woff2)\)/g) || [];
    check('GET /assets/fonts/fonts.css references only local files',
      fontsCss.status === 200 && fontFiles.length > 0 && !cssText.includes('http'));
    let fontsOk = fontFiles.length > 0;
    for (const ref of fontFiles) {
      const name = ref.slice(4, -1);
      const res = await fetch(base + '/assets/fonts/' + name);
      await res.arrayBuffer();
      if (res.status !== 200 || res.headers.get('content-type') !== 'font/woff2') fontsOk = false;
    }
    check('Every font file in fonts.css is served as font/woff2', fontsOk);

    const escape1 = await fetch(base + '/assets/..%2fpackage.json');
    const escape2 = await fetch(base + '/assets/..%5cpackage.json');
    check('Static files cannot escape assets/', escape1.status === 404 && escape2.status === 404,
      escape1.status + ',' + escape2.status);
  } finally {
    if (typeof server.closeAllConnections === 'function') server.closeAllConnections();
    server.close();
  }

  console.log(`RESULTS: ${passed}/${passed + failed} tests passed`);
  if (failed > 0) process.exit(1);
}

main().catch(err => {
  console.error('Fatal LAN server test error:', err);
  process.exit(1);
});
