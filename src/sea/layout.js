/* GLT.layout: world coordinates for plates, cells, ships, rim labels, docks and scenery sectors.
 * Area: logic (pure math, no THREE). Contract: ARCHITECTURE.md §9. Implemented by the architect;
 * the mapping is binding for world/ships/fx/render. */
(function () {
  'use strict';
  const GLT = (globalThis.GLT = globalThis.GLT || {});

  let current = 10;

  const C = () => GLT.C;
  const nn = (n) => (n === 8 || n === 10 || n === 12 ? n : current);

  function size() { return current; }

  function setSize(n) {
    if (n !== 8 && n !== 10 && n !== 12) throw new RangeError('GLT.layout.setSize: n must be 8, 10 or 12');
    const changed = n !== current;
    current = n;
    if (changed && GLT.events) GLT.events.emit('layout:changed', { size: n });
  }

  function plateCenter(plate) {
    const k = C();
    return { x: plate === 'enemy' ? k.PLATE_CX : -k.PLATE_CX, y: k.PLATE_Y, z: 0 };
  }

  function cellToWorld(plate, r, c, n) {
    const k = C(); n = nn(n);
    const half = (n - 1) / 2;
    const cx = plate === 'enemy' ? k.PLATE_CX : -k.PLATE_CX;
    return { x: cx + (c - half) * k.CELL, y: k.PLATE_Y, z: (r - half) * k.CELL };
  }

  function worldToCell(plate, x, z, n) {
    const k = C(); n = nn(n);
    const half = (n - 1) / 2;
    const cx = plate === 'enemy' ? k.PLATE_CX : -k.PLATE_CX;
    const fc = (x - cx) / k.CELL + half;
    const fr = z / k.CELL + half;
    const c = Math.round(fc), r = Math.round(fr);
    if (Math.abs(fc - c) > 0.5 || Math.abs(fr - r) > 0.5) return null;
    if (r < 0 || c < 0 || r >= n || c >= n) return null;
    return { r, c };
  }

  function gridBounds(plate, n) {
    const k = C(); n = nn(n);
    const cx = plate === 'enemy' ? k.PLATE_CX : -k.PLATE_CX;
    const h = (n * k.CELL) / 2;
    return { minX: cx - h, maxX: cx + h, minZ: -h, maxZ: h };
  }

  function rimBounds(plate, n) {
    const b = gridBounds(plate, n), R = C().RIM;
    return { minX: b.minX - R, maxX: b.maxX + R, minZ: b.minZ - R, maxZ: b.maxZ + R };
  }

  function plateAt(x, z, n) {
    for (const p of ['own', 'enemy']) {
      const b = gridBounds(p, n);
      if (x >= b.minX && x < b.maxX && z >= b.minZ && z < b.maxZ) return p;
    }
    return null;
  }

  // Centre of the occupied cells at the waterline; yaw per §9 (bow +X for 'h', +Z for 'v').
  function shipTransform(plate, ship, n) {
    const k = C();
    const mid = (ship.len - 1) / 2;
    const p = ship.dir === 'v' ? cellToWorld(plate, ship.r + mid, ship.c, n) : cellToWorld(plate, ship.r, ship.c + mid, n);
    return { x: p.x, y: k.PLATE_Y, z: p.z, yaw: ship.dir === 'v' ? -Math.PI / 2 : 0, length: ship.len * k.CELL };
  }

  function shipEnvelope(len) {
    const k = C();
    return { length: len * k.CELL - 2 * k.SHIP_END_MARGIN, beam: k.SHIP_MAX_BEAM, height: k.SHIP_MAX_H };
  }

  // Rim label anchors: letters along the -X rim edge, numbers along the -Z rim edge (rim top height).
  function rowLabelPos(plate, r, n) {
    const k = C();
    const p = cellToWorld(plate, r, 0, n);
    return { x: p.x - k.CELL / 2 - k.RIM / 2, y: k.PLATE_Y + k.RIM_TOP, z: p.z };
  }

  function colLabelPos(plate, c, n) {
    const k = C();
    const p = cellToWorld(plate, 0, c, n);
    return { x: p.x, y: k.PLATE_Y + k.RIM_TOP, z: p.z - k.CELL / 2 - k.RIM / 2 };
  }

  // Fallback muzzle: on the shooter's rim edge that faces the target plate, slightly above it.
  function launcher(fromPlate, toPlate, n) {
    const k = C();
    const b = rimBounds(fromPlate, n);
    const towardEnemy = toPlate === 'enemy' || (toPlate !== 'own' && fromPlate === 'own');
    return { x: towardEnemy ? b.maxX - k.RIM / 2 : b.minX + k.RIM / 2, y: k.PLATE_Y + k.RIM_TOP + 1.5, z: 0 };
  }

  function dockPos(plate, n) {
    const k = C(); n = nn(n);
    const c = plateCenter(plate);
    return { x: c.x, y: k.OCEAN_Y, z: -((n / 2) * k.CELL + k.RIM + 6) };
  }

  const norm360 = (a) => ((a % 360) + 360) % 360;
  function angDist(a, b) { const d = Math.abs(norm360(a) - norm360(b)); return d > 180 ? 360 - d : d; }
  function sectorOf(azDeg) { return Math.floor(norm360(azDeg + 22.5) / 45) % 8; }
  function sectorCenter(k) { return ((k % 8) + 8) % 8 * 45; }
  function azDir(azDeg) { const a = (azDeg * Math.PI) / 180; return { x: Math.sin(a), z: Math.cos(a) }; }
  function nearSectors(cameraAz) {
    const out = [];
    for (let k = 0; k < 8; k++) out.push(angDist(sectorCenter(k), cameraAz) <= C().LIFT_NEAR_DEG + 1e-9);
    return out;
  }

  GLT.layout = {
    size, setSize, plateCenter, cellToWorld, worldToCell, plateAt, gridBounds, rimBounds,
    shipTransform, shipEnvelope, rowLabelPos, colLabelPos, launcher, dockPos,
    sectorOf, sectorCenter, angDist, azDir, nearSectors
  };
})();
