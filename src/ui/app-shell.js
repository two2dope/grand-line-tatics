/**
 * Grand Line Tactics: the page as an installable app on phones (PWA).
 *
 * - Service worker (sw.js, written by scripts/build.js): the game opens with no connection and
 *   plays against the AI after the first visit. Registered on https only, never inside a frame
 *   (the single-file artifact build runs in one).
 * - Install: keeps the browser's install prompt (Chrome on Android and desktop) for a button in
 *   Ajustes. Safari on iPhone has no prompt; the game explains "Adicionar à Tela de Início".
 * - Full screen: a toggle in the top bar. A phone turned sideways enters full screen on the
 *   next tap (browsers only allow it from a tap). Leaving full screen by hand stops that until
 *   the phone is turned again. iPhone Safari has no full screen for pages: there the installed
 *   app is the way to lose the browser bars.
 * - Screen kept awake during a battle (Screen Wake Lock), and a short vibration on hits and
 *   sinkings where the device supports it.
 */
(function () {
  'use strict';

  var GLT = (window.GLT = window.GLT || {});

  var KEY_AUTO_FS = 'glt_auto_fullscreen';
  var KEY_VIBRATE = 'glt_vibrate';
  var PHONE_LANDSCAPE = '(orientation: landscape) and (max-height: 520px) and (pointer: coarse)';

  var installEvent = null;
  var listeners = [];
  var armed = false;     // the next tap enters full screen
  var userLeft = false;  // the player left full screen while the phone stayed sideways
  var wakeLock = null;
  var swState = 'none';  // none | registered | unsupported

  function media(q) {
    try { return !!(window.matchMedia && window.matchMedia(q).matches); } catch (_) { return false; }
  }
  function readPref(key, fallback) {
    try {
      var v = localStorage.getItem(key);
      return v === null ? fallback : v === '1';
    } catch (_) { return fallback; }
  }
  function writePref(key, on) {
    try { localStorage.setItem(key, on ? '1' : '0'); } catch (_) {}
  }
  function notify() {
    listeners.slice().forEach(function (fn) { try { fn(); } catch (_) {} });
  }

  function isStandalone() {
    return media('(display-mode: fullscreen)') || media('(display-mode: standalone)') || navigator.standalone === true;
  }
  function isIos() {
    var ua = navigator.userAgent || '';
    return /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  }
  function isTouch() { return media('(pointer: coarse)'); }
  function isPhoneLandscape() { return media(PHONE_LANDSCAPE); }

  function fullscreenElement() { return document.fullscreenElement || document.webkitFullscreenElement || null; }
  function isFullscreen() { return !!fullscreenElement(); }
  function canFullscreen() {
    var d = document.documentElement;
    return !!(document.fullscreenEnabled || document.webkitFullscreenEnabled) && !!(d.requestFullscreen || d.webkitRequestFullscreen);
  }
  function enterFullscreen() {
    var d = document.documentElement;
    try {
      var p = d.requestFullscreen ? d.requestFullscreen({ navigationUI: 'hide' }) : d.webkitRequestFullscreen();
      if (p && typeof p.catch === 'function') p.catch(function () {});
    } catch (_) {}
  }
  function exitFullscreen() {
    try {
      var p = document.exitFullscreen ? document.exitFullscreen() : (document.webkitExitFullscreen && document.webkitExitFullscreen());
      if (p && typeof p.catch === 'function') p.catch(function () {});
    } catch (_) {}
  }
  function toggleFullscreen() {
    if (isFullscreen()) {
      userLeft = isPhoneLandscape();
      armed = false;
      exitFullscreen();
    } else {
      userLeft = false;
      enterFullscreen();
    }
  }

  function autoFullscreenOn() { return readPref(KEY_AUTO_FS, true); }
  function rearm() {
    armed = autoFullscreenOn() && canFullscreen() && !isStandalone() && isPhoneLandscape() && !isFullscreen() && !userLeft;
  }

  function onOrientation() {
    if (!isPhoneLandscape()) userLeft = false; // turned back upright: the next sideways turn asks again
    rearm();
    notify();
  }

  function onTap() {
    if (!armed) return;
    armed = false;
    enterFullscreen();
  }

  function onFullscreenChange() {
    if (!isFullscreen() && isPhoneLandscape()) userLeft = true;
    rearm();
    notify();
  }

  // --- install -------------------------------------------------------------------------------
  /** 'installed' | 'prompt' (button works) | 'ios' (Share > Add to Home Screen) | 'menu' (browser menu) */
  function installMode() {
    if (isStandalone()) return 'installed';
    if (installEvent) return 'prompt';
    if (isIos()) return 'ios';
    return 'menu';
  }
  function promptInstall() {
    if (!installEvent) return Promise.resolve(false);
    var ev = installEvent;
    installEvent = null;
    try { ev.prompt(); } catch (_) { notify(); return Promise.resolve(false); }
    return Promise.resolve(ev.userChoice).then(function (choice) {
      notify();
      return !!(choice && choice.outcome === 'accepted');
    }, function () { notify(); return false; });
  }

  // --- service worker ------------------------------------------------------------------------
  function registerServiceWorker() {
    var inFrame = false;
    try { inFrame = window.top !== window.self; } catch (_) { inFrame = true; }
    if (!('serviceWorker' in navigator) || location.protocol !== 'https:' || inFrame || window.__GLT_NO_SW__) {
      swState = 'unsupported';
      return;
    }
    navigator.serviceWorker.register('sw.js').then(function () {
      return navigator.serviceWorker.ready; // active: the files are in the cache
    }).then(function () {
      swState = 'registered';
      notify();
    }, function () {
      // Offline the update check of sw.js fails, while the installed worker still serves the page.
      swState = navigator.serviceWorker.controller ? 'registered' : 'unsupported';
      notify();
    });
  }

  // --- wake lock and vibration ---------------------------------------------------------------
  function wantAwake() {
    return document.visibilityState === 'visible' && !!(GLT.ui && GLT.ui.gamePhase === 'BATTLE');
  }
  function syncWakeLock() {
    if (!navigator.wakeLock || typeof navigator.wakeLock.request !== 'function') return;
    if (wantAwake()) {
      if (wakeLock) return;
      wakeLock = 'pending';
      navigator.wakeLock.request('screen').then(function (lock) {
        if (!wantAwake()) { lock.release().catch(function () {}); wakeLock = null; return; }
        wakeLock = lock;
        lock.addEventListener('release', function () { if (wakeLock === lock) wakeLock = null; });
      }, function () { wakeLock = null; });
    } else if (wakeLock && wakeLock !== 'pending') {
      var l = wakeLock;
      wakeLock = null;
      l.release().catch(function () {});
    }
  }

  function canVibrate() { return typeof navigator.vibrate === 'function' && isTouch(); }
  function vibrateOn() { return readPref(KEY_VIBRATE, true); }
  var PATTERNS = { hit: 35, sunk: [70, 50, 140], tap: 12 };
  function vibrate(kind) {
    if (!canVibrate() || !vibrateOn()) return;
    try { navigator.vibrate(PATTERNS[kind] || 25); } catch (_) {}
  }

  // --- wiring --------------------------------------------------------------------------------
  function init() {
    window.addEventListener('beforeinstallprompt', function (e) {
      e.preventDefault(); // the game offers it from Ajustes instead of the browser's mini bar
      installEvent = e;
      notify();
    });
    window.addEventListener('appinstalled', function () { installEvent = null; notify(); });

    document.addEventListener('pointerup', onTap, true);
    document.addEventListener('fullscreenchange', onFullscreenChange);
    document.addEventListener('webkitfullscreenchange', onFullscreenChange);
    try {
      var mq = window.matchMedia(PHONE_LANDSCAPE);
      if (mq.addEventListener) mq.addEventListener('change', onOrientation);
      else if (mq.addListener) mq.addListener(onOrientation);
    } catch (_) {}
    rearm();

    document.addEventListener('visibilitychange', syncWakeLock);
    setInterval(syncWakeLock, 2000); // battle starts and ends from many places; a cheap poll follows them

    if (document.readyState === 'complete') registerServiceWorker();
    else window.addEventListener('load', registerServiceWorker);
  }

  GLT.appShell = {
    init: init,
    onChange: function (fn) { if (typeof fn === 'function') listeners.push(fn); },
    isStandalone: isStandalone,
    isIos: isIos,
    isTouch: isTouch,
    isPhoneLandscape: isPhoneLandscape,
    canFullscreen: canFullscreen,
    isFullscreen: isFullscreen,
    toggleFullscreen: toggleFullscreen,
    autoFullscreen: autoFullscreenOn,
    setAutoFullscreen: function (on) { writePref(KEY_AUTO_FS, !!on); rearm(); notify(); },
    installMode: installMode,
    promptInstall: promptInstall,
    offlineReady: function () { return swState === 'registered'; },
    canVibrate: canVibrate,
    vibrateEnabled: vibrateOn,
    setVibrate: function (on) { writePref(KEY_VIBRATE, !!on); if (on) vibrate('tap'); },
    vibrate: vibrate
  };
})();
