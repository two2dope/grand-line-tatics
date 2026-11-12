#!/usr/bin/env node
// Grand Line Tactics test runner. Interface documented in tools/README.md ("tests/run.mjs") and ARCHITECTURE.md §15.
//   node tests/run.mjs [piece] [--list] [--root <dir>] [--grep text] [--quick]
// - Loads src/logic then src/net (+ src/ui/i18n.js when present) with vm.runInThisContext: classic scripts in the SAME
//   realm, so assert.deepStrictEqual works on their objects. No window/document/THREE exist, so DOM use throws.
//   Module order inside an area comes from tools/lib/modules.js ("_" files first, alphabetical, "// @after").
// - Fails a test file if loading leaks any global other than GLT.
// - Runs tests/<piece>.*.test.mjs (every *.test.mjs without a piece). A file may use GLT and node:assert/strict at
//   top level and/or register cases with the injected global test(name, async fn). It may also
//   `export default function (test, ctx)` to receive ctx = {GLT, assert, load, loadAll, loadFiles, report, quick, ROOT, files}.
// - GLT is reloaded fresh before every test file. Exit code 1 on any failure.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

// Legacy runner: lives in legacy/tests, but loads the OLD logic/net/ui/audio/app from legacy/src and render/world/ships/fx
// from the project's src (tools/lib/modules.js honours GLT_LEGACY=1). Run with: npm run test:legacy
const LEGACY = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PROJECT = path.resolve(LEGACY, '..');
const AREAS = ['logic', 'net', 'ui', 'render', 'world', 'ships', 'fx', 'audio', 'app'];

// ---------- args ----------
const argv = process.argv.slice(2);
let piece = null, grep = null, root = PROJECT, list = false;
const quick = argv.includes('--quick') || process.env.GLT_QUICK === '1';
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === '--grep') { grep = argv[++i] || ''; continue; }
  if (a === '--root') { root = path.resolve(argv[++i] || '.'); continue; }
  if (a === '--list') { list = true; continue; }
  if (a === '--quick') continue;
  if (a.startsWith('--')) { console.error(`run: unknown argument ${a}`); process.exit(2); }
  if (piece == null) piece = a;
}
const IS_PROJECT = root === PROJECT; // the real project (legacy mode); any other --root is a fixture with its own src/tests
if (IS_PROJECT) process.env.GLT_LEGACY = '1';
const SRC = path.join(root, 'src');
const TESTS = IS_PROJECT ? path.join(LEGACY, 'tests') : path.join(root, 'tests');
const OUT = path.join(TESTS, 'out');

// ---------- module discovery (shared with tools/build.js when available) ----------
let listJs;
try {
  const M = createRequire(import.meta.url)(path.join(PROJECT, 'tools', 'lib', 'modules.js'));
  listJs = (area) => M.listJs(area, root).map((m) => m.abs);
} catch (e) {
  listJs = (area) => {
    const dir = path.join(SRC, area);
    if (!fs.existsSync(dir)) return [];
    return fs.readdirSync(dir).filter((f) => f.endsWith('.js')).sort((a, b) => ((a[0] === '_') === (b[0] === '_') ? (a < b ? -1 : 1) : a[0] === '_' ? -1 : 1)).map((f) => path.join(dir, f));
  };
}
const I18N = IS_PROJECT ? path.join(LEGACY, 'src', 'ui', 'i18n.js') : path.join(SRC, 'ui', 'i18n.js');
const PURE_FILES = [...listJs('logic'), ...listJs('net'), ...(fs.existsSync(I18N) ? [I18N] : [])];
const ALL_FILES = (() => {
  const out = [];
  for (const a of AREAS) {
    let files = listJs(a);
    if (a === 'ui') files = files.filter((f) => f === I18N).concat(files.filter((f) => f !== I18N)); // build: i18n first in ui
    for (const f of files) if (!out.includes(f)) out.push(f);
  }
  return out;
})();
const rel = (f) => path.relative(root, f).replace(/\\/g, '/');

// ---------- loaders ----------
// Same realm: fresh globalThis.GLT; returns {GLT, leaked}.
function loadHere(files) {
  delete globalThis.GLT;
  const before = new Set(Object.getOwnPropertyNames(globalThis));
  for (const f of files) vm.runInThisContext(fs.readFileSync(f, 'utf8').replace(/^﻿/, ''), { filename: rel(f) });
  const leaked = Object.getOwnPropertyNames(globalThis).filter((k) => !before.has(k) && k !== 'GLT');
  return { GLT: globalThis.GLT, leaked };
}

// Isolated realm (bare: no window/document/THREE). Objects come from another realm: compare with JSON, not deepStrictEqual.
const SANDBOX_KEYS = ['console', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'queueMicrotask',
  'performance', 'crypto', 'TextEncoder', 'TextDecoder', 'structuredClone', 'URL', 'URLSearchParams'];
function loadFiles(files) {
  const sandbox = {
    console, setTimeout, clearTimeout, setInterval, clearInterval, queueMicrotask, performance,
    crypto: webcrypto, TextEncoder, TextDecoder, structuredClone, URL, URLSearchParams
  };
  const ctx = vm.createContext(sandbox, { name: 'glt-isolated' });
  for (const f of files) vm.runInContext(fs.readFileSync(f, 'utf8').replace(/^﻿/, ''), ctx, { filename: rel(f) });
  const leaked = Object.getOwnPropertyNames(ctx).filter((k) => !SANDBOX_KEYS.includes(k) && k !== 'GLT');
  const GLT = ctx.GLT || {};
  Object.defineProperty(GLT, '__leaked', { value: leaked, enumerable: false });
  return GLT;
}
const load = () => loadFiles(PURE_FILES);
const loadAll = () => loadFiles(ALL_FILES);

// ---------- discovery ----------
const testFiles = fs.existsSync(TESTS)
  ? fs.readdirSync(TESTS).filter((f) => f.endsWith('.test.mjs')).filter((f) => !piece || f.startsWith(piece + '.')).sort()
  : [];

if (list) {
  console.log('modules (pure, load order):');
  PURE_FILES.forEach((f) => console.log('  ' + rel(f)));
  console.log('tests:');
  testFiles.forEach((f) => console.log('  tests/' + f));
  process.exit(0);
}
if (!testFiles.length) {
  console.log(`run: no test files${piece ? ` for piece "${piece}"` : ''} in ${rel(TESTS) || 'tests'}`);
  process.exit(piece ? 1 : 0);
}

// ---------- run ----------
let pass = 0, fail = 0, todo = 0;
const t0 = Date.now();
const indent = (s) => String(s).split('\n').map((l) => '    ' + l).join('\n');
const failOne = (file, name, err, ms) => { fail++; console.log(`✘ ${file} › ${name}${ms != null ? ` (${ms} ms)` : ''}\n${indent((err && err.stack) || err)}`); };

for (const file of testFiles) {
  const cases = [];
  const reports = {};
  const test = (name, fn) => { cases.push({ name: String(name), fn }); };
  test.todo = (name) => { cases.push({ name: String(name), todo: true }); };

  let loaded;
  try {
    loaded = loadHere(PURE_FILES);
  } catch (err) { failOne(file, '(load src)', err); continue; }
  if (loaded.leaked.length) { failOne(file, '(load src)', new Error('modules leaked globals other than GLT: ' + loaded.leaked.join(', '))); continue; }
  globalThis.GLT = loaded.GLT;
  globalThis.test = test;

  const ctx = {
    GLT: loaded.GLT, assert, load, loadAll, loadFiles, quick, ROOT: root,
    files: { pure: PURE_FILES.slice(), all: ALL_FILES.slice(), sandboxKeys: SANDBOX_KEYS.slice() },
    report(key, data) { reports[key] = data; }
  };
  try {
    const mod = await import(pathToFileURL(path.join(TESTS, file)).href);
    if (typeof mod.default === 'function') await mod.default(test, ctx);
  } catch (err) { failOne(file, '(top level)', err); delete globalThis.test; continue; }

  for (const c of cases) {
    if (grep && !c.name.includes(grep)) continue;
    if (c.todo) { todo++; console.log(`… ${file} › ${c.name} (todo)`); continue; }
    const s = Date.now();
    try {
      await c.fn();
      pass++;
      console.log(`✔ ${file} › ${c.name} (${Date.now() - s} ms)`);
    } catch (err) { failOne(file, c.name, err, Date.now() - s); }
  }
  delete globalThis.test;
  if (Object.keys(reports).length) {
    fs.mkdirSync(OUT, { recursive: true });
    const outFile = path.join(OUT, file.replace(/\.test\.mjs$/, '.json'));
    fs.writeFileSync(outFile, JSON.stringify(reports, null, 2));
    console.log(`  ↳ report: ${rel(outFile)}`);
  }
}

console.log(`\n${pass} passed, ${fail} failed, ${todo} todo — ${((Date.now() - t0) / 1000).toFixed(1)} s${quick ? ' (quick)' : ''}`);
process.exit(fail ? 1 : 0);
