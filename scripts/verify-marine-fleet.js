const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

async function testMarine() {
  const cdpPort = 9295;
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chrome-marine-'));
  const chromeProc = spawn(CHROME_PATH, [
    '--headless=new',
    '--no-sandbox',
    '--disable-gpu',
    `--remote-debugging-port=${cdpPort}`,
    `--user-data-dir=${userDataDir}`,
    '--window-size=1280,720',
    'about:blank'
  ]);
  await new Promise(r => setTimeout(r, 1200));
  const res = await fetch(`http://127.0.0.1:${cdpPort}/json/list`);
  const tabs = await res.json();
  const ws = new WebSocket(tabs.find(t => t.type === 'page').webSocketDebuggerUrl);
  await new Promise(r => ws.onopen = r);

  let id = 1;
  function send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const curId = id++;
      const handler = (ev) => {
        const d = JSON.parse(ev.data);
        if (d.id === curId) {
          ws.removeEventListener('message', handler);
          if (d.error) reject(new Error(JSON.stringify(d.error)));
          else resolve(d.result);
        }
      };
      ws.addEventListener('message', handler);
      ws.send(JSON.stringify({ id: curId, method, params }));
    });
  }

  await send('Page.enable');
  await send('Runtime.enable');
  await send('Page.navigate', { url: 'http://localhost:8080/' });
  await new Promise(r => setTimeout(r, 2000));

  // Click on Marine crew card
  await send('Runtime.evaluate', {
    expression: `(() => {
      const el = document.querySelector('.glt-crew-card[data-crew="marines"]');
      if (el) el.click();
    })()`
  });

  await new Promise(r => setTimeout(r, 2500));

  const ss = await send('Page.captureScreenshot', { format: 'png' });
  const artDir = path.join(__dirname, '..', 'shots', 'captures');
  fs.mkdirSync(artDir, { recursive: true });
  const artPath = path.join(artDir, '12-3d-ships-marine-fleet.png');
  fs.writeFileSync(artPath, Buffer.from(ss.data, 'base64'));
  console.log('Saved Marine fleet screenshot to:', artPath);

  ws.close();
  chromeProc.kill();
  process.exit(0);
}

testMarine().catch(console.error);

