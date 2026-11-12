/* GLT.transportHost: Transport over the artifact runtime's db + room + user capabilities.
 * Area: net. Contract: ARCHITECTURE.md §6.4, §14. STUB (architect). Owner: net builder.
 * globalThis.claude may be read ONLY inside probe(); everything else gets namespaces injected. */
(function () {
  'use strict';
  const GLT = (globalThis.GLT = globalThis.GLT || {});

  async function probe(claude) {
    const cl = claude || globalThis.claude;
    if (!cl || typeof cl.use !== 'function') {
      return { ok: false, reason: 'no_runtime', db: null, room: null, user: null, uid: null, canWrite: null };
    }
    // To implement (net builder): use('db'|'room'|'user'), user.id(), user.can('data.write'); see §14.
    return { ok: false, reason: 'no_db', db: null, room: null, user: null, uid: null, canWrite: null };
  }

  GLT.transportHost = {
    probe,
    create() { throw new Error('GLT.transportHost.create: not implemented'); }  // ({db, room, user, uid}) -> Transport
  };
})();
