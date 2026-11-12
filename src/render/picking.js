/* GLT.picking: pointer -> plate cell; emits cell:* events. Area: render. Contract: ARCHITECTURE.md §10.8.
 * BOOTSTRAP (architect): ray vs plane y = PLATE_Y, mouse/touch via pointer events. Owner: render builder. */
(function () {
  'use strict';
  const GLT = (globalThis.GLT = globalThis.GLT || {});

  let canvas = null;
  let enabled = true;
  let consumers = [];
  let ray = null, ndc = null, plane = null, hitV = null;
  let lastKey = '';

  function pick(clientX, clientY) {
    const none = { plate: null, r: null, c: null, point: null };
    const cam = GLT.camera.three();
    if (!canvas || !cam) return none;
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return none;
    ndc.set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    ray.setFromCamera(ndc, cam);
    if (!ray.ray.intersectPlane(plane, hitV)) return none;
    const point = { x: hitV.x, y: hitV.y, z: hitV.z };
    const plate = GLT.layout.plateAt(point.x, point.z);
    if (!plate) return { plate: null, r: null, c: null, point };
    const cell = GLT.layout.worldToCell(plate, point.x, point.z);
    return cell ? { plate, r: cell.r, c: cell.c, point } : { plate: null, r: null, c: null, point };
  }

  function payload(ev, hit) {
    return { plate: hit.plate, r: hit.r, c: hit.c, button: ev.button, pointerType: ev.pointerType || 'mouse', x: ev.clientX, y: ev.clientY };
  }

  function emit(type, ev) {
    if (!enabled) return null;
    const hit = pick(ev.clientX, ev.clientY);
    GLT.events.emit(type, payload(ev, hit));
    return hit;
  }

  function init() {
    if (canvas) return true;
    if (typeof THREE === 'undefined') return false;
    canvas = GLT.renderer.canvas();
    if (!canvas) return false;
    ray = new THREE.Raycaster();
    ndc = new THREE.Vector2();
    plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -GLT.C.PLATE_Y);
    hitV = new THREE.Vector3();
    canvas.addEventListener('pointermove', (ev) => {
      if (!enabled) return;
      const hit = pick(ev.clientX, ev.clientY);
      const k = hit.plate + ':' + hit.r + ':' + hit.c;
      if (k !== lastKey) { lastKey = k; GLT.events.emit('cell:hover', payload(ev, hit)); }
      GLT.events.emit('cell:move', payload(ev, hit));
    });
    canvas.addEventListener('pointerdown', (ev) => {
      const hit = emit('cell:down', ev);
      if (!hit) return;
      ev.gltConsumed = consumers.some((fn) => { try { return !!fn(ev, hit); } catch (err) { setTimeout(() => { throw err; }, 0); return false; } });
    });
    canvas.addEventListener('pointerup', (ev) => emit('cell:up', ev));
    // a camera drag/pinch that ends on the canvas must not select a cell
    const dragged = () => !!(GLT.camera && GLT.camera.dragged && GLT.camera.dragged());
    canvas.addEventListener('click', (ev) => { if (!dragged()) emit('cell:click', ev); });
    canvas.addEventListener('dblclick', (ev) => { if (!dragged()) emit('cell:dblclick', ev); });
    canvas.addEventListener('contextmenu', (ev) => { ev.preventDefault(); emit('cell:context', ev); });
    canvas.addEventListener('pointerleave', () => {
      if (lastKey !== 'null:null:null') { lastKey = 'null:null:null'; GLT.events.emit('cell:hover', { plate: null, r: null, c: null }); }
    });
    return true;
  }

  GLT.picking = {
    init,
    setEnabled(b) { enabled = !!b; },
    pick,
    consumes(fn) { consumers.push(fn); return () => { consumers = consumers.filter((f) => f !== fn); }; }
  };
})();
