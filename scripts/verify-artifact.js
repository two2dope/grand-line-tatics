/**
 * Grand Line Tactics - verifies dist/grand-line-tactics.html as a standalone file (SCOPE-V2 stage 6).
 *
 * Copies the single file into an empty temp folder (nothing from the repo next to it), opens it over
 * file:// and checks: size <= 12 MB, metadata, no relative assets, only cdnjs + Google Fonts requests,
 * zero console errors / failed requests, every embedded image decodes and every <img> on screen
 * loaded, no horizontal scroll at phone width. Screenshots go to the folder given as argv[2]
 * (default: a temp folder).
 *
 * Usage: node scripts/verify-artifact.js [screenshotDir]
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT_DIR = path.resolve(__dirname, '..');
const SRC = path.join(ROOT_DIR, 'dist', 'grand-line-tactics.html');
const ALLOWED_HOSTS = new Set(['cdnjs.cloudflare.com', 'fonts.googleapis.com', 'fonts.gstatic.com']);
const sleep = ms => new Promise(r => setTimeout(r, ms));

let failures = 0;
function check(name, ok, detail) {
  console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail && !ok ? '  -> ' + detail : ''));
  if (!ok) failures++;
}

async function main() {
  if (!fs.existsSync(SRC)) throw new Error('dist/grand-line-tactics.html ausente: rode npm run build:artifact');
  const shotDir = process.argv[2] ? path.resolve(process.argv[2]) : fs.mkdtempSync(path.join(os.tmpdir(), 'glt-art-shots-'));
  fs.mkdirSync(shotDir, { recursive: true });
  const isoDir = fs.mkdtempSync(path.join(os.tmpdir(), 'glt-art-iso-'));
  const iso = path.join(isoDir, 'grand-line-tactics.html');
  fs.copyFileSync(SRC, iso);
  const html = fs.readFileSync(iso, 'utf8');
  const bytes = Buffer.byteLength(html, 'utf8');

  console.log('--- Estatico ---');
  check(`tamanho ${(bytes / 1048576).toFixed(2)} MB <= 12 MB`, bytes <= 12 * 1048576);
  check('<html lang="pt-BR">', /<html[^>]+lang="pt-BR"/i.test(html));
  check('<title> presente e nao vazio', /<title>[^<]{3,}<\/title>/i.test(html));
  check('viewport meta (width=device-width)', /<meta[^>]+name="viewport"[^>]+width=device-width/i.test(html));
  check('viewport nao bloqueia zoom', !/user-scalable\s*=\s*no/i.test(html));
  const noTable = html.replace(/window\.GLT_ASSET_DATA = \{[\s\S]*?\n  \};/, '');
  check('nenhum caminho relativo assets/ fora da tabela', !/(?<!GLT_ASSET_DATA\[)['"(]assets\/[^'")\s]+/.test(noTable));
  const ext = [].concat(noTable.match(/<(?:script|link)[^>]+(?:src|href)=["'][^"']+["']/gi) || []);
  const badExt = ext.filter(t => {
    const m = t.match(/(?:src|href)=["']([^"']+)["']/i);
    if (!m) return false;
    if (!/^https?:/i.test(m[1])) return true;
    return !ALLOWED_HOSTS.has(new URL(m[1]).host);
  });
  check('<script src>/<link href> so em cdnjs + Google Fonts', badExt.length === 0, badExt.join(' | '));
  check('three.js r128 via cdnjs', /cdnjs\.cloudflare\.com\/ajax\/libs\/three\.js\/r128\/three\.min\.js/.test(html));

  const { chromium } = require('playwright');
  const launchArgs = ['--use-gl=angle', '--enable-webgl', '--ignore-gpu-blocklist', '--no-first-run'];
  let browser;
  try { browser = await chromium.launch({ channel: 'chrome', headless: true, args: launchArgs }); }
  catch (_) { browser = await chromium.launch({ headless: true, args: launchArgs }); }

  async function run(label, ctxOpts, shots) {
    console.log(`--- ${label} ---`);
    const ctx = await browser.newContext(ctxOpts);
    const page = await ctx.newPage();
    const errors = [], hosts = new Map(), failed = [];
    page.on('console', m => { if (m.type() === 'error' && !/favicon/.test(m.text())) errors.push('console: ' + m.text() + ' ' + (m.location().url || '')); });
    page.on('pageerror', e => errors.push('pageerror: ' + e.message));
    page.on('request', r => {
      const u = r.url();
      if (/^(data|blob|about):/.test(u)) return;
      const h = u.startsWith('file:') ? 'file' : new URL(u).host;
      hosts.set(h, (hosts.get(h) || 0) + 1);
      if (u.startsWith('file:') && path.resolve(decodeURIComponent(new URL(u).pathname.replace(/^\//, ''))) !== path.resolve(iso)) failed.push('arquivo local extra: ' + u);
    });
    page.on('requestfailed', r => failed.push(`${r.url().slice(0, 120)} ${r.failure() && r.failure().errorText}`));
    page.on('response', r => { if (r.status() >= 400) failed.push(`HTTP ${r.status()} ${r.url().slice(0, 120)}`); });

    await page.goto('file:///' + iso.replace(/\\/g, '/'), { waitUntil: 'load' });
    await page.waitForFunction('Boolean(window.GLT && GLT.ui && document.getElementById("glt-app"))', null, { timeout: 20000 });
    await sleep(1500);

    const outsiders = Array.from(hosts.keys()).filter(h => h !== 'file' && !ALLOWED_HOSTS.has(h));
    // every embedded image decodes
    const decode = await page.evaluate(async () => {
      const t = window.GLT_ASSET_DATA || {}; const bad = [];
      let n = 0;
      for (const k of Object.keys(t)) {
        n++;
        try { const im = new Image(); im.src = t[k]; await im.decode(); if (!im.naturalWidth) bad.push(k); } catch (e) { bad.push(k); }
      }
      return { n, bad };
    });
    check(`${decode.n} imagens embutidas decodificam`, decode.n >= 60 && decode.bad.length === 0, decode.bad.join(','));
    check('GLT.assets aponta para data URIs', await page.evaluate('Object.values(GLT.assets.portraits).every(u => /^data:image\\/webp/.test(u))'));

    // images visible on the setup screen
    const imgs = await page.evaluate(() => Array.from(document.images).filter(i => i.loading !== 'lazy').map(i => ({ c: i.className, ok: i.complete && i.naturalWidth > 0, src: i.src.slice(0, 40) })));
    check(`${imgs.length} <img> (nao lazy) na tela de preparo, todas carregadas`, imgs.length > 0 && imgs.every(i => i.ok), JSON.stringify(imgs.filter(i => !i.ok)));

    for (const s of shots) await s(page, ctx, label);

    const overflow = await page.evaluate(() => ({
      sw: document.documentElement.scrollWidth, bw: document.body.scrollWidth, iw: window.innerWidth
    }));
    check(`sem rolagem horizontal (scrollWidth ${overflow.sw}/${overflow.bw} <= ${overflow.iw})`, overflow.sw <= overflow.iw && overflow.bw <= overflow.iw);
    check('hosts externos apenas permitidos: ' + (Array.from(hosts.keys()).join(', ') || '-'), outsiders.length === 0, outsiders.join(','));
    check('zero requisicoes falhas', failed.length === 0, failed.join(' | '));
    check('zero erros de console', errors.length === 0, errors.slice(0, 5).join(' | '));
    await ctx.close();
  }

  const shotSetup = (name) => async (page, ctx, label) => {
    await page.screenshot({ path: path.join(shotDir, `${label.split(' ')[0].toLowerCase()}-${name}.png`) });
  };
  const shotChart = async (page, ctx, label) => {
    const btn = await page.$('#btn-open-nautical-chart');
    if (btn) {
      await btn.click(); await sleep(900);
      await page.screenshot({ path: path.join(shotDir, `${label.split(' ')[0].toLowerCase()}-carta.png`) });
      const imgs = await page.evaluate(() => Array.from(document.images).filter(i => i.className.indexOf('chart') >= 0).map(i => i.complete && i.naturalWidth > 0));
      check('imagem da carta nautica carregada', imgs.length > 0 && imgs.every(Boolean));
      await page.keyboard.press('Escape'); await sleep(300);
    }
  };

  await run('Desktop 1280x800', { viewport: { width: 1280, height: 800 } }, [shotSetup('preparo'), shotChart]);
  await run('Telefone 375x667', { viewport: { width: 375, height: 667 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }, [shotSetup('preparo'), shotChart]);
  await browser.close();

  console.log(`\nCapturas: ${shotDir}`);
  console.log(failures ? `\n${failures} FALHA(S)` : '\nARTEFATO OK');
  process.exit(failures ? 1 : 0);
}

main().catch(e => { console.error(e); process.exit(1); });
