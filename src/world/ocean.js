/* GLT.ocean: the open sea around the plates and the sky behind everything. Area: world. Contract: ARCHITECTURE.md §11.1.
 *
 * - Sea: one merged mesh (tensor grid, 2 m cells near the plates, coarser outside) with vertex colours that encode
 *   teal shallows around the plate bases and darker deep water further out, an emissive glint map that drifts with
 *   game time, and a radial haze fade (onBeforeCompile) so the disc melts into the sky at its edge.
 * - Wave crests: instanced foam dashes that grow, drift and fade (one draw call).
 * - Sky: a full-screen shader quad behind everything (depth = far): vertical gradient anchored to the projected ocean
 *   edge (an orthographic camera has no real horizon), drifting pixel clouds that turn with the camera azimuth, crisp
 *   1-texel stars at night and a sun / moon disc placed from the light's azimuth.
 * Everything animates from GLT.clock time (deterministic under ?t=). */
(function () {
  'use strict';
  const GLT = (globalThis.GLT = globalThis.GLT || {});

  const R_OCEAN = 470;
  const SEAS = {
    calmo:      { deep: '#0c2244', far: '#12325e', mid: '#1e5a92', light: '#2471a8', shallow: '#33978e', shallow2: '#6ad0bc', crest: 0.8 },
    grandline:  { deep: '#0c2244', far: '#12325e', mid: '#18457a', light: '#1e5a92', shallow: '#1d6670', shallow2: '#33978e', crest: 1.0 },
    novomundo:  { deep: '#071428', far: '#0c2244', mid: '#12325e', light: '#18457a', shallow: '#123c40', shallow2: '#1d6670', crest: 1.1 },
    tempestade: { deep: '#1f262e', far: '#1f262e', mid: '#363f46', light: '#525d63', shallow: '#1d6670', shallow2: '#33978e', crest: 1.6 }
  };
  // Underwater shelf bands around the plates, near -> far, then drop-off line and boulders: palette colours only
  // (each band snaps flat under any light, see shelfAlbedo), stepping from lagoon teal down to the open sea.
  const SHELVES = {
    calmo:      ['#64acb6', '#428ea4', '#2d7493', '#205f86', '#367064'],
    grandline:  ['#428ea4', '#2d7493', '#205f86', '#174e78', '#255553'],
    novomundo:  ['#205f86', '#174e78', '#103e68', '#0a3157', '#103e68'],
    tempestade: ['#4f6266', '#435068', '#2f3e43', '#283044', '#255553']
  };

  const S = { ok: false, sea: 'calmo', root: null, seaMesh: null, seaMat: null, glintTex: null, crests: null, crestData: null,
    sky: null, skyMat: null, offs: [], v3: null, v3b: null, dummy: null, tod: 'day' };

  function K() { return GLT._world_kit; }

  // distance from (x,z) to the nearest plate rim rectangle (0 inside)
  function rimDist(x, z) {
    const L = GLT.layout, n = L.size();
    let d = Infinity;
    ['own', 'enemy'].forEach((p) => {
      const b = L.rimBounds(p, n);
      const dx = Math.max(b.minX - x, 0, x - b.maxX), dz = Math.max(b.minZ - z, 0, z - b.maxZ);
      d = Math.min(d, Math.hypot(dx, dz));
    });
    return d;
  }

  function axis() {
    const a = [];
    for (let v = -R_OCEAN; v < -110; v += 24) a.push(v);
    for (let v = -110; v < 110; v += 2) a.push(v);
    for (let v = 110; v <= R_OCEAN; v += 24) a.push(v);
    if (a[a.length - 1] < R_OCEAN) a.push(R_OCEAN);
    return a;
  }

  function seaColor(x, z, pal) {
    const k = K();
    const d = rimDist(x, z);
    const r = Math.hypot(x, z);
    const n = k.noise2(x * 0.08, z * 0.08, 7) * 0.5 + k.noise2(x * 0.021, z * 0.021, 11) * 0.5;
    // the shelves near the plates are drawn per pixel in the shader (crisp bands); vertices carry the open sea
    let c = d < 30 ? k.hex(pal.mid) : k.mix(pal.mid, pal.far, k.smooth(30, 150, d + n * 30));
    if (r > 160) c = k.mix(c, pal.deep, k.smooth(160, 360, r));
    return c;
  }

  function buildSea() {
    const k = K();
    const xs = axis(), zs = axis();
    const nx = xs.length, nz = zs.length;
    const pos = new Float32Array(nx * nz * 3), nor = new Float32Array(nx * nz * 3), col = new Float32Array(nx * nz * 3), uv = new Float32Array(nx * nz * 2);
    for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
      const o = j * nx + i;
      pos[o * 3] = xs[i]; pos[o * 3 + 1] = GLT.C.OCEAN_Y; pos[o * 3 + 2] = zs[j];
      nor[o * 3 + 1] = 1;
      uv[o * 2] = xs[i] / 16; uv[o * 2 + 1] = -zs[j] / 16;
    }
    const idx = [];
    for (let j = 0; j < nz - 1; j++) for (let i = 0; i < nx - 1; i++) {
      const a = j * nx + i, b = a + 1, c = a + nx, d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    g.setIndex(nx * nz > 65535 ? new THREE.Uint32BufferAttribute(idx, 1) : new THREE.Uint16BufferAttribute(idx, 1));
    g.computeBoundingSphere();
    S.glintTex = glintTexture();
    const m = new THREE.MeshLambertMaterial({ vertexColors: true, emissive: new THREE.Color(0x6ec4d2), emissiveMap: S.glintTex, emissiveIntensity: 0.55 });
    m.userData.uHaze = { value: new THREE.Color(0x8fd0ff) };
    m.userData.uHazeR = { value: new THREE.Vector2(300, R_OCEAN - 10) };
    // Underwater shelves (Sea of Stars look): crisp, noise-edged colour bands computed per pixel from the distance to
    // each plate's grid rectangle, so the submerged terraces read through the water with a darker drop-off line and a
    // few sunken boulders, instead of a soft vertex gradient.
    const U = m.userData;
    U.uGridA = { value: new THREE.Vector4(-54, -14, -20, 20) };
    U.uGridB = { value: new THREE.Vector4(14, 54, -20, 20) };
    U.uLift = { value: 0 };
    U.uShelf = { value: [new THREE.Color(), new THREE.Color(), new THREE.Color(), new THREE.Color(), new THREE.Color()] };
    m.onBeforeCompile = (sh) => {
      sh.uniforms.uHaze = U.uHaze;
      sh.uniforms.uHazeR = U.uHazeR;
      sh.uniforms.uGridA = U.uGridA; sh.uniforms.uGridB = U.uGridB; sh.uniforms.uShelf = U.uShelf; sh.uniforms.uLift = U.uLift;
      sh.vertexShader = 'varying vec3 vGltW;\n' + sh.vertexShader.replace('#include <project_vertex>', '#include <project_vertex>\n vGltW = (modelMatrix * vec4(transformed, 1.0)).xyz;');
      sh.fragmentShader = [
        'uniform vec3 uHaze;', 'uniform vec2 uHazeR;', 'varying vec3 vGltW;', 'uniform vec4 uGridA;', 'uniform vec4 uGridB;', 'uniform vec3 uShelf[5];', 'uniform float uLift;',
        'float oH(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }',
        'float oN(vec2 p) { vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);',
        '  return mix(mix(oH(i), oH(i + vec2(1.0, 0.0)), f.x), mix(oH(i + vec2(0.0, 1.0)), oH(i + vec2(1.0, 1.0)), f.x), f.y); }',
        'float rectD(vec2 p, vec4 b) { vec2 d = max(vec2(b.x - p.x, b.z - p.y), vec2(p.x - b.y, p.y - b.w)); return length(max(d, 0.0)); }',
        sh.fragmentShader
      ].join('\n')
        .replace('#include <color_fragment>', [
          '#include <color_fragment>',
          '{',
          '  vec2 q = floor(vGltW.xz * 2.0) * 0.5;',                  // 0.5 m texels, like the plate voxels
          '  float dg = min(rectD(q, uGridA), rectD(q, uGridB));',
          '  float n1 = oN(q * 0.11) - 0.5, n2 = oN(q * 0.031 + 7.0) - 0.5;',
          '  float e0 = 10.4 + n1 * 2.2, e1 = 15.0 + n1 * 3.5 + n2 * 6.0, e2 = 26.0 + n2 * 14.0 + n1 * 3.0;',
          '  if (dg < e0) diffuseColor.rgb = uShelf[0];',
          '  else if (dg < e1) diffuseColor.rgb = (oN(q * 0.27 + 3.0) > 0.74) ? uShelf[4] : uShelf[1];',
          '  else if (dg < e1 + 1.0) diffuseColor.rgb = uShelf[4];',
          '  else if (dg < e2) diffuseColor.rgb = (oN(q * 0.19 + 11.0) > 0.8) ? uShelf[3] : uShelf[2];',
          '  else if (dg < e2 + 1.0) diffuseColor.rgb = uShelf[3];',
          '}'
        ].join('\n'))
        .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n totalEmissiveRadiance += diffuseColor.rgb * uLift;')
        .replace('#include <dithering_fragment>', '#include <dithering_fragment>\n gl_FragColor.rgb = mix(gl_FragColor.rgb, uHaze, smoothstep(uHazeR.x, uHazeR.y, length(vGltW.xz)));');
    };
    m.customProgramCacheKey = () => 'glt-ocean-haze';
    k.outline(m, 'water');
    const mesh = new THREE.Mesh(g, m);
    mesh.name = 'ocean-sea';
    mesh.receiveShadow = true;
    mesh.renderOrder = -1;
    S.seaMesh = mesh; S.seaMat = m;
    recolorSea();
    return mesh;
  }

  function effectivePalette() {
    const base = SEAS[S.sea] || SEAS.calmo;
    if (S.tod !== 'storm' || S.sea === 'tempestade') return base;
    // a storm over any sea: churn the open water toward the slate tempest palette, keep the plate shallows
    const k = K(), st = SEAS.tempestade, o = {};
    Object.keys(base).forEach((key) => { o[key] = typeof base[key] === 'string' ? k.mix(base[key], st[key], key.indexOf('shallow') === 0 ? 0.35 : 0.65) : base[key]; });
    return o;
  }

  function recolorSea() {
    if (!S.seaMesh) return;
    const pal = effectivePalette();
    const k = K();
    const U = S.seaMat.userData;
    // each shelf band is ONE palette colour, lit-exact every frame (shelfAlbedo), so the bands snap flat, no dither
    const sh = SHELVES[S.tod === 'storm' ? 'tempestade' : S.sea] || SHELVES.calmo;
    S.shelfHex = sh.map((h) => snapHex(k.hex(h)));
    shelfAlbedo();
    const L = GLT.layout, n = L.size();
    const ga = L.gridBounds('own', n), gb = L.gridBounds('enemy', n);
    U.uGridA.value.set(ga.minX, ga.maxX, ga.minZ, ga.maxZ);
    U.uGridB.value.set(gb.minX, gb.maxX, gb.minZ, gb.maxZ);
    const g = S.seaMesh.geometry;
    const p = g.getAttribute('position'), c = g.getAttribute('color');
    for (let i = 0; i < p.count; i++) {
      const h = seaColor(p.getX(i), p.getZ(i), pal);
      c.setXYZ(i, (h >> 16 & 255) / 255, (h >> 8 & 255) / 255, (h & 255) / 255);
    }
    c.needsUpdate = true;
  }

  function snapHex(h) {
    return GLT.palette && GLT.palette.snap ? GLT.palette.snap(h) : h;
  }
  // albedo that lands on the shelf's palette colour under the current light, including the emissive lift (uLift)
  const tmpE = [0, 0, 0];
  function shelfAlbedo() {
    if (!S.seaMat || !S.shelfHex) return;
    const Lt = GLT.lighting, U = S.seaMat.userData;
    const lift = U.uLift.value;
    if (Lt && Lt.sunlit) Lt.sunlit(tmpE);
    S.shelfHex.forEach((h, i) => {
      if (!Lt || !Lt.albedoFor) { U.uShelf.value[i].setHex(h); return; }
      const a = Lt.albedoFor(h);
      U.uShelf.value[i].setRGB(a[0] * tmpE[0] / (tmpE[0] + lift), a[1] * tmpE[1] / (tmpE[1] + lift), a[2] * tmpE[2] / (tmpE[2] + lift));
    });
  }

  function glintTexture() {
    const W = 64, cv = document.createElement('canvas');
    cv.width = W; cv.height = W;
    const g = cv.getContext('2d');
    g.fillStyle = '#000'; g.fillRect(0, 0, W, W);
    const r = K().rng(91, 'glint');
    for (let i = 0; i < 9; i++) {
      const x = r.int(W), y = r.int(W), len = 2 + r.int(4);
      const b = r.chance(0.25) ? '#c8e8f0' : '#5a6a70';
      g.fillStyle = b;
      g.fillRect(x, y, len, 1);
      if (r.chance(0.4)) g.fillRect(x + 1, y - 1, Math.max(1, len - 2), 1);
    }
    const t = K().canvasTexture(cv);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    return t;
  }

  // ---- wave crests: instanced foam dashes ----
  function buildCrests() {
    const k = K();
    const b = k.batch();
    // Sea of Stars style wavelet: a light-teal dash with a darker trough line under it and a tiny white cap
    b.box(-0.75, 0, -0.12, 0.45, 0.08, 0.12, '#7fd0e2');
    b.box(0.45, 0, -0.12, 0.75, 0.09, 0.12, '#e0f6f0');
    b.box(-0.45, 0, 0.12, 0.35, 0.07, 0.36, '#2471a8');
    const geo = b.geometry();
    const N = 260;
    // k.inst gives the mesh an all-white instanceColor: 'water' is shared with the instanced plate cells, and three r128
    // reuses one program per material, so a crest mesh without instanceColor would crash in WebGLBindingStates.
    const m = k.inst(geo, k.mat('water'), N, { name: 'ocean-crests' });
    const r = k.rng(5, 'crests');
    const data = [];
    let tries = 0;
    while (data.length < N && tries < 6000) {
      tries++;
      const ang = r.next() * Math.PI * 2, rad = 12 + Math.pow(r.next(), 0.8) * 190;
      const x = Math.sin(ang) * rad, z = Math.cos(ang) * rad * 0.8;
      if (rimDist(x, z) < 4) continue;
      data.push({ x, z, ph: r.next() * 10, per: 3.5 + r.next() * 3.5, yaw: (r.next() - 0.5) * 0.5, s: 0.7 + r.next() * 0.9 });
    }
    m.count = data.length;
    S.crestData = data;
    S.crests = m;
    return m;
  }

  function updateCrests(t) {
    const m = S.crests;
    if (!m) return;
    const pal = SEAS[S.sea] || SEAS.calmo;
    const arr = m.instanceMatrix.array;
    const d = S.crestData;
    const amp = pal.crest;
    for (let i = 0; i < d.length; i++) {
      const c = d[i];
      const ph = ((t + c.ph) % c.per) / c.per;          // 0..1
      const life = Math.sin(Math.min(1, ph * 1.6) * Math.PI);
      const sc = ph < 0.62 ? Math.max(0.001, life * c.s * amp) : 0.001;
      const x = c.x + ph * 2.2, z = c.z + ph * 0.6;
      const cs = Math.cos(c.yaw) * sc, sn = Math.sin(c.yaw) * sc;
      const o = i * 16;
      arr[o] = cs; arr[o + 1] = 0; arr[o + 2] = -sn; arr[o + 3] = 0;
      arr[o + 4] = 0; arr[o + 5] = 1; arr[o + 6] = 0; arr[o + 7] = 0;
      arr[o + 8] = sn * 0.9; arr[o + 9] = 0; arr[o + 10] = cs * 0.9; arr[o + 11] = 0;
      arr[o + 12] = x; arr[o + 13] = GLT.C.OCEAN_Y + 0.02; arr[o + 14] = z; arr[o + 15] = 1;
    }
    m.instanceMatrix.needsUpdate = true;
  }

  // ---- sky quad ----
  const SKY_VERT = [
    'varying vec2 vNdc;',
    'void main() { vNdc = position.xy; gl_Position = vec4(position.xy, 0.99999, 1.0); }'
  ].join('\n');
  const SKY_FRAG = [
    'uniform vec3 uTop; uniform vec3 uHorizon; uniform vec3 uHaze; uniform vec3 uCloud; uniform vec3 uCloudShadow;',
    'uniform float uHorizonY; uniform float uNight; uniform float uStorm; uniform vec2 uRes; uniform float uAz; uniform float uTime;',
    'uniform vec3 uSun; uniform vec3 uSunCol;',
    'varying vec2 vNdc;',
    'float h21(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }',
    'float vn(vec2 p) { vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);',
    '  float a = h21(i), b = h21(i + vec2(1.0, 0.0)), c = h21(i + vec2(0.0, 1.0)), d = h21(i + vec2(1.0, 1.0));',
    '  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y); }',
    'float fbm(vec2 p) { return vn(p) * 0.55 + vn(p * 2.1 + 3.7) * 0.3 + vn(p * 4.3 + 9.1) * 0.15; }',
    'void main() {',
    '  vec2 px = floor(gl_FragCoord.xy);',
    '  float y = vNdc.y;',
    '  float above = y - uHorizonY;',
    '  vec3 col;',
    '  if (above < 0.0) { col = uHaze; }',
    '  else {',
    '    float k = clamp(above / 1.1, 0.0, 1.0);',
    '    col = mix(uHorizon, uTop, pow(k, 0.75));',
    '    float az = uAz / 360.0;',
    '    vec2 cp = vec2(px.x / uRes.y * 2.2 + az * 7.0 + uTime * 0.004, above * 3.0);',
    '    float cl = fbm(cp * vec2(2.2, 4.5)) - smoothstep(0.0, 0.9, above) * 0.35 - 0.33 + uStorm * 0.25;',
    '    float sh = fbm(cp * vec2(2.2, 4.5) + vec2(0.0, -0.06));',
    '    if (cl > 0.12) col = mix(uCloudShadow, uCloud, step(0.47, sh + (cl - 0.12)));',
    '    else if (cl > 0.07) col = mix(col, uCloudShadow, 0.5);',
    '    if (uNight > 0.01 && cl < 0.05) {',
    '      vec2 sp = vec2(px.x + floor(uAz * uRes.x / 90.0), px.y);',
    '      float s = h21(sp);',
    '      if (s > 0.9955) { float tw = 0.55 + 0.45 * sin(uTime * 2.3 + s * 900.0); col = mix(col, vec3(1.0, 0.97, 0.88), uNight * tw * smoothstep(0.02, 0.2, above)); }',
    '    }',
    '  }',
    '  if (uSun.z > 0.0) {',
    '    vec2 d = (vNdc - uSun.xy) * uRes * 0.5;',
    '    float r = length(d);',
    '    if (r < uSun.z) col = uSunCol;',
    '    else if (r < uSun.z + 2.0) col = mix(col, uSunCol, 0.55);',
    '    else if (r < uSun.z * 2.6) col = mix(col, uSunCol, 0.18);',
    '  }',
    '  gl_FragColor = vec4(col, 0.25);',
    '}'
  ].join('\n');

  function buildSky() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0], 3));
    g.setIndex([0, 1, 2, 0, 2, 3]);
    const C = (h) => new THREE.Color(h);
    const m = new THREE.ShaderMaterial({
      vertexShader: SKY_VERT, fragmentShader: SKY_FRAG, depthWrite: false, depthTest: true, fog: false,
      uniforms: {
        uTop: { value: C(0x3a78d0) }, uHorizon: { value: C(0x8cbff0) }, uHaze: { value: C(0x8cbff0) },
        uCloud: { value: C(0xfffdf7) }, uCloudShadow: { value: C(0xc8d0e4) },
        uHorizonY: { value: 0 }, uNight: { value: 0 }, uStorm: { value: 0 }, uRes: { value: new THREE.Vector2(640, 360) },
        uAz: { value: 0 }, uTime: { value: 0 }, uSun: { value: new THREE.Vector3(0, 0, 0) }, uSunCol: { value: C(0xffd86a) }
      }
    });
    m.userData.gltOutline = 'none';
    const mesh = new THREE.Mesh(g, m);
    mesh.frustumCulled = false;
    mesh.renderOrder = -10;
    mesh.name = 'ocean-sky';
    S.sky = mesh; S.skyMat = m;
    return mesh;
  }

  // Sky / haze colours per time of day (palette hexes; the post pass snaps anyway).
  const SKY = {
    day:   { top: 0x3a78d0, hor: 0xc4e2f8, haze: 0x8cbff0, cloud: 0xfffdf7, cs: 0xc8d0e4, sun: 0xfff2d8, sunR: 0 },
    dusk:  { top: 0x3a2858, hor: 0xfbbe7e, haze: 0xd8686a, cloud: 0xf0a8a8, cs: 0xa2486e, sun: 0xffd86a, sunR: 9 },
    night: { top: 0x071428, hor: 0x263c78, haze: 0x172654, cloud: 0x3a5494, cs: 0x263c78, sun: 0xe0f6f0, sunR: 5 },
    storm: { top: 0x1f262e, hor: 0x788488, haze: 0x525d63, cloud: 0x788488, cs: 0x363f46, sun: 0, sunR: 0 }
  };

  function applyTod() {
    if (!S.skyMat) return;
    const tod = GLT.lighting && GLT.lighting.tod ? GLT.lighting.tod() : 'day';
    const wasStorm = S.tod === 'storm';
    S.tod = tod;
    if (wasStorm !== (tod === 'storm')) recolorSea();
    const p = SKY[tod] || SKY.day;
    const u = S.skyMat.uniforms;
    u.uTop.value.setHex(p.top); u.uHorizon.value.setHex(p.hor); u.uHaze.value.setHex(p.haze);
    u.uCloud.value.setHex(p.cloud); u.uCloudShadow.value.setHex(p.cs); u.uSunCol.value.setHex(p.sun);
    if (S.seaMat) {
      S.seaMat.userData.uHaze.value.setHex(p.haze);
      S.glintBase = tod === 'night' ? 0.3 : tod === 'storm' ? 0.18 : tod === 'dusk' ? 0.45 : 0.36;
      S.seaMat.emissiveIntensity = S.glintBase;
      // luminous night / storm lagoon: the water lights itself a little so the shelves still read (Sea of Stars nights)
      S.seaMat.userData.uLift.value = tod === 'night' ? 0.3 : tod === 'storm' ? 0.18 : tod === 'dusk' ? 0.12 : 0;
      S.seaMat.emissive.setHex(tod === 'dusk' ? 0xfbbe7e : tod === 'night' ? 0x3a5494 : 0x6ec4d2);
    }
  }

  function updateSky(t) {
    const cam = GLT.camera && GLT.camera.three ? GLT.camera.three() : null;
    if (!cam || !S.skyMat) return;
    const u = S.skyMat.uniforms;
    const sz = GLT.renderer.size();
    u.uRes.value.set(sz.w, sz.h);
    const az = GLT.camera.azimuth ? GLT.camera.azimuth() : GLT.camera.get().azimuth;
    u.uAz.value = az;
    u.uTime.value = t;
    u.uNight.value = K().nightFactor();
    u.uStorm.value = K().stormFactor();
    // horizon = projected ocean edge straight ahead of the camera
    const a = (az * Math.PI) / 180;
    const tg = cam.position;   // camera sits along (sin az, ., cos az) from its target
    const fx = -Math.sin(a), fz = -Math.cos(a);
    // project the point at distance R_OCEAN-20 from the origin along the forward direction
    S.v3.set(fx * (R_OCEAN - 25), GLT.C.OCEAN_Y, fz * (R_OCEAN - 25));
    if (S.root && S.root.parent) S.v3.applyMatrix4(S.root.matrixWorld);   // hosted: the world sits in a scaled group
    S.v3.project(cam);
    u.uHorizonY.value = S.v3.y;
    // sun / moon disc from the light's horizontal direction relative to the view
    const p = SKY[S.tod] || SKY.day;
    const sun = GLT.lighting && GLT.lighting.sun ? GLT.lighting.sun() : null;
    if (sun && p.sunR > 0) {
      let sx = sun.position.x, sz2 = sun.position.z;
      if (S.tod === 'night') { sx = -sx; sz2 = -sz2; }          // the moon hangs opposite the key light
      const L = Math.hypot(sx, sz2) || 1;
      sx /= L; sz2 /= L;
      const dot = sx * fx + sz2 * fz;
      const cross = fx * sz2 - fz * sx;
      if (dot > 0.25) {
        const rel = Math.atan2(cross, dot);
        u.uSun.value.set(-rel / 1.0, Math.min(0.92, S.v3.y + 0.16 + (S.tod === 'night' ? 0.3 : 0.05)), p.sunR);
      } else u.uSun.value.set(0, 0, 0);
    } else u.uSun.value.set(0, 0, 0);
    void tg;
  }

  function onFrame(dt, t) {
    if (!S.ok) return;
    if (S.glintTex) S.glintTex.offset.set((t * 0.011) % 1, (t * 0.004) % 1);
    K().foamT.value = t;
    // glint dashes are 0.25 m texels: fade them out when zoomed far out, where they would alias into a starfield
    if (S.seaMat && GLT.camera && GLT.camera.worldPerPixel) {
      const wpp = GLT.camera.worldPerPixel();
      S.seaMat.emissiveIntensity = (S.glintBase || 0.55) * K().clamp((0.52 - wpp) / 0.26, 0, 1);
    }
    updateCrests(t);
    updateSky(t);
    shelfAlbedo();
    const tod = GLT.lighting && GLT.lighting.tod ? GLT.lighting.tod() : 'day';
    if (tod !== S.tod) applyTod();
  }

  function init() {
    if (S.ok) return true;
    if (typeof THREE === 'undefined' || !GLT.scene || !GLT.scene.root() || !GLT._world_kit) return false;
    S.v3 = new THREE.Vector3(); S.v3b = new THREE.Vector3();
    S.root = new THREE.Group();
    S.root.name = 'world-ocean';
    S.root.add(buildSky());
    S.root.add(buildSea());
    S.root.add(buildCrests());
    GLT.scene.add(S.root, 'world');
    S.ok = true;
    applyTod();
    updateCrests(GLT.clock());
    S.offs.push(GLT.clock.onFrame(onFrame, 120));
    S.offs.push(GLT.events.on('tod:changed', applyTod));
    S.offs.push(GLT.events.on('layout:changed', () => recolorSea()));
    S.offs.push(GLT.events.on('match:created', (e) => { if (e && e.rules && e.rules.sea) setSea(e.rules.sea); }));
    return true;
  }

  function setSea(sea) {
    S.sea = SEAS[sea] ? sea : 'calmo';
    recolorSea();
  }

  function dispose() {
    S.offs.forEach((f) => { try { f(); } catch (e) { /* ignore */ } });
    S.offs = [];
    if (S.root) K().disposeObj(S.root);
    S.root = null; S.ok = false;
  }

  GLT.ocean = {
    init, setSea, dispose,
    sea() { return S.sea; },
    seaColors(sea) { return Object.assign({}, SEAS[sea || S.sea] || SEAS.calmo); },
    radius() { return R_OCEAN; }
  };

  // Demo: open sea, shelves, shore foam, wavelets and the sky (low camera so the horizon and clouds show).
  GLT.demos = GLT.demos || {};
  GLT.demos['world.ocean'] = function (ctx) {
    GLT.layout.setSize(10);
    init();
    if (GLT.plates) { GLT.plates.init(); GLT.plates.build(10); }
    if (ctx.params && ctx.params.sea) setSea(ctx.params.sea);
    GLT.camera.set({ azimuth: 30, elevation: 15, zoom: 0.4, target: { x: 0, y: 20, z: -140 } }, { instant: true });
  };
})();
