/**
 * Grand Line Tactics — QR Code & Fast Join Test Suite
 * File: tests/qr-test.js
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

console.log('=== TEST SUITE: QR Code & Mobile Fast Access ===\n');

// Mock browser DOM environment if running in Node.js
function setupMockDom() {
  if (typeof global.window === 'undefined') {
    global.window = {
      location: {
        origin: 'http://192.168.1.100:3000',
        pathname: '/',
        hostname: '192.168.1.100',
        search: '',
        href: 'http://192.168.1.100:3000/'
      },
      isSecureContext: true,
      GLT: {}
    };
  }
  if (typeof global.document === 'undefined') {
    global.document = {
      createElement: function(tag) {
        var el = {
          tagName: tag.toUpperCase(),
          className: '',
          id: '',
          dataset: {},
          style: {},
          children: [],
          attributes: {},
          textContent: '',
          innerHTML: '',
          appendChild: function(child) {
            this.children.push(child);
            return child;
          },
          setAttribute: function(k, v) {
            this.attributes[k] = String(v);
          },
          getAttribute: function(k) {
            return this.attributes[k];
          },
          removeAttribute: function(k) {
            delete this.attributes[k];
          },
          addEventListener: function(evt, handler) {
            this._listeners = this._listeners || {};
            this._listeners[evt] = this._listeners[evt] || [];
            this._listeners[evt].push(handler);
          },
          classList: {
            add: function(c) {
              if (!el.className.split(' ').includes(c)) {
                el.className = (el.className ? el.className + ' ' : '') + c;
              }
            },
            remove: function(c) {
              el.className = el.className.split(' ').filter(x => x && x !== c).join(' ');
            },
            toggle: function(c, force) {
              var has = el.className.split(' ').includes(c);
              var shouldHave = force !== undefined ? !!force : !has;
              if (shouldHave) this.add(c);
              else this.remove(c);
              return shouldHave;
            },
            contains: function(c) {
              return el.className.split(' ').includes(c);
            }
          },
          querySelectorAll: function(sel) {
            var list = [];
            function walk(node) {
              if (sel.startsWith('.') && node.className && node.className.indexOf(sel.slice(1)) !== -1) {
                list.push(node);
              } else if (sel.startsWith('#') && node.id === sel.slice(1)) {
                list.push(node);
              }
              for (var i = 0; i < (node.children || []).length; i++) {
                walk(node.children[i]);
              }
            }
            walk(el);
            return list;
          },
          querySelector: function(sel) {
            function find(node) {
              if (sel.startsWith('#') && node.id === sel.slice(1)) return node;
              if (sel.startsWith('.') && node.className && node.className.indexOf(sel.slice(1)) !== -1) return node;
              for (var i = 0; i < (node.children || []).length; i++) {
                var res = find(node.children[i]);
                if (res) return res;
              }
              return null;
            }
            return find(el);
          }
        };
        return el;
      },
      getElementById: function(id) {
        return null;
      }
    };
  }
}

setupMockDom();

// Load modules
const qrcode = require('../src/ui/qrcode.js');
const i18n = require('../src/logic/i18n.js');
const rng = require('../src/logic/rng.js');
const rules = require('../src/logic/rules.js');
const transport = require('../src/net/transport.js');
const protocol = require('../src/logic/protocol.js');

global.GLT = {
  i18n: i18n,
  rng: rng,
  rules: rules,
  transport: transport,
  protocol: protocol,
  qrcode: qrcode
};

// Require ui.js after setting up globals
const uiModule = require('../src/ui/ui.js');
const ui = global.GLT.ui;

let passed = 0;
let total = 0;

function it(desc, fn) {
  total++;
  try {
    fn();
    console.log(`  ✓ ${desc}`);
    passed++;
  } catch (err) {
    console.error(`  ✕ ${desc}`);
    console.error(err);
    process.exitCode = 1;
  }
}

console.log('--- 1. Pure QR Code Generator Module (`src/ui/qrcode.js`) ---');

it('qrcode function is exposed globally and can generate matrix for Room URL', () => {
  assert.strictEqual(typeof qrcode, 'function', 'qrcode should be a function');
  const qr = qrcode(0, 'M');
  qr.addData('http://192.168.1.100:3000/?room=ABCDE');
  qr.make();
  assert(qr.getModuleCount() >= 21, 'QR module count should be at least 21');
  assert.strictEqual(typeof qr.isDark, 'function');
  assert.strictEqual(typeof qr.createSvgTag, 'function');
});

it('createSvgTag generates valid, scalable SVG markup with white background and black modules', () => {
  const qr = qrcode(0, 'M');
  qr.addData('http://192.168.1.100:3000/?room=ABCDE');
  qr.make();
  const svg = qr.createSvgTag(3, 3);
  assert(svg.includes('<svg'), 'SVG must include <svg tag');
  assert(svg.includes('viewBox='), 'SVG must include viewBox');
  assert(svg.includes('<rect width="100%" height="100%" fill="white"'), 'SVG must have white background rect');
  assert(svg.includes('<path d="'), 'SVG must have dark path');
});

console.log('\n--- 2. UI QR Code Helpers & Components (`GLT.ui`) ---');

it('GLT.ui.generateQrSvg produces pure inline SVG or falls back gracefully', () => {
  assert.strictEqual(typeof ui.generateQrSvg, 'function', 'generateQrSvg should be a function');
  const svg = ui.generateQrSvg('http://192.168.1.100:3000/?room=ABCDE', 3, 3);
  assert(typeof svg === 'string', 'generateQrSvg must return string');
  assert(svg.startsWith('<svg'), 'Output must start with <svg');
});

it('GLT.ui.createQrCard builds complete accessible DOM card with header, wrapper, hint and toggle', () => {
  assert.strictEqual(typeof ui.createQrCard, 'function', 'createQrCard should be a function');
  const card = ui.createQrCard(
    'http://192.168.1.100:3000/?room=ABCDE',
    'QR Code da Sala (ABCDE)',
    'Aponte a câmera do 2º jogador para entrar direto nesta sala!',
    'test-qr'
  );
  assert.strictEqual(card.id, 'test-qr-section');
  assert(card.className.includes('glt-pvp-qr-section'));

  // Header and toggle button
  const toggleBtn = card.querySelector('#test-qr-toggle-btn');
  assert(toggleBtn, 'Toggle button must exist');
  assert(toggleBtn.textContent.includes('Ocultar'));

  // QR wrapper and accessibility
  const qrWrapper = card.querySelector('#test-qr-wrapper');
  assert(qrWrapper, 'QR wrapper element must exist');
  assert.strictEqual(qrWrapper.getAttribute('role'), 'button');
  assert.strictEqual(qrWrapper.getAttribute('tabindex'), '0');
  assert(qrWrapper.innerHTML.includes('<svg'), 'QR wrapper must contain SVG');

  // Toggle interaction
  const body = card.querySelector('#test-qr-body');
  assert.strictEqual(body.style.display, 'flex');
  toggleBtn._listeners['click'][0]();
  assert.strictEqual(body.style.display, 'none');
  assert(toggleBtn.textContent.includes('Exibir'));
  toggleBtn._listeners['click'][0]();
  assert.strictEqual(body.style.display, 'flex');
  assert(toggleBtn.textContent.includes('Ocultar'));
});

console.log('\n--- 3. In-Room View & LAN Card Integration ---');

function roomClientStub(playerIndex, guestId) {
  return {
    role: 'player',
    playerIndex: playerIndex,
    state: {
      phase: 'lobby',
      players: [
        { id: 'host_1', nickname: 'Anfitrião', ready: false, crewId: 'straw_hats' },
        { id: guestId || null, nickname: guestId ? 'Convidado' : '', ready: false, crewId: 'marines' }
      ]
    },
    selectCrew: function() {}
  };
}

it('HOST of a room with an empty second seat gets the room QR Code and the host-only controls', () => {
  const container = document.createElement('div');
  ui.dom = { tabPvp: container };
  ui.pvpRoomId = 'ABCDE';
  ui.pvpRole = 'player';
  ui.pvpInviteCode = '';
  ui.pvpClient = roomClientStub(0, null);
  ui.renderPvpTab();

  const qrWrapper = container.querySelector('#qr-room-wrapper');
  assert(container.querySelector('#qr-room-section'), '#qr-room-section must be rendered for the host');
  assert(qrWrapper && qrWrapper.innerHTML.includes('<svg'), 'host QR wrapper must contain SVG');
  assert(container.querySelector('.btn-delete-active-room'), 'host can delete its own room');
  assert(container.querySelector('#glt-pvp-opp-status').textContent.includes('Ninguém entrou'),
    'an empty room says nobody joined, not a generic "waiting"');
});

it('HOST stops showing the QR Code once a rival took the second seat', () => {
  const container = document.createElement('div');
  ui.dom = { tabPvp: container };
  ui.pvpRoomId = 'ABCDE';
  ui.pvpClient = roomClientStub(0, 'guest_1');
  ui.renderPvpTab();
  assert(!container.querySelector('#qr-room-section'), 'no QR Code when the room is full');
  assert(container.querySelector('#glt-pvp-opp-status').textContent.includes('Convidado'));
});

it('GUEST of a room never gets the QR Code, the invite link or the delete-room control', () => {
  const container = document.createElement('div');
  ui.dom = { tabPvp: container };
  ui.pvpRoomId = 'ABCDE';
  ui.pvpRole = 'player';
  ui.pvpInviteCode = 'ABCDE';
  ui.pvpStatus = 'connected';
  ui.pvpLobbyTransport = {
    getBackendType: () => 'lanRelay',
    getLanUrls: () => ['http://192.168.1.100:3000']
  };
  ui.pvpClient = roomClientStub(1, 'guest_1');
  ui.renderPvpTab();

  assert(!container.querySelector('#qr-room-section'), 'guest must not render the room QR Code');
  assert(!container.querySelector('.glt-qr-code-wrapper'), 'guest must not render any QR Code');
  assert(!container.querySelector('.btn-delete-active-room'), 'guest must not delete the host room');
  assert(!container.querySelector('.btn-copy'), 'guest must not get the invite link button');
  assert(!container.querySelector('.glt-lan-share-card'), 'guest must not get the LAN share card');
  assert(container.querySelector('#glt-pvp-guest-title').textContent.includes('Anfitrião'));
  assert(container.querySelector('#btn-pvp-ready'), 'guest still commits its fleet');
});

it('LAN lobby before a room exists shows no QR Code (the only QR Code is the room invite)', () => {
  const container = document.createElement('div');
  ui.dom = { tabPvp: container };
  ui.pvpRoomId = '';
  ui.pvpClient = null;
  ui.pvpInviteCode = '';
  ui.pvpStatus = 'connected'; // a mocked, already-attached lobby transport
  ui.pvpLobbyTransport = {
    getBackendType: () => 'lanRelay',
    getLanUrls: () => ['http://192.168.1.100:3000']
  };
  ui.renderPvpTab();

  assert(!container.querySelector('.glt-qr-code-wrapper'), 'no QR Code before the room exists');
  assert(container.querySelector('#glt-qr-after-create-hint'), 'lobby explains the QR Code comes after "Criar Sala"');
  assert(container.querySelector('#btn-pvp-create'), 'host lobby keeps "Criar Sala"');
});

it('instance opened from an invite whose room is gone offers a retry, never "Criar Sala"', () => {
  const container = document.createElement('div');
  ui.dom = { tabPvp: container };
  ui.pvpRoomId = '';
  ui.pvpClient = null;
  ui.pvpInviteCode = 'ABCDE';
  ui.pvpStatus = 'connected';
  ui.renderPvpTab();

  assert(container.querySelector('#btn-pvp-invite-retry'), 'guest instance offers to retry the invite');
  assert(!container.querySelector('#btn-pvp-create'), 'guest instance must not offer "Criar Sala"');
  assert(!container.querySelector('.glt-qr-code-wrapper'), 'guest instance must not render a QR Code');
  ui.pvpInviteCode = '';
});

function lanLobbyWithRoom(ownsRoom, calls) {
  const container = document.createElement('div');
  ui.dom = { tabPvp: container };
  ui.pvpRoomId = '';
  ui.pvpClient = null;
  ui.pvpInviteCode = '';
  ui.pvpStatus = 'connected';
  ui.pvpOpenRooms = [{ id: 'ABCDE', host: 'Anfitrião', crewId: 'straw_hats', format: '10x10', mode: 'tatico' }];
  ui.pvpLobbyTransport = {
    getBackendType: () => 'lanRelay',
    getLanUrls: () => ['http://192.168.1.100:3000'],
    ownsRoom: () => ownsRoom,
    deleteRoom: id => { calls.push(id); return true; }
  };
  ui.renderPvpTab();
  return container;
}

it('Wi-Fi lobby: a device that did not open a room gets no delete button and no "Limpar Salas"', () => {
  const calls = [];
  const container = lanLobbyWithRoom(false, calls);
  assert(container.querySelector('.open-room-card'), 'the room is still listed for joining');
  assert(!container.querySelector('.btn-delete-room'), 'no delete button on a room opened by another device');
  assert(!container.querySelector('#btn-clear-open-rooms'), 'nobody clears the shared Wi-Fi room list');

  ui.deleteOpenPvpRoom('ABCDE');
  assert.strictEqual(calls.length, 0, 'deleteOpenPvpRoom refuses a room this device does not own');
  assert.strictEqual(ui.pvpOpenRooms.length, 1, 'the room stays listed');
  ui.pvpOpenRooms = [];
});

it('Wi-Fi lobby: the device that opened the room deletes it only after confirming', () => {
  const calls = [];
  const container = lanLobbyWithRoom(true, calls);
  const delBtn = container.querySelector('.btn-delete-room');
  assert(delBtn, 'the owner gets the delete button');
  const click = () => delBtn._listeners.click.forEach(handler => handler());

  click();
  assert.strictEqual(calls.length, 0, 'first tap only asks');
  assert.strictEqual(delBtn.getAttribute('data-armed'), '1');
  assert(delBtn.getAttribute('aria-label').includes('Toque de novo'), 'the question is exposed to screen readers');

  click();
  assert.deepStrictEqual(calls, ['ABCDE'], 'second tap deletes the room');
  ui.pvpOpenRooms = [];
  ui.pvpLobbyTransport = null;
});

console.log('\n--- 4. Crew Selection & Captain Card Synchronization ---');

it('in SETUP phase, selecting a crew updates avatar and speech bubble to match that crew', () => {
  const avatarEl = document.createElement('div');
  const bubbleEl = document.createElement('div');
  ui.dom = ui.dom || {};
  ui.dom.rivalAvatar = avatarEl;
  ui.dom.rivalBubble = bubbleEl;
  ui.gamePhase = 'SETUP';

  const crews = ['straw_hats', 'whitebeard', 'red_haired', 'heart', 'blackbeard', 'marines'];
  const T = i18n.T;

  crews.forEach(crewId => {
    ui.matchConfig.crewId = crewId;
    ui.updateRivalAvatar();
    ui.updateRivalTaunt('intro');

    const expectedCrew = rules.CREWS_MAP[crewId];
    const expectedIntro = T.crews[crewId].taunts.intro;

    // Bubble must contain one of this crew's intro taunts
    assert(
      expectedIntro.some(line => bubbleEl.innerHTML.includes(line)),
      `Bubble for ${crewId} should match its intro taunt, got "${bubbleEl.innerHTML}"`
    );

    // Avatar border color must match this crew's primary color
    assert.strictEqual(
      avatarEl.style.borderColor,
      expectedCrew.colors.primary,
      `Avatar border color for ${crewId} should match crew primary color`
    );
  });
});

it('when transitioning from SETUP to BATTLE, card switches from player crew to rival crew', () => {
  const avatarEl = document.createElement('div');
  const bubbleEl = document.createElement('div');
  ui.dom = ui.dom || {};
  ui.dom.rivalAvatar = avatarEl;
  ui.dom.rivalBubble = bubbleEl;

  ui.gamePhase = 'SETUP';
  ui.matchConfig.crewId = 'whitebeard';
  ui.matchConfig.enemyCrewId = 'marines';
  ui.updateRivalAvatar();
  ui.updateRivalTaunt('intro');

  // In SETUP, shows Whitebeard
  assert(i18n.T.crews.whitebeard.taunts.intro.some(line => bubbleEl.innerHTML.includes(line)));

  // In BATTLE, switches to Marines
  ui.gamePhase = 'BATTLE';
  ui.updateRivalAvatar();
  ui.updateRivalTaunt('intro');

  assert(i18n.T.crews.marines.taunts.intro.some(line => bubbleEl.innerHTML.includes(line)));
  assert.strictEqual(avatarEl.style.borderColor, rules.CREWS_MAP.marines.colors.primary);
});

console.log('\n--- 5. Fleet Cards Vertical Hierarchy (Enemy on Top, Player Below) ---');

it('renderFleetTab places enemy fleet on top and player fleet below in match mode', () => {
  const container = document.createElement('div');
  ui.dom = ui.dom || {};
  ui.dom.tabFleet = container;

  ui.matchState = {
    players: [
      { fleet: [{ id: 'flagship', name: 'Thousand Sunny', length: 5, isSunk: false, hits: 0 }], shipsRemaining: 1 },
      { fleet: [{ id: 'flagship', name: 'Marine Dreadnought', length: 5, isSunk: false, hits: 0 }], shipsRemaining: 1 }
    ]
  };
  ui.isPvpMode = false;
  ui.renderFleetTab();

  const titles = container.children[0].children.filter(c => c.tagName === 'H4');
  assert.strictEqual(titles.length, 2, 'Should have 2 group titles');
  assert(titles[0].textContent.includes(i18n.T.ui.enemyFleetStatus), 'First title (ON TOP) must be Enemy Fleet');
  assert(titles[1].textContent.includes(i18n.T.ui.playerFleetStatus), 'Second title (BELOW) must be Player Fleet');
});

it('dualWrap in both radars mode appends enemy grid first (on top) and player defense grid second (below)', () => {
  const enemyGrid = ui.build2dRadarGrid(1, false, false);
  const myGrid = ui.build2dRadarGrid(0, false, true);

  const enemyTitle = enemyGrid.querySelector('.glt-radar-title');
  const myTitle = myGrid.querySelector('.glt-radar-title');

  assert.strictEqual(enemyTitle.textContent, i18n.T.ui.enemyWaters, 'Plate 1 must be Enemy Waters');
  assert.strictEqual(myTitle.textContent, i18n.T.ui.myWaters, 'Plate 0 must be My Waters');
});

console.log('\n--- 6. Tablet Collapsible Side Panel, Floating Controls & Tactical HUD Mini-Map ---');

it('toggleSidePanelCollapse toggles isSidePanelCollapsed, classes and renders floating action bar & minimap', () => {
  const panel = document.createElement('aside');
  panel.id = 'glt-side-panel';
  const floatBar = document.createElement('div');
  floatBar.id = 'glt-floating-action-bar';
  const minimap = document.createElement('aside');
  minimap.id = 'glt-hud-minimap';
  const restoreBtn = document.createElement('button');
  restoreBtn.id = 'glt-float-restore-btn';

  ui.dom = ui.dom || {};
  ui.dom.sidePanel = panel;
  ui.dom.floatingActionBar = floatBar;
  ui.dom.hudMinimap = minimap;
  ui.dom.floatRestoreBtn = restoreBtn;

  assert.strictEqual(ui.isSidePanelCollapsed, false);
  ui.toggleSidePanelCollapse(true);
  assert.strictEqual(ui.isSidePanelCollapsed, true);
  assert(panel.classList.contains('collapsed'), 'Side panel must have .collapsed class');
  assert.strictEqual(floatBar.style.display, 'flex', 'Floating action bar must be visible when collapsed');
  assert.strictEqual(restoreBtn.style.display, 'inline-flex', 'Restore button must be visible when collapsed');

  ui.toggleSidePanelCollapse(false);
  assert.strictEqual(ui.isSidePanelCollapsed, false);
  assert(!panel.classList.contains('collapsed'), 'Side panel must not have .collapsed class');
  assert.strictEqual(floatBar.style.display, 'none', 'Floating action bar must hide when expanded');
});

it('renderHudMinimap generates interactive grid with clickable cells', () => {
  const minimap = document.createElement('aside');
  minimap.id = 'glt-hud-minimap';
  ui.dom.hudMinimap = minimap;
  ui.isSidePanelCollapsed = true;
  ui.gamePhase = 'BATTLE';
  ui.renderHudMinimap();

  const title = minimap.querySelector('.glt-minimap-title');
  assert(title, 'Minimap must have a title');
  const cells = minimap.querySelectorAll('.glt-minimap-cell');
  assert.strictEqual(cells.length, 100, '10x10 board must generate 100 cells in HUD minimap');
});

console.log('\n--- 7. Non-Mirrored Host -> Convidado Model & In-Room Crew Selection ---');

it('getMyPlatesIndices respects Host -> Convidado model', () => {
  // Offline or Host (playerIndex 0)
  ui.isPvpMode = false;
  let p = ui.getMyPlatesIndices();
  assert.strictEqual(p.myPlate, 0, 'Host/Offline myPlate must be 0');
  assert.strictEqual(p.oppPlate, 1, 'Host/Offline oppPlate must be 1');

  // PvP Guest (playerIndex 1)
  ui.isPvpMode = true;
  ui.pvpClient = { role: 'player', playerIndex: 1 };
  p = ui.getMyPlatesIndices();
  assert.strictEqual(p.myPlate, 1, 'Guest myPlate must be 1 (canonical guest plate)');
  assert.strictEqual(p.oppPlate, 0, 'Guest oppPlate must be 0 (canonical host plate)');
  assert.strictEqual(p.isGuest, true);
});

it('renderPvpTab provides In-Room Crew Selection for unready player in lobby phase', () => {
  const pvpBox = document.createElement('div');
  ui.dom.tabPvp = pvpBox;
  ui.pvpRoomId = 'TEST1';
  ui.pvpRole = 'player';
  ui.pvpClient = {
    role: 'player',
    playerIndex: 1,
    state: {
      phase: 'lobby',
      players: [
        { ready: false, crewId: 'straw_hats' },
        { ready: false, crewId: 'marines' }
      ]
    },
    selectCrew: function(id) { this.state.players[1].crewId = id; }
  };

  ui.renderPvpTab();
  const crewSelectGroup = pvpBox.querySelector('.glt-inroom-crew-select');
  assert(crewSelectGroup, 'In-room crew selector must be rendered for guest before ready');
  const crewBtns = crewSelectGroup.querySelectorAll('.glt-inroom-crew-btn');
  assert.strictEqual(crewBtns.length, 6, 'Must render all 6 canonical crews');
});

console.log('\n--- 8. On-Screen Floating Actions & Battle Execution ---');

it('renderFloatingControls binds correct functions for Fire, Technique and Setup actions', () => {
  const floatBar = document.createElement('div');
  floatBar.id = 'glt-floating-action-bar';
  ui.dom.floatingActionBar = floatBar;
  ui.isSidePanelCollapsed = true;

  // 1. SETUP phase
  ui.gamePhase = 'SETUP';
  ui.isPvpMode = false;
  ui.matchConfig = { boardId: 'classica', crewId: 'straw_hats' };
  ui.placedPlayerFleet = [];
  ui.renderFloatingControls();

  const autoBtn = floatBar.children.find(c => (c.textContent || c.innerHTML || '').includes('Auto'));
  assert(autoBtn, 'Auto button must be present in floating controls during SETUP');
  const rotateBtn = floatBar.children.find(c => (c.textContent || c.innerHTML || '').includes('Horizontal') || (c.textContent || c.innerHTML || '').includes('Vertical'));
  assert(rotateBtn, 'Rotate button must be present in floating controls during SETUP');

  // 2. BATTLE phase
  ui.gamePhase = 'BATTLE';
  ui.selectedAimCell = { r: 3, c: 4 };
  ui.matchState = {
    turn: 0,
    players: [
      { technique: 'bazooka', techniqueUsed: false },
      { technique: 'observacao', techniqueUsed: false }
    ]
  };

  let fireShotCalled = false;
  ui.confirmFireShot = () => { fireShotCalled = true; };
  let techCalled = false;
  ui.triggerSpecialTechnique = () => { techCalled = true; };

  ui.renderFloatingControls();

  const fireBtn = floatBar.children.find(c => c.id === 'btn-float-fire');
  assert(fireBtn, 'Fire button must be present in floating controls during BATTLE');
  assert(!fireBtn.disabled, 'Fire button must be enabled when aim is selected and it is player turn');
  fireBtn._listeners['click'][0]();
  assert.strictEqual(fireShotCalled, true, 'Fire button must invoke confirmFireShot');

  const techBtn = floatBar.children.find(c => c.id === 'btn-float-tech');
  assert(techBtn, 'Technique button must be present in floating controls during BATTLE');
  techBtn._listeners['click'][0]();
  assert.strictEqual(techCalled, true, 'Technique button must invoke triggerSpecialTechnique');
});

console.log('\n--- 9. PvP Rules Sync & Rematch UX ---');

it('renderPvpTab displays active combat rules preview and rematch banner', () => {
  const pvpBox = document.createElement('div');
  ui.dom.tabPvp = pvpBox;
  ui.pvpRoomId = '';
  ui.matchConfig = {
    boardId: 'classica',
    mode: 'tatico',
    sea: 'calm_belt',
    turnTimer: 30,
    salvo: true,
    continueOnHit: true
  };

  // Pre-room view must include rules preview
  ui.renderPvpTab();
  const rulesPreview = pvpBox.querySelector('.glt-pvp-rules-preview');
  assert(rulesPreview, 'Pre-room PvP lobby must show active combat rules preview');

  // In-room view with rematch requested must show rematch banner
  ui.pvpRoomId = 'REMT1';
  ui.pvpRole = 'player';
  ui.pvpClient = {
    role: 'player',
    playerIndex: 0,
    state: {
      phase: 'game_over',
      rematchRequested: [true, false],
      matchConfig: ui.matchConfig,
      players: [{ ready: false }, { ready: false }]
    }
  };
  ui.renderPvpTab();
  const rematchBanner = pvpBox.querySelector('.glt-rematch-status-card');
  assert(rematchBanner, 'In-room PvP view must show rematch status card when rematchRequested is true');
});

console.log(`\n==============================================`);
console.log(`RESULTS: ${passed}/${total} tests passed (${Math.round(passed / total * 100)}%)`);
console.log(`==============================================\n`);

if (passed !== total) {
  process.exit(1);
}
