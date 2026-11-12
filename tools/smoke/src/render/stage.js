(function () {
  'use strict';
  globalThis.GLT = globalThis.GLT || {};
  GLT.demos.cube = function (ctx) {
    const p = ctx.params, THREE = ctx.THREE;
    const W = ctx.root.clientWidth || 640, H = ctx.root.clientHeight || 360;
    const r = new THREE.WebGLRenderer({ antialias: false, preserveDrawingBuffer: true });
    r.setSize(W, H); ctx.root.appendChild(r.domElement);
    const s = new THREE.Scene(); s.background = new THREE.Color(p.tod === 'night' ? 0x050a18 : 0x7fc8f0);
    const cam = new THREE.OrthographicCamera(-W / 100, W / 100, H / 100, -H / 100, 0.1, 100);
    const a = (p.angle === undefined ? 45 : p.angle) * Math.PI / 180, e = (p.elev === undefined ? 35 : p.elev) * Math.PI / 180;
    cam.position.set(Math.cos(a) * Math.cos(e) * 10, Math.sin(e) * 10, Math.sin(a) * Math.cos(e) * 10); cam.lookAt(0, 0, 0);
    const m = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2), new THREE.MeshBasicMaterial({ color: 0xc8643c }));
    m.rotation.y = GLT.clock(); s.add(m);
    r.render(s, cam);
    const l = document.createElement('div'); l.id = 'label'; l.textContent = GLT.T('hello'); ctx.root.appendChild(l);
    GLT.smoke = { pixels: () => { const g = r.getContext(); const b = new Uint8Array(4); g.readPixels(W >> 1, H >> 1, 1, 1, g.RGBA, g.UNSIGNED_BYTE, b); return Array.from(b); }, t: GLT.clock(), params: p };
    GLT.demos.cube.ran = true;
  };
})();
