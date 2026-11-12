/* GLT.C: all numeric constants. Area: logic. Contract: ARCHITECTURE.md §5.1, §9.
 * Implemented by the architect; values are part of the contract (change only via ARCHITECTURE.md). */
(function () {
  'use strict';
  const GLT = (globalThis.GLT = globalThis.GLT || {});

  const deepFreeze = (o) => {
    Object.values(o).forEach((v) => { if (v && typeof v === 'object') deepFreeze(v); });
    return Object.freeze(o);
  };

  GLT.C = deepFreeze({
    // ---- world (metres) ----
    CELL: 4,              // one grid cell edge
    OCEAN_Y: 0,           // open sea surface
    PLATE_Y: 8,           // plate water surface = ship waterline
    PLATE_CX: 34,         // |x| of each plate centre ('own' at -34, 'enemy' at +34), z = 0
    PLATE_MAX: 12,        // largest grid
    RIM: 4,               // rim width around the grid
    RIM_TOP: 1,           // rim top above PLATE_Y
    PLATE_DEPTH: 6,       // strata reach about y = -PLATE_DEPTH
    SHIP_VOXEL: 0.25,     // ship voxel edge
    SHIP_END_MARGIN: 0.25,// free space at each ship end inside its cells
    SHIP_MAX_BEAM: 3.4,   // max hull width incl. cannons
    SHIP_MAX_H: 9,        // max mast height above waterline
    RING_IN: 90,          // scenery ring inner radius
    RING_OUT: 320,        // scenery ring outer radius
    INNER_ZONE: 70,       // everything beyond this radius belongs to a backdrop sector
    SECTORS: 8,
    LIFT_H: 90,           // doll's-house lift height
    LIFT_NEAR_DEG: 67.5,  // a sector is "near" when angDist(sector, cameraAz) <= this
    VIEW_HALF_H: 40,      // ortho half-height at zoom 1

    // ---- game time (seconds; scaled by GLT.clock speed) ----
    T: {
      flight: 0.9, afterMiss: 0.5, afterHit: 0.9, afterSink: 2.2, tech: 1.4, coin: 2.0,
      cpuMin: 0.4, cpuMax: 1.2, gameOverBanner: 2.0, autoNext: 6.0, ceremony: 9.0, liftS: 0.85,
      cameraEase: 0.6, tauntGap: 3.0
    },

    // ---- network (wall-clock ms) ----
    NET: {
      heartbeat: 3000, away: 10000, forfeit: 60000, timeoutGrace: 5000,
      chunk: 100, roomTtl: 900000, maxRooms: 20, maxWanted: 20
    },

    // ---- gameplay / ui ----
    HINTS: 3,
    PIXEL_DEFAULT: 2, PIXEL_MIN: 1, PIXEL_MAX: 6,
    GUST_P: 0.2,          // Tempestade gust probability per turn (Tático)
    FOG_TURNS: 2,         // fog: markers visible while view.turnNo - markTurn <= FOG_TURNS
    BOUNTY_BASE: 30e6
  });
})();
