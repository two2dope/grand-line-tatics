/* GLT.renderer: WebGL, low-res target, post pass (depth outlines, crease highlights, water foam, colour grade,
 * OKLab palette snap with 4x4 Bayer dither), nearest upscale. Area: render. Contract: ARCHITECTURE.md §10.2.
 *
 * Pipeline per frame (priority 1000 clock subscriber):
 *   scene  -> low-res WebGLRenderTarget (w x h, RGBA8 colour + 24-bit depth texture)
 *   post   -> the canvas drawing buffer (also w x h); the canvas element is sized to exactly w*px x h*px CSS pixels
 *             with image-rendering: pixelated, so the browser does an integer nearest upscale.
 *   raw    -> the scene straight into the low-res canvas (no post).
 *
 * Material outline classes travel in the colour target's ALPHA (opaque NormalBlending materials write it as-is):
 *   alpha 1.0  'full'  : silhouette outlines + convex crease highlights + concave contact shading (default)
 *   alpha 0.75 'glow'  : emissive (lanterns, fire): no outlines and no grade, so it stays bright at night
 *   alpha 0.5  'water' : never outlined; crest line on the lip of each raised swell step; foam ring where it touches
 *                        'full' geometry
 *   alpha 0.25 'none'  : untouched (sky, beams, particles) - palette snap + dither only
 * Use GLT.renderer.markMaterial(material, 'water'|'none'|'full').
 *
 * The Bayer pattern is anchored to the camera's whole-texel offset (GLT.camera.snapOffset), so when the snapped
 * camera pans, the dither moves with the world instead of crawling. */
(function () {
  'use strict';
  const GLT = (globalThis.GLT = globalThis.GLT || {});

  const CLASS_ALPHA = { full: 1.0, glow: 0.75, water: 0.5, none: 0.25 };

  let r = null;
  let host = null;
  let px = 2;
  let post = { outlines: true, dither: true, raw: false };
  let size = { w: 1, h: 1, cssW: 1, cssH: 1, px: 2 };
  let resizeFns = [];
  let ro = null;
  let rt = null;
  let depthOk = false;
  let postScene = null, postCam = null, postMat = null;
  let lut = null;
  let hosted = null;            // { cssW, cssH } when attached to a host's WebGLRenderer (src/sea/bridge.js)
  const info = { calls: 0, triangles: 0, points: 0, lines: 0, geometries: 0, textures: 0, programs: 0, cpuMs: 0, frames: 0 };

  const VERT = [
    'varying vec2 vUv;',
    'void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }'
  ].join('\n');

  const FRAG = [
    'uniform sampler2D tColor;',
    'uniform sampler2D tDepth;',
    'uniform sampler2D tLut;',
    'uniform sampler2D tPal;',
    'uniform vec2 uRes;',
    'uniform vec2 uBayerOff;',
    'uniform float uNear;',
    'uniform float uFar;',
    'uniform float uSilT;',
    'uniform float uCreaseT;',
    'uniform float uFoamT;',
    'uniform float uEdges;',
    'uniform float uDither;',
    'uniform float uLutN;',
    'uniform float uLutTiles;',
    'uniform float uLutSize;',
    'uniform vec3 uGradeMul;',
    'uniform vec3 uGradeAdd;',
    'uniform float uSat;',
    'uniform float uVignette;',
    'uniform vec3 uVigColor;',
    'uniform vec3 uOutlineTint;',
    'uniform float uOutlineMix;',
    'uniform float uOutlineDark;',
    'uniform float uHighlight;',
    'uniform float uConcave;',
    'uniform vec3 uFoamColor;',
    'uniform float uFoamMix;',
    'uniform float uCrestT;',
    'uniform float uCrestMix;',
    'uniform float uRaw;',
    'varying vec2 vUv;',
    '',
    'float depthAt(vec2 p) { return uNear + texture2D(tDepth, p / uRes).x * (uFar - uNear); }',
    'vec4 colAt(vec2 p) { return texture2D(tColor, p / uRes); }',
    'float cls(float a) { return a > 0.875 ? 2.0 : (a > 0.625 ? 3.0 : (a > 0.375 ? 1.0 : 0.0)); }',
    'float bayer2(vec2 a) { a = floor(a); return fract(a.x * 0.5 + a.y * a.y * 0.75); }',
    'float bayer4(vec2 a) { return bayer2(0.5 * a) * 0.25 + bayer2(a); }',
    '',
    'vec3 snapPal(vec3 c, float th) {',
    '  c = clamp(c, 0.0, 1.0);',
    '  vec3 q = floor(c * (uLutN - 1.0) + 0.5);',
    '  float tx = mod(q.b, uLutTiles);',
    '  float ty = floor(q.b / uLutTiles + 0.0001);',
    '  vec2 uv = (vec2(tx * uLutN + q.r, ty * uLutN + q.g) + 0.5) / uLutSize;',
    '  vec4 L = texture2D(tLut, uv);',
    '  float ia = floor(L.r * 255.0 + 0.5);',
    '  float ib = floor(L.g * 255.0 + 0.5);',
    '  float idx = (uDither > 0.5 && L.b > th) ? ib : ia;',
    '  return texture2D(tPal, vec2((idx + 0.5) / 128.0, 0.5)).rgb;',
    '}',
    '',
    'void main() {',
    // low-res texel centre: equals gl_FragCoord when the drawing buffer is the low-res size (own canvas), and also
    // works when a host draws this pass into a full-size canvas (nearest upscale by sampling)
    '  vec2 p = floor(vUv * uRes) + 0.5;',
    '  vec4 c0 = colAt(p);',
    '  if (uRaw > 0.5) { gl_FragColor = vec4(c0.rgb, 1.0); return; }',
    '  vec3 col = c0.rgb;',
    '  float k = cls(c0.a);',
    '  bool glow = k > 2.5;',
    // uEdges is a pure uniform (outlines on and a depth texture), so software GL skips the whole block when off
    '  if (uEdges > 0.5) {',
    '    float dC = depthAt(p);',
    '    float dL = depthAt(p + vec2(-1.0, 0.0));',
    '    float dR = depthAt(p + vec2(1.0, 0.0));',
    '    float dD = depthAt(p + vec2(0.0, -1.0));',
    '    float dU = depthAt(p + vec2(0.0, 1.0));',
    // a 1-texel crack (T-junction of merged voxel faces, or a pin-hole): farther than all four neighbours.
    // Fill it from the left neighbour so it neither shows the background nor rings itself with outline.
    '    if (dC - max(max(dL, dR), max(dD, dU)) > uSilT) {',
    '      c0 = colAt(p + vec2(-1.0, 0.0)); col = c0.rgb; k = cls(c0.a); glow = k > 2.5;',
    '      dC = min(min(dL, dR), min(dD, dU));',
    '    }',
    '    if (k > 1.5 && k < 2.5) {',
    // silhouette: a neighbour is much farther AND so is the texel beyond it (a lone crack next door is not an edge)
    '      float sil = 0.0;',
    '      if (dL - dC > uSilT) { if (depthAt(p + vec2(-2.0, 0.0)) - dC > uSilT * 0.5) sil = 1.0; else dL = dC; }',
    '      if (dR - dC > uSilT) { if (depthAt(p + vec2(2.0, 0.0)) - dC > uSilT * 0.5) sil = 1.0; else dR = dC; }',
    '      if (dD - dC > uSilT) { if (depthAt(p + vec2(0.0, -2.0)) - dC > uSilT * 0.5) sil = 1.0; else dD = dC; }',
    '      if (dU - dC > uSilT) { if (depthAt(p + vec2(0.0, 2.0)) - dC > uSilT * 0.5) sil = 1.0; else dU = dC; }',
    '      if (sil > 0.5) {',
    '        col = mix(col * uOutlineDark, uOutlineTint, uOutlineMix);',
    '      } else {',
    // second derivatives of the (linear, ortho) depth: > 0 convex edge, < 0 concave corner
    '        float lx = dL + dR - 2.0 * dC;',
    '        float ly = dD + dU - 2.0 * dC;',
    '        if (ly > uCreaseT && dU > dC) col = col + (col * 0.6 + 0.03) * uHighlight;',          // lit upper lip
    '        else if (lx > uCreaseT * 1.6) col = col + (col * 0.6 + 0.03) * uHighlight * 0.5;',   // vertical corner
    '        else if ((-ly > uCreaseT && -ly < uSilT) || (-lx > uCreaseT && -lx < uSilT)) col = col * (1.0 - uConcave);',
    '      }',
    '    } else if (k > 0.5 && k < 1.5) {',
    // water: never outlined. Foam ring where it meets solid geometry at the same depth (left, right and above: the
    // contact below a water texel is always hidden behind the solid itself); a crest line on the lip of every raised
    // swell step (positive vertical curvature with water above; a solid below makes the curvature negative anyway).
    '      vec4 nL = colAt(p + vec2(-1.0, 0.0)); vec4 nR = colAt(p + vec2(1.0, 0.0)); vec4 nU = colAt(p + vec2(0.0, 1.0));',
    '      float foam = 0.0;',
    '      if (nL.a > 0.875 && dC - dL < uFoamT && dL - dC < uFoamT * 0.35) foam = 1.0;',
    '      if (nR.a > 0.875 && dC - dR < uFoamT && dR - dC < uFoamT * 0.35) foam = 1.0;',
    '      if (nU.a > 0.875 && dC - dU < uFoamT && dU - dC < uFoamT * 0.35) foam = 1.0;',
    '      float crest = (dU - dC) - (dC - dD);',
    '      if (foam < 0.5 && nU.a > 0.375 && nU.a < 0.625 && crest > uCrestT && crest < uSilT * 2.0) col = mix(col, uFoamColor, uCrestMix);',
    '      col = mix(col, uFoamColor, foam * uFoamMix);',
    '    }',
    '  }',
    '  if (!glow) {',
    '    col = col * uGradeMul + uGradeAdd;',
    '    float l = dot(col, vec3(0.299, 0.587, 0.114));',
    '    col = mix(vec3(l), col, uSat);',
    '    vec2 v = vUv - 0.5; v.x *= uRes.x / uRes.y;',
    '    col = mix(col, uVigColor, smoothstep(0.42, 1.1, length(v)) * uVignette);',
    '  }',
    '  float th = bayer4(floor(p) + uBayerOff) + 0.03125;',
    '  gl_FragColor = vec4(snapPal(col, th), 1.0);',
    '}'
  ].join('\n');

  // Default grade (lighting.js overrides per time of day).
  const GRADE = {
    mul: [1, 1, 1], add: [0, 0, 0], sat: 1, vignette: 0, vigColor: [0.04, 0.03, 0.08],
    outlineTint: [0.07, 0.06, 0.13], outlineMix: 0.35, outlineDark: 0.42, highlight: 0.55, concave: 0.16,
    foam: [0.86, 0.96, 0.94], foamMix: 0.85, crestMix: 0.35
  };

  // r128's PCFShadowMap kernel takes 17 shadow-map taps per fragment, which dominates software GL (SwiftShader).
  // With a 2048 map over ~220 m one shadow texel is ~0.1 m, under a third of a screen texel, so the extra softness
  // is invisible after the low-res pass anyway. Swap in a 2x2 (4-tap) kernel; the type stays PCFShadowMap.
  let pcfPatched = false;
  function patchShadowKernel() {
    if (pcfPatched) return;
    pcfPatched = true;
    const SC = THREE.ShaderChunk;
    const src = SC && SC.shadowmap_pars_fragment;
    if (typeof src !== 'string') return;
    const re = /(defined\( SHADOWMAP_TYPE_PCF \)\s*\n)([\s\S]*?)(#elif defined\( SHADOWMAP_TYPE_PCF_SOFT \))/;
    if (!re.test(src)) return;
    SC.shadowmap_pars_fragment = src.replace(re, (m, a, body, c) => a + [
      'vec2 pcfO = vec2( 0.5 ) / shadowMapSize * shadowRadius;',
      'shadow = (',
      '  texture2DCompare( shadowMap, shadowCoord.xy + vec2( -pcfO.x, -pcfO.y ), shadowCoord.z ) +',
      '  texture2DCompare( shadowMap, shadowCoord.xy + vec2( pcfO.x, -pcfO.y ), shadowCoord.z ) +',
      '  texture2DCompare( shadowMap, shadowCoord.xy + vec2( -pcfO.x, pcfO.y ), shadowCoord.z ) +',
      '  texture2DCompare( shadowMap, shadowCoord.xy + vec2( pcfO.x, pcfO.y ), shadowCoord.z )',
      ') * 0.25;',
      ''
    ].join('\n') + c);
  }

  function makeLutTextures() {
    lut = GLT.palette.buildLut(64);
    const lt = new THREE.DataTexture(lut.data, lut.width, lut.height, THREE.RGBAFormat, THREE.UnsignedByteType);
    const pt = new THREE.DataTexture(GLT.palette.paletteData(128), 128, 1, THREE.RGBAFormat, THREE.UnsignedByteType);
    [lt, pt].forEach((t) => {
      t.minFilter = THREE.NearestFilter; t.magFilter = THREE.NearestFilter;
      t.generateMipmaps = false; t.flipY = false; t.needsUpdate = true;
    });
    return { lt, pt };
  }

  function makePost() {
    const tex = makeLutTextures();
    postMat = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      depthTest: false,
      depthWrite: false,
      uniforms: {
        tColor: { value: null }, tDepth: { value: null }, tLut: { value: tex.lt }, tPal: { value: tex.pt },
        uRes: { value: new THREE.Vector2(1, 1) }, uBayerOff: { value: new THREE.Vector2(0, 0) },
        uNear: { value: 1 }, uFar: { value: 1000 }, uSilT: { value: 0.6 }, uCreaseT: { value: 0.1 }, uFoamT: { value: 1.2 },
        uEdges: { value: depthOk ? 1 : 0 }, uDither: { value: 1 },
        uLutN: { value: lut.levels }, uLutTiles: { value: lut.tiles }, uLutSize: { value: lut.width },
        uGradeMul: { value: new THREE.Vector3(1, 1, 1) }, uGradeAdd: { value: new THREE.Vector3(0, 0, 0) },
        uSat: { value: 1 }, uVignette: { value: 0 }, uVigColor: { value: new THREE.Vector3() },
        uOutlineTint: { value: new THREE.Vector3() }, uOutlineMix: { value: 0.35 }, uOutlineDark: { value: 0.42 },
        uHighlight: { value: 0.55 }, uConcave: { value: 0.16 }, uFoamColor: { value: new THREE.Vector3(0.86, 0.96, 0.94) },
        uFoamMix: { value: 0.85 }, uCrestT: { value: 0.2 }, uCrestMix: { value: 0.35 }, uRaw: { value: 0 }
      }
    });
    postScene = new THREE.Scene();
    postCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), postMat);
    quad.frustumCulled = false;
    postScene.add(quad);
    setGrade(GRADE);
  }

  function setGrade(g) {
    if (!postMat || !g) return;
    const u = postMat.uniforms;
    const v3 = (dst, a) => { if (a) dst.value.set(a[0], a[1], a[2]); };
    v3(u.uGradeMul, g.mul); v3(u.uGradeAdd, g.add); v3(u.uVigColor, g.vigColor); v3(u.uOutlineTint, g.outlineTint); v3(u.uFoamColor, g.foam);
    if (g.sat != null) u.uSat.value = g.sat;
    if (g.vignette != null) u.uVignette.value = g.vignette;
    if (g.outlineMix != null) u.uOutlineMix.value = g.outlineMix;
    if (g.outlineDark != null) u.uOutlineDark.value = g.outlineDark;
    if (g.highlight != null) u.uHighlight.value = g.highlight;
    if (g.concave != null) u.uConcave.value = g.concave;
    if (g.foamMix != null) u.uFoamMix.value = g.foamMix;
    if (g.crestMix != null) u.uCrestMix.value = g.crestMix;
  }

  function makeTarget(w, h) {
    if (rt) { if (rt.depthTexture) rt.depthTexture.dispose(); rt.dispose(); }
    rt = new THREE.WebGLRenderTarget(w, h, {
      minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, format: THREE.RGBAFormat,
      type: THREE.UnsignedByteType, depthBuffer: true, stencilBuffer: false, generateMipmaps: false
    });
    rt.texture.generateMipmaps = false;
    if (depthOk) {
      rt.depthTexture = new THREE.DepthTexture(w, h, THREE.UnsignedIntType);
      rt.depthTexture.minFilter = THREE.NearestFilter;
      rt.depthTexture.magFilter = THREE.NearestFilter;
    }
  }

  function layoutCanvas() {
    const cv = r.domElement;
    const W = size.w * px, H = size.h * px;
    cv.style.position = 'absolute';
    cv.style.left = Math.floor((size.cssW - W) / 2) + 'px';
    cv.style.top = Math.floor((size.cssH - H) / 2) + 'px';
    cv.style.width = W + 'px';
    cv.style.height = H + 'px';
  }

  function resize() {
    if (!r || (!host && !hosted)) return;
    const cssW = hosted ? hosted.cssW : Math.max(1, host.clientWidth || (typeof window !== 'undefined' ? window.innerWidth : 1) || 1);
    const cssH = hosted ? hosted.cssH : Math.max(1, host.clientHeight || (typeof window !== 'undefined' ? window.innerHeight : 1) || 1);
    const w = Math.max(1, Math.floor(cssW / px));
    const h = Math.max(1, Math.floor(cssH / px));
    const changed = w !== size.w || h !== size.h || px !== size.px || !rt;
    size = { w, h, cssW, cssH, px };
    if (changed) {
      if (!hosted) r.setSize(w, h, false);      // hosted: the game owns the canvas size
      makeTarget(w, h);
      if (postMat) postMat.uniforms.uRes.value.set(w, h);
    }
    if (!hosted) layoutCanvas();
    for (const fn of resizeFns.slice()) { try { fn(size); } catch (err) { setTimeout(() => { throw err; }, 0); } }
  }

  function applyPrefs(all) {
    if (!all) return;
    if (all.pixelSize != null) setPixelSize(all.pixelSize);
    setPost({ outlines: all.outlines !== false, dither: all.dither !== false, raw: !!all.raw3d });
  }

  function init(h) {
    if (r) return true;
    if (typeof THREE === 'undefined' || !h) return false;
    patchShadowKernel();
    try {
      r = new THREE.WebGLRenderer({ antialias: false, alpha: false, powerPreference: 'high-performance', preserveDrawingBuffer: false, stencil: false });
    } catch (e) {
      r = null;
      return false;
    }
    if (!r.getContext()) { r = null; return false; }
    depthOk = !!(r.capabilities.isWebGL2 || r.extensions.has('WEBGL_depth_texture'));
    px = (GLT.prefs && GLT.prefs.get && GLT.prefs.get('pixelSize')) || GLT.C.PIXEL_DEFAULT;
    px = Math.max(GLT.C.PIXEL_MIN, Math.min(GLT.C.PIXEL_MAX, Math.round(px)));
    host = h;
    try { if (typeof getComputedStyle !== 'undefined' && getComputedStyle(host).position === 'static') host.style.position = 'relative'; } catch (e) { /* ignore */ }
    host.style.overflow = 'hidden';
    r.setPixelRatio(1);
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFShadowMap;
    r.shadowMap.autoUpdate = true;
    r.info.autoReset = true;
    const cv = r.domElement;
    cv.setAttribute('role', 'img');
    cv.setAttribute('aria-label', GLT.T('a11y.canvas'));
    cv.style.imageRendering = 'pixelated';
    cv.style.display = 'block';
    cv.style.touchAction = 'none';
    host.appendChild(cv);
    makePost();
    if (GLT.prefs && GLT.prefs.all) {
      const all = GLT.prefs.all();
      post = { outlines: all.outlines !== false, dither: all.dither !== false, raw: !!all.raw3d };
    }
    resize();
    if (typeof ResizeObserver !== 'undefined') { ro = new ResizeObserver(resize); ro.observe(host); }
    else if (typeof window !== 'undefined') window.addEventListener('resize', resize);
    GLT.clock.onFrame(render, 1000);
    if (GLT.events) GLT.events.on('settings:changed', (e) => {
      if (!e) return;
      if (e.key === '*') { applyPrefs(e.all); return; }
      if (e.key === 'pixelSize') setPixelSize(e.value);
      if (e.key === 'outlines') setPost({ outlines: !!e.value });
      if (e.key === 'dither') setPost({ dither: !!e.value });
      if (e.key === 'raw3d') setPost({ raw: !!e.value });
    });
    return true;
  }

  // Hosted mode: draw with a WebGLRenderer the host created on its own canvas (full CSS size). The scene goes to the
  // low-res target, the post pass samples it texel-exact into the host's default framebuffer (nearest upscale).
  function attach(ext, o) {
    if (r) return r === ext;
    if (typeof THREE === 'undefined' || !ext) return false;
    patchShadowKernel();
    r = ext;
    depthOk = !!(r.capabilities.isWebGL2 || r.extensions.has('WEBGL_depth_texture'));
    o = o || {};
    px = Math.max(GLT.C.PIXEL_MIN, Math.min(GLT.C.PIXEL_MAX, Math.round(o.pixelSize || GLT.C.PIXEL_DEFAULT)));
    hosted = { cssW: Math.max(1, o.width || 1), cssH: Math.max(1, o.height || 1) };
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFShadowMap;
    r.shadowMap.autoUpdate = true;
    makePost();
    resize();
    return true;
  }

  function setViewport(cssW, cssH) {
    if (!hosted) return;
    hosted.cssW = Math.max(1, Math.round(cssW) || 1);
    hosted.cssH = Math.max(1, Math.round(cssH) || 1);
    resize();
  }

  function renderHosted(scene, cam) {
    if (!r || !hosted || !scene || !cam) return;
    const t0 = GLT.clock.realNow();
    GLT.scene.beforeRender();
    r.setRenderTarget(rt);
    r.render(scene, cam);
    snapshotInfo();
    updateUniforms(cam);
    postMat.uniforms.uRaw.value = post.raw ? 1 : 0;
    r.setRenderTarget(null);
    r.render(postScene, postCam);
    info.cpuMs = GLT.clock.realNow() - t0;
    info.frames++;
  }

  function setPixelSize(v) {
    const C = GLT.C;
    const n = Math.max(C.PIXEL_MIN, Math.min(C.PIXEL_MAX, Math.round(Number(v)) || C.PIXEL_DEFAULT));
    if (n === px && r) return;
    px = n;
    resize();
  }

  function setPost(o) { post = Object.assign({}, post, o || {}); }

  function updateUniforms(cam) {
    const u = postMat.uniforms;
    u.tColor.value = rt.texture;
    u.tDepth.value = rt.depthTexture || null;
    u.uEdges.value = post.outlines && depthOk && rt.depthTexture ? 1 : 0;
    u.uDither.value = post.dither ? 1 : 0;
    u.uNear.value = cam.near;
    u.uFar.value = cam.far;
    const wpp = GLT.camera.worldPerPixel ? GLT.camera.worldPerPixel() : 0.2;
    const el = Math.max(10, Math.min(85, GLT.camera.get ? GLT.camera.get().elevation : 38)) * Math.PI / 180;
    const slope = Math.max(1 / Math.tan(el), Math.tan(el));
    u.uSilT.value = wpp * (1.6 + 1.2 * slope);
    u.uCreaseT.value = wpp * 0.45;
    u.uFoamT.value = Math.max(0.6, wpp * (1.5 + 1.2 * slope));
    // a 0.25 m swell step seen at elevation el jumps the depth by 0.25 / sin(el); fire on about half of it
    u.uCrestT.value = Math.max(0.06, 0.11 / Math.sin(el));
    const off = GLT.camera.snapOffset ? GLT.camera.snapOffset() : null;
    if (off) u.uBayerOff.value.set(((off.x % 4) + 4) % 4, ((off.y % 4) + 4) % 4);
  }

  function render() {
    if (!r || GLT.clock.simulating()) return;
    const scene = GLT.scene.root();
    const cam = GLT.camera.three();
    if (!scene || !cam) return;
    const t0 = GLT.clock.realNow();
    GLT.scene.beforeRender();
    if (post.raw || !rt) {
      r.setRenderTarget(null);
      r.render(scene, cam);
      snapshotInfo();
    } else {
      r.setRenderTarget(rt);
      r.render(scene, cam);
      snapshotInfo();
      updateUniforms(cam);
      r.setRenderTarget(null);
      r.render(postScene, postCam);
    }
    info.cpuMs = GLT.clock.realNow() - t0;
    info.frames++;
  }

  function snapshotInfo() {
    const i = r.info;
    info.calls = i.render.calls; info.triangles = i.render.triangles; info.points = i.render.points; info.lines = i.render.lines;
    info.geometries = i.memory.geometries; info.textures = i.memory.textures; info.programs = i.programs ? i.programs.length : 0;
  }

  // Outline class of a material (see header). Opaque materials only; returns the material.
  function markMaterial(mat, cls) {
    if (!mat) return mat;
    const a = CLASS_ALPHA[cls] != null ? CLASS_ALPHA[cls] : 1;
    if (!mat.transparent) mat.opacity = a;
    mat.userData = mat.userData || {};
    mat.userData.gltOutline = cls || 'full';
    return mat;
  }

  GLT.renderer = {
    init,
    three() { return r; },
    canvas() { return r ? r.domElement : null; },
    setPixelSize,
    size() { return size; },
    setPost,
    post() { return Object.assign({}, post); },
    render,
    attach,
    setViewport,
    renderHosted,
    hosted() { return !!hosted; },
    onResize(fn) { resizeFns.push(fn); return () => { resizeFns = resizeFns.filter((f) => f !== fn); }; },
    // additions (render area)
    setGrade,
    markMaterial,
    CLASS_ALPHA,
    depthSupported() { return depthOk; },
    stats() { return Object.assign({}, info, { w: size.w, h: size.h, px }); },
    target() { return rt; },
    postMaterial() { return postMat; }
  };
})();
