// Renders the trailer soundtrack offline from dist/trailer/events.json (written by the video pass): every sound the
// game asked for is replayed into an OfflineAudioContext at its exact timestamp, so audio and video match by sample.
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const OUT = path.join(root, 'dist', 'trailer');
const events = JSON.parse(fs.readFileSync(path.join(OUT, 'events.json'), 'utf8'));
const { dur } = JSON.parse(fs.readFileSync(path.join(OUT, 'timings.json'), 'utf8'));
const SR = 48000;
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--autoplay-policy=no-user-gesture-required', '--disable-background-timer-throttling'] });
const page = await browser.newPage();
page.on('pageerror', (e) => console.error('pageerror', e.message));
await page.addInitScript(({ dur, SR }) => {
  const Fake = function () {
    const off = new OfflineAudioContext(2, Math.ceil((dur + 0.5) * SR), SR);
    window.__off = off;
    window.__offResume = off.resume.bind(off);
    // the game's third gain node is the music bus (master, sfx, music): lift it so the shanty carries the trailer
    const mk = off.createGain.bind(off); let nGain = 0;
    off.createGain = () => {
      const g = mk();
      if (++nGain === 3) {
        const boost = mk(); boost.gain.value = 2.8;
        const conn = g.connect.bind(g);
        g.connect = (dest, ...r) => { conn(boost); boost.connect(dest, ...r); return dest; };
      }
      return g;
    };
    off.resume = () => Promise.resolve();            // the game must never resume the render by itself
    Object.defineProperty(off, 'state', { get: () => 'running' });
    return off;
  };
  window.AudioContext = Fake; window.webkitAudioContext = Fake;
}, { dur, SR });
await page.goto(pathToFileURL(path.join(root, 'dist/grand-line-tactics.html')).href);
await page.waitForFunction(() => window.GLT && GLT.audio && GLT.ui && GLT.ui.gamePhase === 'SETUP', null, { timeout: 60000 });
const res = await page.evaluate(async ({ events, dur, SR }) => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  GLT.audio.init(); GLT.audio.setMuted(false); GLT.audio.setVolume(0.9);
  const off = window.__off;
  const q = (t) => Math.max(1, Math.round(t * SR / 128)) * 128 / SR;      // render-quantum grid
  const at = new Map();
  for (let t = 0.05; t < dur; t += 0.05) at.set(q(t), []);                 // 20 Hz grid keeps the music scheduler fed
  let played = 0; const failed = [];
  events.forEach((e) => { const k = q(e.t / 1000); if (k >= dur) return; if (!at.has(k)) at.set(k, []); at.get(k).push(e); });
  for (const [t, list] of at) {
    off.suspend(t).then(async () => {
      for (const e of list) { try { GLT.audio[e.n].apply(GLT.audio, e.a); played++; } catch (err) { failed.push(e.n + ': ' + err.message); } }
      await sleep(32);                                                      // lets the 25 ms shanty scheduler tick
      window.__offResume();
    });
  }
  const buf = await off.startRendering();
  const n = Math.round(dur * SR), L = buf.getChannelData(0), R = buf.getChannelData(1);
  let peak = 0; for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i]));
  const g = peak > 0.98 ? 0.98 / peak : 1;
  const wav = new DataView(new ArrayBuffer(44 + n * 4));
  const W = (o, s) => { for (let i = 0; i < s.length; i++) wav.setUint8(o + i, s.charCodeAt(i)); };
  W(0, 'RIFF'); wav.setUint32(4, 36 + n * 4, true); W(8, 'WAVEfmt '); wav.setUint32(16, 16, true); wav.setUint16(20, 1, true); wav.setUint16(22, 2, true);
  wav.setUint32(24, SR, true); wav.setUint32(28, SR * 4, true); wav.setUint16(32, 4, true); wav.setUint16(34, 16, true); W(36, 'data'); wav.setUint32(40, n * 4, true);
  for (let i = 0; i < n; i++) { wav.setInt16(44 + i * 4, Math.max(-1, Math.min(1, L[i] * g)) * 32767, true); wav.setInt16(46 + i * 4, Math.max(-1, Math.min(1, R[i] * g)) * 32767, true); }
  const u8 = new Uint8Array(wav.buffer); let s = ''; const CH = 0x8000;
  for (let i = 0; i < u8.length; i += CH) s += String.fromCharCode.apply(null, u8.subarray(i, i + CH));
  return { b64: btoa(s), played, failed, peak };
}, { events, dur, SR });
fs.writeFileSync(path.join(OUT, 'audio.wav'), Buffer.from(res.b64, 'base64'));
console.log(JSON.stringify({ events: events.length, played: res.played, failed: res.failed.slice(0, 5), peak: res.peak, seconds: dur,
  first: events.slice(0, 30).map((x) => x.n + '@' + (x.t / 1000).toFixed(2)).join(' ') }));
await browser.close();
