/**
 * Grand Line Tactics - Artifact build (SCOPE-V2 stage 6)
 * File: scripts/build-artifact.js
 *
 * Produces dist/grand-line-tactics.html: ONE self-contained file for publishing.
 *  - runs the normal build (index.html stays the dev/LAN build with external assets/)
 *  - finds every 'assets/*.jpg' reference in the built page
 *  - recompresses each image to WebP at the largest size the UI really shows (zero-install:
 *    headless Chromium canvas through the playwright dev dependency; results cached)
 *  - embeds the images once, as data URIs, in a lookup table (window.GLT_ASSET_DATA) and
 *    rewrites every reference to read from it (images used twice are not duplicated)
 *  - fails if the file exceeds 12 MB or any relative asset path is left behind
 *
 * Only external hosts in the output: cdnjs (three.js r128) + Google Fonts.
 *
 * Usage: node scripts/build-artifact.js
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT_DIR = path.resolve(__dirname, '..');
const OUT_FILE = path.join(ROOT_DIR, 'dist', 'grand-line-tactics.html');
const CACHE_DIR = path.join(ROOT_DIR, 'node_modules', '.cache', 'glt-artifact');
const MAX_BYTES = 12 * 1024 * 1024;

/**
 * Display budget per image family: max width/height in px (about 2-3x the CSS size, so a 2x phone
 * screen is still sharp) and WebP quality. Never upscales. First matching rule wins.
 */
const IMAGE_RULES = [
  { re: /^assets\/backgrounds\//, max: 1024, q: 0.78 },          // sky banners + 3D sky texture
  { re: /^assets\/blessings\//, max: 750, q: 0.84 },             // inspector 240x320 CSS
  { re: /^assets\/techniques\//, max: 600, q: 0.82 },
  { re: /^assets\/hazards\//, max: 768, q: 0.80 },
  { re: /^assets\/maps\/grand-line-chart/, max: 1280, q: 0.84 }, // full-width chart with small labels
  { re: /^assets\/maps\//, max: 800, q: 0.82 },
  { re: /^assets\/emblems\//, max: 256, q: 0.86 },
  { re: /^assets\/(portraits|officers|ships|props)\//, max: 384, q: 0.86 },
  { re: /.*/, max: 640, q: 0.82 }
];

function ruleFor(rel) {
  return IMAGE_RULES.find(r => r.re.test(rel));
}

// 'assets/x/y.jpg' (single or double quoted) ; the one dynamic reference is handled separately
const LITERAL_RE = /(['"])(assets\/[A-Za-z0-9_\-./]+\.(?:jpg|jpeg|png|webp|gif))\1/g;
const SKY_DYNAMIC_RE = /'assets\/backgrounds\/sky-biome-'\s*\+\s*([A-Za-z_$][\w$]*)\s*\+\s*'\.jpg'/g;

function listSkyKeys() {
  const dir = path.join(ROOT_DIR, 'assets', 'backgrounds');
  return fs.readdirSync(dir).filter(f => /^sky-biome-.+\.jpg$/.test(f)).map(f => 'assets/backgrounds/' + f);
}

async function encodeAll(relPaths) {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  const result = new Map();
  const todo = [];
  for (const rel of relPaths) {
    const src = fs.readFileSync(path.join(ROOT_DIR, rel));
    const rule = ruleFor(rel);
    const key = crypto.createHash('sha1').update(src).update(JSON.stringify([rule.max, rule.q, 'v1'])).digest('hex');
    const cacheFile = path.join(CACHE_DIR, key + '.webp');
    if (fs.existsSync(cacheFile)) {
      result.set(rel, { buf: fs.readFileSync(cacheFile), srcBytes: src.length, cached: true });
    } else {
      todo.push({ rel, src, rule, cacheFile });
    }
  }
  if (!todo.length) return result;

  const { chromium } = require('playwright');
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent('<!doctype html><meta charset="utf-8"><body></body>');
    for (const t of todo) {
      const b64 = await page.evaluate(async ({ b64, max, q }) => {
        const bin = atob(b64);
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        const bmp = await createImageBitmap(new Blob([bytes], { type: 'image/jpeg' }));
        const scale = Math.min(1, max / Math.max(bmp.width, bmp.height));
        const tw = Math.max(1, Math.round(bmp.width * scale));
        const th = Math.max(1, Math.round(bmp.height * scale));
        // halve repeatedly while the reduction is large, then a final high-quality draw
        let cur = bmp, cw = bmp.width, ch = bmp.height;
        while (cw / 2 >= tw && ch / 2 >= th) {
          const nw = Math.round(cw / 2), nh = Math.round(ch / 2);
          const c = document.createElement('canvas');
          c.width = nw; c.height = nh;
          const g = c.getContext('2d');
          g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high';
          g.drawImage(cur, 0, 0, nw, nh);
          cur = c; cw = nw; ch = nh;
        }
        const out = document.createElement('canvas');
        out.width = tw; out.height = th;
        const g = out.getContext('2d');
        g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high';
        g.drawImage(cur, 0, 0, tw, th);
        const blob = await new Promise(res => out.toBlob(res, 'image/webp', q));
        if (!blob || blob.type !== 'image/webp') throw new Error('WebP encoding unavailable');
        const ab = new Uint8Array(await blob.arrayBuffer());
        let s = '';
        for (let i = 0; i < ab.length; i += 0x8000) s += String.fromCharCode.apply(null, ab.subarray(i, i + 0x8000));
        return btoa(s);
      }, { b64: t.src.toString('base64'), max: t.rule.max, q: t.rule.q });
      const buf = Buffer.from(b64, 'base64');
      fs.writeFileSync(t.cacheFile, buf);
      result.set(t.rel, { buf, srcBytes: t.src.length, cached: false });
    }
  } finally {
    await browser.close();
  }
  return result;
}

async function buildArtifact() {
  console.log('=== GRAND LINE TACTICS: ARTIFACT BUILD (single file) ===');
  require('./build').build();

  let html = fs.readFileSync(path.join(ROOT_DIR, 'index.html'), 'utf8');

  // The installable-app block points at files next to index.html (manifest, icons); the
  // single-file artifact has none, and runs in a frame where app-shell.js skips the worker.
  const pwaBlock = /\n\s*<!-- PWA:[\s\S]*?<!-- \/PWA -->/;
  if (!pwaBlock.test(html)) throw new Error('Bloco PWA nao encontrado no HTML base');
  html = html.replace(pwaBlock, '');

  const used = new Set();
  html.replace(LITERAL_RE, (_, q, rel) => { used.add(rel); return _; });
  if (SKY_DYNAMIC_RE.test(html)) listSkyKeys().forEach(k => used.add(k));
  SKY_DYNAMIC_RE.lastIndex = 0;
  const rels = Array.from(used).sort();
  for (const rel of rels) {
    if (!fs.existsSync(path.join(ROOT_DIR, rel))) throw new Error('Asset referenciado e ausente: ' + rel);
  }
  console.log('Imagens referenciadas: ' + rels.length);

  const enc = await encodeAll(rels);

  // 1) rewrite references to lookups (dynamic sky first, it contains a literal-looking prefix)
  html = html.replace(SKY_DYNAMIC_RE, (_, v) => `GLT_ASSET_DATA['assets/backgrounds/sky-biome-' + ${v} + '.jpg']`);
  html = html.replace(LITERAL_RE, (_, q, rel) => `GLT_ASSET_DATA[${q}${rel}${q}]`);

  // 2) one table with every image, defined before the game script runs
  const entries = rels.map(rel => {
    const data = 'data:image/webp;base64,' + enc.get(rel).buf.toString('base64');
    return JSON.stringify(rel) + ':' + JSON.stringify(data);
  });
  const table = `  <script>\n  /* Imagens embutidas (WebP recomprimido). Chaves = caminhos originais em assets/. */\n  window.GLT_ASSET_DATA = {\n${entries.join(',\n')}\n  };\n  </script>\n`;
  if (!html.includes('<body>\n')) throw new Error('Marcador <body> nao encontrado no HTML base');
  html = html.replace('<body>\n', () => '<body>\n' + table);

  // 3) publishing metadata
  html = html.replace(
    '<title>',
    '<meta name="description" content="Batalha naval tática em 3D, 100% em português: monte sua frota, enfrente a IA ou um amigo e conquiste a Grand Line.">\n  <title>'
  );

  // 4) self-containment guard: nothing but the two allowed hosts, no relative asset paths
  const scanHtml = html.replace(table, '');
  const leftovers = scanHtml.match(/(?<!GLT_ASSET_DATA\[)['"(]assets\/[^'")\s]+/g);
  if (leftovers) throw new Error('Caminhos relativos de assets restantes: ' + leftovers.slice(0, 5).join(', '));
  const hosts = new Set((html.replace(table, '').match(/https?:\/\/[^\s'"<>)\\]+/g) || []).map(u => new URL(u).host));
  const allowed = new Set(['cdnjs.cloudflare.com', 'fonts.googleapis.com', 'fonts.gstatic.com']);
  const extra = Array.from(hosts).filter(h => !allowed.has(h));
  if (extra.length) console.warn('Aviso: hosts externos citados no codigo (nao carregados na pagina): ' + extra.join(', '));

  fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });
  fs.writeFileSync(OUT_FILE, html, 'utf8');
  const bytes = Buffer.byteLength(html, 'utf8');

  const srcTotal = rels.reduce((n, r) => n + enc.get(r).srcBytes, 0);
  const webpTotal = rels.reduce((n, r) => n + enc.get(r).buf.length, 0);
  console.log(`Imagens: ${(srcTotal / 1048576).toFixed(1)} MB -> ${(webpTotal / 1048576).toFixed(2)} MB (WebP)`);
  console.log(`OK ${OUT_FILE}  ${(bytes / 1048576).toFixed(2)} MB`);
  if (bytes > MAX_BYTES) throw new Error(`Artefato com ${(bytes / 1048576).toFixed(2)} MB excede o limite de 12 MB`);
  return { file: OUT_FILE, bytes };
}

if (require.main === module) {
  buildArtifact().catch(err => { console.error(err); process.exit(1); });
}

module.exports = { buildArtifact };
