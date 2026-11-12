/* GLT.voxel: voxel builder -> merged meshes (one per material class), instancing, shared materials.
 * Area: render. Contract: ARCHITECTURE.md §10.4. Voxel (x,y,z) occupies [x*s,(x+1)*s] on each axis.
 *
 * build() emits the exposed voxel faces (hidden faces culled). Faces whose four corners share one AO level are greedily
 * merged per direction/slice into rectangles of one colour (o.greedy, default true; o.maxRun caps a side, default 8
 * voxels, so per-vertex point lights still interpolate sensibly). On software GL the cost is per triangle, so this
 * cuts typical models 3-6x. Corners are exact multiples of the voxel size, so the merged edges stay watertight in
 * practice. Faces with an AO gradient (o.ao, 0..1, default 0.45, darkens inner corners) stay single quads, split along
 * the brighter diagonal so AO stays smooth.
 * Material classes and their post-pass outline class (renderer.markMaterial):
 *   'solid'    Lambert, vertex colours, outlines            -> 'full'
 *   'emissive' Basic, vertex colours (lanterns, fire)       -> 'glow' (not outlined, not darkened by the night grade)
 *   'glass'    Lambert, transparent 0.55, keeps the target's alpha flag
 * material(cls, { outline: 'full'|'glow'|'water'|'none', ...THREE material params }) returns a cached shared material. */
(function () {
  'use strict';
  const GLT = (globalThis.GLT = globalThis.GLT || {});

  const CLASSES = ['solid', 'emissive', 'glass'];
  const CLS_ID = { solid: 0, emissive: 1, glass: 2 };
  const DEFAULT_OUTLINE = { solid: 'full', emissive: 'glow', glass: 'none' };
  const matCache = {};

  function toHex(color) {
    if (typeof color === 'number') return color >>> 0;
    if (typeof color === 'string' && color.charAt(0) === '#') return parseInt(color.slice(1), 16) >>> 0;
    return GLT.palette.get(color);
  }

  function material(cls, o) {
    cls = CLS_ID[cls] != null ? cls : 'solid';
    const key = cls + (o ? JSON.stringify(o) : '');
    if (matCache[key]) return matCache[key];
    const params = Object.assign({}, o || {});
    const outline = params.outline || DEFAULT_OUTLINE[cls];
    delete params.outline;
    let m;
    if (cls === 'emissive') m = new THREE.MeshBasicMaterial(Object.assign({ vertexColors: true }, params));
    else if (cls === 'glass') {
      m = new THREE.MeshLambertMaterial(Object.assign({
        vertexColors: true, transparent: true, opacity: 0.55, depthWrite: false,
        blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.SrcAlphaFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
        blendSrcAlpha: THREE.ZeroFactor, blendDstAlpha: THREE.OneFactor
      }, params));
    } else m = new THREE.MeshLambertMaterial(Object.assign({ vertexColors: true }, params));
    if (GLT.renderer && GLT.renderer.markMaterial) GLT.renderer.markMaterial(m, outline);
    m.userData.gltShared = true;
    matCache[key] = m;
    return m;
  }

  // Face table: normal, 4 corners (CCW from outside), and for each corner the two in-plane directions used by AO.
  const FACES = [
    { n: [1, 0, 0], q: [[1, 0, 0], [1, 1, 0], [1, 1, 1], [1, 0, 1]] },
    { n: [-1, 0, 0], q: [[0, 0, 1], [0, 1, 1], [0, 1, 0], [0, 0, 0]] },
    { n: [0, 1, 0], q: [[0, 1, 1], [1, 1, 1], [1, 1, 0], [0, 1, 0]] },
    { n: [0, -1, 0], q: [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]] },
    { n: [0, 0, 1], q: [[1, 0, 1], [1, 1, 1], [0, 1, 1], [0, 0, 1]] },
    { n: [0, 0, -1], q: [[0, 0, 0], [0, 1, 0], [1, 1, 0], [1, 0, 0]] }
  ];
  // per face/corner: offsets (relative to the voxel, already stepped along the normal) of side1, side2, corner
  FACES.forEach((f) => {
    f.axis = f.n[0] !== 0 ? 0 : (f.n[1] !== 0 ? 1 : 2);
    const inPlane = [0, 1, 2].filter((a) => a !== f.axis);
    f.u = inPlane[0]; f.v = inPlane[1];
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

  const OFF = 512, SPAN = 1024;
  const keyOf = (x, y, z) => ((x + OFF) * SPAN + (y + OFF)) * SPAN + (z + OFF);

  function builder(o) {
    const s = (o && o.size) || 0.25;
    const col = new Map();   // key -> hex
    const cls = new Map();   // key -> class id (only non-solid stored)
    const api = {
      set(x, y, z, color, c) {
        const k = keyOf(x | 0, y | 0, z | 0);
        col.set(k, toHex(color));
        const id = CLS_ID[c] || 0;
        if (id) cls.set(k, id); else cls.delete(k);
        return api;
      },
      box(x0, y0, z0, x1, y1, z1, color, c) {
        const hex = toHex(color);
        const id = CLS_ID[c] || 0;
        const xa = Math.min(x0, x1) | 0, xb = Math.max(x0, x1) | 0;
        const ya = Math.min(y0, y1) | 0, yb = Math.max(y0, y1) | 0;
        const za = Math.min(z0, z1) | 0, zb = Math.max(z0, z1) | 0;
        for (let x = xa; x <= xb; x++) for (let y = ya; y <= yb; y++) for (let z = za; z <= zb; z++) {
          const k = keyOf(x, y, z);
          col.set(k, hex);
          if (id) cls.set(k, id); else cls.delete(k);
        }
        return api;
      },
      get(x, y, z) { const v = col.get(keyOf(x | 0, y | 0, z | 0)); return v === undefined ? null : v; },
      remove(x, y, z) { const k = keyOf(x | 0, y | 0, z | 0); col.delete(k); cls.delete(k); return api; },
      count() { return col.size; },
      forEach(fn) { col.forEach((hex, k) => { const z = (k % SPAN) - OFF; const y = (Math.floor(k / SPAN) % SPAN) - OFF; const x = Math.floor(k / (SPAN * SPAN)) - OFF; fn(x, y, z, hex, CLASSES[cls.get(k) || 0]); }); },
      build(bo) {
        const opt = Object.assign({ castShadow: true, receiveShadow: true, center: false, ao: 0.45 }, bo);
        const aoK = Math.max(0, Math.min(1, opt.ao || 0));
        let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
        const keys = [];
        col.forEach((hex, k) => {
          keys.push(k);
          const z = (k % SPAN) - OFF; const x = Math.floor(k / (SPAN * SPAN)) - OFF;
          if (x < minX) minX = x; if (x + 1 > maxX) maxX = x + 1; if (z < minZ) minZ = z; if (z + 1 > maxZ) maxZ = z + 1;
        });
        const ox = opt.center && keys.length ? -((minX + maxX) / 2) * s : 0;
        const oz = opt.center && keys.length ? -((minZ + maxZ) / 2) * s : 0;
        const buf = CLASSES.map(() => ({ p: [], n: [], c: [], i: [] }));
        const solidAt = (x, y, z) => { const k = keyOf(x, y, z); return col.has(k) && !cls.has(k); };
        const AO_LEVEL = [1, 1 - 0.18 * aoK, 1 - 0.32 * aoK, 1 - 0.46 * aoK];
        const tmp = new THREE.Color();
        const shades = [0, 0, 0, 0];
        const lv = [0, 0, 0, 0];
        const greedy = opt.greedy !== false;
        const maxRun = Math.max(1, opt.maxRun || 8);
        // minY: voxels below this y emit nothing and the bottom faces at y === minY are dropped (terrain under an
        // opaque water plane: never visible, never needed for shadows from above). Saves a quad per column.
        const minY = opt.minY != null ? opt.minY : -Infinity;
        const groups = new Map();   // (face, class, slice) -> [u, v, key, ...] of uniformly shaded faces
        const P3 = [0, 0, 0];
        for (let ki = 0; ki < keys.length; ki++) {
          const k = keys[ki];
          const z = (k % SPAN) - OFF; const y = (Math.floor(k / SPAN) % SPAN) - OFF; const x = Math.floor(k / (SPAN * SPAN)) - OFF;
          if (y < minY) continue;
          const myCls = cls.get(k) || 0;
          const hex = col.get(k);
          for (let fi = 0; fi < 6; fi++) {
            if (fi === 3 && y <= minY) continue;
            const f = FACES[fi];
            const nk = keyOf(x + f.n[0], y + f.n[1], z + f.n[2]);
            if (col.has(nk)) { const nc = cls.get(nk) || 0; if (nc === 0 || nc === myCls) continue; }
            for (let q = 0; q < 4; q++) {
              let l = 0;
              if (aoK > 0 && myCls === 0) {
                const a = f.ao[q];
                const s1 = solidAt(x + a[0][0], y + a[0][1], z + a[0][2]) ? 1 : 0;
                const s2 = solidAt(x + a[1][0], y + a[1][1], z + a[1][2]) ? 1 : 0;
                const cc = solidAt(x + a[2][0], y + a[2][1], z + a[2][2]) ? 1 : 0;
                l = s1 && s2 ? 3 : s1 + s2 + cc;
              }
              lv[q] = l;
            }
            if (greedy && lv[0] === lv[1] && lv[1] === lv[2] && lv[2] === lv[3]) {
              P3[0] = x; P3[1] = y; P3[2] = z;
              const gk = (fi * 4 + myCls) * 4096 + (P3[f.axis] + 2048);
              let g = groups.get(gk);
              if (!g) { g = []; groups.set(gk, g); }
              g.push(P3[f.u], P3[f.v], hex * 4 + lv[0]);
              continue;
            }
            const b = buf[myCls];
            tmp.setHex(hex);
            const base = b.p.length / 3;
            for (let q = 0; q < 4; q++) {
              const sh = AO_LEVEL[lv[q]];
              shades[q] = sh;
              const c = f.q[q];
              b.p.push((x + c[0]) * s + ox, (y + c[1]) * s, (z + c[2]) * s + oz);
              b.n.push(f.n[0], f.n[1], f.n[2]);
              b.c.push(tmp.r * sh, tmp.g * sh, tmp.b * sh);
            }
            if (shades[0] + shades[2] >= shades[1] + shades[3]) b.i.push(base, base + 1, base + 2, base, base + 2, base + 3);
            else b.i.push(base + 1, base + 2, base + 3, base + 1, base + 3, base);
          }
        }
        // Greedy merge: per face direction and slice, grow rectangles of identical colour+shade (capped at maxRun
        // voxels a side so per-vertex point lighting still interpolates well). Coordinates are exact multiples of the
        // voxel size, so the shared edges stay watertight in practice.
        groups.forEach((g, gk) => {
          const fi = Math.floor(gk / 16384), myCls = Math.floor(gk / 4096) % 4, slice = (gk % 4096) - 2048;
          const f = FACES[fi];
          const cells = new Map();
          const order = [];
          for (let i = 0; i < g.length; i += 3) {
            const uk = (g[i + 1] + 2048) * 4096 + (g[i] + 2048);
            cells.set(uk, g[i + 2]);
            order.push(uk);
          }
          order.sort((a, b) => a - b);   // by v, then u
          const b = buf[myCls];
          for (let oi = 0; oi < order.length; oi++) {
            const uk = order[oi];
            const ck = cells.get(uk);
            if (ck === undefined) continue;
            const u0 = (uk % 4096) - 2048, v0 = Math.floor(uk / 4096) - 2048;
            let w = 1;
            while (w < maxRun && cells.get(uk + w) === ck) w++;
            let h = 1;
            outer: while (h < maxRun) {
              const row = uk + h * 4096;
              for (let i = 0; i < w; i++) if (cells.get(row + i) !== ck) break outer;
              h++;
            }
            for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) cells.delete(uk + j * 4096 + i);
            const sh = AO_LEVEL[ck % 4];
            tmp.setHex(Math.floor(ck / 4));
            const base = b.p.length / 3;
            for (let q = 0; q < 4; q++) {
              const c = f.q[q];
              P3[f.axis] = slice + c[f.axis];
              P3[f.u] = u0 + c[f.u] * w;
              P3[f.v] = v0 + c[f.v] * h;
              b.p.push(P3[0] * s + ox, P3[1] * s, P3[2] * s + oz);
              b.n.push(f.n[0], f.n[1], f.n[2]);
              b.c.push(tmp.r * sh, tmp.g * sh, tmp.b * sh);
            }
            b.i.push(base, base + 1, base + 2, base, base + 2, base + 3);
          }
        });
        const group = new THREE.Group();
        CLASSES.forEach((c, ci) => {
          const B = buf[ci];
          if (!B.p.length) return;
          const g = new THREE.BufferGeometry();
          g.setAttribute('position', new THREE.Float32BufferAttribute(B.p, 3));
          g.setAttribute('normal', new THREE.Float32BufferAttribute(B.n, 3));
          g.setAttribute('color', new THREE.Float32BufferAttribute(B.c, 3));
          g.setIndex(B.p.length / 3 > 65535 ? new THREE.Uint32BufferAttribute(B.i, 1) : new THREE.Uint16BufferAttribute(B.i, 1));
          g.computeBoundingSphere();
          g.computeBoundingBox();
          const mesh = new THREE.Mesh(g, (opt.materials && opt.materials[c]) || material(c));
          mesh.name = 'voxel-' + c;
          mesh.castShadow = c !== 'glass' && c !== 'emissive' && !!opt.castShadow;
          mesh.receiveShadow = c !== 'emissive' && !!opt.receiveShadow;
          group.add(mesh);
        });
        return group;
      }
    };
    return api;
  }

  function mergeGeometries(geoms) {
    geoms = geoms.filter(Boolean);
    const names = ['position', 'normal', 'color', 'uv'].filter((n) => geoms.length && geoms.every((g) => g.getAttribute(n)));
    const out = new THREE.BufferGeometry();
    let total = 0;
    geoms.forEach((g) => { total += g.getAttribute('position').count; });
    names.forEach((n) => {
      const sz = geoms[0].getAttribute(n).itemSize;
      const arr = new Float32Array(total * sz);
      let o = 0;
      geoms.forEach((g) => { const a = g.getAttribute(n).array; arr.set(a, o); o += a.length; });
      out.setAttribute(n, new THREE.BufferAttribute(arr, sz));
    });
    let icount = 0;
    geoms.forEach((g) => { const ix = g.getIndex(); icount += ix ? ix.count : g.getAttribute('position').count; });
    const idx = total > 65535 ? new Uint32Array(icount) : new Uint16Array(icount);
    let off = 0, w = 0;
    geoms.forEach((g) => {
      const count = g.getAttribute('position').count;
      const ix = g.getIndex();
      if (ix) for (let i = 0; i < ix.count; i++) idx[w++] = ix.getX(i) + off;
      else for (let i = 0; i < count; i++) idx[w++] = i + off;
      off += count;
    });
    out.setIndex(new THREE.BufferAttribute(idx, 1));
    out.computeBoundingSphere();
    return out;
  }

  function instanced(geometry, mat, count) {
    const m = new THREE.InstancedMesh(geometry, mat, count);
    m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    return m;
  }

  function dispose(obj) {
    if (!obj) return;
    obj.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      const mats = o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : [];
      mats.forEach((m) => { if (!m.userData || !m.userData.gltShared) { if (m.map) m.map.dispose(); m.dispose(); } });
    });
    if (obj.parent) obj.parent.remove(obj);
  }

  GLT.voxel = { builder, material, mergeGeometries, instanced, dispose, CLASSES };
})();
