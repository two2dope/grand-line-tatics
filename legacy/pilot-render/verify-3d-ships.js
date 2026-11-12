const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

async function main() {
  const cdpPort = 9277;
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chrome-3dships-'));
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

  const cLogs = [];
  ws.onmessage = (ev) => {
    const d = JSON.parse(ev.data);
    if (d.method === 'Runtime.consoleAPICalled') {
      cLogs.push(d.params.args.map(a => a.value || a.description).join(' '));
    } else if (d.method === 'Runtime.exceptionThrown') {
      cLogs.push('EXCEPTION: ' + JSON.stringify(d.params.exceptionDetails));
    }
  };

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

  // Poll until ships have hasGlb == true or 6 seconds
  let diag = null;
  for (let i = 0; i < 14; i++) {
    await new Promise(r => setTimeout(r, 500));
    const evalRes = await send('Runtime.evaluate', {
      expression: `(() => {
        const ships = GLT.ui && GLT.ui.playerShipMeshes ? GLT.ui.playerShipMeshes : [];
        return {
          hasThree: typeof THREE !== 'undefined',
          hasGLTF: typeof THREE !== 'undefined' && typeof THREE.GLTFLoader !== 'undefined',
          loaderInVoxel: typeof GLT !== 'undefined' && GLT.shipsVoxel ? Boolean(THREE && THREE.GLTFLoader) : false,
          count: ships.length,
          shipIds: ships.map(s => s.name),
          hasGlb: ships.map(s => Boolean(s.userData && s.userData.hasGlb))
        };
      })()`,
      returnByValue: true
    });
    diag = evalRes.result.value;
    if (diag.hasGlb && diag.hasGlb.length > 0 && diag.hasGlb.every(Boolean)) {
      break;
    }
  }

  console.log('3D Ships Diagnostics:', JSON.stringify(diag, null, 2));
  console.log('Browser Logs:', cLogs);

  // Allow one more render frame
  await new Promise(r => setTimeout(r, 600));

  const ss = await send('Page.captureScreenshot', { format: 'png' });
  const artDir = path.join(__dirname, '..', 'shots', 'captures');
  fs.mkdirSync(artDir, { recursive: true });
  const artPath = path.join(artDir, '11-3d-ships-glb-board.png');
  fs.writeFileSync(artPath, Buffer.from(ss.data, 'base64'));
  console.log('Saved screenshot to:', artPath);

  ws.close();
  chromeProc.kill();
  process.exit(0);
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
