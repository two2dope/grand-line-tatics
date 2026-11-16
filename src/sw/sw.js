/**
 * Grand Line Tactics service worker (template: scripts/build.js fills VERSION and PRECACHE and
 * writes the result to /sw.js next to index.html).
 *
 * - The page itself: network first, so every deploy shows up on the next open; the cached copy
 *   is used only with no connection.
 * - Game images (assets/) and the pinned CDN files (Three.js, PeerJS, fonts): cache first. Their
 *   URLs change when their content does (versioned CDN paths; a new deploy gets a new VERSION
 *   and a fresh cache).
 * - Online play (PeerJS signalling, the Wi-Fi relay API) is never cached.
 */
'use strict';

var VERSION = '__VERSION__';
var CACHE = 'glt-' + VERSION;
var PRECACHE = __PRECACHE__;
var CDN_HOSTS = ['cdnjs.cloudflare.com', 'fonts.googleapis.com', 'fonts.gstatic.com'];
var PAGE_KEY = './';

self.addEventListener('install', function (event) {
  event.waitUntil(caches.open(CACHE).then(function (cache) {
    return Promise.all(PRECACHE.map(function (url) {
      var cross = /^https?:\/\//.test(url);
      var req = new Request(url, cross ? { mode: 'no-cors' } : { cache: 'reload' });
      // one missing image must not cancel the whole install
      return fetch(req).then(function (res) {
        if (res.ok || res.type === 'opaque') return cache.put(url === './index.html' ? PAGE_KEY : url, res);
      }).catch(function () {});
    }));
  }).then(function () { return self.skipWaiting(); }));
});

self.addEventListener('activate', function (event) {
  event.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k.indexOf('glt-') === 0 && k !== CACHE; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});

function networkFirstPage(request) {
  return fetch(request).then(function (res) {
    if (res.ok) {
      var copy = res.clone();
      caches.open(CACHE).then(function (cache) { cache.put(PAGE_KEY, copy); });
    }
    return res;
  }).catch(function () {
    return caches.open(CACHE).then(function (cache) { return cache.match(PAGE_KEY); }).then(function (hit) {
      return hit || new Response('Sem conexão e sem cópia salva do jogo.', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
    });
  });
}

function cacheFirst(request) {
  return caches.open(CACHE).then(function (cache) {
    return cache.match(request, { ignoreSearch: true }).then(function (hit) {
      if (hit) return hit;
      return fetch(request).then(function (res) {
        if (res.ok || res.type === 'opaque') cache.put(request, res.clone());
        return res;
      });
    });
  });
}

self.addEventListener('fetch', function (event) {
  var request = event.request;
  if (request.method !== 'GET') return;
  var url = new URL(request.url);

  if (url.origin === self.location.origin) {
    if (url.pathname.indexOf('/api/') !== -1) return; // Wi-Fi relay
    if (request.mode === 'navigate') {
      event.respondWith(networkFirstPage(request));
      return;
    }
    if (url.pathname.indexOf('/assets/') !== -1 || /manifest\.webmanifest$/.test(url.pathname)) {
      event.respondWith(cacheFirst(request));
    }
    return;
  }

  if (CDN_HOSTS.indexOf(url.hostname) !== -1) event.respondWith(cacheFirst(request));
});
