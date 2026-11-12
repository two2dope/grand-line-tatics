/* GLT.lobby: room codes, share links, pseudonymous nicknames, player ids. Area: net. Contract: ARCHITECTURE.md §6.6.
 * Implemented by the architect (formats are contract). Nicknames travel only as NickCode "a.n.dd". */
(function () {
  'use strict';
  const GLT = (globalThis.GLT = globalThis.GLT || {});

  const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  const CODE_LEN = 5;
  const CODE_RE = new RegExp('^[' + ALPHABET + ']{' + CODE_LEN + '}$');

  function rnd(n, rng) {
    if (rng) return rng.int(n);
    const u = new Uint32Array(1);
    globalThis.crypto.getRandomValues(u);
    return u[0] % n;
  }

  function code(rng) {
    let s = '';
    for (let i = 0; i < CODE_LEN; i++) s += ALPHABET.charAt(rnd(ALPHABET.length, rng));
    return s;
  }

  function normalizeCode(s) {
    const t = String(s || '').toUpperCase().replace(/[\s-]/g, '');
    return CODE_RE.test(t) ? t : null;
  }

  function shareLink(c, base) {
    let b = base;
    if (!b && typeof location !== 'undefined') {
      const ref = typeof document !== 'undefined' ? document.referrer || '' : '';
      b = /claude\.ai\/(code\/)?artifact\//.test(ref) ? ref : location.href;
    }
    b = String(b || '').split('#')[0];
    return b + '#sala=' + c;
  }

  function parseLink(href) {
    const m = /[#?&]sala=([A-Za-z0-9-]+)/.exec(String(href || ''));
    return m ? normalizeCode(m[1]) : null;
  }

  // NickCode "a.n.dd": adjective index, noun index, two digits. Indices are taken modulo the
  // dictionary's variant counts at render time, so the code stays valid if the lists grow.
  function nickname(rng) {
    const a = rnd(64, rng), n = rnd(64, rng), d = rnd(100, rng);
    return a + '.' + n + '.' + (d < 10 ? '0' + d : String(d));
  }

  function parseNick(nick) {
    const m = /^(\d{1,2})\.(\d{1,2})\.(\d{2})$/.exec(String(nick || ''));
    return m ? { a: +m[1], n: +m[2], d: m[3] } : null;
  }

  function nickText(nick) {
    const p = parseNick(nick);
    if (!p || !GLT.T) return GLT.T ? GLT.T('nick.fallback') : 'nick.fallback';
    return GLT.T('nick.format', { noun: GLT.T('nick.noun', { v: p.n }), adj: GLT.T('nick.adj', { v: p.a }), num: p.d });
  }

  function pid() { return 'p_' + GLT.commit.randomHex(6); }

  GLT.lobby = { ALPHABET, CODE_LEN, code, normalizeCode, shareLink, parseLink, nickname, parseNick, nickText, pid };
})();
