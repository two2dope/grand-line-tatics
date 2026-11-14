/**
 * Grand Line Tactics — Network Transport Layer
 * 
 * Defines the Transport interface and implementations:
 * 1. ArtifactSharedTransport: Wi-Fi/LAN relay (scripts/lan-server.js) or cross-tab BroadcastChannel + localStorage
 * 4. ArtifactDbTransport: published Artifact — claude.use("db") move log + claude.use("room") presence/reactions
 *    (detectTransportBackend + createTransportFor pick the backend automatically)
 * 2. InMemoryTransport: zero-dependency in-memory event bus
 * 3. SimulatedNetworkTransport & SimulatedNetworkHub: latency, packet drops, duplicate injection,
 *    out-of-order delivery, disconnect/reconnect, and virtual clock support for deterministic testing.
 * 
 * Works in both browser environments and headless Node.js without modification.
 */

(function(root) {
  'use strict';

  /** Deep clone helper to prevent accidental shared-state mutation */
  function clone(obj) {
    if (obj === undefined || obj === null) return obj;
    return JSON.parse(JSON.stringify(obj));
  }

  /** Cryptographically secure random hex string without pseudorandom float */
  function getRandomHex(bytesCount = 4) {
    if (typeof globalThis !== 'undefined' && globalThis.crypto && typeof globalThis.crypto.getRandomValues === 'function') {
      const bytes = new Uint8Array(bytesCount);
      globalThis.crypto.getRandomValues(bytes);
      return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
    }
    try {
      const nodeCrypto = require('crypto');
      return nodeCrypto.randomBytes(bytesCount).toString('hex');
    } catch (_) {}
    return (Date.now().toString(36) + '00000000').slice(0, bytesCount * 2);
  }

  /** Default random generator in [0, 1) using WebCrypto / node crypto */
  function defaultRng() {
    if (typeof globalThis !== 'undefined' && globalThis.crypto && typeof globalThis.crypto.getRandomValues === 'function') {
      const u32 = new Uint32Array(1);
      globalThis.crypto.getRandomValues(u32);
      return u32[0] / 4294967296;
    }
    try {
      const nodeCrypto = require('crypto');
      const b = nodeCrypto.randomBytes(4);
      return (((b[0] << 24) | (b[1] << 16) | (b[2] << 8) | b[3]) >>> 0) / 4294967296;
    } catch (_) {}
    return 0.5;
  }

  /**
   * Base Transport Interface
   */
  class Transport {
    constructor() {
      if (new.target === Transport) {
        throw new TypeError('Transport is an abstract interface and cannot be instantiated directly.');
      }
    }

    /**
     * Publish an event to the specified channel/room key.
     * @param {string} key - Room or channel identifier
     * @param {object} event - Event payload
     * @returns {Promise<boolean>|boolean}
     */
    publish(key, event) {
      throw new Error('publish() must be implemented by subclass.');
    }

    /**
     * Subscribe to events for the specified channel/room key.
     * @param {string} key - Room or channel identifier
     * @param {Function} handler - Callback invoked with event payload
     * @returns {Function} Unsubscribe function
     */
    subscribe(key, handler) {
      throw new Error('subscribe() must be implemented by subclass.');
    }

    /**
     * Read the full event log or state for the specified channel/room key.
     * @param {string} key - Room or channel identifier
     * @returns {Array<object>|object} Array of events or state
     */
    read(key) {
      throw new Error('read() must be implemented by subclass.');
    }

    /**
     * Publish a heartbeat to maintain presence and liveness.
     * @param {string} key - Room or channel identifier
     * @param {object} payload - Heartbeat payload { playerId, status, ... }
     * @returns {Promise<boolean>|boolean}
     */
    heartbeat(key, payload) {
      throw new Error('heartbeat() must be implemented by subclass.');
    }

    /**
     * Check if this transport is supported and available in the current environment.
     * @returns {boolean}
     */
    isAvailable() {
      return false;
    }

    /**
     * Get estimated or measured round-trip latency in milliseconds.
     * @returns {number}
     */
    getLatencyMs() {
      return 0;
    }
  }

  // =========================================================================
  // 1. InMemoryTransport
  // =========================================================================

  class InMemoryRegistry {
    constructor() {
      this.rooms = new Map();        // key -> Array<event>
      this.subscribers = new Map();  // key -> Set<handler>
      this.heartbeats = new Map();   // key -> Map<playerId, heartbeatInfo>
    }

    clear() {
      this.rooms.clear();
      this.subscribers.clear();
      this.heartbeats.clear();
    }
  }

  // Global default registry for in-memory instances that share the same process
  const defaultInMemoryRegistry = new InMemoryRegistry();

  class InMemoryTransport extends Transport {
    /**
     * @param {object} [options]
     * @param {InMemoryRegistry} [options.registry] - Optional custom registry
     * @param {number} [options.latencyMs=0] - Optional simulated latency
     */
    constructor(options = {}) {
      super();
      this.registry = options.registry || defaultInMemoryRegistry;
      this.latencyMs = options.latencyMs || 0;
      this.clientId = options.clientId || ('client_' + getRandomHex(4));
      this.subscriptions = new Set(); // track subscriptions for cleanup
    }

    static createRegistry() {
      return new InMemoryRegistry();
    }

    isAvailable() {
      return true;
    }

    getLatencyMs() {
      return this.latencyMs;
    }

    publish(key, event) {
      if (!key) throw new Error('Transport.publish requires a key');
      const clonedEvent = clone(event);

      // Ensure room event list exists
      if (!this.registry.rooms.has(key)) {
        this.registry.rooms.set(key, []);
      }
      const roomLog = this.registry.rooms.get(key);

      // Idempotent append: if event has eventId, avoid duplicate insertion in log
      if (!clonedEvent.eventId || !roomLog.some(e => e.eventId === clonedEvent.eventId)) {
        roomLog.push(clonedEvent);
      }

      // Dispatch to all subscribers
      const subs = this.registry.subscribers.get(key);
      if (subs && subs.size > 0) {
        subs.forEach(handler => {
          try {
            handler(clone(clonedEvent));
          } catch (err) {
            console.error('[InMemoryTransport] Subscriber error:', err);
          }
        });
      }
      return true;
    }

    subscribe(key, handler) {
      if (!key || typeof handler !== 'function') {
        throw new Error('Transport.subscribe requires a key and handler function');
      }
      if (!this.registry.subscribers.has(key)) {
        this.registry.subscribers.set(key, new Set());
      }
      const subs = this.registry.subscribers.get(key);
      subs.add(handler);

      const unbind = () => {
        subs.delete(handler);
        this.subscriptions.delete(unbind);
      };
      this.subscriptions.add(unbind);
      return unbind;
    }

    read(key) {
      if (!key) return [];
      const log = this.registry.rooms.get(key);
      return log ? clone(log) : [];
    }

    heartbeat(key, payload = {}) {
      if (!key) return false;
      if (!this.registry.heartbeats.has(key)) {
        this.registry.heartbeats.set(key, new Map());
      }
      const hbMap = this.registry.heartbeats.get(key);
      const pid = payload.playerId || this.clientId;
      const hbData = {
        playerId: pid,
        timestamp: Date.now(),
        ...clone(payload)
      };
      hbMap.set(pid, hbData);

      // Also publish a lightweight HEARTBEAT event so active subscribers are alerted
      const hbEvent = {
        type: 'HEARTBEAT',
        playerId: pid,
        timestamp: hbData.timestamp,
        status: payload.status || 'online'
      };
      const subs = this.registry.subscribers.get(key);
      if (subs) {
        subs.forEach(handler => {
          try { handler(clone(hbEvent)); } catch (_) {}
        });
      }
      return true;
    }

    readHeartbeats(key) {
      if (!key || !this.registry.heartbeats.has(key)) return {};
      const map = this.registry.heartbeats.get(key);
      const res = {};
      map.forEach((val, k) => { res[k] = clone(val); });
      return res;
    }

    disconnectAll() {
      this.subscriptions.forEach(unbind => unbind());
      this.subscriptions.clear();
    }
  }

  // =========================================================================
  // 2. SimulatedNetworkTransport & SimulatedNetworkHub
  // =========================================================================

  class SimulatedNetworkHub {
    constructor(options = {}) {
      this.rooms = new Map();           // key -> Array<event>
      this.endpoints = new Set();       // Set<SimulatedNetworkTransport>
      this.virtualClock = !!options.virtualClock;
      this.virtualTime = 0;
      this.scheduledQueue = [];         // [{ deliverAt, endpoint, key, event, eventId }]
      this.nextQueueId = 1;
    }

    clear() {
      this.rooms.clear();
      this.scheduledQueue = [];
      this.virtualTime = 0;
    }

    registerEndpoint(endpoint) {
      this.endpoints.add(endpoint);
    }

    unregisterEndpoint(endpoint) {
      this.endpoints.delete(endpoint);
      // Remove pending scheduled deliveries for this endpoint
      this.scheduledQueue = this.scheduledQueue.filter(item => item.endpoint !== endpoint);
    }

    read(key) {
      const roomLog = this.rooms.get(key);
      return roomLog ? clone(roomLog) : [];
    }

    appendEvent(key, event) {
      if (!this.rooms.has(key)) {
        this.rooms.set(key, []);
      }
      const roomLog = this.rooms.get(key);
      if (!event.eventId || !roomLog.some(e => e.eventId === event.eventId)) {
        roomLog.push(clone(event));
      }
    }

    scheduleDelivery(endpoint, key, event, delayMs) {
      const deliverAt = (this.virtualClock ? this.virtualTime : Date.now()) + Math.max(0, delayMs);
      const queueItem = {
        id: this.nextQueueId++,
        deliverAt,
        endpoint,
        key,
        event: clone(event)
      };

      this.scheduledQueue.push(queueItem);
      // Keep sorted by deliverAt
      this.scheduledQueue.sort((a, b) => a.deliverAt - b.deliverAt);

      if (!this.virtualClock) {
        setTimeout(() => {
          this._deliverItem(queueItem.id);
        }, delayMs);
      }
    }

    _deliverItem(queueId) {
      const idx = this.scheduledQueue.findIndex(i => i.id === queueId);
      if (idx === -1) return;
      const [item] = this.scheduledQueue.splice(idx, 1);
      if (this.endpoints.has(item.endpoint)) {
        item.endpoint._receiveFromHub(item.key, item.event);
      }
    }

    advanceTime(ms) {
      if (!this.virtualClock) {
        throw new Error('advanceTime() is only available when virtualClock is true');
      }
      this.virtualTime += ms;
      while (this.scheduledQueue.length > 0 && this.scheduledQueue[0].deliverAt <= this.virtualTime) {
        const item = this.scheduledQueue.shift();
        if (this.endpoints.has(item.endpoint)) {
          item.endpoint._receiveFromHub(item.key, item.event);
        }
      }
      return this.virtualTime;
    }

    flushPending() {
      while (this.scheduledQueue.length > 0) {
        const item = this.scheduledQueue.shift();
        if (this.endpoints.has(item.endpoint)) {
          item.endpoint._receiveFromHub(item.key, item.event);
        }
      }
    }
  }

  class SimulatedNetworkTransport extends Transport {
    /**
     * @param {object} [options]
     * @param {SimulatedNetworkHub} [options.hub]
     * @param {string} [options.endpointId]
     * @param {number|{min:number, max:number}} [options.latencyMs=0]
     * @param {number} [options.dropRate=0] - 0.0 to 1.0 probability of packet loss
     * @param {number} [options.duplicateRate=0] - 0.0 to 1.0 probability of packet duplication
     * @param {number} [options.reorderRate=0] - 0.0 to 1.0 probability of jitter causing out-of-order delivery
     * @param {Function} [options.rng] - Custom random generator () => number
     */
    constructor(options = {}) {
      super();
      this.hub = options.hub || new SimulatedNetworkHub({ virtualClock: options.virtualClock });
      this.endpointId = options.endpointId || ('ep_' + getRandomHex(4));
      this.clientId = this.endpointId;
      this.subscribers = new Map(); // key -> Set<handler>
      this.isOnline = true;
      this.rng = options.rng || defaultRng;

      this.setOptions(options);

      this.stats = {
        published: 0,
        received: 0,
        dropped: 0,
        duplicated: 0,
        reordered: 0
      };

      this.hub.registerEndpoint(this);
    }

    setOptions(opts = {}) {
      if (opts.latencyMs !== undefined) {
        this.latencyConfig = opts.latencyMs;
      } else if (!this.latencyConfig) {
        this.latencyConfig = 0;
      }
      if (opts.dropRate !== undefined) this.dropRate = Math.max(0, Math.min(1, opts.dropRate));
      else if (this.dropRate === undefined) this.dropRate = 0;

      if (opts.duplicateRate !== undefined) this.duplicateRate = Math.max(0, Math.min(1, opts.duplicateRate));
      else if (this.duplicateRate === undefined) this.duplicateRate = 0;

      if (opts.reorderRate !== undefined) this.reorderRate = Math.max(0, Math.min(1, opts.reorderRate));
      else if (this.reorderRate === undefined) this.reorderRate = 0;
    }

    _sampleLatency() {
      if (typeof this.latencyConfig === 'number') {
        return this.latencyConfig;
      }
      if (typeof this.latencyConfig === 'object' && this.latencyConfig !== null) {
        const min = this.latencyConfig.min || 0;
        const max = Math.max(min, this.latencyConfig.max || min);
        return Math.floor(min + this.rng() * (max - min + 1));
      }
      return 0;
    }

    isAvailable() {
      return this.isOnline;
    }

    getLatencyMs() {
      if (typeof this.latencyConfig === 'number') return this.latencyConfig;
      if (this.latencyConfig && this.latencyConfig.min !== undefined) {
        return Math.round((this.latencyConfig.min + (this.latencyConfig.max || this.latencyConfig.min)) / 2);
      }
      return 0;
    }

    disconnect() {
      this.isOnline = false;
    }

    reconnect() {
      this.isOnline = true;
    }

    publish(key, event) {
      if (!this.isOnline) {
        this.stats.dropped++;
        return false;
      }
      this.stats.published++;
      const clonedEvent = clone(event);

      // Hub stores the authoritative event log
      this.hub.appendEvent(key, clonedEvent);

      // Route to all endpoints that subscribe to this key
      this.hub.endpoints.forEach(target => {
        if (!target.isOnline) {
          target.stats.dropped++;
          return;
        }

        // Check packet drop rate on target
        if (target.dropRate > 0 && target.rng() < target.dropRate) {
          target.stats.dropped++;
          return;
        }

        // Base latency
        let delay = target._sampleLatency();

        // Check reorder jitter
        if (target.reorderRate > 0 && target.rng() < target.reorderRate) {
          target.stats.reordered++;
          // Add extra jitter delay (e.g. 50-200ms) to cause out-of-order delivery
          delay += Math.floor(60 + target.rng() * 150);
        }

        // Schedule delivery
        this.hub.scheduleDelivery(target, key, clonedEvent, delay);

        // Check duplicate injection
        if (target.duplicateRate > 0 && target.rng() < target.duplicateRate) {
          target.stats.duplicated++;
          // Duplicate delivered with a slight delay
          this.hub.scheduleDelivery(target, key, clonedEvent, delay + Math.floor(10 + target.rng() * 40));
        }
      });

      return true;
    }

    _receiveFromHub(key, event) {
      if (!this.isOnline) {
        this.stats.dropped++;
        return;
      }
      this.stats.received++;
      const subs = this.subscribers.get(key);
      if (subs) {
        subs.forEach(handler => {
          try {
            handler(clone(event));
          } catch (err) {
            console.error(`[SimulatedNetworkTransport:${this.endpointId}] Handler error:`, err);
          }
        });
      }
    }

    subscribe(key, handler) {
      if (!key || typeof handler !== 'function') {
        throw new Error('Transport.subscribe requires a key and handler function');
      }
      if (!this.subscribers.has(key)) {
        this.subscribers.set(key, new Set());
      }
      const subs = this.subscribers.get(key);
      subs.add(handler);

      return () => {
        subs.delete(handler);
      };
    }

    read(key) {
      return this.hub.read(key);
    }

    heartbeat(key, payload = {}) {
      if (!this.isOnline) return false;
      const pid = payload.playerId || this.endpointId;
      const hbEvent = {
        type: 'HEARTBEAT',
        playerId: pid,
        timestamp: Date.now(),
        status: payload.status || 'online',
        ...clone(payload)
      };
      return this.publish(key, hbEvent);
    }

    advanceTime(ms) {
      return this.hub.advanceTime(ms);
    }

    flushPending() {
      this.hub.flushPending();
    }

    destroy() {
      this.hub.unregisterEndpoint(this);
      this.subscribers.clear();
    }
  }

  // =========================================================================
  // 3. ArtifactSharedTransport
  // =========================================================================

  class ArtifactSharedTransport extends Transport {
    constructor(options = {}) {
      super();
      this.prefix = options.prefix || 'glt_';
      this.clientId = options.clientId || ('art_' + getRandomHex(4));
      this.backend = this._detectBackend();
      this.isSupported = this.backend !== null;
      this.channels = new Map(); // key -> BroadcastChannel
      this.eventSources = new Map(); // key -> EventSource (lanRelay)
      this.lanCache = new Map(); // key -> Array<event> (lanRelay)
      this.subscribers = new Map(); // key -> Set<handler>
      this.storageListener = null;
      this.onStatus = typeof options.onStatus === 'function' ? options.onStatus : null;
      this.lanRetryBaseMs = options.lanRetryBaseMs !== undefined ? options.lanRetryBaseMs : 400;
      this.lanMaxAttempts = options.lanMaxAttempts !== undefined ? options.lanMaxAttempts : 6;
      this.destroyed = false;
      // roomId -> secret that proves this device opened the room (LAN relay only closes a room for it)
      this.roomTokens = this._loadRoomTokens();

      if (this.backend === 'lanRelay' && typeof window !== 'undefined' && window.__GLT_LAN_CONFIG__) {
        const initRooms = window.__GLT_LAN_CONFIG__.initialRooms;
        if (Array.isArray(initRooms)) {
          this.lanCache.set('glt_open_rooms', clone(initRooms));
        }
      }

      if (this.isSupported && this.backend !== 'lanRelay' && typeof window !== 'undefined' && window.addEventListener) {
        this._initStorageListener();
      }
    }

    _detectBackend() {
      if (typeof window === 'undefined') return null;

      // 0. Wi-Fi / LAN Relay Server (injected by scripts/lan-server.js)
      if (window.__GLT_LAN_CONFIG__ && window.__GLT_LAN_CONFIG__.enabled) {
        return 'lanRelay';
      }

      // 1. Cross-tab channel for local browser execution (same device, several tabs).
      //    The published-Artifact path is ArtifactDbTransport (see detectTransportBackend).
      if (typeof window.BroadcastChannel !== 'undefined') {
        try {
          const probe = new BroadcastChannel(this.prefix + '_probe');
          probe.close();
          return 'broadcastChannel';
        } catch (_) {}
      }

      return null;
    }

    isAvailable() {
      return this.isSupported;
    }

    getBackendType() {
      return this.backend || 'none';
    }

    getLanUrls() {
      if (typeof window !== 'undefined' && window.__GLT_LAN_CONFIG__ && Array.isArray(window.__GLT_LAN_CONFIG__.lanUrls)) {
        return window.__GLT_LAN_CONFIG__.lanUrls.slice();
      }
      return [];
    }

    getUnsupportedReason() {
      if (this.isSupported) return '';
      return 'Ambiente não suporta multijogador em tempo real (BroadcastChannel indisponível). Jogue contra a CPU!';
    }

    getLatencyMs() {
      if (this.backend === 'broadcastChannel') return 12;
      if (this.backend === 'lanRelay') return 18;
      return 45;
    }

    _loadRoomTokens() {
      const tokens = new Map();
      try {
        if (typeof sessionStorage === 'undefined') return tokens;
        const raw = JSON.parse(sessionStorage.getItem(this.prefix + 'room_tokens') || '{}');
        Object.keys(raw || {}).forEach(id => {
          if (typeof raw[id] === 'string' && raw[id]) tokens.set(id, raw[id]);
        });
      } catch (_) {}
      return tokens;
    }

    _saveRoomTokens() {
      try {
        if (typeof sessionStorage === 'undefined') return;
        const out = {};
        Array.from(this.roomTokens.entries()).slice(-20).forEach(pair => { out[pair[0]] = pair[1]; });
        sessionStorage.setItem(this.prefix + 'room_tokens', JSON.stringify(out));
      } catch (_) {}
    }

    /** True when this device opened the room, so it is the one allowed to close it. */
    ownsRoom(roomId) {
      const cleanId = String(roomId || '').trim().toUpperCase();
      if (!cleanId) return false;
      if (this.backend !== 'lanRelay') return true; // same-device tabs share one local store
      return this.roomTokens.has(cleanId);
    }

    /** Copy of a lobby event carrying this device's ownership proof for that room. */
    _withOwnerToken(event) {
      const cleanId = String((event && event.id) || '').trim().toUpperCase();
      if (!cleanId) return event;
      const isAnnounce = !event.type;
      if (isAnnounce && !this.roomTokens.has(cleanId)) {
        this.roomTokens.set(cleanId, getRandomHex(16));
        this._saveRoomTokens();
      }
      const token = this.roomTokens.get(cleanId);
      return token ? Object.assign({}, event, { ownerToken: token }) : event;
    }

    _updateLanCacheWithEvent(key, event) {
      if (!key || !event) return;
      if (key === 'glt_open_rooms') {
        const cur = this.lanCache.get('glt_open_rooms') || [];
        if (event.type === 'ROOM_DELETED' && event.id) {
          this.lanCache.set('glt_open_rooms', cur.filter(r => r.id !== event.id));
          // 'started' / 'expired' only take the room off the list; its match log stays.
          if (!event.reason) this.lanCache.delete(event.id);
          return;
        }
        if (event.type === 'ROOMS_CLEARED') {
          this.lanCache.set('glt_open_rooms', []);
          return;
        }
        if (event.id) {
          const next = cur.filter(r => r.id !== event.id).concat([clone(event)]).slice(-12);
          this.lanCache.set('glt_open_rooms', next);
        }
        return;
      }

      const list = this.lanCache.get(key) || [];
      const isDup = (event.eventId && list.some(e => e.eventId === event.eventId)) ||
        (event._transportMsgId && list.some(e => e._transportMsgId === event._transportMsgId));
      if (!isDup) {
        list.push(clone(event));
        this.lanCache.set(key, list);
      }
    }

    _ensureLanStream(key) {
      if (this.backend !== 'lanRelay' || typeof EventSource === 'undefined') return null;
      if (this.eventSources.has(key)) return this.eventSources.get(key);

      try {
        const es = new EventSource('/api/glt-lan/stream?key=' + encodeURIComponent(key));
        es.onmessage = (msgEvent) => {
          if (!msgEvent || !msgEvent.data) return;
          try {
            const parsed = JSON.parse(msgEvent.data);
            if (parsed && parsed.event) {
              this._updateLanCacheWithEvent(key, parsed.event);
              this._dispatch(key, parsed.event);
            }
          } catch (_) {}
        };
        this.eventSources.set(key, es);
        return es;
      } catch (_) {
        return null;
      }
    }

    _lanStatus(kind, detail) {
      if (!this.onStatus) return;
      try { this.onStatus(kind, detail); } catch (_) {}
    }

    /**
     * Deliver one event to the LAN relay. The relay de-duplicates by eventId/_transportMsgId,
     * so a retry is idempotent. Presence is never retried (the next heartbeat replaces it).
     */
    _postLan(key, event, attempt) {
      if (typeof fetch !== 'function' || this.destroyed) return;
      const isPresence = !!event && event.type === 'HEARTBEAT';
      const giveUp = () => {
        if (!isPresence) this._lanStatus('error', { code: 'unavailable', key, type: event.type });
      };
      const retry = () => {
        if (isPresence) return;
        if (this.destroyed || attempt >= this.lanMaxAttempts) { giveUp(); return; }
        this._lanStatus('retrying', { key, attempt });
        const wait = Math.min(8000, this.lanRetryBaseMs * Math.pow(2, attempt - 1));
        setTimeout(() => this._postLan(key, event, attempt + 1), wait);
      };
      let req;
      try {
        req = fetch('/api/glt-lan/publish', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ key, event })
        });
      } catch (_) { retry(); return; }
      Promise.resolve(req).then(res => {
        if (res && res.ok) {
          if (attempt > 1) this._lanStatus('ok', { key });
        } else if (res && res.status >= 400 && res.status < 500) {
          giveUp(); // the relay refused this payload: the same body cannot succeed later
        } else {
          retry();
        }
      }, retry);
    }

    _getChannel(key) {
      if (this.channels.has(key)) return this.channels.get(key);
      if (typeof BroadcastChannel !== 'undefined') {
        try {
          const bc = new BroadcastChannel(this.prefix + key);
          bc.onmessage = (msgEvent) => {
            if (msgEvent && msgEvent.data && msgEvent.data.event) {
              this._dispatch(key, msgEvent.data.event);
            }
          };
          this.channels.set(key, bc);
          return bc;
        } catch (_) {}
      }
      return null;
    }

    _initStorageListener() {
      this.storageListener = (e) => {
        if (!e.key || !e.key.startsWith(this.prefix + 'log_') || !e.newValue) return;
        const key = e.key.slice((this.prefix + 'log_').length);
        try {
          const events = JSON.parse(e.newValue);
          if (Array.isArray(events) && events.length > 0) {
            const latest = events[events.length - 1];
            this._dispatch(key, latest);
          }
        } catch (_) {}
      };
      window.addEventListener('storage', this.storageListener);
    }

    _dispatch(key, event) {
      if (!this._seenIds) this._seenIds = new Set();
      const msgKey = event && (event._transportMsgId || event.eventId);
      if (msgKey) {
        const dedupKey = key + ':' + msgKey;
        if (this._seenIds.has(dedupKey)) return;
        this._seenIds.add(dedupKey);
        if (this._seenIds.size > 512) {
          const first = this._seenIds.values().next().value;
          this._seenIds.delete(first);
        }
      }
      const subs = this.subscribers.get(key);
      if (subs) {
        subs.forEach(handler => {
          try { handler(clone(event)); } catch (err) {
            console.error('[ArtifactSharedTransport] Handler error:', err);
          }
        });
      }
    }

    publish(key, event) {
      if (!this.isSupported) return false;
      const cloned = clone(event);
      if (!cloned._transportMsgId) {
        cloned._transportMsgId = (cloned.eventId || 'm') + '_' + Date.now() + '_' + getRandomHex(3);
      }

      // 0. Wi-Fi / LAN Relay mode
      if (this.backend === 'lanRelay') {
        if (key === 'glt_open_rooms' && cloned.type === 'ROOM_DELETED' && !this.ownsRoom(cloned.id)) {
          return false; // the relay would refuse it: only the device that opened a room closes it
        }
        this._updateLanCacheWithEvent(key, cloned);
        this._dispatch(key, cloned);
        this._postLan(key, key === 'glt_open_rooms' ? this._withOwnerToken(cloned) : cloned, 1);
        return true;
      }

      // 1. BroadcastChannel real-time distribution
      const channel = this._getChannel(key);
      if (channel) {
        try {
          channel.postMessage({ type: 'GLT_EVENT', key, event: cloned });
        } catch (err) {
          console.warn('[ArtifactSharedTransport] BroadcastChannel error:', err);
        }
      }

      // 2. Persist append-only log in localStorage for replay/reconnection
      if (typeof localStorage !== 'undefined') {
        const storageKey = this.prefix + 'log_' + key;
        try {
          const existing = JSON.parse(localStorage.getItem(storageKey) || '[]');
          if (!cloned.eventId || !existing.some(e => e.eventId === cloned.eventId)) {
            existing.push(cloned);
            localStorage.setItem(storageKey, JSON.stringify(existing));
          }
        } catch (err) {
          console.warn('[ArtifactSharedTransport] localStorage write error:', err);
        }
      }

      // Local loopback dispatch to self listeners as well
      this._dispatch(key, cloned);
      return true;
    }

    subscribe(key, handler) {
      if (!key || typeof handler !== 'function') {
        throw new Error('Transport.subscribe requires a key and handler function');
      }
      if (!this.subscribers.has(key)) {
        this.subscribers.set(key, new Set());
      }
      const subs = this.subscribers.get(key);
      subs.add(handler);

      if (this.backend === 'lanRelay') {
        this._ensureLanStream(key);
      } else {
        this._getChannel(key);
      }

      return () => {
        subs.delete(handler);
      };
    }

    read(key) {
      if (!this.isSupported) return [];

      // 0. Wi-Fi / LAN Relay local cache
      if (this.backend === 'lanRelay') {
        return clone(this.lanCache.get(key) || []);
      }

      // 1. Check localStorage
      if (typeof localStorage !== 'undefined') {
        try {
          const raw = localStorage.getItem(this.prefix + 'log_' + key);
          if (raw) return JSON.parse(raw);
        } catch (_) {}
      }

      return [];
    }

    async readAsync(key) {
      if (!this.isSupported || !key) return [];
      if (this.backend === 'lanRelay' && typeof fetch === 'function') {
        try {
          const res = await fetch('/api/glt-lan/read?key=' + encodeURIComponent(key), { cache: 'no-store' });
          if (res.ok) {
            const json = await res.json();
            if (json && Array.isArray(json.events)) {
              this.lanCache.set(key, clone(json.events));
              return clone(json.events);
            }
          }
        } catch (_) {}
      }
      return this.read(key);
    }

    deleteRoom(roomId) {
      const cleanId = String(roomId || '').trim().toUpperCase();
      if (!cleanId) return false;
      const delEvent = {
        type: 'ROOM_DELETED',
        id: cleanId,
        _transportMsgId: 'del_' + cleanId + '_' + Date.now() + '_' + getRandomHex(2)
      };

      if (this.backend === 'lanRelay') {
        const token = this.roomTokens.get(cleanId);
        if (!token) return false; // not this device's room
        this._updateLanCacheWithEvent('glt_open_rooms', delEvent);
        this._dispatch('glt_open_rooms', delEvent);
        this.roomTokens.delete(cleanId);
        this._saveRoomTokens();
        if (typeof fetch === 'function') {
          fetch('/api/glt-lan/rooms?id=' + encodeURIComponent(cleanId) + '&token=' + encodeURIComponent(token), { method: 'DELETE' }).catch(() => {});
        }
        return true;
      }

      if (typeof localStorage !== 'undefined') {
        try {
          localStorage.removeItem(this.prefix + 'log_' + cleanId);
          const openKey = this.prefix + 'log_glt_open_rooms';
          const list = JSON.parse(localStorage.getItem(openKey) || '[]');
          const filtered = Array.isArray(list) ? list.filter(r => r && r.id !== cleanId) : [];
          localStorage.setItem(openKey, JSON.stringify(filtered));
        } catch (_) {}
      }

      const ch = this._getChannel('glt_open_rooms');
      if (ch) {
        try { ch.postMessage({ type: 'GLT_EVENT', key: 'glt_open_rooms', event: delEvent }); } catch (_) {}
      }
      this._dispatch('glt_open_rooms', delEvent);
      return true;
    }

    clearOpenRooms() {
      const clrEvent = {
        type: 'ROOMS_CLEARED',
        _transportMsgId: 'clr_' + Date.now() + '_' + getRandomHex(2)
      };

      if (this.backend === 'lanRelay') {
        // Shared relay: close only the rooms this device opened. Rooms abandoned by other
        // devices leave the list by themselves once their host stops sending presence.
        Array.from(this.roomTokens.keys()).forEach(id => this.deleteRoom(id));
        return true;
      }

      if (typeof localStorage !== 'undefined') {
        try {
          const openKey = this.prefix + 'log_glt_open_rooms';
          const list = JSON.parse(localStorage.getItem(openKey) || '[]');
          if (Array.isArray(list)) {
            list.forEach(r => {
              if (r && r.id) localStorage.removeItem(this.prefix + 'log_' + r.id);
            });
          }
          localStorage.setItem(openKey, '[]');
        } catch (_) {}
      }

      const ch = this._getChannel('glt_open_rooms');
      if (ch) {
        try { ch.postMessage({ type: 'GLT_EVENT', key: 'glt_open_rooms', event: clrEvent }); } catch (_) {}
      }
      this._dispatch('glt_open_rooms', clrEvent);
      return true;
    }

    heartbeat(key, payload = {}) {
      if (!this.isSupported) return false;
      const hb = {
        type: 'HEARTBEAT',
        playerId: payload.playerId || this.clientId,
        status: payload.status || 'online',
        timestamp: Date.now(),
        ...clone(payload)
      };
      return this.publish(key, hb);
    }

    destroy() {
      this.destroyed = true;
      this.channels.forEach(ch => {
        try { ch.close(); } catch (_) {}
      });
      this.channels.clear();
      this.eventSources.forEach(es => {
        try { es.close(); } catch (_) {}
      });
      this.eventSources.clear();
      this.subscribers.clear();
      if (this.storageListener && typeof window !== 'undefined') {
        window.removeEventListener('storage', this.storageListener);
      }
    }
  }

  // =========================================================================
  // 4. ArtifactDbTransport — published Artifact (claude.use("db") + claude.use("room"))
  // =========================================================================
  //
  // Store layout (all paths follow the db path grammar):
  //   rooms/{CODE}                 listing + discovery {id, host, crewId, format, mode, timestamp,
  //                                status, by, guest}. Untrusted: anyone at `interact` can rewrite it,
  //                                so it only POINTS at authors; it never carries a move.
  //   moves/{uid}                  that author's index of rooms played {rooms:[{c, at, h}]} (pruning)
  //   moves/{uid}/{CODE}/{cNNNN}   that author's events in this match, CHUNK_EVENTS per doc
  //                                {v, room, k, at, events:[...]}; only {uid} can write here
  //                                (db rule `moves/{self}`), so the path IS the author.
  //   bounties/{playerId}          casual "Mais procurados" entry
  // Seats: seat 0 is the room's host (read from the listing once, then pinned in the tab session);
  // seat 1 is the uid the host binds with a SEAT_BIND event in ITS OWN log. Every delivered event
  // is stamped `_seat` from its author path, never from its body, and the protocol fold drops any
  // event that speaks for the other seat. Writes are serialized one at a time per doc; a retry
  // rewrites the same chunk with a superset of the same events, so it is idempotent.
  // The room capability carries only presence (heartbeat) and preset reactions, both checked
  // against the platform-stamped sender id; nothing there is stored. The fleet never reaches this
  // transport before FLEET_REVEAL.

  const LOBBY_KEY = 'glt_open_rooms';
  const BOUNTY_KEY = 'glt_bounty_board';
  const ROOM_KEY_RE = /^[A-Za-z0-9_-]{1,40}$/;
  const UID_RE = /^[A-Za-z0-9_\-.~:@+]{1,128}$/;
  const MOVES = 'moves';
  const CHUNK_EVENTS = 64;
  const FATAL_DB_CODES = ['revoked', 'not_granted', 'capability_disabled', 'capability_removed'];
  const NO_RETRY_DB_CODES = ['invalid_argument', 'quota_exceeded', 'transform_error'].concat(FATAL_DB_CODES);
  const OPEN_ROOM_MAX_AGE_MS = 6 * 60 * 60 * 1000;
  // Timestamps are client-written: a room dated further ahead than this is a flood attempt
  // (it would sit at the top of the newest-first window forever) and is not listed.
  const OPEN_ROOM_MAX_FUTURE_MS = 5 * 60 * 1000;
  const PRUNE_AFTER_MS = 24 * 60 * 60 * 1000;

  /**
   * The exact `capabilities` the publish must declare (docs/project/PUBLISH-NOTES.md §1). The test double
   * enforces these same rules, so the suites run against what the platform will enforce.
   */
  const ARTIFACT_CAPABILITIES = Object.freeze({
    db: Object.freeze({
      rules: Object.freeze([
        Object.freeze({ path: '', read: 'view', write: 'admin' }),
        Object.freeze({ path: 'rooms', read: 'view', write: 'interact' }),
        Object.freeze({ path: 'bounties', read: 'view', write: 'interact' }),
        Object.freeze({ path: 'moves', read: 'view', write: 'owner' }),
        Object.freeze({ path: 'moves/{self}', read: 'view', write: 'interact' })
      ])
    }),
    room: Object.freeze({ topics: Object.freeze({ reaction: 'interact' }) }),
    user: Object.freeze({})
  });

  function str(v, max) { return typeof v === 'string' ? v.slice(0, max) : ''; }
  function num(v, fallback) { return (typeof v === 'number' && isFinite(v)) ? v : fallback; }
  function isPlainObject(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }
  function validUid(v) { return typeof v === 'string' && UID_RE.test(v) && v !== '.' && v !== '..'; }
  function safeDocId(id) {
    const s = String(id || '').replace(/[^A-Za-z0-9_\-.~:@+]/g, '_').slice(0, 180);
    return (s && s !== '.' && s !== '..') ? s : null;
  }
  function sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
  }
  function chunkId(k) { return 'c' + String(k).padStart(4, '0'); }

  /** Events of one author, in write order, from that author's chunk docs. */
  function flattenChunks(docs) {
    const rows = [];
    for (const d of docs || []) {
      if (!d || !d.exists) continue;
      const body = typeof d.data === 'function' ? d.data() : null;
      if (!isPlainObject(body) || !Array.isArray(body.events)) continue;
      rows.push({ k: num(body.k, 0), id: String(d.id), events: body.events });
    }
    rows.sort((a, b) => (a.k - b.k) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    const out = [];
    rows.forEach(r => r.events.forEach(ev => {
      if (isPlainObject(ev) && typeof ev.type === 'string' && typeof ev.eventId === 'string' && ev.eventId) out.push(ev);
    }));
    return out;
  }

  // One write at a time per document across every transport of this page (the lobby transport
  // and a match transport may both touch rooms/{CODE}).
  const docLocks = new WeakMap();
  function withDocLock(db, path, fn) {
    let byPath = docLocks.get(db);
    if (!byPath) { byPath = new Map(); docLocks.set(db, byPath); }
    const prev = byPath.get(path) || Promise.resolve();
    const run = prev.then(fn, fn);
    const tail = run.then(() => {}, () => {});
    byPath.set(path, tail);
    tail.then(() => { if (byPath.get(path) === tail) byPath.delete(path); });
    return run;
  }

  // Named rooms are shared per page (join(name) returns the same object): refcount them so one
  // transport's destroy() never kicks another transport out of the same match room.
  const namedRoomRefs = new WeakMap();
  function acquireNamedRoom(room, name) {
    let byName = namedRoomRefs.get(room);
    if (!byName) { byName = new Map(); namedRoomRefs.set(room, byName); }
    let entry = byName.get(name);
    if (!entry) {
      entry = { count: 0, promise: Promise.resolve().then(() => room.join(name)) };
      entry.promise.catch(() => { if (byName.get(name) === entry) byName.delete(name); });
      byName.set(name, entry);
    }
    entry.count++;
    return entry.promise;
  }
  function releaseNamedRoom(room, name) {
    const byName = namedRoomRefs.get(room);
    const entry = byName && byName.get(name);
    if (!entry) return;
    entry.count--;
    if (entry.count <= 0) {
      byName.delete(name);
      entry.promise.then(r => r && typeof r.leave === 'function' && r.leave()).catch(() => {});
    }
  }

  function lobbyView(body) {
    return {
      id: body.id,
      host: body.host,
      crewId: body.crewId,
      format: body.format,
      mode: body.mode,
      timestamp: body.timestamp
    };
  }

  function sanitizeLobbyDoc(id, data, now) {
    if (!isPlainObject(data) || data.status !== 'open' || !ROOM_KEY_RE.test(id)) return null;
    const timestamp = num(data.timestamp, 0);
    if (now - timestamp > OPEN_ROOM_MAX_AGE_MS || timestamp - now > OPEN_ROOM_MAX_FUTURE_MS) return null;
    return {
      id,
      host: str(data.host, 40),
      crewId: str(data.crewId, 40),
      format: str(data.format, 12),
      mode: str(data.mode, 20),
      timestamp,
      status: 'open',
      by: validUid(data.by) ? data.by : null
    };
  }

  function sanitizeBountyDoc(data) {
    if (!isPlainObject(data) || typeof data.playerId !== 'string') return null;
    return {
      playerId: str(data.playerId, 128),
      nickname: str(data.nickname, 24) || 'Pirata Desconhecido',
      crewId: str(data.crewId, 40),
      bounty: Math.max(0, num(data.bounty, 0)),
      wonMatches: Math.max(0, num(data.wonMatches, 0)),
      totalMatches: Math.max(0, num(data.totalMatches, 0)),
      timestamp: num(data.timestamp, 0),
      verified: false,
      tag: '[Casual / Não verificado]'
    };
  }

  class ArtifactDbTransport extends Transport {
    /**
     * @param {object} options
     * @param {object} options.db - namespace resolved by `await claude.use("db")`
     * @param {object} [options.room] - namespace resolved by `await claude.use("room")` (or null)
     * @param {string} [options.userId] - `await user.id()`; required to write moves (`moves/{self}`)
     * @param {string} [options.clientId] - writer id of this page instance
     * @param {Function} [options.onStatus] - (kind, detail) for 'retrying' | 'ok' | 'error' | 'slow' | 'seat_taken'
     */
    constructor(options = {}) {
      super();
      if (!options.db || typeof options.db.collection !== 'function') {
        throw new Error('ArtifactDbTransport requires the db namespace from claude.use("db").');
      }
      this.db = options.db;
      this.room = (options.room && typeof options.room.join === 'function') ? options.room : null;
      this.userId = validUid(options.userId) ? options.userId : null;
      this.clientId = safeDocId(options.clientId) || ('w' + getRandomHex(4));
      this.rng = options.rng || defaultRng;
      this.retryBaseMs = options.retryBaseMs !== undefined ? options.retryBaseMs : 250;
      this.maxRetryMs = options.maxRetryMs !== undefined ? options.maxRetryMs : 4000;
      this.loadTimeoutMs = options.loadTimeoutMs !== undefined ? options.loadTimeoutMs : 10000;
      this.pruneAfterMs = options.pruneAfterMs !== undefined ? options.pruneAfterMs : PRUNE_AFTER_MS;
      this.onStatus = typeof options.onStatus === 'function' ? options.onStatus : null;

      this.feeds = new Map();     // key -> feed (log | lobby | bounty)
      this.joined = new Map();    // key -> { promise, named, name, unsubs, failedAt }
      this.outbox = [];
      this.flushing = false;
      this.idleWaiters = [];
      this.hbCounter = 0;
      this.latencySamples = [];
      this.myRooms = new Set();
      this.registered = new Set();
      this.lastError = null;
      this.fatal = false;
      this.destroyed = false;
      this.stats = { writes: 0, retries: 0, failures: 0, snapshots: 0 };
    }

    isAvailable() { return !this.fatal; }
    getBackendType() { return 'artifactDb'; }
    getLanUrls() { return []; }
    getUnsupportedReason() { return ''; }

    getLatencyMs() {
      if (this.latencySamples.length === 0) return 0;
      const sum = this.latencySamples.reduce((a, b) => a + b, 0);
      return Math.round(sum / this.latencySamples.length);
    }

    _status(kind, detail) {
      if (this.onStatus) {
        try { this.onStatus(kind, detail); } catch (_) {}
      }
    }

    _fail(err) {
      this.lastError = err || { code: 'unavailable', message: 'unknown' };
      this.stats.failures++;
      if (err && FATAL_DB_CODES.includes(err.code)) this.fatal = true;
      this._status('error', this.lastError);
    }

    // ---- listeners: subscribed once, re-subscribed with backoff only when terminated ----------

    _watch(makeRef, onSnap, onDead) {
      const w = { unsub: null, retryMs: 1000, dead: false };
      const start = () => {
        if (this.destroyed || w.dead) return;
        try {
          w.unsub = makeRef().onSnapshot(snap => {
            if (this.destroyed || w.dead || !snap) return;
            this.stats.snapshots++;
            if (!(snap.metadata && snap.metadata.fromCache)) w.retryMs = 1000;
            onSnap(snap);
          }, err => {
            w.unsub = null;
            if (this.destroyed || w.dead) return;
            const code = err && err.code;
            if (FATAL_DB_CODES.includes(code) || code === 'invalid_argument' || code === 'transform_error') {
              w.dead = true;
              this._fail(err);
              if (onDead) onDead();
              return;
            }
            // 'unavailable' (host stopped answering), budget codes and unknown codes: a fresh
            // onSnapshot is the only recovery. Back off so we never loop tightly.
            const wait = w.retryMs;
            w.retryMs = Math.min(30000, w.retryMs * 2);
            sleep(wait).then(start);
          });
        } catch (err) {
          w.dead = true;
          this._fail({ code: 'invalid_argument', message: String(err && err.message || err) });
          if (onDead) onDead();
        }
      };
      start();
      return w;
    }

    _stopWatch(w) {
      if (!w) return;
      w.dead = true;
      if (typeof w.unsub === 'function') {
        try { w.unsub(); } catch (_) {}
      }
      w.unsub = null;
    }

    // ---- feeds ----------------------------------------------------------------------------

    _feed(key) {
      let f = this.feeds.get(key);
      if (f) return f;
      const kind = key === LOBBY_KEY ? 'lobby' : (key === BOUNTY_KEY ? 'bounty' : 'log');
      if (kind === 'log' && !ROOM_KEY_RE.test(String(key))) {
        throw new Error('Código de sala inválido: ' + key);
      }
      f = {
        key,
        kind,
        items: [],              // log: delivered events (stamped _seat) in arrival order
        byId: new Map(),        // lobby/bounty: id -> sanitized body
        seen: new Set(),        // log: `${seat}|${eventId}` already delivered
        handlers: new Set(),
        loaded: false,
        stale: false
      };
      f.ready = new Promise(resolve => { f.resolveReady = resolve; });
      this.feeds.set(key, f);
      f.timer = setTimeout(() => {
        if (!f.loaded) {
          this._markLoaded(f, true);
          this._status('slow', { key: f.key });
        }
      }, this.loadTimeoutMs);
      if (f.timer && typeof f.timer.unref === 'function') f.timer.unref();
      if (kind === 'log') this._initLog(f);
      else this._listen(f);
      return f;
    }

    _markLoaded(f, stale) {
      f.stale = !!stale;
      if (!stale) clearTimeout(f.timer);
      if (!f.loaded) {
        f.loaded = true;
        f.resolveReady();
      }
    }

    _query(f) {
      // Newest first: abandoned rooms can never push a fresh one out of the window.
      // Rooms dated in the future are cut by the query itself, so they cannot hold the window.
      if (f.kind === 'lobby') {
        return this.db.collection('rooms').where('timestamp', '<=', Date.now() + OPEN_ROOM_MAX_FUTURE_MS)
          .orderBy('timestamp', 'desc').limit(50);
      }
      return this.db.collection('bounties').orderBy('bounty', 'desc').limit(20);
    }

    _listen(f) {
      if (f.kind === 'lobby' && !f.refresh) {
        // The lobby query carries a time bound; renew it before rooms created now fall past it.
        f.refresh = setInterval(() => {
          if (this.destroyed) return;
          this._stopWatch(f.watch);
          this._listen(f);
        }, Math.floor(OPEN_ROOM_MAX_FUTURE_MS / 2));
        if (typeof f.refresh.unref === 'function') f.refresh.unref();
      }
      f.watch = this._watch(() => this._query(f), snap => {
        const fromCache = !!(snap.metadata && snap.metadata.fromCache);
        if (!fromCache) this._markLoaded(f, false);
        const docs = Array.isArray(snap.docs) ? snap.docs : [];
        if (f.kind === 'lobby') this._applyLobbyDocs(f, docs, fromCache);
        else this._applyBountyDocs(f, docs);
      }, () => this._markLoaded(f, true));
    }

    // ---- match log: authors, seats and delivery --------------------------------------------

    _initLog(f) {
      Object.assign(f, {
        hostUid: null,
        guestUid: null,
        iAmHost: false,
        claimGuest: false,
        seatLost: false,
        roomBody: null,
        roomLoaded: false,
        authors: new Map(),   // uid -> { events, ids, loaded, watch }
        own: { events: [], ids: new Set(), merged: false, pending: new Set() }
      });
      const roomRef = () => this.db.doc('rooms/' + f.key);
      f.roomWatch = this._watch(roomRef, snap => this._onRoomDoc(f, snap), () => {
        f.roomLoaded = true;
        this._checkReady(f);
      });
      if (this.userId) this._watchAuthor(f, this.userId);
    }

    _onRoomDoc(f, snap) {
      const body = snap.exists && typeof snap.data === 'function' ? snap.data() : null;
      f.roomBody = isPlainObject(body) ? body : null;
      if (!(snap.metadata && snap.metadata.fromCache)) f.roomLoaded = true;
      if (!f.hostUid && f.roomBody && validUid(f.roomBody.by)) this._bindHost(f, f.roomBody.by);
      this._maybeBindGuest(f);
      this._checkReady(f);
    }

    _watchAuthor(f, uid) {
      let a = f.authors.get(uid);
      if (a) return a;
      a = { uid, events: [], ids: new Set(), loaded: false, watch: null };
      f.authors.set(uid, a);
      const path = MOVES + '/' + uid + '/' + f.key;
      a.watch = this._watch(() => this.db.collection(path), snap => {
        if (!(snap.metadata && snap.metadata.fromCache)) a.loaded = true;
        // Scan the whole set every time (never trust docChanges alone): a repeated or
        // re-ordered delivery can never apply an event twice.
        const fresh = [];
        flattenChunks(snap.docs).forEach(ev => {
          if (a.ids.has(ev.eventId)) return;
          a.ids.add(ev.eventId);
          a.events.push(ev);
          fresh.push(ev);
        });
        fresh.forEach(ev => this._ingest(f, uid, ev));
        this._maybeBindGuest(f);
        this._checkReady(f);
      }, () => {
        a.loaded = true;
        this._checkReady(f);
      });
      return a;
    }

    _seatOf(f, uid) {
      if (uid && uid === f.hostUid) return 0;
      if (uid && uid === f.guestUid) return 1;
      return null;
    }

    _mySeat(f) {
      if (!this.userId) return null;
      if (f.hostUid === this.userId) return 0;
      if (f.guestUid === this.userId) return 1;
      if (f.claimGuest && !f.guestUid) return 1; // optimistic until the host's SEAT_BIND arrives
      return null;
    }

    _bindHost(f, uid) {
      if (f.hostUid || !validUid(uid)) return;
      f.hostUid = uid;
      if (uid === this.userId) f.iAmHost = true;
      this._watchAuthor(f, uid);
      this._replayAuthor(f, uid);
    }

    _bindGuest(f, uid) {
      if (f.guestUid || !validUid(uid) || uid === f.hostUid) return;
      f.guestUid = uid;
      if (f.claimGuest && uid !== this.userId && !f.seatLost) {
        f.seatLost = true;
        this._status('seat_taken', { key: f.key });
      }
      this._watchAuthor(f, uid);
      this._replayAuthor(f, uid);
      this._checkReady(f);
    }

    /** Host only: bind the guest named by the listing, once my own log is known. */
    _maybeBindGuest(f) {
      if (!f.iAmHost || f.guestUid || !f.roomBody) return;
      const own = f.authors.get(this.userId);
      if (!own || !own.loaded) return; // a SEAT_BIND already in my log wins over the listing
      const g = f.roomBody.guest;
      if (!validUid(g) || g === this.userId) return;
      this._appendOwn(f, { eventId: 'seat_bind_1', type: 'SEAT_BIND', seat: 1, uid: g, timestamp: Date.now() });
      this._bindGuest(f, g);
      const ref = this.db.doc('rooms/' + f.key);
      this._enqueue(ref.path, () => ref.update({ status: 'playing' }), { ignoreInvalid: true });
    }

    _replayAuthor(f, uid) {
      const a = f.authors.get(uid);
      if (a) a.events.slice().forEach(ev => this._ingest(f, uid, ev));
    }

    _ingest(f, uid, raw) {
      const seat = this._seatOf(f, uid);
      if (seat === null) return; // held in a.events until the author is bound to a seat
      if (raw.type === 'SEAT_BIND') {
        if (seat === 0 && raw.seat === 1) this._bindGuest(f, raw.uid);
        return;
      }
      if (raw.type === 'HEARTBEAT') return;
      const ev = clone(raw);
      ev._seat = seat; // from the author path, never from the body
      const key = seat + '|' + ev.eventId;
      if (f.seen.has(key)) return;
      f.seen.add(key);
      f.items.push(ev);
      this._dispatch(f, ev);
    }

    _checkReady(f) {
      if (f.loaded && !f.stale) return;
      if (!f.hostUid) {
        if (f.roomLoaded) this._markLoaded(f, false);
        return;
      }
      const h = f.authors.get(f.hostUid);
      if (!h || !h.loaded) return;
      if (f.guestUid) {
        const g = f.authors.get(f.guestUid);
        if (!g || !g.loaded) return;
      }
      this._markLoaded(f, false);
    }

    _applyLobbyDocs(f, docs, fromCache) {
      const now = Date.now();
      const next = new Map();
      const status = new Map();
      if (!f.inStore) f.inStore = new Set();
      for (const doc of docs) {
        if (!doc || !doc.exists) continue;
        const data = typeof doc.data === 'function' ? doc.data() : null;
        if (isPlainObject(data)) status.set(doc.id, data.status);
        const body = sanitizeLobbyDoc(doc.id, data, now);
        if (body) next.set(doc.id, body);
      }
      next.forEach((body, id) => {
        if (!fromCache) f.inStore.add(id);
        const prev = f.byId.get(id);
        if (!prev || JSON.stringify(prev) !== JSON.stringify(body)) {
          f.byId.set(id, body);
          this._dispatch(f, lobbyView(body));
        }
      });
      if (fromCache) return; // never announce removals from an unconfirmed view
      Array.from(f.byId.keys()).forEach(id => {
        if (next.has(id)) return;
        // A room announced locally but not yet confirmed by the store stays listed.
        if (!f.inStore.has(id) && !status.has(id)) return;
        f.byId.delete(id);
        f.inStore.delete(id);
        const ev = { type: 'ROOM_DELETED', id };
        if (status.get(id) === 'playing') ev.reason = 'started'; // both seats taken: not a close
        this._dispatch(f, ev);
      });
    }

    _applyBountyDocs(f, docs) {
      for (const doc of docs) {
        if (!doc || !doc.exists) continue;
        const body = sanitizeBountyDoc(typeof doc.data === 'function' ? doc.data() : null);
        if (!body) continue;
        const prev = f.byId.get(doc.id);
        if (!prev || JSON.stringify(prev) !== JSON.stringify(body)) {
          f.byId.set(doc.id, body);
          this._dispatch(f, body);
        }
      }
    }

    _dispatch(f, ev) {
      f.handlers.forEach(handler => {
        try { handler(clone(ev)); } catch (err) {
          console.error('[ArtifactDbTransport] Handler error:', err);
        }
      });
    }

    // ---- outbox: one write at a time, idempotent retries -------------------

    _enqueue(path, op, opts = {}) {
      this.outbox.push({ path, op, attempts: 0, ignoreInvalid: !!opts.ignoreInvalid });
      this._flush();
    }

    async _flush() {
      if (this.flushing) return;
      this.flushing = true;
      try {
        while (this.outbox.length > 0) {
          const item = this.outbox[0];
          const t0 = Date.now();
          try {
            await withDocLock(this.db, item.path, item.op);
            this.stats.writes++;
            this.latencySamples.push(Date.now() - t0);
            if (this.latencySamples.length > 20) this.latencySamples.shift();
            this.outbox.shift();
            if (this.lastError && !this.fatal) {
              this.lastError = null;
              this._status('ok');
            }
          } catch (err) {
            const code = err && err.code;
            if (code === 'invalid_argument' && item.ignoreInvalid) {
              this.outbox.shift();
              continue;
            }
            if (NO_RETRY_DB_CODES.includes(code)) {
              this.outbox.shift();
              this._fail(err);
              continue;
            }
            // 'unavailable', 'resource_exhausted' and unknown codes: the op rebuilds the same
            // doc with a superset of the same body, so retrying is safe even when it landed.
            item.attempts++;
            this.stats.retries++;
            this.lastError = err;
            this._status('retrying', err);
            const backoff = Math.min(this.maxRetryMs, this.retryBaseMs * Math.pow(2, Math.min(item.attempts - 1, 6)));
            await sleep(Math.round(backoff * (0.5 + this.rng() * 0.5)));
          }
        }
      } finally {
        this.flushing = false;
        const waiters = this.idleWaiters.splice(0);
        waiters.forEach(w => w());
      }
    }

    /** Resolves once every queued write has been acknowledged (or given up). */
    whenIdle() {
      if (!this.flushing && this.outbox.length === 0) return Promise.resolve();
      return new Promise(resolve => this.idleWaiters.push(resolve));
    }

    hasPendingWrites() {
      return this.flushing || this.outbox.length > 0;
    }

    // ---- my own log: moves/{me}/{CODE}/cNNNN ---------------------------------------------

    _appendOwn(f, ev) {
      if (!this.userId || f.own.ids.has(ev.eventId)) return;
      f.own.ids.add(ev.eventId);
      f.own.events.push(clone(ev));
      this._register(f);
      this._scheduleChunk(f, Math.floor((f.own.events.length - 1) / CHUNK_EVENTS));
    }

    _scheduleChunk(f, k) {
      if (f.own.pending.has(k)) return; // the queued write builds its body when it runs
      f.own.pending.add(k);
      const path = MOVES + '/' + this.userId + '/' + f.key + '/' + chunkId(k);
      this._enqueue(path, async () => {
        f.own.pending.delete(k);
        await this._mergeOwn(f);
        const events = f.own.events.slice(k * CHUNK_EVENTS, (k + 1) * CHUNK_EVENTS);
        if (events.length === 0) return;
        await this.db.doc(path).set({ v: 1, room: f.key, k, at: Date.now(), events });
      });
    }

    /**
     * Before the first write of this page to a match, fold in what an earlier page of mine
     * (refresh) already stored, so a chunk is never rewritten with fewer events.
     */
    async _mergeOwn(f) {
      if (f.own.merged) return;
      const snap = await this.db.collection(MOVES + '/' + this.userId + '/' + f.key).get();
      if (f.own.merged) return;
      const stored = flattenChunks(snap.docs).map(e => clone(e));
      const storedIds = new Set(stored.map(e => e.eventId));
      const localOnly = f.own.events.filter(e => !storedIds.has(e.eventId));
      f.own.events = stored.concat(localOnly);
      f.own.ids = new Set(f.own.events.map(e => e.eventId));
      f.own.merged = true;
      const last = Math.floor((f.own.events.length - 1) / CHUNK_EVENTS);
      for (let k = Math.floor(stored.length / CHUNK_EVENTS); k <= last; k++) this._scheduleChunk(f, k);
    }

    /** Index this match under moves/{me} and prune my matches older than pruneAfterMs. */
    _register(f) {
      if (!this.userId || this.registered.has(f.key)) return;
      this.registered.add(f.key);
      const path = MOVES + '/' + this.userId;
      const isHost = !!f.iAmHost;
      this._enqueue(path, async () => {
        const idxRef = this.db.doc(path);
        const snap = await idxRef.get();
        const data = snap.exists && typeof snap.data === 'function' ? snap.data() : null;
        const cur = isPlainObject(data) && Array.isArray(data.rooms) ? data.rooms : [];
        const now = Date.now();
        const keep = [];
        for (const e of cur) {
          if (!isPlainObject(e) || !ROOM_KEY_RE.test(String(e.c)) || e.c === f.key) continue;
          if (now - num(e.at, 0) > this.pruneAfterMs) await this._pruneMatch(e.c, !!e.h);
          else keep.push({ c: e.c, at: num(e.at, now), h: !!e.h });
        }
        keep.push({ c: f.key, at: now, h: isHost });
        await idxRef.set({ v: 1, rooms: keep.slice(-40) });
      });
    }

    async _pruneMatch(code, wasHost) {
      const collPath = MOVES + '/' + this.userId + '/' + code;
      const snap = await this.db.collection(collPath).get();
      for (const d of snap.docs) {
        const p = collPath + '/' + d.id;
        await withDocLock(this.db, p, () => this.db.doc(p).delete());
      }
      if (wasHost) {
        const ref = this.db.doc('rooms/' + code);
        const r = await ref.get();
        const body = r.exists && typeof r.data === 'function' ? r.data() : null;
        if (isPlainObject(body) && body.by === this.userId) {
          await withDocLock(this.db, ref.path, () => ref.delete());
        }
      }
    }

    _becomeHost(f, ev) {
      if (!this.userId) return;
      if (f.hostUid && f.hostUid !== this.userId) return; // code already belongs to another host
      this._bindHost(f, this.userId);
      const cfg = isPlainObject(ev.matchConfig) ? ev.matchConfig : {};
      const size = num(cfg.boardSize, 0);
      const body = {
        id: f.key,
        host: str(ev.hostNickname, 40),
        crewId: str(ev.crewId, 40),
        format: size ? size + 'x' + size : '',
        mode: str(cfg.mode, 20),
        timestamp: Date.now(),
        status: 'open',
        by: this.userId,
        guest: null
      };
      const ref = this.db.doc('rooms/' + f.key);
      this._enqueue(ref.path, () => ref.set(body));
    }

    _claimGuest(f) {
      if (!this.userId || f.iAmHost) return;
      f.claimGuest = true;
      if (f.guestUid) {
        if (f.guestUid !== this.userId && !f.seatLost) {
          f.seatLost = true;
          this._status('seat_taken', { key: f.key });
        }
        return;
      }
      const cur = f.roomBody && f.roomBody.guest;
      if (validUid(cur) && cur !== this.userId) return; // someone asked first; the host's SEAT_BIND decides
      const ref = this.db.doc('rooms/' + f.key);
      this._enqueue(ref.path, () => ref.update({ guest: this.userId }), { ignoreInvalid: true });
      this._register(f);
    }

    // ---- Transport interface ------------------------------------------------

    publish(key, event) {
      if (!key || !event || this.fatal) return false;
      const ev = clone(event);
      if (ev.type === 'HEARTBEAT') return this.heartbeat(key, ev);
      if (key === LOBBY_KEY) return this._publishLobby(ev);
      if (key === BOUNTY_KEY) return this._publishBounty(ev);

      const f = this._feed(key);
      if (!ev.eventId) ev.eventId = 'ev_' + this.clientId + '_' + getRandomHex(4);
      if (ev.type === 'ROOM_CREATED') this._becomeHost(f, ev);
      else if (ev.type === 'ROOM_JOINED' && ev.role !== 'spectator') this._claimGuest(f);

      const seat = this._mySeat(f);
      delete ev._seat;
      if (seat !== null) ev._seat = seat;
      const sk = (seat === null ? '-' : seat) + '|' + ev.eventId;
      if (f.seen.has(sk)) return true; // idempotent re-publish
      f.seen.add(sk);
      f.items.push(ev);
      this._dispatch(f, ev); // local loopback (latency compensation)
      if (seat === null) return true; // spectators and unseated viewers write nothing

      const body = clone(ev);
      delete body._seat;
      if (body.type === 'REACTION' && this.room) this._emitReaction(f, body);
      else this._appendOwn(f, body);
      return true;
    }

    subscribe(key, handler) {
      if (!key || typeof handler !== 'function') {
        throw new Error('Transport.subscribe requires a key and handler function');
      }
      const f = this._feed(key);
      f.handlers.add(handler);
      if (f.kind === 'log' && this.room) this._joinRoom(key);
      return () => { f.handlers.delete(handler); };
    }

    read(key) {
      if (!key) return [];
      const f = this._feed(key);
      if (f.kind === 'lobby') {
        return Array.from(f.byId.values()).map(lobbyView).sort((a, b) => a.timestamp - b.timestamp);
      }
      if (f.kind === 'bounty') return clone(Array.from(f.byId.values()));
      return clone(f.items);
    }

    /** Waits for the room listing and both authors' logs (or the 10 s load timeout). */
    async readAsync(key) {
      if (!key) return [];
      await this._feed(key).ready;
      return this.read(key);
    }

    isStale(key) {
      const f = this.feeds.get(key);
      return !!(f && f.stale);
    }

    /** After a refresh: keep seat 0 on the host this tab already played against. */
    pinRoomHost(key, uid) {
      if (!key || key === LOBBY_KEY || key === BOUNTY_KEY || !validUid(uid)) return false;
      const f = this._feed(key);
      this._bindHost(f, uid);
      return f.hostUid === uid;
    }

    getRoomHost(key) {
      const f = this.feeds.get(key);
      return (f && f.hostUid) || null;
    }

    heartbeat(key, payload = {}) {
      if (!key || key === LOBBY_KEY || key === BOUNTY_KEY || this.destroyed) return false;
      const f = this._feed(key);
      const pi = payload.playerIndex;
      const hb = {
        type: 'HEARTBEAT',
        playerId: str(payload.playerId || this.clientId, 128),
        playerIndex: (pi === 0 || pi === 1) ? pi : -1,
        status: payload.status === 'online' ? 'online' : (str(payload.status, 16) || 'online'),
        timestamp: Date.now()
      };
      this._dispatch(f, hb); // local loopback, like the other transports
      if (!this.room) return false;
      const presence = { pi: hb.playerIndex, pid: hb.playerId, st: hb.status, hb: ++this.hbCounter };
      this._joinRoom(key).then(named => named && named.presence(presence)).catch(() => {});
      return true;
    }

    // ---- room capability: presence + preset reactions (never persisted) ----

    _joinRoom(key) {
      if (!this.room || this.destroyed) return Promise.resolve(null);
      let j = this.joined.get(key);
      if (j && (j.named || j.pending)) return j.promise;
      if (j && j.failedAt && Date.now() - j.failedAt < 15000) return Promise.resolve(null);
      const name = ('glt-' + String(key).toLowerCase()).replace(/[^a-z0-9_.-]/g, '-').slice(0, 48);
      j = { name, named: null, pending: true, unsubs: [], failedAt: 0, promise: null };
      this.joined.set(key, j);
      j.promise = acquireNamedRoom(this.room, name).then(named => {
        j.pending = false;
        if (this.destroyed || !named) {
          releaseNamedRoom(this.room, name);
          return null;
        }
        j.named = named;
        j.unsubs.push(named.on('reaction', msg => this._onReaction(key, msg), () => {}));
        j.unsubs.push(named.onPeers(change => this._onPeers(key, change), () => {}));
        return named;
      }).catch(() => {
        j.pending = false;
        j.failedAt = Date.now();
        releaseNamedRoom(this.room, name);
        return null;
      });
      return j.promise;
    }

    /** The seat a platform-stamped sender id (`by`) holds in this match, or null. */
    _seatForSender(f, by, claimed) {
      if (claimed !== 0 && claimed !== 1) return null;
      const uid = claimed === 0 ? f.hostUid : f.guestUid;
      return (uid && by === uid) ? claimed : null;
    }

    _onPeers(key, change) {
      const f = this.feeds.get(key);
      if (!f || !change) return;
      const list = [].concat(change.joined || [], change.updated || []);
      for (const p of list) {
        if (!p || p.sameTab || p.kind === 'agent') continue;
        const pr = isPlainObject(p.presence) ? p.presence : {};
        const seat = this._seatForSender(f, p.by, pr.pi);
        if (seat === null) continue;
        this._dispatch(f, {
          type: 'HEARTBEAT',
          playerId: str(pr.pid, 128),
          playerIndex: seat,
          status: pr.st === 'online' ? 'online' : 'away',
          timestamp: Date.now() // receiver clock: presence is liveness, never authority
        });
      }
    }

    _onReaction(key, msg) {
      const f = this.feeds.get(key);
      if (!f || !msg || msg.sameTab) return;
      const d = isPlainObject(msg.data) ? msg.data : {};
      const seat = this._seatForSender(f, msg.by, d.pi);
      if (seat === null) return;
      const eventId = safeDocId(d.e);
      const sk = seat + '|' + eventId;
      if (!eventId || f.seen.has(sk)) return;
      const ev = { eventId, type: 'REACTION', playerIndex: seat, reactionId: str(d.r, 40), timestamp: Date.now(), _seat: seat };
      f.seen.add(sk);
      f.items.push(ev);
      this._dispatch(f, ev); // the protocol fold still checks the preset whitelist
    }

    _emitReaction(f, ev) {
      this._joinRoom(f.key).then(named => {
        if (!named) throw new Error('room unavailable');
        return named.emit('reaction', { pi: ev.playerIndex, r: str(ev.reactionId, 40), e: ev.eventId });
      }).catch(() => {
        // not_permitted / no room: fall back to my durable log so the rival still sees it
        if (!this.fatal) this._appendOwn(f, ev);
      });
    }

    // ---- lobby ("Partida rápida") and bounty board --------------------------

    _publishLobby(ev) {
      if (ev.type === 'ROOM_DELETED') return this.deleteRoom(ev.id);
      if (ev.type === 'ROOMS_CLEARED') return this.clearOpenRooms();
      const id = String(ev.id || '').trim().toUpperCase();
      if (!ROOM_KEY_RE.test(id)) return false;
      // The listing doc is written by the room's own transport on ROOM_CREATED (it carries the
      // host binding `by`); here it is only shown at once, until the store confirms it.
      const body = {
        id,
        host: str(ev.host, 40),
        crewId: str(ev.crewId, 40),
        format: str(ev.format, 12),
        mode: str(ev.mode, 20),
        timestamp: num(ev.timestamp, Date.now()),
        status: 'open',
        by: this.userId
      };
      const f = this._feed(LOBBY_KEY);
      this.myRooms.add(id);
      f.byId.set(id, body);
      this._dispatch(f, lobbyView(body));
      return true;
    }

    /** True when this viewer opened the room (the store only lets its host close it). */
    ownsRoom(roomId) {
      const id = String(roomId || '').trim().toUpperCase();
      if (!ROOM_KEY_RE.test(id)) return false;
      if (this.myRooms.has(id)) return true;
      const body = this._feed(LOBBY_KEY).byId.get(id);
      return !!(body && this.userId && body.by === this.userId);
    }

    deleteRoom(roomId) {
      const id = String(roomId || '').trim().toUpperCase();
      if (!ROOM_KEY_RE.test(id)) return false;
      const f = this._feed(LOBBY_KEY);
      f.byId.delete(id);
      this._dispatch(f, { type: 'ROOM_DELETED', id });
      const ref = this.db.doc('rooms/' + id);
      this._enqueue(ref.path, () => ref.update({ status: 'closed', closedAt: Date.now() }), { ignoreInvalid: true });
      return true;
    }

    clearOpenRooms() {
      // Shared store: close only the rooms this viewer opened; just hide the rest locally.
      const f = this._feed(LOBBY_KEY);
      Array.from(f.byId.values()).forEach(body => {
        const mine = this.myRooms.has(body.id) || (this.userId && body.by === this.userId);
        if (mine) {
          const ref = this.db.doc('rooms/' + body.id);
          this._enqueue(ref.path, () => ref.update({ status: 'closed', closedAt: Date.now() }), { ignoreInvalid: true });
        }
      });
      this._dispatch(f, { type: 'ROOMS_CLEARED' });
      return true;
    }

    _publishBounty(ev) {
      const body = sanitizeBountyDoc(ev);
      const id = body && safeDocId(body.playerId);
      if (!id) return false;
      const f = this._feed(BOUNTY_KEY);
      f.byId.set(id, body);
      this._dispatch(f, body);
      const ref = this.db.doc('bounties/' + id);
      this._enqueue(ref.path, () => ref.set(body));
      return true;
    }

    destroy() {
      this.destroyed = true;
      this.feeds.forEach(f => {
        clearTimeout(f.timer);
        clearInterval(f.refresh);
        this._stopWatch(f.watch);
        this._stopWatch(f.roomWatch);
        if (f.authors) f.authors.forEach(a => this._stopWatch(a.watch));
        f.handlers.clear();
      });
      this.joined.forEach(j => {
        j.unsubs.forEach(u => { try { u(); } catch (_) {} });
        if (j.named) releaseNamedRoom(this.room, j.name); // a pending join releases itself on settle
      });
      this.joined.clear();
      // The outbox keeps flushing: a FLEET_REVEAL queued just before leaving must still land.
    }
  }

  // =========================================================================
  // 5. Backend detection (automatic): LAN relay > published Artifact db > BroadcastChannel
  // =========================================================================

  let capsMemo = null;

  /**
   * Resolves the published-Artifact capabilities. `window.claude` carries only `use`;
   * every namespace arrives later through its promise (null when this view cannot run it).
   */
  function resolveArtifactCapabilities(win) {
    const w = win || (typeof window !== 'undefined' ? window : undefined);
    const host = w && w.claude;
    if (!host || typeof host.use !== 'function') {
      return Promise.resolve({ hosted: false, db: null, room: null, user: null, userId: null });
    }
    if (capsMemo && capsMemo.host === host) return capsMemo.promise;
    const safeUse = (name) => {
      try { return Promise.resolve(host.use(name)).then(ns => ns || null, () => null); } catch (_) { return Promise.resolve(null); }
    };
    const promise = Promise.all([safeUse('db'), safeUse('room'), safeUse('user')]).then(async ([db, room, user]) => {
      let userId = null;
      if (user && typeof user.id === 'function') {
        try { userId = await user.id(); } catch (_) { userId = null; }
      }
      return {
        hosted: true,
        db,
        room,
        user,
        userId: (typeof userId === 'string' && userId) ? userId : null
      };
    });
    capsMemo = { host, promise };
    return promise;
  }

  /**
   * @returns {Promise<{kind: 'lanRelay'|'artifactDb'|'broadcastChannel'|'none', caps?: object, reason?: string}>}
   */
  function detectTransportBackend(win) {
    const w = win || (typeof window !== 'undefined' ? window : undefined);
    if (w && w.__GLT_LAN_CONFIG__ && w.__GLT_LAN_CONFIG__.enabled) {
      return Promise.resolve({ kind: 'lanRelay' });
    }
    return resolveArtifactCapabilities(w).then(caps => {
      if (caps.hosted) {
        if (!caps.db) return { kind: 'none', caps, reason: 'db_unavailable' };
        // Moves live under moves/{self}: without the viewer's own id nothing can be authored.
        if (!caps.userId) return { kind: 'none', caps, reason: 'identity_unavailable' };
        return { kind: 'artifactDb', caps };
      }
      if (w && typeof w.BroadcastChannel !== 'undefined') return { kind: 'broadcastChannel' };
      return { kind: 'none', reason: 'no_transport' };
    }, () => ({ kind: 'none', reason: 'db_unavailable' }));
  }

  /** Builds a fresh transport for an already-detected backend (null when PvP is unavailable). */
  function createTransportFor(backend, options = {}) {
    if (!backend || backend.kind === 'none') return null;
    if (backend.kind === 'artifactDb') {
      return new ArtifactDbTransport(Object.assign({}, options, {
        db: backend.caps.db,
        room: backend.caps.room,
        userId: backend.caps.userId
      }));
    }
    return new ArtifactSharedTransport(options);
  }

  // =========================================================================
  // Module Exports
  // =========================================================================

  const transportExports = {
    Transport,
    InMemoryTransport,
    InMemoryRegistry,
    SimulatedNetworkTransport,
    SimulatedNetworkHub,
    ArtifactSharedTransport,
    ArtifactDbTransport,
    ARTIFACT_CAPABILITIES,
    resolveArtifactCapabilities,
    detectTransportBackend,
    createTransportFor
  };

  root.GLT = root.GLT || {};
  root.GLT.transport = transportExports;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = transportExports;
  }

})(typeof globalThis !== 'undefined' ? globalThis : this);
