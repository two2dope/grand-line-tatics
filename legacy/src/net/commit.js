/* GLT.commit: WebCrypto SHA-256 commitments, salts and nonces. Area: net. Contract: ARCHITECTURE.md §6.1, §6.6.
 * Implemented by the architect (format is contract): commit = sha256Hex(GLT.board.canonical(fleet) + salt). */
(function () {
  'use strict';
  const GLT = (globalThis.GLT = globalThis.GLT || {});

  function cryptoObj() {
    const c = globalThis.crypto;
    if (!c || typeof c.getRandomValues !== 'function') throw new Error('GLT.commit: WebCrypto unavailable');
    return c;
  }

  function randomHex(bytes) {
    const u = new Uint8Array(bytes);
    cryptoObj().getRandomValues(u);
    let s = '';
    for (let i = 0; i < u.length; i++) s += (u[i] < 16 ? '0' : '') + u[i].toString(16);
    return s;
  }

  async function sha256Hex(str) {
    const c = cryptoObj();
    if (!c.subtle) throw new Error('GLT.commit: crypto.subtle unavailable');
    const buf = await c.subtle.digest('SHA-256', new TextEncoder().encode(String(str)));
    const u = new Uint8Array(buf);
    let s = '';
    for (let i = 0; i < u.length; i++) s += (u[i] < 16 ? '0' : '') + u[i].toString(16);
    return s;
  }

  function salt() { return randomHex(16); }
  function nonce() { return randomHex(16); }
  function commit(fleet, s) { return sha256Hex(GLT.board.canonical(fleet) + String(s)); }
  async function verify(fleet, s, commitHex) {
    try { return (await commit(fleet, s)) === String(commitHex).toLowerCase(); } catch (e) { return false; }
  }

  GLT.commit = { salt, nonce, sha256Hex, commit, verify, randomHex };
})();
