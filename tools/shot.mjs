#!/usr/bin/env node
// Headless WebGL screenshot / eval tool.
//   node tools/shot.mjs --html dist/x.html --demo name [--angle 45 --elev 35 --zoom 1 --tod day --seed 7 --t 0.5]
//        [--viewport 1280x720] [--frames 5] [--out shots/p/x.png] [--eval "js"] [--sequence "0,0.2,0.4"]
//        [--timeout 30000] [--no-ready] [--full-page]
// stdout: ONLY the JSON result of --eval (if given). Everything else goes to stderr.
// Writes <out>.console.json. Exit 1 on any console error / pageerror / missing GLT_READY.
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const log = (...a) => console.error(...a);

function parse(argv) {
  const o = { viewport: '1280x720', frames: 5, timeout: 30000, ready: true };
  const flags = new Set(['no-ready', 'full-page']);
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (!k.startsWith('--')) { log(`unknown argument ${k}`); process.exit(2); }
    const name = k.slice(2);
    if (flags.has(name)) { o[name === 'no-ready' ? 'noReady' : 'fullPage'] = true; continue; }
    if (i + 1 >= argv.length) { log(`${k} needs a value`); process.exit(2); }
    o[name] = argv[++i];
  }
  return o;
}

const o = parse(process.argv.slice(2));
if (!o.html) { log('usage: node tools/shot.mjs --html dist/x.html [--demo name] [--out file.png] ...'); process.exit(2); }
const htmlPath = path.resolve(o.html);
if (!fs.existsSync(htmlPath)) { log(`html not found: ${htmlPath}`); process.exit(2); }
const [vw, vh] = o.viewport.split('x').map(Number);
const frames = parseInt(o.frames, 10);
const timeout = parseInt(o.timeout, 10);

function urlFor(t) {
  const u = pathToFileURL(htmlPath);
  for (const k of ['demo', 'angle', 'elev', 'zoom', 'tod', 'seed']) if (o[k] !== undefined) u.searchParams.set(k, o[k]);
  const tv = t !== undefined ? t : o.t;
  if (tv !== undefined) u.searchParams.set('t', String(tv));
  return u.href;
}

const vendorThree = path.join(ROOT, 'tools', 'vendor', 'three.min.js');
const consoleLog = { url: null, messages: [], errors: [], warnings: [], pageErrors: [], failedRequests: [], ignored: [] };
const isFontNoise = (s) => /fonts\.(googleapis|gstatic)\.com/.test(s || '');

async function setup(browser) {
  const context = await browser.newContext({ viewport: { width: vw, height: vh }, deviceScaleFactor: 1 });
  // three.js from the local vendor copy (deterministic, works offline). Falls through to the CDN if absent.
  await context.route(/cdnjs\.cloudflare\.com\/ajax\/libs\/three\.js\/r128\/three\.min\.js/, (route) => {
    if (fs.existsSync(vendorThree)) return route.fulfill({ status: 200, contentType: 'application/javascript', body: fs.readFileSync(vendorThree) });
    return route.continue();
  });
  // Google Fonts: use the network if it works, otherwise answer with an empty stylesheet so offline runs stay clean.
  await context.route(/fonts\.googleapis\.com/, async (route) => {
    try { const r = await route.fetch({ timeout: 8000 }); await route.fulfill({ response: r }); }
    catch { consoleLog.ignored.push('fonts css offline: ' + route.request().url()); await route.fulfill({ status: 200, contentType: 'text/css', body: '/* offline */' }); }
  });
  await context.route(/fonts\.gstatic\.com/, async (route) => {
    try { const r = await route.fetch({ timeout: 8000 }); await route.fulfill({ response: r }); }
    catch { consoleLog.ignored.push('font file offline: ' + route.request().url()); await route.abort(); }
  });
  return context;
}

function attach(page) {
  page.on('console', (m) => {
    const rec = { type: m.type(), text: m.text(), location: m.location() };
    consoleLog.messages.push(rec);
    if (m.type() === 'error') {
      if (isFontNoise(rec.text) || isFontNoise(rec.location?.url)) consoleLog.ignored.push(rec.text);
      else consoleLog.errors.push(rec);
    } else if (m.type() === 'warning') consoleLog.warnings.push(rec);
  });
  page.on('pageerror', (e) => consoleLog.pageErrors.push({ message: e.message, stack: e.stack }));
  page.on('requestfailed', (r) => {
    if (isFontNoise(r.url())) return;
    consoleLog.failedRequests.push({ url: r.url(), failure: r.failure()?.errorText });
  });
}

async function loadAndWait(page, url) {
  consoleLog.url = url;
  await page.goto(url, { waitUntil: 'load', timeout });
  if (!o.noReady) {
    try { await page.waitForFunction(() => window.GLT_READY === true || !!window.GLT_ERROR, null, { timeout, polling: 50 }); }
    catch { consoleLog.pageErrors.push({ message: `window.GLT_READY never became true within ${timeout} ms` }); }
    const err = await page.evaluate(() => window.GLT_ERROR || null);
    if (err) consoleLog.pageErrors.push({ message: 'GLT_ERROR: ' + err });
  }
  if (frames > 0) {
    await page.evaluate((n) => new Promise((res) => { let i = 0; const step = () => (++i >= n ? res() : requestAnimationFrame(step)); requestAnimationFrame(step); }), frames);
  }
}

async function shoot(page, file) {
  fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
  await page.screenshot({ path: file, fullPage: !!o.fullPage });
  log(`shot: wrote ${file}`);
}

function numbered(file, i, n) {
  const ext = path.extname(file);
  const base = file.slice(0, file.length - ext.length);
  return `${base}_${String(i).padStart(Math.max(2, String(n - 1).length), '0')}${ext}`;
}

const browser = await chromium.launch({
  headless: true,
  args: ['--use-angle=swiftshader', '--use-gl=angle', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl', '--disable-dev-shm-usage', '--hide-scrollbars'],
});
let evalResult;
let exitCode = 0;
try {
  const context = await setup(browser);
  const page = await context.newPage();
  attach(page);
  const outs = [];
  if (o.sequence) {
    const ts = o.sequence.split(',').map((s) => s.trim()).filter(Boolean);
    for (let i = 0; i < ts.length; i++) {
      await loadAndWait(page, urlFor(ts[i]));
      if (o.out) { const f = numbered(o.out, i, ts.length); await shoot(page, f); outs.push(f); }
    }
  } else {
    await loadAndWait(page, urlFor());
    if (o.out) { await shoot(page, o.out); outs.push(o.out); }
  }
  if (o.eval !== undefined) {
    try { evalResult = await page.evaluate(async (code) => { const f = new Function('return (async()=>{ return (' + code + '\n); })()'); return await f(); }, o.eval); }
    catch (e) {
      try { evalResult = await page.evaluate(async (code) => { const f = new Function('return (async()=>{ ' + code + '\n })()'); return await f(); }, o.eval); }
      catch (e2) { consoleLog.pageErrors.push({ message: 'eval failed: ' + e2.message }); }
    }
  }
  const sidecar = o.out ? o.out.replace(/\.[^.]+$/, '') + '.console.json' : null;
  const summary = { ok: !consoleLog.errors.length && !consoleLog.pageErrors.length, ...consoleLog };
  if (sidecar) { fs.writeFileSync(sidecar, JSON.stringify(summary, null, 2)); log(`shot: wrote ${sidecar}`); }
  for (const e of consoleLog.errors) log(`console.error: ${e.text}`);
  for (const e of consoleLog.pageErrors) log(`pageerror: ${e.message}`);
  for (const e of consoleLog.failedRequests) log(`requestfailed: ${e.url} ${e.failure}`);
  if (!summary.ok) exitCode = 1;
  if (o.eval !== undefined) process.stdout.write(JSON.stringify(evalResult === undefined ? null : evalResult) + '\n');
} catch (e) {
  log(`shot: FATAL ${e.stack || e}`);
  exitCode = 1;
} finally {
  await browser.close();
}
process.exit(exitCode);
