/* GLT._world_kit: private helpers for the world area (no other area may use it).
 * - Batch: accumulates coloured boxes / voxel grids into ONE merged BufferGeometry (vertex colours) per material.
 * - Vox: sparse voxel grid with numeric keys and hidden-face culling that emits into a Batch.
 * - glyphs: a 3x5 pixel font for the rim coordinates (A-L, 0-9). Strings come from GLT.board; we only draw them.
 * - colour helpers, easing, world-owned materials (night-aware glow), shared scratch objects.
 * Load time: defines functions only (THREE / GLT namespaces are touched at call time). */
(function () {
  'use strict';
  const GLT = (globalThis.GLT = globalThis.GLT || {});

  // ---------- colours ----------
  function hex(c) {
    if (typeof c === 'number') return c >>> 0;
    if (typeof c === 'string' && c.charAt(0) === '#') return parseInt(c.slice(1), 16) >>> 0;
    if (GLT.palette && GLT.palette.has && GLT.palette.has(c)) return GLT.palette.get(c);
    return 0xff00ff;
  }
  function mix(a, b, t) {
    a = hex(a); b = hex(b);
    const ar = a >> 16 & 255, ag = a >> 8 & 255, ab = a & 255;
    const br = b >> 16 & 255, bg = b >> 8 & 255, bb = b & 255;
    return ((Math.round(ar + (br - ar) * t) << 16) | (Math.round(ag + (bg - ag) * t) << 8) | Math.round(ab + (bb - ab) * t)) >>> 0;
  }
  function shade(c, f) {
    c = hex(c);
    const r = Math.min(255, Math.round((c >> 16 & 255) * f)), g = Math.min(255, Math.round((c >> 8 & 255) * f)), b = Math.min(255, Math.round((c & 255) * f));
    return ((r << 16) | (g << 8) | b) >>> 0;
  }
  const easeInOutCubic = (k) => (k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2);
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const smooth = (a, b, v) => { const t = clamp((v - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

  function rng(seed, label) {
    if (GLT.rng && GLT.rng.derive) return GLT.rng.derive(seed >>> 0, 'world', label || '');
    let s = (seed >>> 0) || 1;
    return { next() { s = (s + 0x6d2b79f5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; },
      int(n) { return Math.floor(this.next() * n); }, range(a, b) { return a + (b - a) * this.next(); }, chance(p) { return this.next() < p; },
      pick(a) { return a[Math.floor(this.next() * a.length)]; } };
  }

  // cheap deterministic value noise (2D / 3D) for erosion, strata jitter
  function hash3(x, y, z) {
    let h = (x * 374761393 + y * 668265263 + z * 2147483647) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  }
  function noise2(x, y, seed) {
    const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
    const s = seed | 0;
    const a = hash3(xi, yi, s), b = hash3(xi + 1, yi, s), c = hash3(xi, yi + 1, s), d = hash3(xi + 1, yi + 1, s);
    const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  }

  // ---------- Batch ----------
  // Face table: normal + 4 corners in unit cube coords (CCW from outside).
  const FACES = [
    { n: [1, 0, 0], q: [[1, 0, 0], [1, 1, 0], [1, 1, 1], [1, 0, 1]] },
    { n: [-1, 0, 0], q: [[0, 0, 1], [0, 1, 1], [0, 1, 0], [0, 0, 0]] },
    { n: [0, 1, 0], q: [[0, 1, 1], [1, 1, 1], [1, 1, 0], [0, 1, 0]] },
    { n: [0, -1, 0], q: [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]] },
    { n: [0, 0, 1], q: [[1, 0, 1], [1, 1, 1], [0, 1, 1], [0, 0, 1]] },
    { n: [0, 0, -1], q: [[0, 0, 0], [0, 1, 0], [1, 1, 0], [1, 0, 0]] }
  ];

  function Batch() {
    this.p = []; this.n = []; this.c = []; this.uv = null; this.idx = [];
    this.m = null;          // optional THREE.Matrix4 applied to added geometry
    this.nm = null;         // normal matrix (Matrix3)
  }
  Batch.prototype.setMatrix = function (m) {
    this.m = m || null;
    if (m) { this.nm = this.nm || new THREE.Matrix3(); this.nm.getNormalMatrix(m); }
    return this;
  };
  Batch.prototype._v = function (x, y, z, nx, ny, nz, r, g, b) {
    if (this.m) {
      const e = this.m.elements;
      const X = e[0] * x + e[4] * y + e[8] * z + e[12], Y = e[1] * x + e[5] * y + e[9] * z + e[13], Z = e[2] * x + e[6] * y + e[10] * z + e[14];
      const k = this.nm.elements;
      const NX = k[0] * nx + k[3] * ny + k[6] * nz, NY = k[1] * nx + k[4] * ny + k[7] * nz, NZ = k[2] * nx + k[5] * ny + k[8] * nz;
      const L = Math.hypot(NX, NY, NZ) || 1;
      this.p.push(X, Y, Z); this.n.push(NX / L, NY / L, NZ / L);
    } else { this.p.push(x, y, z); this.n.push(nx, ny, nz); }
    this.c.push(r, g, b);
  };
  // Axis-aligned box [x0,x1]x[y0,y1]x[z0,z1] (floats). color = hex/role; o.bottom = colour for the lower side vertices
  // (vertical gradient), o.top = colour of the top face, o.faces = bitmask of faces to emit (1 +x,2 -x,4 +y,8 -y,16 +z,32 -z).
  Batch.prototype.box = function (x0, y0, z0, x1, y1, z1, color, o) {
    const c = hex(color);
    const cb = o && o.bottom != null ? hex(o.bottom) : c;
    const ct = o && o.top != null ? hex(o.top) : c;
    const mask = o && o.faces != null ? o.faces : 63;
    const r = (c >> 16 & 255) / 255, g = (c >> 8 & 255) / 255, b = (c & 255) / 255;
    const rb = (cb >> 16 & 255) / 255, gb = (cb >> 8 & 255) / 255, bb = (cb & 255) / 255;
    const rt = (ct >> 16 & 255) / 255, gt = (ct >> 8 & 255) / 255, bt = (ct & 255) / 255;
    const sx = x1 - x0, sy = y1 - y0, sz = z1 - z0;
    for (let f = 0; f < 6; f++) {
      if (!(mask & (1 << f))) continue;
      const F = FACES[f];
      const base = this.p.length / 3;
      for (let i = 0; i < 4; i++) {
        const q = F.q[i];
        const top = f === 2;
        const lo = q[1] === 0 && f !== 2;
        const cr = top ? rt : lo ? rb : r, cg = top ? gt : lo ? gb : g, cbb = top ? bt : lo ? bb : b;
        this._v(x0 + q[0] * sx, y0 + q[1] * sy, z0 + q[2] * sz, F.n[0], F.n[1], F.n[2], cr, cg, cbb);
      }
      this.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
    return this;
  };
  // Box centred at (cx,cy,cz) with half sizes; optional rotation about Y (radians) around its centre.
  Batch.prototype.cbox = function (cx, cy, cz, hx, hy, hz, color, o) {
    if (o && o.yaw) {
      const prev = this.m;
      const m = new THREE.Matrix4().makeRotationY(o.yaw).setPosition(cx, cy, cz);
      if (prev) m.premultiply(prev);
      this.setMatrix(m);
      this.box(-hx, -hy, -hz, hx, hy, hz, color, o);
      this.setMatrix(prev);
      return this;
    }
    return this.box(cx - hx, cy - hy, cz - hz, cx + hx, cy + hy, cz + hz, color, o);
  };
  // Flat quad (two triangles) given 4 corners (CCW from the visible side) with optional uvs.
  Batch.prototype.quad = function (a, b, c, d, color, uv, colors) {
    const col = hex(color);
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
    const vx = d[0] - a[0], vy = d[1] - a[1], vz = d[2] - a[2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const L = Math.hypot(nx, ny, nz) || 1; nx /= L; ny /= L; nz /= L;
    const base = this.p.length / 3;
    const pts = [a, b, c, d];
    for (let i = 0; i < 4; i++) {
      const cc = colors ? hex(colors[i]) : col;
      this._v(pts[i][0], pts[i][1], pts[i][2], nx, ny, nz, (cc >> 16 & 255) / 255, (cc >> 8 & 255) / 255, (cc & 255) / 255);
    }
    if (uv) { this.uv = this.uv || []; this.uv.push(uv[0], uv[1], uv[2], uv[3], uv[4], uv[5], uv[6], uv[7]); }
    this.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
    return this;
  };
  Batch.prototype.count = function () { return this.idx.length / 3; };
  Batch.prototype.geometry = function () {
    if (!this.p.length) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.c, 3));
    if (this.uv && this.uv.length / 2 === this.p.length / 3) g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    const nv = this.p.length / 3;
    g.setIndex(nv > 65535 ? new THREE.Uint32BufferAttribute(this.idx, 1) : new THREE.Uint16BufferAttribute(this.idx, 1));
    g.computeBoundingSphere();
    g.computeBoundingBox();
    return g;
  };
  Batch.prototype.mesh = function (material, o) {
    const g = this.geometry();
    if (!g) return null;
    const mesh = new THREE.Mesh(g, material);
    mesh.castShadow = !!(o && o.cast);
    mesh.receiveShadow = !(o && o.receive === false);
    if (o && o.name) mesh.name = o.name;
    return mesh;
  };

  // ---------- Vox: sparse voxel grid -> culled faces into a Batch ----------
  const OFF = 1024, SPAN = 2048;
  function Vox(size) { this.s = size || 1; this.map = new Map(); }
  Vox.prototype.key = function (x, y, z) { return ((x + OFF) * SPAN + (y + OFF)) * SPAN + (z + OFF); };
  Vox.prototype.set = function (x, y, z, color) { this.map.set(this.key(x, y, z), [x, y, z, hex(color)]); return this; };
  Vox.prototype.get = function (x, y, z) { const v = this.map.get(this.key(x, y, z)); return v ? v[3] : null; };
  Vox.prototype.has = function (x, y, z) { return this.map.has(this.key(x, y, z)); };
  Vox.prototype.remove = function (x, y, z) { this.map.delete(this.key(x, y, z)); return this; };
  Vox.prototype.box = function (x0, y0, z0, x1, y1, z1, color) {
    for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) this.set(x, y, z, color);
    return this;
  };
  Vox.prototype.size = function () { return this.map.size; };
  // Emit visible faces. ox,oy,oz = world offset of voxel (0,0,0)'s min corner. o.skipBottom drops -y faces.
  Vox.prototype.emit = function (batch, ox, oy, oz, o) {
    const s = this.s, map = this.map;
    const skipBottom = !!(o && o.skipBottom);
    const minY = o && o.minY != null ? o.minY : -Infinity;
    const D = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
    map.forEach((v) => {
      const x = v[0], y = v[1], z = v[2], c = v[3];
      let mask = 0;
      for (let f = 0; f < 6; f++) {
        if (f === 3 && (skipBottom || y <= minY)) continue;
        if (!map.has(this.key(x + D[f][0], y + D[f][1], z + D[f][2]))) mask |= 1 << f;
      }
      if (!mask) return;
      const x0 = ox + x * s, y0 = oy + y * s, z0 = oz + z * s;
      batch.box(x0, y0, z0, x0 + s, y0 + s, z0 + s, c, { faces: mask, top: c, bottom: c });
    });
    return batch;
  };

  // ---------- 3x5 pixel font (rows top->bottom) ----------
  const GLYPHS = {
    A: ['.#.', '#.#', '###', '#.#', '#.#'], B: ['##.', '#.#', '##.', '#.#', '##.'], C: ['.##', '#..', '#..', '#..', '.##'],
    D: ['##.', '#.#', '#.#', '#.#', '##.'], E: ['###', '#..', '##.', '#..', '###'], F: ['###', '#..', '##.', '#..', '#..'],
    G: ['.##', '#..', '#.#', '#.#', '.##'], H: ['#.#', '#.#', '###', '#.#', '#.#'], I: ['###', '.#.', '.#.', '.#.', '###'],
    J: ['..#', '..#', '..#', '#.#', '.#.'], K: ['#.#', '#.#', '##.', '#.#', '#.#'], L: ['#..', '#..', '#..', '#..', '###'],
    0: ['###', '#.#', '#.#', '#.#', '###'], 1: ['.#.', '##.', '.#.', '.#.', '###'], 2: ['##.', '..#', '.#.', '#..', '###'],
    3: ['##.', '..#', '.#.', '..#', '##.'], 4: ['#.#', '#.#', '###', '..#', '..#'], 5: ['###', '#..', '##.', '..#', '##.'],
    6: ['.##', '#..', '###', '#.#', '###'], 7: ['###', '..#', '.#.', '.#.', '.#.'], 8: ['###', '#.#', '###', '#.#', '###'],
    9: ['###', '#.#', '###', '..#', '##.']
  };
  // Calls fn(px, py) for every lit pixel of `text` laid out left->right; px in [0, width), py 0 = top row.
  function glyphPixels(text, fn) {
    const chars = String(text).toUpperCase().split('');
    let x = 0;
    chars.forEach((ch, i) => {
      const g = GLYPHS[ch];
      if (g) for (let r = 0; r < 5; r++) for (let c = 0; c < 3; c++) if (g[r].charAt(c) === '#') fn(x + c, r);
      x += 3 + (i < chars.length - 1 ? 1 : 0);
    });
    return { w: x, h: 5 };
  }
  function glyphWidth(text) { const n = String(text).length; return n * 3 + Math.max(0, n - 1); }

  // ---------- materials (world-owned, cached) ----------
  const mats = {};
  function mat(name) {
    if (mats[name]) return mats[name];
    let m;
    switch (name) {
      case 'solid': m = new THREE.MeshLambertMaterial({ vertexColors: true }); break;
      case 'water': m = new THREE.MeshLambertMaterial({ vertexColors: true }); outline(m, 'water'); break;
      case 'glow': m = new THREE.MeshBasicMaterial({ vertexColors: true }); outline(m, 'none'); break;          // night-aware (colour scaled)
      case 'lamp': m = new THREE.MeshBasicMaterial({ vertexColors: true }); outline(m, 'glow'); break;          // always lit, not graded
      case 'overlay': m = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.55, depthWrite: false,
        blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.SrcAlphaFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
        blendSrcAlpha: THREE.ZeroFactor, blendDstAlpha: THREE.OneFactor }); m.userData.gltOutline = 'none'; break;
      case 'flat': m = new THREE.MeshBasicMaterial({ vertexColors: true }); break;
      default: m = new THREE.MeshLambertMaterial({ vertexColors: true });
    }
    m.userData.gltWorld = true;
    m.userData.gltShared = true;      // GLT.voxel.dispose leaves it alone
    mats[name] = m;
    return m;
  }
  function outline(m, cls) {
    if (GLT.renderer && typeof GLT.renderer.markMaterial === 'function') GLT.renderer.markMaterial(m, cls);
    else { m.userData = m.userData || {}; m.userData.gltOutline = cls; }
    return m;
  }
  // Night-aware tint for the 'glow' material: windows/lamps are dim by day and bright at night.
  function updateGlow(night) {
    const m = mats.glow;
    if (!m) return;
    const k = 0.5 + 0.5 * clamp(night, 0, 1);
    m.color.setRGB(k, k, k);
  }

  function nightFactor() { return GLT.lighting && GLT.lighting.nightFactor ? GLT.lighting.nightFactor() : 0; }
  function stormFactor() { return GLT.lighting && GLT.lighting.stormFactor ? GLT.lighting.stormFactor() : 0; }
  function reduced() { return !!(GLT.prefs && GLT.prefs.reducedMotion && GLT.prefs.reducedMotion()); }

  function disposeObj(obj) {
    if (!obj) return;
    if (GLT.voxel && GLT.voxel.dispose) { GLT.voxel.dispose(obj); return; }
    obj.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
    if (obj.parent) obj.parent.remove(obj);
  }

  // Nearest-filtered canvas texture.
  function canvasTexture(canvas) {
    const t = new THREE.CanvasTexture(canvas);
    t.magFilter = THREE.NearestFilter; t.minFilter = THREE.NearestFilter; t.generateMipmaps = false;
    return t;
  }

  // Extract the merged geometry (first mesh of a class) from a GLT.voxel build, for instancing.
  function voxGeometry(vb, o) {
    const g = build(vb, Object.assign({ castShadow: false, receiveShadow: false }, o || {}));
    let geo = null;
    g.traverse((m) => { if (!geo && m.isMesh) geo = m.geometry; });
    return geo;
  }

  // ---------- greedy voxel mesher (world-only) ----------
  // Same look as GLT.voxel.build (hidden faces culled, per-corner AO, vertex colours, one mesh per class) but coplanar
  // faces with the same colour, class and a UNIFORM AO level are merged into rectangles. Faces with an AO gradient stay
  // single quads (split along the brighter diagonal), so the shading is identical and the triangle count drops a lot.
  const VCLS = ['solid', 'emissive', 'glass'];
  const VCLS_ID = { solid: 0, emissive: 1, glass: 2 };
  const GFACES = [
    { n: [1, 0, 0], q: [[1, 0, 0], [1, 1, 0], [1, 1, 1], [1, 0, 1]], a: 0, u: 1, v: 2 },
    { n: [-1, 0, 0], q: [[0, 0, 1], [0, 1, 1], [0, 1, 0], [0, 0, 0]], a: 0, u: 1, v: 2 },
    { n: [0, 1, 0], q: [[0, 1, 1], [1, 1, 1], [1, 1, 0], [0, 1, 0]], a: 1, u: 0, v: 2 },
    { n: [0, -1, 0], q: [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]], a: 1, u: 0, v: 2 },
    { n: [0, 0, 1], q: [[1, 0, 1], [1, 1, 1], [0, 1, 1], [0, 0, 1]], a: 2, u: 0, v: 1 },
    { n: [0, 0, -1], q: [[0, 0, 0], [0, 1, 0], [1, 1, 0], [1, 0, 0]], a: 2, u: 0, v: 1 }
  ];
  GFACES.forEach((f) => {
    f.ao = f.q.map((c) => {
      const s = [];
      for (let a = 0; a < 3; a++) if (f.n[a] === 0) s.push(a);
      const d = s.map((a) => (c[a] === 1 ? 1 : -1));
      const o1 = [f.n[0], f.n[1], f.n[2]]; o1[s[0]] += d[0];
      const o2 = [f.n[0], f.n[1], f.n[2]]; o2[s[1]] += d[1];
      const o3 = [f.n[0], f.n[1], f.n[2]]; o3[s[0]] += d[0]; o3[s[1]] += d[1];
      return [o1, o2, o3];
    });
  });
  const GOFF = 512, GSPAN = 1024;
  const gkey = (x, y, z) => ((x + GOFF) * GSPAN + (y + GOFF)) * GSPAN + (z + GOFF);
  function vb(size) { const b = GLT.voxel.builder({ size }); b.gltSize = size; return b; }
  function greedy(builder, o) {
    const opt = Object.assign({ castShadow: true, receiveShadow: true, center: false, ao: 0.45 }, o || {});
    const s = builder.gltSize || 0.25;
    const aoK = Math.max(0, Math.min(1, opt.ao || 0));
    const AO_LEVEL = [1, 1 - 0.18 * aoK, 1 - 0.32 * aoK, 1 - 0.46 * aoK];
    const col = new Map(), cl = new Map();
    const xs = [], ys = [], zs = [];
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    builder.forEach((x, y, z, hex, c) => {
      const k = gkey(x, y, z);
      col.set(k, hex);
      if (c !== 'solid') cl.set(k, VCLS_ID[c] || 0);
      xs.push(x); ys.push(y); zs.push(z);
      if (x < minX) minX = x; if (x + 1 > maxX) maxX = x + 1; if (z < minZ) minZ = z; if (z + 1 > maxZ) maxZ = z + 1;
    });
    const ox = opt.center && xs.length ? -((minX + maxX) / 2) * s : 0;
    const oz = opt.center && xs.length ? -((minZ + maxZ) / 2) * s : 0;
    const buf = VCLS.map(() => ({ p: [], n: [], c: [], i: [] }));
    const solidAt = (x, y, z) => { const k = gkey(x, y, z); return col.has(k) && !cl.has(k); };
    const slices = new Map();       // (f, slice) -> Map(cellKey -> mergeKey)
    const shades = [0, 0, 0, 0];
    const cr = new THREE.Color();
    function emit(f, cls, hex, slice, u0, u1, v0, v1, sh) {
      const F = GFACES[f], b = buf[cls];
      cr.setHex(hex);
      const base = b.p.length / 3;
      for (let q = 0; q < 4; q++) {
        const c = F.q[q];
        const P = [0, 0, 0];
        P[F.a] = slice + c[F.a];
        P[F.u] = c[F.u] ? u1 : u0;
        P[F.v] = c[F.v] ? v1 : v0;
        b.p.push(P[0] * s + ox, P[1] * s, P[2] * s + oz);
        b.n.push(F.n[0], F.n[1], F.n[2]);
        const k = sh ? sh[q] : 1;
        b.c.push(cr.r * k, cr.g * k, cr.b * k);
      }
      if (!sh || sh[0] + sh[2] >= sh[1] + sh[3]) b.i.push(base, base + 1, base + 2, base, base + 2, base + 3);
      else b.i.push(base + 1, base + 2, base + 3, base + 1, base + 3, base);
    }
    for (let vi = 0; vi < xs.length; vi++) {
      const x = xs[vi], y = ys[vi], z = zs[vi];
      const k = gkey(x, y, z);
      const myCls = cl.get(k) || 0;
      const hex = col.get(k);
      const P = [x, y, z];
      for (let f = 0; f < 6; f++) {
        const F = GFACES[f];
        const nk = gkey(x + F.n[0], y + F.n[1], z + F.n[2]);
        if (col.has(nk)) { const nc = cl.get(nk) || 0; if (nc === 0 || nc === myCls) continue; }
        let uniform = true, lvl = 0;
        if (aoK > 0 && myCls === 0) {
          for (let q = 0; q < 4; q++) {
            const a = F.ao[q];
            const s1 = solidAt(x + a[0][0], y + a[0][1], z + a[0][2]) ? 1 : 0;
            const s2 = solidAt(x + a[1][0], y + a[1][1], z + a[1][2]) ? 1 : 0;
            const cc = solidAt(x + a[2][0], y + a[2][1], z + a[2][2]) ? 1 : 0;
            const L = s1 && s2 ? 3 : s1 + s2 + cc;
            shades[q] = AO_LEVEL[L];
            if (q === 0) lvl = L; else if (L !== lvl) uniform = false;
          }
        } else { shades[0] = shades[1] = shades[2] = shades[3] = 1; }
        if (!uniform) { emit(f, myCls, hex, P[F.a], P[F.u], P[F.u] + 1, P[F.v], P[F.v] + 1, shades.slice()); continue; }
        const sk = f * 4096 + (P[F.a] + 2048);
        let m = slices.get(sk);
        if (!m) { m = new Map(); slices.set(sk, m); }
        m.set((P[F.u] + GOFF) * GSPAN + (P[F.v] + GOFF), (hex * 4 + lvl) * 4 + myCls);
      }
    }
    slices.forEach((m, sk) => {
      const f = Math.floor(sk / 4096), slice = (sk % 4096) - 2048;
      const keys = Array.from(m.keys()).sort((a, b) => a - b);
      const done = new Set();
      // keys sort by u then v (u major): grow along v first, then u
      for (let ki = 0; ki < keys.length; ki++) {
        const ck = keys[ki];
        if (done.has(ck)) continue;
        const mk = m.get(ck);
        const u = Math.floor(ck / GSPAN) - GOFF, v = (ck % GSPAN) - GOFF;
        let h = 1;
        while (true) { const nk = (u + GOFF) * GSPAN + (v + h + GOFF); if (m.get(nk) === mk && !done.has(nk)) h++; else break; }
        let w = 1;
        outer: while (true) {
          for (let q = 0; q < h; q++) { const nk = (u + w + GOFF) * GSPAN + (v + q + GOFF); if (m.get(nk) !== mk || done.has(nk)) break outer; }
          w++;
        }
        for (let a = 0; a < w; a++) for (let q = 0; q < h; q++) done.add((u + a + GOFF) * GSPAN + (v + q + GOFF));
        const cls = mk % 4, lvl = Math.floor(mk / 4) % 4, hex = Math.floor(mk / 16);
        const sh = AO_LEVEL[lvl];
        emit(f, cls, hex, slice, u, u + w, v, v + h, sh === 1 ? null : [sh, sh, sh, sh]);
      }
    });
    const group = new THREE.Group();
    VCLS.forEach((c, ci) => {
      const B = buf[ci];
      if (!B.p.length) return;
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(B.p, 3));
      g.setAttribute('normal', new THREE.Float32BufferAttribute(B.n, 3));
      g.setAttribute('color', new THREE.Float32BufferAttribute(B.c, 3));
      g.setIndex(B.p.length / 3 > 65535 ? new THREE.Uint32BufferAttribute(B.i, 1) : new THREE.Uint16BufferAttribute(B.i, 1));
      g.computeBoundingSphere();
      g.computeBoundingBox();
      const mesh = new THREE.Mesh(g, (opt.materials && opt.materials[c]) || GLT.voxel.material(c));
      mesh.name = 'voxel-' + c;
      mesh.castShadow = c === 'solid' && !!opt.castShadow;
      mesh.receiveShadow = c !== 'emissive' && !!opt.receiveShadow;
      group.add(mesh);
    });
    return group;
  }
  function build(builder, o) { return builder.gltSize ? greedy(builder, o) : builder.build(o); }

  // ---------- merge accumulator: many voxel builders / batches -> ONE mesh per material class ----------
  // acc = K.acc(); K.addVox(acc, vb, matrix?, o?); K.addBatch(acc, 'solid', batch); group = K.flush(acc, {cast, receive})
  function acc() { return { solid: [], emissive: [], glass: [], water: [] }; }
  function addVox(a, vb, m, o) {
    if (!vb.count()) return a;
    const g = build(vb, Object.assign({ castShadow: false, receiveShadow: false, ao: 0.5 }, o || {}));
    g.children.slice().forEach((mesh) => {
      const cls = mesh.name.replace('voxel-', '');
      const geo = mesh.geometry;
      if (m) geo.applyMatrix4(m);
      (a[cls] || a.solid).push(geo);
    });
    return a;
  }
  function addBatch(a, cls, b, m) {
    if (m) { const prev = b.m; b.setMatrix(m); void prev; }
    const g = b.geometry();
    if (g) {
      if (g.getAttribute('uv')) g.deleteAttribute('uv');
      (a[cls] || a.solid).push(g);
    }
    return a;
  }
  function flush(a, o) {
    o = o || {};
    const group = new THREE.Group();
    Object.keys(a).forEach((cls) => {
      const list = a[cls];
      if (!list.length) return;
      const geo = list.length === 1 ? list[0] : GLT.voxel.mergeGeometries(list);
      if (list.length > 1) list.forEach((g) => g.dispose());
      geo.computeBoundingBox();
      geo.computeBoundingSphere();
      let material;
      if (cls === 'water') material = mat('water');
      else material = (o.materials && o.materials[cls]) || GLT.voxel.material(cls);
      const mesh = new THREE.Mesh(geo, material);
      mesh.name = (o.name || 'world') + '-' + cls;
      mesh.castShadow = cls === 'solid' && !!o.cast;
      mesh.receiveShadow = cls !== 'emissive' && o.receive !== false;
      group.add(mesh);
      a[cls] = [];
    });
    if (o.name) group.name = o.name;
    return group;
  }
  // translate/rotate/scale matrix helper
  function mtx(x, y, z, yaw, s) {
    const m = new THREE.Matrix4();
    m.makeRotationY(yaw || 0);
    if (s && s !== 1) m.scale(new THREE.Vector3(s, s, s));
    m.setPosition(x || 0, y || 0, z || 0);
    return m;
  }
  // easeOutBack for pop-ins
  const easeOutBack = (k) => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(k - 1, 3) + c1 * Math.pow(k - 1, 2); };
  // instanced mesh with colour buffer
  function inst(geo, material, count, o) {
    const m = new THREE.InstancedMesh(geo, material, Math.max(1, count));
    m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    // Always give vertex-coloured instanced meshes an (all white) instanceColor: the voxel materials are shared, and
    // three r128 keeps the first program it compiled for a material, so a mesh without instanceColor drawn with a
    // program that expects one fails in WebGLBindingStates (and colours would be ignored the other way round).
    if ((o && o.colors) || (material && material.vertexColors)) {
      m.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(Math.max(1, count) * 3).fill(1), 3);
      m.instanceColor.setUsage(THREE.DynamicDrawUsage);
    }
    m.frustumCulled = false;
    m.castShadow = !!(o && o.cast);
    m.receiveShadow = !!(o && o.receive);
    m.count = 0;
    if (o && o.name) m.name = o.name;
    return m;
  }
  // write a TRS (yaw only + non-uniform scale) into an instance matrix array at slot i (no allocation)
  function setInst(arr, i, x, y, z, yaw, sx, sy, sz) {
    const c = Math.cos(yaw || 0), s = Math.sin(yaw || 0), o = i * 16;
    arr[o] = c * sx; arr[o + 1] = 0; arr[o + 2] = -s * sx; arr[o + 3] = 0;
    arr[o + 4] = 0; arr[o + 5] = sy; arr[o + 6] = 0; arr[o + 7] = 0;
    arr[o + 8] = s * sz; arr[o + 9] = 0; arr[o + 10] = c * sz; arr[o + 11] = 0;
    arr[o + 12] = x; arr[o + 13] = y; arr[o + 14] = z; arr[o + 15] = 1;
  }
  // Give an InstancedMesh a bounding sphere that encloses all its instances (points {x,y?,z} + pad), so frustum
  // culling works for it (three r128 only uses the base geometry's sphere).
  function cullSphere(mesh, pts, pad, yMin, yMax) {
    if (!pts.length) return mesh;
    let x0 = Infinity, x1 = -Infinity, y0 = yMin == null ? Infinity : yMin, y1 = yMax == null ? -Infinity : yMax, z0 = Infinity, z1 = -Infinity;
    pts.forEach((p) => {
      x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); z0 = Math.min(z0, p.z); z1 = Math.max(z1, p.z);
      if (yMin == null) { y0 = Math.min(y0, p.y || 0); y1 = Math.max(y1, p.y || 0); }
    });
    const c = new THREE.Vector3((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
    const r = Math.hypot(x1 - x0, y1 - y0, z1 - z0) / 2 + (pad || 0);
    mesh.geometry.boundingSphere = new THREE.Sphere(c, r);
    mesh.frustumCulled = true;
    return mesh;
  }
  function setCol(arr, i, h) { arr[i * 3] = (h >> 16 & 255) / 255; arr[i * 3 + 1] = (h >> 8 & 255) / 255; arr[i * 3 + 2] = (h & 255) / 255; }
  function t() { return GLT.clock ? GLT.clock.now() : 0; }

  // A procedural vertical streak texture for falling / flowing water (shared by plates and the Reverse Mountain canal).
  let streak = null;
  function streakTexture() {
    if (streak) return streak;
    const W = 16, H = 64, cv = document.createElement('canvas');
    cv.width = W; cv.height = H;
    const g = cv.getContext('2d');
    const r = rng(77, 'streak');
    const cols = ['#2f8bba', '#3d9cc8', '#6ad0bc', '#a6e2df', '#e0f6f0'];
    for (let x = 0; x < W; x++) {
      let y = 0;
      while (y < H) {
        const len = 3 + r.int(10);
        const v = r.next();
        g.fillStyle = v < 0.34 ? cols[0] : v < 0.62 ? cols[1] : v < 0.82 ? cols[2] : v < 0.94 ? cols[3] : cols[4];
        g.fillRect(x, y, 1, len);
        y += len;
      }
    }
    streak = canvasTexture(cv);
    streak.wrapS = streak.wrapT = THREE.RepeatWrapping;
    return streak;
  }
  let flowMat = null;
  function flowMaterial() {
    if (flowMat) return flowMat;
    flowMat = new THREE.MeshLambertMaterial({ map: streakTexture(), vertexColors: true, side: THREE.DoubleSide, emissive: new THREE.Color(0x1d3a52) });
    outline(flowMat, 'water');
    flowMat.userData.gltShared = true;
    return flowMat;
  }

  // ---------- shoreline foam (Sea of Stars style broken white lines hugging every coast) ----------
  // isLand(i,k) over integer cells of size s (world x = ox + i*s, z = oz + k*s). Rings 1..3 = sea cells at Chebyshev
  // distance 1..3 from land. Each quad carries aPh (arc position around the centroid, metres) + aRing, and the shared
  // foam material animates breaks / breathing in the fragment shader, so the whole coast is ONE static draw call.
  const foamT = { value: 0 };
  function foamGeometry(isLand, i0, i1, k0, k1, s, ox, oz, o) {
    o = o || {};
    const y = o.y != null ? o.y : 0.05;
    const W = i1 - i0 + 7, H = k1 - k0 + 7;
    const dist = new Uint8Array(W * H).fill(9);
    const at = (i, k) => (i - i0 + 3) * H + (k - k0 + 3);
    let cx = 0, cz = 0, cn = 0;
    for (let i = i0; i <= i1; i++) for (let k = k0; k <= k1; k++) if (isLand(i, k)) { dist[at(i, k)] = 0; cx += i; cz += k; cn++; }
    if (!cn) return null;
    cx /= cn; cz /= cn;
    const rings = o.rings || 3;
    for (let d = 1; d <= rings; d++) {
      for (let i = i0 - 3; i <= i1 + 3; i++) for (let k = k0 - 3; k <= k1 + 3; k++) {
        const q = at(i, k);
        if (dist[q] <= d) continue;
        let hit = false;
        for (let a = -1; a <= 1 && !hit; a++) for (let b = -1; b <= 1; b++) {
          const ii = i + a, kk = k + b;
          if (ii < i0 - 3 || ii > i1 + 3 || kk < k0 - 3 || kk > k1 + 3) continue;
          if (dist[at(ii, kk)] === d - 1) { hit = true; break; }
        }
        if (hit) dist[q] = d;
      }
    }
    const p = [], c = [], ph = [], rg = [], idx = [];
    const cols = [0, hex('#fffdf7'), hex('#a6e2df'), hex('#6ad0bc')];
    let R = 0;
    for (let i = i0 - 3; i <= i1 + 3; i++) for (let k = k0 - 3; k <= k1 + 3; k++) { const d = dist[at(i, k)]; if (d === 1) R = Math.max(R, Math.hypot(i - cx, k - cz)); }
    R = Math.max(1, R) * s;
    for (let i = i0 - 3; i <= i1 + 3; i++) for (let k = k0 - 3; k <= k1 + 3; k++) {
      const d = dist[at(i, k)];
      if (d < 1 || d > rings) continue;
      const x = ox + i * s, z = oz + k * s;
      const base = p.length / 3;
      const a = Math.atan2(k - cz, i - cx) * R + (o.phase || 0);
      const col = cols[d];
      const cr = (col >> 16 & 255) / 255, cg = (col >> 8 & 255) / 255, cb = (col & 255) / 255;
      [[0, 0], [0, 1], [1, 1], [1, 0]].forEach((v) => { p.push(x + v[0] * s, y + d * 0.004, z + v[1] * s); c.push(cr, cg, cb); ph.push(a); rg.push(d); });
      idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
    if (!p.length) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(new Array(p.length).fill(0).map((_, j) => (j % 3 === 1 ? 1 : 0)), 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(c, 3));
    g.setAttribute('aPh', new THREE.Float32BufferAttribute(ph, 1));
    g.setAttribute('aRing', new THREE.Float32BufferAttribute(rg, 1));
    g.setIndex(p.length / 3 > 65535 ? new THREE.Uint32BufferAttribute(idx, 1) : new THREE.Uint16BufferAttribute(idx, 1));
    g.computeBoundingSphere(); g.computeBoundingBox();
    return g;
  }
  let foamMat = null;
  function foamMaterial() {
    if (foamMat) return foamMat;
    const m = new THREE.MeshBasicMaterial({ vertexColors: true });
    m.onBeforeCompile = (sh) => {
      sh.uniforms.uFoamT = foamT;
      sh.vertexShader = 'attribute float aPh;\nattribute float aRing;\nvarying float vPh;\nvarying float vRing;\n' +
        sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n vPh = aPh; vRing = aRing;');
      sh.fragmentShader = 'uniform float uFoamT;\nvarying float vPh;\nvarying float vRing;\n' +
        sh.fragmentShader.replace('void main() {', [
          'void main() {',
          '  float t = uFoamT;',
          '  if (vRing < 1.5) { if (fract(vPh * 0.083 + t * 0.045) < 0.13) discard; }',
          '  else if (vRing < 2.5) {',
          '    float breathe = sin(t * 1.25 + vPh * 0.021);',
          '    if (breathe < -0.15 || fract(vPh * 0.147 - t * 0.06) < 0.42) discard;',
          '  } else {',
          '    float breathe = sin(t * 0.9 + vPh * 0.017 + 2.0);',
          '    if (breathe < 0.45 || fract(vPh * 0.211 + t * 0.05) < 0.62) discard;',
          '  }'
        ].join('\n'));
    };
    m.customProgramCacheKey = () => 'glt-shore-foam';
    outline(m, 'none');
    m.userData.gltWorld = true;
    m.userData.gltShared = true;
    foamMat = m;
    return m;
  }
  // merge geometries keeping EVERY attribute of the first one (GLT.voxel.mergeGeometries keeps only the standard ones)
  function mergeAll(geoms) {
    geoms = geoms.filter(Boolean);
    if (!geoms.length) return null;
    if (geoms.length === 1) return geoms[0];
    const names = Object.keys(geoms[0].attributes).filter((n) => geoms.every((g) => g.getAttribute(n)));
    const out = new THREE.BufferGeometry();
    let total = 0, icount = 0;
    geoms.forEach((g) => { total += g.getAttribute('position').count; icount += g.getIndex().count; });
    names.forEach((n) => {
      const sz = geoms[0].getAttribute(n).itemSize;
      const arr = new Float32Array(total * sz);
      let o = 0;
      geoms.forEach((g) => { const a = g.getAttribute(n).array; arr.set(a, o); o += a.length; });
      out.setAttribute(n, new THREE.BufferAttribute(arr, sz));
    });
    const idx = total > 65535 ? new Uint32Array(icount) : new Uint16Array(icount);
    let off = 0, w = 0;
    geoms.forEach((g) => { const ix = g.getIndex(); for (let i = 0; i < ix.count; i++) idx[w++] = ix.getX(i) + off; off += g.getAttribute('position').count; g.dispose(); });
    out.setIndex(new THREE.BufferAttribute(idx, 1));
    out.computeBoundingSphere(); out.computeBoundingBox();
    return out;
  }
  function foamMesh(isLand, i0, i1, k0, k1, s, ox, oz, o) {
    const g = Array.isArray(isLand) ? mergeAll(isLand) : foamGeometry(isLand, i0, i1, k0, k1, s, ox, oz, o);
    if (!g) return null;
    if (Array.isArray(isLand)) o = i0;
    const mesh = new THREE.Mesh(g, foamMaterial());
    mesh.name = (o && o.name) || 'shore-foam';
    mesh.receiveShadow = false; mesh.castShadow = false;
    return mesh;
  }

  GLT._world_kit = {
    foamGeometry, foamMaterial, foamMesh, foamT, mergeAll,
    hex, mix, shade, easeInOutCubic, easeOutBack, clamp, smooth, rng, hash3, noise2,
    batch() { return new Batch(); }, vox(size) { return new Vox(size); },
    glyphPixels, glyphWidth, GLYPHS,
    mat, outline, updateGlow, nightFactor, stormFactor, reduced, disposeObj, canvasTexture, voxGeometry,
    acc, addVox, addBatch, flush, mtx, inst, setInst, setCol, t, streakTexture, flowMaterial, vb, greedy, build, cullSphere
  };
})();
