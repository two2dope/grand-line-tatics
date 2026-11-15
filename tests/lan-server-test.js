/**
 * Grand Line Tactics: Wi-Fi / LAN relay server rules (no browser needed).
 *
 * Covers what a second device on the network may and may not do:
 *  - only the device that opened a room can close it (owner token);
 *  - nobody can wipe every room at once;
 *  - a room whose host went quiet leaves "Salas Abertas" and comes back with its host;
 *  - presence is relayed but never stored;
 *  - each seat of a room belongs to the device that took it: nobody else publishes for it;
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

  const publish = (key, event, seatToken) => fetch(base + '/api/glt-lan/publish', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ key, event, seatToken })
  });
  const HOST_SEAT = 'host-seat-secret';
  const GUEST_SEAT = 'guest-seat-secret';
  const openRooms = async () => (await (await fetch(base + '/api/glt-lan/info')).json()).openRooms;
  const roomLog = async key => (await (await fetch(base + '/api/glt-lan/read?key=' + key)).json()).events;
  const announce = (id, token) => publish('glt_open_rooms', {
    id, host: 'Capitão', crewId: 'straw_hats', format: '10x10', mode: 'tatico', timestamp: Date.now(), ownerToken: token
  });

  try {
    // ---- ownership ----
    const created = await announce('AAAAA', 'host-secret');
    await publish('AAAAA', { type: 'ROOM_CREATED', eventId: 'e1', roomId: 'AAAAA' }, HOST_SEAT);
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
    await publish('AAAAA', { type: 'HEARTBEAT', playerIndex: 0 }, HOST_SEAT);
    check('Presence is relayed but never stored', (await roomLog('AAAAA')).every(e => e.type !== 'HEARTBEAT'));

    server.sweepIdleOpenRooms(Date.now() + 60 * 1000);
    check('A room with a recent host stays listed', (await openRooms()).some(r => r.id === 'AAAAA'));

    server.sweepIdleOpenRooms(Date.now() + 10 * 60 * 1000);
    check('A room whose host went quiet leaves the open list', !(await openRooms()).some(r => r.id === 'AAAAA'));
    check('...but keeps its match log', (await roomLog('AAAAA')).length === 1);

    await publish('AAAAA', { type: 'HEARTBEAT', playerIndex: 0 }, HOST_SEAT);
    check('The room is listed again when its host comes back', (await openRooms()).some(r => r.id === 'AAAAA'));

    // ---- seats ----
    const reason = async res => (await res.json()).reason;
    const noProof = await publish('AAAAA', { type: 'READY_COMMIT', eventId: 's1', playerIndex: 0 });
    check('An event without a seat secret is refused', noProof.status === 403 && (await reason(noProof)) === 'no_token');

    const asHost = await publish('AAAAA', { type: 'READY_COMMIT', eventId: 's2', playerIndex: 0 }, 'intruder');
    check('Another device cannot publish for the host seat', asHost.status === 403 && (await reason(asHost)) === 'wrong_seat');

    const early = await publish('AAAAA', { type: 'SHOT_FIRE', eventId: 's3', shooterIndex: 1 }, 'intruder');
    check('Nobody publishes for a seat that was not taken by joining', early.status === 403 && (await reason(early)) === 'seat_unclaimed');

    const joined = await publish('AAAAA', { type: 'ROOM_JOINED', eventId: 's4', role: 'player' }, GUEST_SEAT);
    const second = await publish('AAAAA', { type: 'ROOM_JOINED', eventId: 's5', role: 'player' }, 'intruder');
    check('The first device to join takes the guest seat', joined.status === 200);
    check('A second device is told the seat is taken', second.status === 403 && (await reason(second)) === 'seat_taken');

    const asGuest = await publish('AAAAA', { type: 'SHOT_FIRE', eventId: 's6', shooterIndex: 1 }, 'intruder');
    const forfeitForHost = await publish('AAAAA', { type: 'GAME_OVER', eventId: 's7', forfeitedBy: 0, winnerIndex: 1, reason: 'manual_forfeit' }, GUEST_SEAT);
    const noSeatEvent = await publish('AAAAA', { type: 'TURN_TIMEOUT', eventId: 's8' }, GUEST_SEAT);
    check('Another device cannot publish for the guest seat', asGuest.status === 403);
    check('A player cannot forfeit on behalf of the other', forfeitForHost.status === 403);
    check('An event that speaks for no seat is refused', noSeatEvent.status === 403 && (await reason(noSeatEvent)) === 'no_seat');

    const forged = await publish('AAAAA', { type: 'REACTION', eventId: 's9', playerIndex: 1, reactionId: 'gg', _seat: 0 }, GUEST_SEAT);
    const stored = await roomLog('AAAAA');
    const reaction = stored.find(e => e.eventId === 's9');
    check('The seat stamp comes from the server, not from the sender', forged.status === 200 && reaction && reaction._seat === 1);
    check('Stored events carry the seat of their author', stored.find(e => e.eventId === 'e1')._seat === 0 && stored.find(e => e.eventId === 's4')._seat === 1);
    check('Seat secrets never leave the server', !JSON.stringify(stored).includes(HOST_SEAT) && !JSON.stringify(stored).includes(GUEST_SEAT));

    const watcher = await publish('AAAAA', { type: 'ROOM_JOINED', eventId: 's10', role: 'spectator' });
    check('A spectator may join without a seat', watcher.status === 200);

    // ---- start and close by the owner ----
    const started = await publish('glt_open_rooms', { type: 'ROOM_DELETED', id: 'AAAAA', reason: 'started', ownerToken: 'host-secret' });
    check('Owner marks the match as started: off the list, log kept',
      started.status === 200 && !(await openRooms()).some(r => r.id === 'AAAAA') && (await roomLog('AAAAA')).length === 4);

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
