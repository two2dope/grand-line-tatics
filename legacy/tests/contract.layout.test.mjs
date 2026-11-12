// Contract: world coordinate invariants (ARCHITECTURE.md §9). Owner: architect.
export default function (test, { GLT, assert }) {
  const L = GLT.layout, C = GLT.C;
  const near = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps;

  test('cellToWorld / worldToCell round-trip for every size, plate and cell', () => {
    for (const n of [8, 10, 12]) for (const plate of ['own', 'enemy']) for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
      const p = L.cellToWorld(plate, r, c, n);
      assert.equal(p.y, C.PLATE_Y);
      assert.deepEqual(L.worldToCell(plate, p.x, p.z, n), { r, c });
      assert.equal(L.plateAt(p.x, p.z, n), plate);
    }
  });

  test('rows grow toward +Z, columns toward +X, plates centred at x = ∓PLATE_CX', () => {
    const a = L.cellToWorld('own', 0, 0, 10), b = L.cellToWorld('own', 1, 1, 10);
    assert.ok(b.x > a.x && b.z > a.z);
    assert.ok(near(b.x - a.x, C.CELL) && near(b.z - a.z, C.CELL));
    assert.deepEqual(L.plateCenter('own'), { x: -C.PLATE_CX, y: C.PLATE_Y, z: 0 });
    assert.deepEqual(L.plateCenter('enemy'), { x: C.PLATE_CX, y: C.PLATE_Y, z: 0 });
  });

  test('plates never overlap; rims leave a channel for the Log Pose buoy at the origin', () => {
    for (const n of [8, 10, 12]) {
      const own = L.rimBounds('own', n), en = L.rimBounds('enemy', n);
      assert.ok(own.maxX < en.minX);
      assert.ok(en.minX - own.maxX >= 12, 'channel >= 12 m');
      assert.ok(own.maxX < 0 && en.minX > 0);
    }
  });

  test('ship transform: centre of cells, yaw 0 for h (bow +X), -PI/2 for v (bow +Z)', () => {
    for (const n of [8, 10, 12]) {
      const fmt = { 8: 'escaramuca', 10: 'classica', 12: 'grandline' }[n];
      for (const plate of ['own', 'enemy']) for (const s of GLT.data.sampleFleets[fmt].ships) {
        const tr = L.shipTransform(plate, s, n);
        const cells = GLT.board.shipCells(s).map((p) => L.cellToWorld(plate, p.r, p.c, n));
        const mx = cells.reduce((a, p) => a + p.x, 0) / cells.length, mz = cells.reduce((a, p) => a + p.z, 0) / cells.length;
        assert.ok(near(tr.x, mx) && near(tr.z, mz));
        assert.equal(tr.yaw, s.dir === 'v' ? -Math.PI / 2 : 0);
        // bow direction = rotation of local +X by yaw: (cos yaw, -sin yaw) must point at the last cell
        const bx = Math.cos(tr.yaw), bz = -Math.sin(tr.yaw);
        const last = cells[cells.length - 1], first = cells[0];
        assert.ok((last.x - first.x) * bx + (last.z - first.z) * bz > 0 || s.len === 1);
      }
    }
  });

  test('ship envelope fits inside its cells with margins (no clipping between touching ships)', () => {
    for (const id of GLT.data.shipOrder) {
      const len = GLT.data.ships[id].len, env = L.shipEnvelope(len);
      assert.ok(env.length / 2 <= (len * C.CELL) / 2 - C.SHIP_END_MARGIN + 1e-9);
      assert.ok(env.beam / 2 < C.CELL / 2);
    }
  });

  test('sectors: 8 x 45°, az 0 = +Z, three near sectors for any camera azimuth', () => {
    for (let k = 0; k < 8; k++) assert.equal(L.sectorOf(L.sectorCenter(k)), k);
    assert.equal(L.sectorOf(-10), 0);
    assert.equal(L.sectorOf(200), 4);
    const d = L.azDir(0);
    assert.ok(near(d.x, 0) && near(d.z, 1));
    for (const az of [0, 30, 45, 90, 179, 271, 330]) {
      const nearS = L.nearSectors(az);
      const count = nearS.filter(Boolean).length;
      assert.ok(count === 3 || count === 4, `az ${az}: ${count}`);
      assert.ok(nearS[L.sectorOf(az)]);
    }
    assert.deepEqual(L.nearSectors(30).map((b, i) => (b ? i : -1)).filter((i) => i >= 0), [0, 1, 2]);
  });

  test('rim labels sit on the -X (letters) and -Z (numbers) rims; docks behind each plate', () => {
    const g = L.gridBounds('own', 10);
    const rl = L.rowLabelPos('own', 3, 10), cl = L.colLabelPos('own', 3, 10);
    assert.ok(rl.x < g.minX && rl.x > g.minX - C.RIM);
    assert.ok(cl.z < g.minZ && cl.z > g.minZ - C.RIM);
    const dock = L.dockPos('enemy', 12);
    assert.ok(dock.z < L.rimBounds('enemy', 12).minZ);
  });

  test('setSize validates and emits layout:changed once per change', () => {
    let n = 0;
    const off = GLT.events.on('layout:changed', () => n++);
    L.setSize(12); L.setSize(12); L.setSize(8);
    off();
    assert.equal(n, 2);
    assert.throws(() => L.setSize(9), RangeError);
    L.setSize(10);
  });
}
