'use strict';
// Shared module discovery for build.js and tests/run.mjs.
// Areas, fixed concatenation order and area-level dependencies live here ONLY.
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');

// Fixed concatenation order.
const AREAS = ['logic', 'net', 'ui', 'render', 'world', 'ships', 'fx', 'audio', 'app'];

// Area-level dependencies used by --only expansion (transitive closure is computed).
// Override per project by creating tools/deps.json, e.g. {"ships": ["logic","render","world"]}.
const DEFAULT_DEPS = {
  logic: [],
  net: ['logic'],
  ui: ['logic'],
  render: ['logic'],
  world: ['logic', 'render'],
  ships: ['logic', 'render'],
  fx: ['logic', 'render'],
  audio: ['logic'],
  app: ['logic', 'net', 'ui', 'render', 'world', 'ships', 'fx', 'audio'],
};

function loadDeps() {
  const deps = Object.assign({}, DEFAULT_DEPS);
  const f = path.join(ROOT, 'tools', 'deps.json');
  if (fs.existsSync(f)) Object.assign(deps, JSON.parse(fs.readFileSync(f, 'utf8')));
  return deps;
}

function expandAreas(only, useDeps = true) {
  const deps = loadDeps();
  const want = new Set();
  const visit = (a) => {
    if (!AREAS.includes(a)) throw new Error(`unknown area "${a}" (valid: ${AREAS.join(', ')})`);
    if (want.has(a)) return;
    want.add(a);
    if (useDeps) (deps[a] || []).forEach(visit);
  };
  only.forEach(visit);
  return AREAS.filter((a) => want.has(a));
}

// Order inside one area: files starting with "_" first, then alphabetical, then
// a file may declare "// @after other.js[, another.js]" in its first 10 lines to be moved after those.
function orderFiles(dir, files) {
  const info = new Map();
  for (const f of files) {
    const head = fs.readFileSync(path.join(dir, f), 'utf8').split(/\r?\n/).slice(0, 10).join('\n');
    const m = head.match(/@after\s+([^\n*]+)/);
    info.set(f, m ? m[1].split(',').map((s) => s.trim().replace(/\*\/\s*$/, '').trim()).filter(Boolean) : []);
  }
  const base = files.slice().sort((a, b) => {
    const au = a.startsWith('_') ? 0 : 1;
    const bu = b.startsWith('_') ? 0 : 1;
    return au - bu || (a < b ? -1 : a > b ? 1 : 0);
  });
  const out = [];
  const state = new Map();
  const visit = (f, chain) => {
    if (state.get(f) === 2) return;
    if (state.get(f) === 1) throw new Error(`@after cycle: ${[...chain, f].join(' -> ')}`);
    state.set(f, 1);
    for (const d of info.get(f)) {
      if (!info.has(d)) throw new Error(`${dir}/${f}: @after "${d}" does not exist`);
      visit(d, [...chain, f]);
    }
    state.set(f, 2);
    out.push(f);
  };
  base.forEach((f) => visit(f, []));
  return out;
}

// Old logic/net/ui/audio/app live in legacy/src since the pilot port. Set GLT_LEGACY=1 (or build.js --legacy)
// to build/test our old render/world/ships/fx demos, which still use those modules.
const LEGACY_AREAS = ['logic', 'net', 'ui', 'audio', 'app'];
function areaDir(area, root) {
  return process.env.GLT_LEGACY === '1' && LEGACY_AREAS.includes(area)
    ? path.join(root, 'legacy', 'src', area)
    : path.join(root, 'src', area);
}

function listJs(area, root = ROOT) {
  const dir = areaDir(area, root);
  if (!fs.existsSync(dir)) return [];
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.js') && fs.statSync(path.join(dir, f)).isFile());
  return orderFiles(dir, files).map((f) => ({ area, name: f, rel: `src/${area}/${f}`, abs: path.join(dir, f) }));
}

function listCss(root = ROOT) {
  const dir = areaDir('ui', root);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((f) => f.endsWith('.css')).sort()
    .map((f) => ({ area: 'ui', name: f, rel: `src/ui/${f}`, abs: path.join(dir, f) }));
}

module.exports = { ROOT, AREAS, loadDeps, expandAreas, orderFiles, listJs, listCss };
