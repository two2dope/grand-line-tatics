/* GLT.scene: THREE.Scene, layers, before-render hooks. Area: render. Contract: ARCHITECTURE.md §10.7.
 * BOOTSTRAP (architect). Owner: render builder (keep the API). */
(function () {
  'use strict';
  const GLT = (globalThis.GLT = globalThis.GLT || {});

  const LAYERS = ['world', 'plates', 'ships', 'fx', 'backdrop', 'props', 'crowd', 'ui3d'];
  let root = null;
  const groups = {};
  let hooks = [];

  function init() {
    if (root) return true;
    if (typeof THREE === 'undefined') return false;
    root = new THREE.Scene();
    root.name = 'glt-root';
    LAYERS.forEach((l) => { const g = new THREE.Group(); g.name = 'layer-' + l; groups[l] = g; root.add(g); });
    return true;
  }

  // Hosted mode (src/sea/bridge.js): use a group inside the game's own THREE.Scene as the root. Fog and background
  // set on it by GLT.lighting are copied to the real scene by the bridge every frame.
  function adopt(group) {
    if (root || !group) return !!root;
    root = group;
    LAYERS.forEach((l) => { const g = new THREE.Group(); g.name = 'layer-' + l; groups[l] = g; root.add(g); });
    return true;
  }

  function add(obj, layer) {
    if (!root || !obj) return;
    (groups[layer] || groups.world).add(obj);
  }

  function remove(obj) { if (obj && obj.parent) obj.parent.remove(obj); }

  function onBeforeRender(fn) {
    hooks.push(fn);
    return () => { hooks = hooks.filter((h) => h !== fn); };
  }

  function beforeRender() {
    for (const h of hooks.slice()) {
      try { h(); } catch (err) { setTimeout(() => { throw err; }, 0); }
    }
  }

  GLT.scene = {
    LAYERS,
    init,
    adopt,
    root() { return root; },
    add,
    remove,
    group(layer) { return groups[layer] || null; },
    onBeforeRender,
    beforeRender
  };
})();
