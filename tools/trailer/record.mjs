// Records the promo trailer: drives the built game in real time in Chrome (GPU), captures frames through the CDP
// screencast and the game's own Web Audio through a MediaRecorder, then muxes both with ffmpeg.
//   node tools/trailer/record.mjs            -> dist/trailer/grand-line-tactics-trailer.mp4
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { pathToFileURL, fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const url = pathToFileURL(path.join(root, 'dist/grand-line-tactics.html')).href;
const OUT = path.join(root, 'dist', 'trailer');
const FR = path.join(OUT, 'frames');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const MODE = process.argv.includes('--audio') ? 'audio' : process.argv.includes('--encode') ? 'encode' : 'video';
const LIMIT = (() => { const i = process.argv.indexOf('--limit'); return i > 0 ? +process.argv[i + 1] * 1000 : Infinity; })();
const TIMINGS = path.join(OUT, 'timings.json');

if (MODE === 'video') { fs.rmSync(FR, { recursive: true, force: true }); fs.mkdirSync(FR, { recursive: true }); }
if (MODE !== 'encode') {
const browser = await chromium.launch({
  channel: 'chrome', headless: true,
  args: ['--autoplay-policy=no-user-gesture-required', '--enable-gpu', '--ignore-gpu-blocklist', '--use-angle=d3d11',
    '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--hide-scrollbars']
});
const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1.5 });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));

// ---- audio tap: everything that reaches the destination is also recorded
await page.addInitScript(() => {
  const origConnect = AudioNode.prototype.connect;
  window.__aud = { chunks: [], startEpoch: 0, rec: null };
  AudioNode.prototype.connect = function (dest, ...rest) {
    const ac = this.context;
    if (dest === ac.destination && !ac.__tap) {
      ac.__tap = ac.createMediaStreamDestination();
      const rec = new MediaRecorder(ac.__tap.stream, { mimeType: 'audio/webm;codecs=opus', audioBitsPerSecond: 192000 });
      rec.ondataavailable = (e) => { if (e.data && e.data.size) window.__aud.chunks.push(e.data); };
      rec.onstart = () => { window.__aud.startEpoch = Date.now(); };
      rec.start(500);
      window.__aud.rec = rec;
    }
    if (dest === ac.destination && ac.__tap) origConnect.call(this, ac.__tap);
    return origConnect.call(this, dest, ...rest);
  };
});

await page.goto(url);
await page.waitForFunction(() => window.GLT && GLT.ui && GLT.ui.gamePhase === 'SETUP' && GLT.ui.platesSystem, null, { timeout: 60000 });
await page.waitForTimeout(1500);

// ---- overlay kit + game helpers
await page.addStyleTag({ content: `
#tr-ov{position:fixed;inset:0;z-index:99999;pointer-events:none;overflow:hidden;font-family:'Chakra Petch',sans-serif}
#tr-ov .bar{position:absolute;left:0;right:0;height:0;background:#02060d;transition:height .5s cubic-bezier(.2,.8,.2,1)}
#tr-ov .bar.t{top:0}#tr-ov .bar.b{bottom:0}
#tr-ov.cine .bar{height:58px}
#tr-cap{position:absolute;left:54px;bottom:84px;max-width:900px;opacity:0}
#tr-cap::before{content:"";position:absolute;inset:-46px -150px -40px -90px;z-index:-1;background:radial-gradient(ellipse at 34% 58%,#020812e0 0,#020812a8 42%,#02081200 72%)}
#tr-cap.narrow{max-width:600px;left:40px;bottom:150px}
#tr-cap.narrow .h{font-size:58px}
#tr-cap.narrow .s{font-size:19px}
#tr-cap.low{max-width:262px;left:16px;bottom:250px}
#tr-cap.low .h{font-size:40px}
#tr-cap.low .s{font-size:15px}
#tr-cap.low .k{font-size:11px}
#tr-cap .k{font-family:'Press Start 2P',monospace;font-size:13px;letter-spacing:2px;color:#ffd35a;background:#0a1830e6;border:2px solid #ffd35a;padding:9px 12px;display:inline-block;transform:skewX(-8deg);box-shadow:5px 5px 0 #000}
#tr-cap .h{font-family:'Pirata One',serif;font-size:76px;line-height:.95;color:#fff;margin-top:12px;text-shadow:4px 4px 0 #b3122b,8px 8px 0 #000,0 0 28px #000}
#tr-cap .s{font-size:22px;font-weight:700;color:#e9f3ff;margin-top:10px;text-shadow:2px 2px 0 #000,0 0 12px #000;letter-spacing:.5px}
#tr-cap.in{animation:trIn .42s cubic-bezier(.15,1.4,.3,1) forwards}
#tr-cap.out{animation:trOut .25s ease-in forwards}
@keyframes trIn{0%{opacity:0;transform:translateX(-90px) scale(1.25) skewX(-10deg)}100%{opacity:1;transform:none}}
@keyframes trOut{to{opacity:0;transform:translateX(60px)}}
#tr-slam{position:absolute;left:50%;top:46%;opacity:0;white-space:nowrap;font-family:'Pirata One',serif;font-size:190px;color:#ffe04a;-webkit-text-stroke:5px #1a0508;text-shadow:9px 9px 0 #c3122b,16px 16px 0 #000;transform:translate(-50%,-50%) rotate(-7deg)}
#tr-slam.go{animation:trSlam var(--d,1.3s) cubic-bezier(.1,1.6,.3,1) forwards}
@keyframes trSlam{0%{opacity:0;transform:translate(-50%,-50%) rotate(-7deg) scale(3.4)}14%{opacity:1;transform:translate(-50%,-50%) rotate(-7deg) scale(.92)}22%{transform:translate(-50%,-50%) rotate(-7deg) scale(1.06)}80%{opacity:1;transform:translate(-50%,-50%) rotate(-7deg) scale(1)}100%{opacity:0;transform:translate(-50%,-50%) rotate(-7deg) scale(1.25)}}
#tr-burst{position:absolute;inset:-30%;opacity:0;background:repeating-conic-gradient(from 0deg at 50% 46%,#ffffff00 0 5deg,#ffffffcc 5deg 6.2deg);-webkit-mask:radial-gradient(circle at 50% 46%,transparent 0 17%,#000 42%);mask:radial-gradient(circle at 50% 46%,transparent 0 17%,#000 42%)}
#tr-burst.go{animation:trBurst var(--d,1.3s) ease-out forwards}
@keyframes trBurst{0%{opacity:0;transform:scale(.6) rotate(0)}12%{opacity:.9}100%{opacity:0;transform:scale(1.25) rotate(8deg)}}
#tr-flash{position:absolute;inset:0;background:#fff;opacity:0}
#tr-flash.go{animation:trFlash .45s ease-out forwards}
@keyframes trFlash{0%{opacity:.95}100%{opacity:0}}
body.tr-shake #glt-app{animation:trShake .5s linear}
@keyframes trShake{0%,100%{transform:none}10%{transform:translate(-14px,9px) rotate(-.5deg)}25%{transform:translate(12px,-10px) rotate(.5deg)}40%{transform:translate(-10px,-6px)}55%{transform:translate(9px,7px)}70%{transform:translate(-5px,4px)}85%{transform:translate(3px,-2px)}}
#tr-end{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;opacity:0;background:radial-gradient(ellipse at 50% 40%,#12305cf2 0,#040a16fa 70%);transition:opacity .6s}
#tr-end.on{opacity:1}
#tr-end .t{font-family:'Pirata One',serif;font-size:150px;line-height:1;color:#ffd35a;text-shadow:6px 6px 0 #b3122b,12px 12px 0 #000}
#tr-end .u{font-family:'Press Start 2P',monospace;font-size:20px;color:#fff;letter-spacing:3px;margin-top:22px}
#tr-end .f{font-size:24px;font-weight:700;color:#bfe2ff;margin-top:34px;letter-spacing:1px}
#tr-end .c{font-family:'Press Start 2P',monospace;font-size:22px;color:#061121;background:#ffd35a;padding:16px 26px;margin-top:38px;box-shadow:6px 6px 0 #000;transform:skewX(-8deg)}
#tr-end .d{position:absolute;bottom:26px;font-size:13px;color:#8fa6c4;max-width:1000px}
body.tr-cine #glt-top-hud,body.tr-cine #glt-side-panel,body.tr-cine #glt-footer,body.tr-cine #glt-hud-minimap,body.tr-cine .glt-camera-bar,body.tr-cine [data-camera],body.tr-cine #glt-dialogue-box,body.tr-cine .glt-rival-overlay,body.tr-cine .glt-aim-badge,body.tr-cine .glt-aim-pill{display:none!important}
body.tr-cine #glt-viewport-container{position:fixed!important;inset:0!important;width:100vw!important;height:100vh!important;z-index:9000!important;margin:0!important;border:0!important;border-radius:0!important}
` });
await page.evaluate(() => {
  const ov = document.createElement('div'); ov.id = 'tr-ov';
  ov.innerHTML = '<div id="tr-burst"></div><div id="tr-slam"></div><div id="tr-cap"><div class="k"></div><div class="h"></div><div class="s"></div></div><div class="bar t"></div><div class="bar b"></div><div id="tr-flash"></div>' +
    '<div id="tr-end"><div class="t">Grand Line Tactics</div><div class="u">BATALHA NA GRAND LINE</div><div class="f">Jogador vs CPU · Duelo online · 100% em português</div><div class="c">JOGUE AGORA NO NAVEGADOR</div><div class="d">Tributo de fã não oficial e sem fins lucrativos. One Piece pertence a Eiichiro Oda / Shueisha / Toei Animation.</div></div>';
  document.body.appendChild(ov);
  const $ = (id) => document.getElementById(id);
  const restart = (el, cls) => { el.classList.remove(cls); void el.offsetWidth; el.classList.add(cls); };
  const ui = GLT.ui;
  let orbitRate = 0, zoomRate = 0, last = performance.now();
  (function loop() {
    const now = performance.now(), dt = Math.min(0.05, (now - last) / 1000); last = now;
    const cc = ui.platesSystem && ui.platesSystem.cameraController;
    if (cc && orbitRate) cc.orbit(orbitRate * dt, 0);
    if (cc && zoomRate) cc.zoomBy(zoomRate * dt);
    requestAnimationFrame(loop);
  })();
  const animT = new WeakMap();
  window.__syncAnims = (step) => {
    for (const an of document.getAnimations()) {
      try {
        let t = animT.get(an);
        if (t === undefined) { t = Number(an.currentTime) || 0; an.pause(); } else t += step;
        animT.set(an, t);
        const end = an.effect && an.effect.getComputedTiming ? an.effect.getComputedTiming().endTime : Infinity;
        if (t >= end) an.finish(); else an.currentTime = t;
      } catch (e) {}
    }
  };
  // every sound the game asks for, stamped with the (virtual) clock: the audio is rendered offline from this log
  window.__audLog = []; window.__audBase = null;
  Object.keys(GLT.audio).forEach((k) => {
    if (typeof GLT.audio[k] !== 'function' || !/^(play|startShanty|stopShanty)/.test(k)) return;
    const orig = GLT.audio[k];
    GLT.audio[k] = function (...a) {
      if (window.__audBase !== null) { let args = []; try { args = JSON.parse(JSON.stringify(a)); } catch (e) {} window.__audLog.push({ n: k, a: args, t: performance.now() - window.__audBase }); }
      return orig.apply(this, a);
    };
  });
  window.TR = {
    cine(on) { document.body.classList.toggle('tr-cine', !!on); $('tr-ov').classList.toggle('cine', !!on); window.dispatchEvent(new Event('resize')); },
    cap(k, h, s, pos) { const c = $('tr-cap'); c.classList.toggle('narrow', pos === 'narrow'); c.classList.toggle('low', pos === 'low'); c.querySelector('.k').textContent = k || ''; c.querySelector('.k').style.display = k ? '' : 'none'; c.querySelector('.h').textContent = h || ''; c.querySelector('.s').textContent = s || ''; c.classList.remove('out'); restart(c, 'in'); },
    capOut() { const c = $('tr-cap'); c.classList.remove('in'); c.classList.add('out'); },
    slam(text, dur, size) { const s = $('tr-slam'), b = $('tr-burst'); s.textContent = text; s.style.fontSize = (size || 190) + 'px'; restart(s, 'go'); restart(b, 'go'); s.style.animationDuration = (dur || 1.3) + 's'; b.style.animationDuration = (dur || 1.3) + 's'; TR.shake(); },
    shake() { document.body.classList.remove('tr-shake'); void document.body.offsetWidth; document.body.classList.add('tr-shake'); try { ui.platesSystem.cameraController.triggerShake(1.2, 0.5); } catch (e) {} },
    hideNotices() {
      const panel = document.getElementById('glt-side-panel'); if (!panel) return;
      const hit = [];
      panel.querySelectorAll('*').forEach((el) => {
        if (el.children.length > 3) return;
        const tx = (el.textContent || '').trim();
        if (tx.length < 900 && !/Criar Sala|Codinome/.test(tx) && (/^.{0,3}Modo Arquivo Local/.test(tx) || /^.{0,3}Sincronização entre abas/.test(tx))) hit.push(el);
      });
      hit.forEach((el) => { let box = el; for (let i = 0; i < 3 && box.parentElement && box.parentElement !== panel && !/Criar Sala|Codinome/.test(box.parentElement.textContent || ''); i++) box = box.parentElement; box.style.display = 'none'; });
    },
    modalTop() { const mb = document.getElementById('glt-modal-box'); if (!mb) return; mb.scrollTop = 0; mb.querySelectorAll('*').forEach((e) => { if (e.scrollTop) e.scrollTop = 0; }); },
    flash() { restart($('tr-flash'), 'go'); },
    end(on) { $('tr-end').classList.toggle('on', !!on); },
    orbit(r) { orbitRate = r || 0; }, zoom(r) { zoomRate = r || 0; },
    cam(p) { orbitRate = 0; zoomRate = 0; ui.setCameraPreset(p); },
    env(tod, sea) { ui.platesSystem.setEnvironment(tod, 700, sea); },
    fire(r, c) { ui.clearTurnTimers && ui.clearTurnTimers(); ui.matchState.turn = 0; ui.shotInFlight = false; ui.isCpuThinking = false; ui.selectAimCoordinate(r, c); ui.confirmFireShot(); },
    cpu(r, c) { window.__cpuQueue.push({ r, c }); ui.isCpuThinking = false; ui.shotInFlight = false; ui.matchState.turn = 1; ui.triggerCpuTurn(); },
    cells() {
      const ms = ui.matchState, N = ms.boardSize;
      const map = (p) => ms.players[p].fleet.map((s) => ({ id: s.id, len: s.length, cells: s.cells.map((c) => ({ r: c.r, c: c.c })) }));
      const enemy = map(1), mine = map(0), occ = new Set();
      enemy.forEach((s) => s.cells.forEach((c) => occ.add(c.r + ',' + c.c)));
      const water = [];
      for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) if (!occ.has(r + ',' + c)) water.push({ r, c });
      return { N, enemy, mine, water, taken: Object.keys(ms.players[1].shotsTaken) };
    }
  };
  // the CPU only fires when the script says so
  window.__cpuQueue = [];
  const realTrigger = ui.triggerCpuTurn;
  ui.triggerCpuTurn = function () {
    if (!window.__cpuQueue.length) return;
    const cell = window.__cpuQueue.shift();
    const ai = this.aiPlayer, orig = ai && ai.chooseAction;
    if (ai) ai.chooseAction = () => ({ type: 'shot', r: cell.r, c: cell.c });
    realTrigger.call(this);
    setTimeout(() => { if (ai) ai.chooseAction = orig; }, 5000);
  };
  try { ui.hideModal(); } catch (e) {}
  Object.assign(ui.matchConfig, { boardId: 'grand_line', format: 'grand_line', mode: 'tatico', difficulty: 'capitao', seriesLength: 1, turnTimer: 0, sea: 'mar_calmo', crewId: 'straw_hats', enemyCrewId: 'marines' });
  try { ui.applyMatchConfig && ui.applyMatchConfig(); } catch (e) {}
  try { ui.rebuildBoardForConfig && ui.rebuildBoardForConfig(); } catch (e) {}
  ui.animSpeed = 1;
  ui.autoPlacePlayerFleet();
  GLT.audio.init(); GLT.audio.resume && GLT.audio.resume(); GLT.audio.setMuted(false); GLT.audio.setVolume(0.9);
});
const E = (fn, ...a) => page.evaluate(fn, ...a);
const TR = (code) => page.evaluate(code);

// ---- clock: video = virtual time, one screenshot every 1/30 s; audio = real time
const cdp = await ctx.newCDPSession(page);
let nFrame = 0, recording = false, vt = 0, stopAll = false;
const FRAME = 1000 / 30;
async function tick() {
  const done = new Promise((res) => cdp.once('Emulation.virtualTimeBudgetExpired', res));
  await cdp.send('Emulation.setVirtualTimePolicy', { policy: 'advance', budget: FRAME });
  await done;
  // CSS animations and transitions run on the compositor's real clock: pin them to the virtual one
  await cdp.send('Runtime.evaluate', { expression: 'window.__syncAnims && window.__syncAnims(' + FRAME + ')' });
  if (recording) {
    const shot = await cdp.send('Page.captureScreenshot', { format: 'jpeg', quality: 93 });
    fs.writeFileSync(path.join(FR, 'f' + String(nFrame++).padStart(6, '0') + '.jpg'), Buffer.from(shot.data, 'base64'));
  }
}
let owed = 0;
async function wait(ms) {
  if (stopAll) return;
  if (MODE === 'audio') { await sleep(ms); vt += ms; return; }
  owed += ms;
  while (owed >= FRAME / 2) { await tick(); owed -= FRAME; vt += FRAME; if (recording && vt - vt0 > LIMIT) { stopAll = true; return; } }
}
let vt0 = 0;
const timings = MODE === 'audio' && fs.existsSync(TIMINGS) ? JSON.parse(fs.readFileSync(TIMINGS, 'utf8')) : {};
if (MODE === 'video') await cdp.send('Emulation.setVirtualTimePolicy', { policy: 'pause' });

// ================= TIMELINE =================
// pre-roll: cinematic panorama at dusk
await TR(`TR.cine(true); TR.env('dusk','grand_line'); TR.cam('panorama')`);
await wait(1800);
recording = MODE === 'video';
vt0 = vt;
const audT0 = await page.evaluate(() => { window.__audBase = performance.now(); return Date.now(); });
const mark = (n) => console.error(((vt - vt0) / 1000).toFixed(1).padStart(6), n);

// S0 cold open
mark('S0 open');
await TR(`GLT.audio.startShanty(); TR.orbit(0.10); TR.zoom(0.05)`);
await wait(1300);
await TR(`TR.cap('TRIBUTO DE FÃ EM PIXEL ART 3D','A Grand Line está em guerra','')`);
await wait(2600);
await TR(`TR.capOut()`);
await wait(350);
await TR(`GLT.audio.playCannon && GLT.audio.playCannon(); TR.flash(); TR.slam('Grand Line Tactics',2.3,150)`);
await wait(2500);

// S1 the fleet
mark('S1 fleet');
await TR(`TR.flash(); TR.env('day','mar_calmo'); TR.cam('minhas_aguas')`);
await wait(1000);
await TR(`TR.orbit(-0.18); TR.zoom(0.17); TR.cap('7 NAVIOS LENDÁRIOS','Do Going Merry ao Moby Dick','Modelos voxel originais, com velas, bandeiras e tripulação no convés')`);
await wait(4600);
await TR(`TR.capOut()`);
await wait(300);

// S2 setup UI
mark('S2 setup');
await TR(`TR.flash(); TR.cine(false); TR.cam('minhas_aguas')`);
await wait(700);
await TR(`TR.cap('PREPARAÇÃO','Monte sua frota','6 tripulações · 3 tabuleiros · 4 mares · regras à sua escolha','narrow')`);
await wait(1200);
await TR(`GLT.ui.autoPlacePlayerFleet(); GLT.audio.playUiClick && GLT.audio.playUiClick()`);
await wait(1100);
await TR(`GLT.ui.autoPlacePlayerFleet(); GLT.audio.playUiClick && GLT.audio.playUiClick()`);
await wait(1500);
await TR(`TR.capOut()`);

// S3 coin toss -> battle
mark('S3 toss');
await TR(`GLT.ui.startMatchWithCoinToss()`);
await wait(600);
await TR(`TR.cap('SORTEIO','Cara ou coroa de Berry','A moeda decide quem atira primeiro','narrow')`);
if (MODE === 'video') {
  let n = 0;
  while (!stopAll && n < 20000 && !(await page.evaluate(() => GLT.ui.gamePhase === 'BATTLE'))) { await wait(200); n += 200; }
  timings.toss = n;
} else {
  await wait(timings.toss || 4000);
  await page.waitForFunction(() => GLT.ui.gamePhase === 'BATTLE', null, { timeout: 30000 }).catch(() => {});
}
await wait(900);
await TR(`TR.capOut(); GLT.ui.clearTurnTimers && GLT.ui.clearTurnTimers(); GLT.ui.matchState.turn = 0`);
let F = await E(() => TR.cells());
const mid = (F.N - 1) / 2;
const byLen = F.enemy.slice().sort((a, b) => a.len - b.len);
const sinkShip = byLen[0], hitShip = byLen[byLen.length - 1];
const waters = F.water.sort((a, b) => (Math.abs(a.r - mid) + Math.abs(a.c - mid)) - (Math.abs(b.r - mid) + Math.abs(b.c - mid)));
const fire = (c) => E((c) => TR.fire(c.r, c.c), c);

// S4 battle
mark('S4 battle');
await TR(`TR.cam('mira_inimiga')`);
await wait(900);
await TR(`TR.cap('COMBATE','Mire. Confirme. FOGO!','No mouse, no toque ou no teclado','narrow')`);
await wait(900);
await fire(waters[0]);
await wait(2600);
await TR(`TR.capOut()`);
await fire(hitShip.cells[1]);
await wait(3000);
await fire(hitShip.cells[2]);
await wait(2600);

mark('S4b cpu');
await TR(`TR.cam('minhas_aguas'); TR.cap('RIVAIS','A CPU revida','4 patentes: Grumete, Marujo, Capitão e Yonkou','narrow')`);
await wait(900);
const myShip = F.mine.slice().sort((a, b) => b.len - a.len)[0];
await E((c) => TR.cpu(c.r, c.c), myShip.cells[1]);
await wait(3400);
await E((c) => TR.cpu(c.r, c.c), myShip.cells[2]);
await wait(3000);
await TR(`TR.capOut()`);

mark('S4c technique');
await TR(`TR.cam('mira_inimiga')`);
await wait(800);
await TR(`TR.cap('MODO TÁTICO','Técnicas de tripulação','Bazooka · Tremor · Haki do Rei · Room · Vórtice · Observação','narrow')`);
await wait(700);
const tgt = byLen[1].cells[0];
await E((c) => { const ui = GLT.ui; ui.clearTurnTimers && ui.clearTurnTimers(); ui.matchState.turn = 0; ui.shotInFlight = false; ui.isUsingTechnique = true; ui.executePlayerTechnique(c.r, c.c); }, tgt);
await wait(4200);
await TR(`TR.capOut(); const b = document.getElementById('glt-technique-banner'); if (b) b.remove()`);

// S5 seas and weather
mark('S5 weather');
await TR(`TR.flash(); TR.cine(true); TR.env('dusk','grand_line'); TR.cam('duas_aguas')`);
await wait(900);
await TR(`TR.orbit(0.14); TR.cap('4 MARES','Do Mar Calmo ao Novo Mundo','Crepúsculo, noite com lanternas e farol, tempestade com raios')`);
await wait(2300);
await TR(`TR.flash(); TR.env('night','novo_mundo')`);
await wait(3000);
await TR(`TR.flash(); TR.env('storm','tempestade'); TR.slam('Tempestade!',1.4,150)`);
await wait(3400);
await TR(`TR.capOut()`);

// S6 sinking
mark('S6 sink');
await TR(`TR.flash(); TR.cine(false); TR.env('day','mar_calmo'); TR.cam('mira_inimiga')`);
await wait(1000);
for (const c of sinkShip.cells.slice(0, -1)) { await fire(c); await wait(2300); }
await fire(sinkShip.cells[sinkShip.cells.length - 1]);
await wait(750);
await TR(`TR.slam('Afundou!',1.6,200)`);
await wait(3600);

// S7 online
mark('S7 online');
await TR(`GLT.ui.switchTab('tab-pvp'); TR.cam('duas_aguas'); TR.hideNotices(); TR.cap('DUELO ONLINE','Desafie outro capitão','Salas por código · reações Den Den Mushi · anti-trapaça SHA-256','narrow')`);
await wait(4200);
await TR(`TR.capOut(); GLT.ui.switchTab('tab-gameplay')`);

// S8 finale: clear the board fast, ceremony
mark('S8 finale');
await TR(`GLT.ui.animSpeed = 4; TR.cam('mira_inimiga'); TR.cap('','Afunde a frota inteira','','narrow')`);
F = await E(() => TR.cells());
const left = [];
F.enemy.forEach((s) => s.cells.forEach((c) => { if (!F.taken.includes(c.r + ',' + c.c)) left.push(c); }));
for (const c of left.slice(0, -1)) {
  await fire(c);
  await wait(430);
}
await wait(900);
await TR(`GLT.ui.animSpeed = 1; TR.capOut()`);
await fire(left[left.length - 1]);
await wait(900);
await TR(`TR.slam('Vitória!',1.8,210)`);
mark('S8b ceremony');
await wait(4200);
await TR(`TR.cap('CERIMÔNIA','Conquiste sua recompensa','Cartaz de PROCURADO com a pontuação em Berries','low'); TR.modalTop()`);
await wait(6000);
await TR(`TR.capOut()`);
await wait(400);

// S9 end card
mark('S9 end');
await TR(`TR.flash(); TR.end(true); GLT.audio.playCannon && GLT.audio.playCannon()`);
await wait(5200);
recording = false;
mark('stop');
const dur = (vt - vt0) / 1000;

// ---- pull the audio
const aud = MODE !== 'audio' ? null : await page.evaluate(async () => {
  const a = window.__aud;
  if (!a.rec) return null;
  await new Promise((res) => { a.rec.onstop = res; a.rec.stop(); });
  const blob = new Blob(a.chunks, { type: 'audio/webm' });
  const buf = new Uint8Array(await blob.arrayBuffer());
  let s = ''; const CH = 0x8000;
  for (let i = 0; i < buf.length; i += CH) s += String.fromCharCode.apply(null, buf.subarray(i, i + CH));
  return { b64: btoa(s), startEpoch: a.startEpoch };
});
const audLog = await page.evaluate(() => window.__audLog);
if (MODE === 'video') fs.writeFileSync(path.join(OUT, 'events.json'), JSON.stringify(audLog));
await browser.close();
if (MODE === 'video') { timings.dur = dur; timings.frames = nFrame; fs.writeFileSync(TIMINGS, JSON.stringify(timings)); }
if (MODE === 'audio' && aud) {
  fs.writeFileSync(path.join(OUT, 'audio.webm'), Buffer.from(aud.b64, 'base64'));
  fs.writeFileSync(path.join(OUT, 'audio.json'), JSON.stringify({ offset: (audT0 - aud.startEpoch) / 1000, dur }));
}
console.log(JSON.stringify({ mode: MODE, seconds: dur, frames: nFrame, errors }));
}

// ---- encode
if (MODE === 'encode') {
  const t = JSON.parse(fs.readFileSync(TIMINGS, 'utf8'));
  const args = ['-y', '-framerate', '30', '-i', 'frames/f%06d.jpg'];
  const hasAudio = fs.existsSync(path.join(OUT, 'audio.wav'));
  if (hasAudio) args.push('-i', 'audio.wav');
  args.push('-vf', 'scale=1920:1080:flags=lanczos,format=yuv420p', '-c:v', 'libx264', '-preset', 'slow', '-crf', '23');
  if (hasAudio) args.push('-af', `loudnorm=I=-14:TP=-1.5:LRA=11,afade=t=in:d=0.3,afade=t=out:st=${(t.dur - 1.8).toFixed(2)}:d=1.7`, '-ar', '48000', '-c:a', 'aac', '-b:a', '192k');
  args.push('-t', t.dur.toFixed(2), '-movflags', '+faststart', 'grand-line-tactics-trailer.mp4');
  execFileSync('ffmpeg', args, { cwd: OUT, stdio: ['ignore', 'ignore', 'inherit'] });
  console.log('encoded', t.dur, 's audio', hasAudio);
}
