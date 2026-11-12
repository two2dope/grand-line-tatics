const { spawn } = require('child_process');
const os = require('os');
const path = require('path');
const fs = require('fs');

const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

async function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function connectCdp(port) {
  for (let i = 0; i < 30; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json/list`);
      const tabs = await res.json();
      const pageTab = tabs.find(t => t.type === 'page');
      if (pageTab && pageTab.webSocketDebuggerUrl) {
        return pageTab.webSocketDebuggerUrl;
      }
    } catch (_) {}
    await sleep(200);
  }
  throw new Error('Could not connect to Chrome DevTools Protocol');
}

class CdpClient {
  constructor(wsUrl) {
    this.ws = new WebSocket(wsUrl);
    this.id = 0;
    this.pending = new Map();
    this.consoleErrors = [];
  }
  async init() {
    await new Promise((resolve, reject) => {
      this.ws.onopen = resolve;
      this.ws.onerror = reject;
    });
    this.ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(JSON.stringify(msg.error)));
        else resolve(msg.result);
      } else if (msg.method === 'Runtime.exceptionThrown') {
        this.consoleErrors.push(JSON.stringify(msg.params.exceptionDetails));
      } else if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
        this.consoleErrors.push(msg.params.args.map(a => a.value || a.description).join(' '));
      }
    };
    await this.send('Page.enable');
    await this.send('Runtime.enable');
  }
  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
  close() {
    this.ws.close();
  }
}

async function main() {
  const outDir = path.join(__dirname, '..', 'shots', 'captures');
  fs.mkdirSync(outDir, { recursive: true });
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'glt-capture-scene-'));

  const port = 9333;
  const chrome = spawn(CHROME_PATH, [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${userDataDir}`,
    '--headless=new',
    '--window-size=1280,720',
    '--use-gl=angle',
    '--enable-webgl',
    '--ignore-gpu-blocklist',
    '--no-first-run',
    '--no-default-browser-check',
    'about:blank'
  ], { stdio: 'ignore' });

  try {
    const wsUrl = await connectCdp(port);
    const cdp = new CdpClient(wsUrl);
    await cdp.init();

    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: 1280,
      height: 720,
      deviceScaleFactor: 1,
      mobile: false
    });

    const url = 'file:///' + path.join(__dirname, 'scene-preview.html').replace(/\\/g, '/');
    await cdp.send('Page.navigate', { url });

    // Wait for window.HARNESS to be ready
    for (let i = 0; i < 40; i++) {
      const check = await cdp.send('Runtime.evaluate', {
        expression: 'Boolean(window.HARNESS)',
        returnByValue: true
      });
      if (check.result && check.result.value === true) break;
      await sleep(250);
    }

    const scenarios = [
      { name: '01-day-duas-aguas', cfg: { env: 'day', camera: 'duas_aguas', lift: true, fireShot: true, steps: 20 } },
      { name: '02-dusk-mira-inimiga', cfg: { env: 'dusk', camera: 'mira_inimiga', lift: true, fireShot: true, steps: 20 } },
      { name: '03-night-minhas-aguas', cfg: { env: 'night', camera: 'minhas_aguas', lift: true, steps: 25 } },
      { name: '04-storm-panorama-lift-off', cfg: { env: 'storm', camera: 'panorama', lift: false, steps: 25 } },
      { name: '05-ceremony-wanted', cfg: { env: 'dusk', camera: 'duas_aguas', lift: false, ceremony: true, steps: 15 } }
    ];

    for (const s of scenarios) {
      await cdp.send('Runtime.evaluate', {
        expression: `window.HARNESS.setScenario(${JSON.stringify(s.cfg)})`,
        returnByValue: true
      });
      await sleep(100);
      const shot = await cdp.send('Page.captureScreenshot', { format: 'png' });
      const file = path.join(outDir, `${s.name}.png`);
      fs.writeFileSync(file, Buffer.from(shot.data, 'base64'));
      console.log('Captured:', file);
    }

    const perf = await cdp.send('Runtime.evaluate', {
      expression: `(() => {
        const t0 = performance.now();
        for (let i = 0; i < 120; i++) window.HARNESS.stepFrame(0.016);
        const elapsed = performance.now() - t0;
        return { elapsedMs: elapsed, avgFrameMs: elapsed / 120, estFps: 1000 / (elapsed / 120) };
      })()`,
      returnByValue: true
    });

    console.log('Performance (120 frames):', JSON.stringify(perf.result.value));
    console.log('Console errors:', cdp.consoleErrors.length, cdp.consoleErrors);

    cdp.close();
    if (cdp.consoleErrors.length > 0) process.exitCode = 1;
  } finally {
    chrome.kill();
    await sleep(250);
    try { fs.rmSync(userDataDir, { recursive: true, force: true }); } catch (_) {}
  }
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
