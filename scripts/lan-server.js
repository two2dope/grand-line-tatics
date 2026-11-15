#!/usr/bin/env node
/**
 * Grand Line Tactics — Servidor Multijogador Wi-Fi / LAN (Zero Dependências)
 *
 * Permite jogar Online PvP entre aparelhos diferentes conectados no mesmo Wi-Fi / roteador
 * (ex.: PC vs Celular, Notebook vs Tablet, 2 PCs) mantendo o artefato HTML único.
 *
 * Uso:
 *   node scripts/lan-server.js
 *   node scripts/lan-server.js --port=8080 --open
 */

'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { exec } = require('child_process');

const ROOT_DIR = path.resolve(__dirname, '..');
const ARTIFACT_FILE = fs.existsSync(path.join(ROOT_DIR, 'grand-line-tactics.html'))
  ? path.join(ROOT_DIR, 'grand-line-tactics.html')
  : path.join(ROOT_DIR, 'index.html');

const MAX_BODY_BYTES = 64 * 1024;
const MAX_EVENTS_PER_KEY = 600;
const MAX_ROOMS = 100;
// A room leaves "Salas Abertas" when its host stops sending presence (closed tab, lost Wi-Fi).
const OPEN_ROOM_IDLE_MS = 90 * 1000;
const OPEN_ROOM_SWEEP_MS = 10 * 1000;
const VENDOR_THREE_FILE = path.join(ROOT_DIR, 'tools', 'vendor', 'three.min.js');
const FONTS_CSS_FILE = path.join(ROOT_DIR, 'assets', 'fonts', 'fonts.css');
const CDN_THREE_RE = /<script src="https:\/\/cdnjs\.cloudflare\.com\/ajax\/libs\/three\.js\/r128\/three\.min\.js"><\/script>/;
const CDN_FONTS_RE = /<link rel="preconnect" href="https:\/\/fonts\.googleapis\.com">\s*<link rel="preconnect" href="https:\/\/fonts\.gstatic\.com" crossorigin>\s*<link href="https:\/\/fonts\.googleapis\.com\/css2[^"]*" rel="stylesheet">/;

/**
 * Point the page at copies served by this machine, so a second device on a Wi-Fi without
 * internet (hotspot, router with no uplink) still loads the game. Only what exists is rewritten.
 */
function localizeExternalAssets(html) {
  let out = html;
  if (fs.existsSync(VENDOR_THREE_FILE)) {
    out = out.replace(CDN_THREE_RE, '<script src="/vendor/three.min.js"></script>');
  }
  if (fs.existsSync(FONTS_CSS_FILE)) {
    out = out.replace(CDN_FONTS_RE, '<link href="/assets/fonts/fonts.css" rel="stylesheet">');
  }
  return out;
}

/**
 * Detecta endereços IPv4 da rede local (Wi-Fi / Ethernet), priorizando adaptadores físicos
 * reais sobre adaptadores virtuais (WSL, Hyper-V, Docker, VirtualBox, VMware).
 */
function detectLanUrls(port) {
  const interfaces = os.networkInterfaces();
  const candidates = [];

  for (const [ifName, addrs] of Object.entries(interfaces)) {
    if (!Array.isArray(addrs)) continue;
    const isVirtualName = /vethernet|wsl|docker|vbox|virtualbox|vmware|hyper-v|loopback|tailscale|hamachi/i.test(ifName);

    for (const addr of addrs) {
      const family = typeof addr.family === 'string' ? addr.family : (addr.family === 4 ? 'IPv4' : 'IPv6');
      if (family !== 'IPv4' || addr.internal) continue;
      if (addr.address.startsWith('169.254.')) continue; // APIPA

      let priority = 50;
      if (isVirtualName || addr.address.startsWith('192.168.56.')) {
        priority = 10;
      } else if (addr.address.startsWith('192.168.')) {
        priority = 100;
      } else if (addr.address.startsWith('10.')) {
        priority = 90;
      } else if (/^172\.(1[6-9]|2\d|3[0-1])\./.test(addr.address)) {
        priority = 80;
      }

      candidates.push({
        ifName,
        ip: addr.address,
        url: `http://${addr.address}:${port}`,
        priority
      });
    }
  }

  candidates.sort((a, b) => b.priority - a.priority);
  const uniqueUrls = [];
  for (const c of candidates) {
    if (!uniqueUrls.includes(c.url)) uniqueUrls.push(c.url);
  }
  return uniqueUrls;
}

/**
 * Cria uma instância isolada do servidor LAN (também exportada para testes automatizados).
 */
function createLanServer() {
  // key -> Array<event>
  const roomLogs = new Map();
  // roomId -> openRoomSummary
  const openRoomsMap = new Map();
  // key -> Set<http.ServerResponse>
  const sseSubscribers = new Map();
  // roomId -> secret chosen by the device that opened the room; only it may close the room
  const roomOwners = new Map();
  // roomId -> last time anything (presence included) arrived for that room
  const roomLastSeen = new Map();
  // roomIds currently hidden from the open list because their host went quiet
  const dormantRooms = new Set();

  function getOpenRoomsArray() {
    return Array.from(openRoomsMap.values())
      .filter(entry => !dormantRooms.has(entry.id))
      .slice(-12);
  }

  function ownerAllows(roomId, token) {
    const owner = roomOwners.get(roomId);
    return !owner || (typeof token === 'string' && token === owner);
  }

  function forgetRoom(roomId) {
    openRoomsMap.delete(roomId);
    dormantRooms.delete(roomId);
  }

  function touchRoom(roomId) {
    if (!openRoomsMap.has(roomId)) return;
    roomLastSeen.set(roomId, Date.now());
    if (dormantRooms.has(roomId)) {
      // The host came back (screen unlocked, Wi-Fi returned): list the room again.
      dormantRooms.delete(roomId);
      const entry = Object.assign({}, openRoomsMap.get(roomId), { _transportMsgId: 'room_' + roomId + '_' + Date.now() });
      openRoomsMap.set(roomId, entry);
      broadcastSse('glt_open_rooms', entry);
    }
  }

  function sweepIdleOpenRooms(now) {
    const at = typeof now === 'number' ? now : Date.now();
    for (const id of openRoomsMap.keys()) {
      if (dormantRooms.has(id)) continue;
      const seen = roomLastSeen.get(id) || 0;
      if (at - seen > OPEN_ROOM_IDLE_MS) {
        dormantRooms.add(id);
        broadcastSse('glt_open_rooms', { type: 'ROOM_DELETED', id, reason: 'expired', _transportMsgId: 'exp_' + id + '_' + at });
      }
    }
  }

  function broadcastSse(key, event) {
    const subs = sseSubscribers.get(key);
    if (!subs || subs.size === 0) return;
    const payload = `data: ${JSON.stringify({ key, event })}\n\n`;
    for (const res of subs) {
      try {
        res.write(payload);
      } catch (_) {
        subs.delete(res);
      }
    }
  }

  function appendRoomEvent(key, event) {
    if (!key || !event || typeof event !== 'object') return false;

    if (key === 'glt_open_rooms') {
      if (event.type === 'ROOM_DELETED' && event.id && event.reason === 'started') {
        // The match began: the room leaves the open list but its log stays (refresh/resume need it).
        const startedId = String(event.id).toUpperCase();
        if (!ownerAllows(startedId, event.ownerToken)) return false;
        forgetRoom(startedId);
        broadcastSse('glt_open_rooms', { type: 'ROOM_DELETED', id: startedId, reason: 'started', _transportMsgId: event._transportMsgId || ('started_' + Date.now()) });
        return true;
      }
      if (event.type === 'ROOM_DELETED' && event.id) {
        const cleanId = String(event.id).toUpperCase();
        // Closing a room ends the match for both devices: only the device that opened it may do so.
        if (!ownerAllows(cleanId, event.ownerToken)) return false;
        forgetRoom(cleanId);
        roomLogs.delete(cleanId);
        roomOwners.delete(cleanId);
        roomLastSeen.delete(cleanId);
        broadcastSse('glt_open_rooms', { type: 'ROOM_DELETED', id: cleanId, _transportMsgId: event._transportMsgId || ('del_' + Date.now()) });
        broadcastSse(cleanId, { type: 'ROOM_DELETED', id: cleanId, _transportMsgId: 'del_' + Date.now() });
        return true;
      }
      if (event.type === 'ROOMS_CLEARED') {
        // No device may wipe everybody's rooms. Abandoned rooms leave the list by themselves
        // (see sweepIdleOpenRooms) and each host closes only the room it opened.
        return false;
      }
      if (event.id) {
        const cleanId = String(event.id).toUpperCase();
        const token = typeof event.ownerToken === 'string' ? event.ownerToken.slice(0, 64) : '';
        if (!ownerAllows(cleanId, token)) return false; // somebody else already owns this code
        if (token && !roomOwners.has(cleanId)) roomOwners.set(cleanId, token);
        dormantRooms.delete(cleanId);
        roomLastSeen.set(cleanId, Date.now());
        const entry = {
          id: cleanId,
          host: String(event.host || 'Capitão').slice(0, 24),
          crewId: String(event.crewId || 'straw_hats'),
          format: String(event.format || '10x10'),
          mode: String(event.mode || 'tatico'),
          timestamp: Number(event.timestamp) || Date.now(),
          _transportMsgId: event._transportMsgId || ('room_' + cleanId + '_' + Date.now())
        };
        openRoomsMap.delete(cleanId);
        openRoomsMap.set(cleanId, entry);
        while (openRoomsMap.size > 20) {
          const oldest = openRoomsMap.keys().next().value;
          forgetRoom(oldest);
        }
        broadcastSse('glt_open_rooms', entry);
        return true;
      }
      return false;
    }

    touchRoom(String(key).toUpperCase());

    // Presence is live-only: storing it would push ROOM_CREATED / READY_COMMIT out of the capped log.
    if (event.type === 'HEARTBEAT') {
      broadcastSse(key, event);
      return true;
    }

    if (!roomLogs.has(key)) {
      if (roomLogs.size >= MAX_ROOMS) {
        const oldestKey = roomLogs.keys().next().value;
        roomLogs.delete(oldestKey);
        roomOwners.delete(oldestKey);
        roomLastSeen.delete(oldestKey);
        forgetRoom(oldestKey);
      }
      roomLogs.set(key, []);
    }

    const list = roomLogs.get(key);
    const isDup = (event.eventId && list.some(e => e.eventId === event.eventId)) ||
      (event._transportMsgId && list.some(e => e._transportMsgId === event._transportMsgId));

    if (!isDup) {
      list.push(event);
      if (list.length > MAX_EVENTS_PER_KEY) {
        list.splice(0, list.length - MAX_EVENTS_PER_KEY);
      }
    }

    broadcastSse(key, event);
    return true;
  }

  function setSecurityHeaders(res) {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  }

  function isCrossSiteBlocked(req) {
    const fetchSite = req.headers['sec-fetch-site'];
    if (fetchSite && fetchSite === 'cross-site') {
      return true;
    }
    return false;
  }

  const server = http.createServer((req, res) => {
    setSecurityHeaders(res);

    const parsedUrl = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
    const pathname = parsedUrl.pathname;

    // 1. Servir o jogo HTML único com configuração LAN injetada em memória
    if (req.method === 'GET' && (pathname === '/' || pathname === '/index.html' || pathname === '/grand-line-tactics.html')) {
      try {
        const rawHtml = fs.readFileSync(ARTIFACT_FILE, 'utf8');
        const actualPort = server.address() ? server.address().port : 8080;
        const lanConfig = {
          enabled: true,
          port: actualPort,
          lanUrls: detectLanUrls(actualPort),
          initialRooms: getOpenRoomsArray()
        };
        const safeJson = JSON.stringify(lanConfig).replace(/</g, '\\u003c');
        const injectedScript = `<script>window.__GLT_LAN_CONFIG__=${safeJson};</script>`;
        const localHtml = localizeExternalAssets(rawHtml);
        const finalHtml = localHtml.includes('</head>')
          ? localHtml.replace('</head>', `${injectedScript}\n</head>`)
          : `${injectedScript}\n${localHtml}`;

        res.writeHead(200, {
          'Content-Type': 'text/html; charset=utf-8',
          'Cache-Control': 'no-store'
        });
        res.end(finalHtml);
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Erro ao carregar artefato HTML: ' + err.message);
      }
      return;
    }

    // 2. Informações de rede e salas abertas
    if (req.method === 'GET' && pathname === '/api/glt-lan/info') {
      const actualPort = server.address() ? server.address().port : 8080;
      res.writeHead(200, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store'
      });
      res.end(JSON.stringify({
        ok: true,
        port: actualPort,
        lanUrls: detectLanUrls(actualPort),
        openRooms: getOpenRoomsArray()
      }));
      return;
    }

    // 3. Leitura de eventos de uma chave/sala
    if (req.method === 'GET' && pathname === '/api/glt-lan/read') {
      const key = (parsedUrl.searchParams.get('key') || '').trim();
      const events = key === 'glt_open_rooms'
        ? getOpenRoomsArray()
        : (roomLogs.get(key) || []);

      res.writeHead(200, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store'
      });
      res.end(JSON.stringify({ ok: true, key, events }));
      return;
    }

    // 4. Stream em tempo real via Server-Sent Events (SSE)
    if (req.method === 'GET' && pathname === '/api/glt-lan/stream') {
      const key = (parsedUrl.searchParams.get('key') || '').trim();
      if (!key) {
        res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ ok: false, error: 'Missing key' }));
        return;
      }

      res.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no'
      });
      res.write(': connected\n\n');

      // Envia histórico imediato para sincronizar aparelhos recém-conectados
      const initialEvents = key === 'glt_open_rooms'
        ? getOpenRoomsArray()
        : (roomLogs.get(key) || []);

      for (const ev of initialEvents) {
        res.write(`data: ${JSON.stringify({ key, event: ev })}\n\n`);
      }

      if (!sseSubscribers.has(key)) {
        sseSubscribers.set(key, new Set());
      }
      const subs = sseSubscribers.get(key);
      subs.add(res);

      const keepAlive = setInterval(() => {
        try {
          res.write(': ping\n\n');
        } catch (_) {
          clearInterval(keepAlive);
          subs.delete(res);
        }
      }, 15000);
      if (keepAlive.unref) keepAlive.unref();

      req.on('close', () => {
        clearInterval(keepAlive);
        subs.delete(res);
      });
      return;
    }

    // 5. Publicação de eventos (POST /api/glt-lan/publish)
    if (req.method === 'POST' && pathname === '/api/glt-lan/publish') {
      if (isCrossSiteBlocked(req)) {
        res.writeHead(403, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ ok: false, error: 'Cross-site request blocked' }));
        return;
      }

      let body = '';
      let aborted = false;
      req.on('data', chunk => {
        body += chunk;
        if (body.length > MAX_BODY_BYTES) {
          aborted = true;
          res.writeHead(413, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ ok: false, error: 'Payload too large' }));
          req.destroy();
        }
      });
      req.on('end', () => {
        if (aborted) return;
        try {
          const parsed = JSON.parse(body || '{}');
          const ok = appendRoomEvent(String(parsed.key || '').trim(), parsed.event);
          res.writeHead(ok ? 200 : 403, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify(ok ? { ok } : { ok, error: 'Refused' }));
        } catch (_) {
          res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ ok: false, error: 'Invalid JSON' }));
        }
      });
      return;
    }

    // 6. Exclusão de salas abertas (DELETE /api/glt-lan/rooms?id=ABCDE ou ?all=1)
    if (req.method === 'DELETE' && pathname === '/api/glt-lan/rooms') {
      if (isCrossSiteBlocked(req)) {
        res.writeHead(403, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ ok: false, error: 'Cross-site request blocked' }));
        return;
      }

      const roomId = (parsedUrl.searchParams.get('id') || '').trim().toUpperCase();
      const ownerToken = parsedUrl.searchParams.get('token') || '';
      // "?all=1" used to wipe every room on the server; it is refused now.
      const deleted = Boolean(roomId) && parsedUrl.searchParams.get('all') !== '1' &&
        appendRoomEvent('glt_open_rooms', { type: 'ROOM_DELETED', id: roomId, ownerToken });

      res.writeHead(deleted ? 200 : 403, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(deleted
        ? { ok: true, openRooms: getOpenRoomsArray() }
        : { ok: false, error: 'Only the device that opened a room can close it' }));
      return;
    }

    if (pathname === '/favicon.ico') {
      res.writeHead(204);
      res.end();
      return;
    }

    // 7. three.js local (o HTML servido aponta para cá em vez do CDN)
    if (req.method === 'GET' && pathname === '/vendor/three.min.js' && fs.existsSync(VENDOR_THREE_FILE)) {
      res.writeHead(200, {
        'Content-Type': 'text/javascript; charset=utf-8',
        'Cache-Control': 'public, max-age=86400'
      });
      fs.createReadStream(VENDOR_THREE_FILE).pipe(res);
      return;
    }

    // 8. Arquivos estáticos (Assets: retratos, sinetes, mapas, bênçãos e fontes)
    if (req.method === 'GET' && pathname.startsWith('/assets/')) {
      const assetsRoot = path.join(ROOT_DIR, 'assets');
      let decodedPath = '';
      try { decodedPath = decodeURIComponent(pathname); } catch (_) { decodedPath = ''; }
      const filePath = path.join(ROOT_DIR, path.normalize(decodedPath));
      const insideAssets = decodedPath !== '' && filePath.startsWith(assetsRoot + path.sep);
      if (insideAssets && fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
        const ext = path.extname(filePath).toLowerCase();
        const mimeTypes = {
          '.jpg': 'image/jpeg',
          '.jpeg': 'image/jpeg',
          '.png': 'image/png',
          '.webp': 'image/webp',
          '.svg': 'image/svg+xml',
          '.css': 'text/css; charset=utf-8',
          '.woff2': 'font/woff2',
          '.glb': 'model/gltf-binary',
          '.gltf': 'model/gltf+json'
        };
        res.writeHead(200, {
          'Content-Type': mimeTypes[ext] || 'application/octet-stream',
          'Cache-Control': 'public, max-age=86400'
        });
        fs.createReadStream(filePath).pipe(res);
        return;
      }
    }

    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Não encontrado');
  });

  const sweepTimer = setInterval(sweepIdleOpenRooms, OPEN_ROOM_SWEEP_MS);
  if (sweepTimer.unref) sweepTimer.unref();
  server.on('close', () => clearInterval(sweepTimer));
  // Exposed for tests: run the idle sweep as if the clock read `now`.
  server.sweepIdleOpenRooms = sweepIdleOpenRooms;

  return server;
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const portArg = args.find(a => a.startsWith('--port='));
  const preferredPort = portArg ? parseInt(portArg.split('=')[1], 10) : (parseInt(process.env.PORT, 10) || 8080);
  const shouldOpenBrowser = args.includes('--open');

  const server = createLanServer();

  function tryListen(port, attemptsLeft) {
    server.once('error', err => {
      if (err && err.code === 'EADDRINUSE' && attemptsLeft > 0) {
        tryListen(port + 1, attemptsLeft - 1);
      } else {
        console.error('Erro ao iniciar servidor Wi-Fi:', err.message);
        process.exit(1);
      }
    });

    server.listen(port, '0.0.0.0', () => {
      const actualPort = server.address().port;
      const lanUrls = detectLanUrls(actualPort);
      const localUrl = `http://localhost:${actualPort}`;

      console.log('');
      console.log('==================================================================');
      console.log(' 🏴‍☠️  GRAND LINE TACTICS — SERVIDOR WI-FI / REDE LOCAL ATIVO!');
      console.log('==================================================================');
      console.log(` 💻 Neste computador:        ${localUrl}`);
      if (lanUrls.length > 0) {
        lanUrls.forEach((u, idx) => {
          const tag = idx === 0 ? ' 📱 No celular / outro PC:  ' : ' 🌐 Outro adaptador de rede:';
          console.log(`${tag} ${u}`);
        });
      } else {
        console.log(' ⚠️  Nenhum IP Wi-Fi detectado. Verifique se está conectado ao roteador.');
      }
      console.log('------------------------------------------------------------------');
      console.log(' Como jogar em 2 aparelhos no mesmo Wi-Fi:');
      console.log('  1. Abra o endereço acima no navegador deste PC e no celular/outro PC.');
      console.log('  2. Vá na aba "Online" -> "Criar Sala" em um aparelho.');
      console.log('  3. No segundo aparelho, toque em "Entrar Rápido" na sala criada!');
      console.log('  (Se o Firewall do Windows perguntar, marque "Redes Privadas" e permita.)');
      console.log('  Pressione Ctrl+C nesta janela quando quiser encerrar o servidor.');
      console.log('==================================================================');
      console.log('');

      if (shouldOpenBrowser) {
        const cmd = process.platform === 'win32'
          ? `start "" "${localUrl}"`
          : process.platform === 'darwin'
            ? `open "${localUrl}"`
            : `xdg-open "${localUrl}"`;
        exec(cmd, () => {});
      }
    });
  }

  tryListen(preferredPort, 10);
}

module.exports = { createLanServer, detectLanUrls, localizeExternalAssets };
