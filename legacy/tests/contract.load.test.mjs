// Contract: every module loads with no DOM/THREE, attaches its namespace, leaks nothing. Owner: architect.
import fs from 'node:fs';

const NAMESPACES = {
  logic: ['C', 'events', 'rng', 'data', 'layout', 'board', 'rules', 'engine', 'ai', 'stats', 'taunts', 'sim'],
  net: ['commit', 'protocol', 'lobby', 'transportMem', 'transportHost', 'session'],
  ui: ['i18n', 'T', 'theme', 'ui', 'menuUi', 'setupUi', 'grid2d', 'hud', 'logbook', 'statsUi', 'lobbyUi', 'settingsUi', 'ceremonyUi', 'wanted'],
  render: ['clock', 'palette', 'voxel', 'renderer', 'camera', 'lighting', 'scene', 'picking'],
  world: ['ocean', 'plates', 'backdrop', 'props', 'crowd'],
  ships: ['flags', 'shipModels', 'fleet3d'],
  fx: ['particles', 'shotFx', 'fireworks', 'weather'],
  audio: ['audio', 'music'],
  app: ['persist', 'prefs', 'pvc', 'pvp', 'app']
};

// API members every builder can rely on (subset of ARCHITECTURE.md; presence only).
const API = {
  events: ['on', 'off', 'once', 'emit', 'clear', 'count'],
  rng: ['create', 'hashString', 'mix', 'derive', 'randomSeed'],
  layout: ['size', 'setSize', 'plateCenter', 'cellToWorld', 'worldToCell', 'plateAt', 'gridBounds', 'rimBounds', 'shipTransform', 'shipEnvelope', 'rowLabelPos', 'colLabelPos', 'launcher', 'dockPos', 'sectorOf', 'sectorCenter', 'angDist', 'azDir', 'nearSectors'],
  board: ['rowLetter', 'label', 'parse', 'idx', 'inBounds', 'shipCells', 'fits', 'occupancy', 'validateFleet', 'canPlace', 'emptyFleet', 'canonical', 'neighbors4'],
  rules: ['defaults', 'normalize', 'format', 'size', 'shipsFor', 'techAllowed', 'techFor', 'seaEffect', 'effectiveFog', 'shotsPerTurn', 'summary'],
  engine: ['createSeries', 'gameSeed', 'coinToss', 'createGame', 'reduce', 'answer', 'recordGame', 'view', 'untried', 'randomUntried', 'markVisible', 'techCells', 'legalTech'],
  ai: ['create', 'placeFleet', 'hint', 'thinkMs', 'createMemory'],
  stats: ['compute', 'bounty', 'seriesStats'],
  taunts: ['situations', 'pick'],
  sim: ['game', 'series', 'batch'],
  commit: ['salt', 'nonce', 'sha256Hex', 'commit', 'verify'],
  protocol: ['make', 'valid', 'order', 'fold', 'duties', 'nextSeq', 'nextN', 'publicDigest'],
  lobby: ['code', 'normalizeCode', 'shareLink', 'parseLink', 'nickname', 'nickText', 'pid'],
  transportMem: ['hub'],
  transportHost: ['probe', 'create'],
  session: ['create'],
  i18n: ['t', 'has', 'variants', 'num', 'berry', 'pct', 'time', 'cell', 'list', 'missing', 'fontsReady'],
  theme: ['init', 'set', 'current', 'token'],
  ui: ['mount', 'refs', 'show', 'announce', 'toast'],
  menuUi: ['init', 'config'], setupUi: ['init', 'open', 'close', 'fleet'], grid2d: ['create'], hud: ['init'],
  logbook: ['init', 'add', 'clear'], statsUi: ['init', 'showGame', 'showSeries'], lobbyUi: ['init', 'show'],
  settingsUi: ['init', 'open', 'close'], ceremonyUi: ['init', 'show', 'hide'], wanted: ['draw'],
  clock: ['start', 'onFrame', 'after', 'now', 'realNow', 'setSpeed', 'speed', 'setPaused', 'paused', 'freeze', 'frozen', 'simulate', 'simulating'],
  palette: ['colors', 'get', 'nearest', 'oklab'],
  voxel: ['builder', 'material', 'mergeGeometries', 'instanced', 'dispose'],
  renderer: ['init', 'three', 'canvas', 'setPixelSize', 'size', 'setPost', 'render', 'onResize'],
  camera: ['init', 'three', 'setMode', 'mode', 'set', 'get', 'setInputEnabled', 'worldPerPixel'],
  lighting: ['init', 'setTod', 'tod', 'sun', 'nightFactor', 'stormFactor', 'flash', 'skyColors'],
  scene: ['init', 'root', 'add', 'remove', 'group', 'onBeforeRender'],
  picking: ['init', 'setEnabled', 'pick', 'consumes'],
  ocean: ['init', 'setSea'],
  plates: ['init', 'build', 'setColors', 'setMark', 'clearMarks', 'sync', 'setCursor', 'setGhostCells', 'revealOutline', 'setFoam', 'annotate'],
  backdrop: ['init', 'setLift', 'liftState', 'sectorGroup'],
  props: ['init', 'setBoard'],
  crowd: ['init', 'build', 'react'],
  flags: ['jollyRoger', 'texture', 'pennant'],
  shipModels: ['build'],
  fleet3d: ['init', 'setFleet', 'clear', 'ghost', 'damage', 'sink', 'recoil', 'muzzle', 'raiseFlag', 'reveal', 'sync'],
  particles: ['init', 'emit', 'clear'],
  shotFx: ['init', 'fire', 'splash', 'hit', 'burn', 'clearBurns', 'techFx'],
  fireworks: ['init', 'start', 'stop'],
  weather: ['init', 'set'],
  audio: ['init', 'unlock', 'play', 'setVolume', 'setMuted', 'muted'],
  music: ['init', 'start', 'stop', 'setIntensity'],
  persist: ['get', 'set', 'remove', 'keys'],
  prefs: ['init', 'get', 'set', 'all', 'reset', 'reducedMotion'],
  pvc: ['create'],
  pvp: ['create', 'probe'],
  app: ['boot', 'driver', 'view', 'local', 'plateOf', 'colorsOf', 'crews', 'screen', 'net', 'startMatch', 'toMenu']
};

function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"\\])\/\/.*$/gm, '$1');
}

export default function (test, { loadAll, files, assert }) {
  test('every src/**/*.js loads in a bare VM (no window/document/THREE) without throwing', () => {
    loadAll();
  });

  test('no module leaks a global other than GLT', () => {
    const G = loadAll();
    assert.deepEqual(Array.from(G.__leaked), []);
  });

  test('every contract namespace exists', () => {
    const G = loadAll();
    const missing = [];
    for (const [area, list] of Object.entries(NAMESPACES)) for (const ns of list) if (G[ns] == null) missing.push(area + ':' + ns);
    assert.deepEqual(missing, []);
  });

  test('every contract API member exists', () => {
    const G = loadAll();
    const missing = [];
    for (const [ns, members] of Object.entries(API)) {
      for (const m of members) if (!G[ns] || G[ns][m] === undefined) missing.push(ns + '.' + m);
    }
    assert.deepEqual(missing, []);
  });

  test('GLT.T is GLT.i18n.t and GLT.clock is callable', () => {
    const G = loadAll();
    assert.equal(G.T, G.i18n.t);
    assert.equal(typeof G.clock, 'function');
    assert.equal(G.clock(), G.clock.now());
  });

  test('logic/ and net/ never mention DOM or THREE identifiers (outside comments)', () => {
    const allowed = { 'lobby.js': ['document', 'location'], 'transport-host.js': [] };
    const bad = [];
    for (const f of files.pure) {
      const norm = f.replace(/\\/g, '/');
      if (!/\/src\/(logic|net)\//.test(norm)) continue;
      const name = norm.split('/').pop();
      const src = stripComments(fs.readFileSync(f, 'utf8'));
      for (const id of ['document', 'window', 'THREE', 'localStorage', 'requestAnimationFrame', 'navigator', 'location', 'AudioContext']) {
        if ((allowed[name] || []).includes(id)) continue;
        if (new RegExp('\\b' + id + '\\b').test(src)) bad.push(name + ': ' + id);
      }
      if (/\bMath\.random\b/.test(src)) bad.push(name + ': Math.random');
    }
    assert.deepEqual(bad, []);
  });
}
