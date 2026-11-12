#!/usr/bin/env node
'use strict';
// Concatenates src/<area>/*.js into ONE html file.
//   node tools/build.js --out dist/<tag>.html [--only logic,render] [--no-deps] [--vendor] [--title "..."] [--list] [--root <dir>]
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const M = require('./lib/modules');

const THREE_URL = 'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js';
const FONTS_URL = 'https://fonts.googleapis.com/css2?family=Pirata+One&family=Pixelify+Sans:wght@400..700&family=Press+Start+2P&display=swap';
const VENDOR_THREE = path.join(M.ROOT, 'tools', 'vendor', 'three.min.js');
const NEEDS_THREE = new Set(['render', 'world', 'ships', 'fx', 'app']);

function parseArgs(argv) {
  const a = { only: null, deps: true, vendor: false, list: false, title: 'Grand Line Tactics', fonts: FONTS_URL, root: M.ROOT };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    const val = () => { if (i + 1 >= argv.length) die(`${k} needs a value`); return argv[++i]; };
    if (k === '--out') a.out = val();
    else if (k === '--only') a.only = val().split(',').map((s) => s.trim()).filter(Boolean);
    else if (k === '--no-deps') a.deps = false;
    else if (k === '--vendor') a.vendor = true;
    else if (k === '--title') a.title = val();
    else if (k === '--fonts') a.fonts = val();
    else if (k === '--list') a.list = true;
    else if (k === '--legacy') process.env.GLT_LEGACY = '1';
    else if (k === '--root') a.root = path.resolve(val());
    else if (k === '-h' || k === '--help') { console.log(fs.readFileSync(__filename, 'utf8').split('\n').slice(2, 4).join('\n').replace(/^\/\/ ?/gm, '')); process.exit(0); }
    else die(`unknown argument ${k}`);
  }
  return a;
}
function die(msg) { console.error(`build: ERROR ${msg}`); process.exit(1); }

// Loud syntax check. new Function parses without running; on failure re-parse with vm.Script for file:line.
function syntaxCheck(mod, src) {
  try { new Function(src); } catch (e) {
    let where = '';
    try { new vm.Script(src, { filename: mod.rel }); } catch (e2) {
      const m = String(e2.stack || '').match(new RegExp(mod.rel.replace(/[\\/.]/g, (c) => '\\' + c) + ':(\\d+)'));
      where = m ? ` (line ${m[1]})` : '';
      e = e2;
    }
    die(`syntax error in ${mod.rel}${where}: ${e.message}`);
  }
}
const escScript = (s) => s.replace(/<\/(script)/gi, '<\\/$1').replace(/<!--/g, '<\\!--');

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.out && !args.list) die('missing --out dist/<tag>.html');

  // area selection
  let areas = args.only ? M.expandAreas(args.only, args.deps) : M.AREAS.slice();
  const withI18n = !areas.includes('ui');

  // module list in fixed order; ui/i18n.js is always included and comes first in ui
  const mods = [];
  for (const area of M.AREAS) {
    const inArea = areas.includes(area);
    if (!inArea && !(area === 'ui')) continue;
    let list = M.listJs(area, args.root);
    if (area === 'ui') {
      const i18n = list.filter((m) => m.name === 'i18n.js');
      const rest = list.filter((m) => m.name !== 'i18n.js');
      list = inArea ? i18n.concat(rest) : i18n;
    }
    mods.push(...list);
  }
  const hasI18n = mods.some((m) => m.rel === 'src/ui/i18n.js');
  if (!hasI18n) console.warn('build: WARN src/ui/i18n.js does not exist yet (always required once written)');

  if (args.list) { mods.forEach((m) => console.log(m.rel)); return; }

  // read + syntax check everything BEFORE writing anything
  const chunks = [];
  for (const m of mods) {
    const src = fs.readFileSync(m.abs, 'utf8').replace(/^﻿/, '');
    syntaxCheck(m, src);
    if (!/\bGLT\b/.test(src)) console.warn(`build: WARN ${m.rel} never mentions GLT (does it attach to the namespace?)`);
    chunks.push({ m, src });
  }
  const harness = fs.readFileSync(path.join(__dirname, 'harness.js'), 'utf8');
  const runner = fs.readFileSync(path.join(__dirname, 'harness-run.js'), 'utf8');
  syntaxCheck({ rel: 'tools/harness.js' }, harness);
  syntaxCheck({ rel: 'tools/harness-run.js' }, runner);

  const css = areas.includes('ui') ? M.listCss(args.root).map((c) => `/* ${c.rel} */\n${fs.readFileSync(c.abs, 'utf8')}`).join('\n') : '';
  const bodyFile = path.join(args.root, 'src', 'ui', 'body.html');
  const body = areas.includes('ui') && fs.existsSync(bodyFile) ? fs.readFileSync(bodyFile, 'utf8') : '<div id="app"></div>';

  const needThree = areas.some((a) => NEEDS_THREE.has(a));
  let threeTag = '';
  if (needThree) {
    if (args.vendor) {
      if (!fs.existsSync(VENDOR_THREE)) die('--vendor requested but tools/vendor/three.min.js is missing');
      threeTag = `<script>/* three.js r128 (vendored, tests only) */\n${escScript(fs.readFileSync(VENDOR_THREE, 'utf8'))}\n</script>`;
    } else {
      threeTag = `<script src="${THREE_URL}"></script>`;
    }
  }

  const out = [];
  out.push('<!doctype html>');
  out.push('<html lang="pt-BR">');
  out.push('<head>');
  out.push('<meta charset="utf-8">');
  out.push('<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">');
  out.push(`<title>${args.title}</title>`);
  out.push('<link rel="preconnect" href="https://fonts.googleapis.com">');
  out.push('<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>');
  out.push(`<link href="${args.fonts}" rel="stylesheet">`);
  out.push(`<style>\nhtml,body{margin:0;height:100%;background:#0b1624;color:#e8ecf4}\n#app{position:relative;width:100%;height:100%}\n${css}\n</style>`);
  out.push('</head>');
  out.push('<body>');
  out.push(body);
  if (threeTag) out.push(threeTag);
  out.push(`<script>\n${escScript(harness)}\n//# sourceURL=glt/harness.js\n</script>`);
  for (const { m, src } of chunks) {
    out.push(`<script>\n/* ==== ${m.rel} ==== */\n${escScript(src)}\n//# sourceURL=glt/${m.area}/${m.name}\n</script>`);
  }
  out.push(`<script>\n${escScript(runner)}\n//# sourceURL=glt/harness-run.js\n</script>`);
  out.push('</body>');
  out.push('</html>');
  const html = out.join('\n') + '\n';

  const outPath = path.resolve(args.out);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, html);
  const byArea = {};
  mods.forEach((m) => { byArea[m.area] = (byArea[m.area] || 0) + 1; });
  console.log(`build: OK ${path.relative(process.cwd(), outPath)}  ${(html.length / 1024).toFixed(1)} KiB`);
  console.log(`build: areas=[${areas.join(',')}]${withI18n ? '+ui/i18n.js' : ''}  modules=${mods.length} ${JSON.stringify(byArea)}  three=${needThree ? (args.vendor ? 'vendored' : 'cdnjs') : 'none'}`);
}
main();
