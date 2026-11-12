/**
 * Grand Line Tactics — Canonical Voxel Fleet Renderer
 * Piece 5: ships-voxel.js
 *
 * Models all 7 canonical One Piece ships from procedural voxel parts,
 * merged per material for maximum draw-call efficiency (60 FPS on mobile),
 * with animated sub-nodes for billowing sails, recoiling cannons, ship lanterns,
 * and instanced deck crew.
 *
 * Strict Bounding Box Discipline:
 * Every ship of length L fits strictly within L x 1 cells (L * cellSize by 0.85 * cellSize)
 * with a 7.5% margin on all borders, preventing any clipping even when allowTouch is true.
 */

(function (root) {
  'use strict';

  // Support both browser (window/globalThis) and Node.js testing
  const _THREE = (typeof THREE !== 'undefined') ? THREE : (typeof globalThis !== 'undefined' && globalThis.THREE ? globalThis.THREE : null);

  // ---------------------------------------------------------------------------
  // Canonical Ship Metadata Registry
  // ---------------------------------------------------------------------------
  const SHIPS_VOXEL_CONFIG = {
    moby_dick: {
      id: 'moby_dick',
      name: 'Moby Dick',
      captain: 'Edward Newgate (Barba Branca)',
      length: 5,
      crewId: 'whitebeard',
      baseHullColor: 0xf8fafc, // Bright white/ivory whale bow
      deckColor: 0xd97706,     // Warm oak deck
      accentColor: 0x38bdf8,   // Vivid sky-blue stripes
      figurehead: 'whale',
      hasCannons: true,
      hasLanterns: true,
      cannonCountPerSide: 4,
      masts: 3
    },
    thousand_sunny: {
      id: 'thousand_sunny',
      name: 'Thousand Sunny',
      captain: 'Monkey D. Luffy',
      length: 4,
      crewId: 'straw_hats',
      baseHullColor: 0xef4444, // Crimson-red & white hull
      deckColor: 0x4ade80,     // Vibrant emerald grass deck
      accentColor: 0xfacc15,   // Bright gold
      figurehead: 'lion',
      hasCannons: true,
      hasLanterns: true,
      cannonCountPerSide: 3,
      masts: 2
    },
    oro_jackson: {
      id: 'oro_jackson',
      name: 'Oro Jackson',
      captain: 'Gol D. Roger',
      length: 4,
      crewId: 'roger',
      baseHullColor: 0xdc2626, // Rich ruby-red Adam-wood
      deckColor: 0x78350f,     // Warm mahogany
      accentColor: 0xfacc15,   // Gleaming gold arches
      figurehead: 'mermaid_cannons',
      hasCannons: true,
      hasLanterns: true,
      cannonCountPerSide: 3,
      masts: 3
    },
    red_force: {
      id: 'red_force',
      name: 'Red Force',
      captain: 'Shanks',
      length: 3,
      crewId: 'red_haired',
      baseHullColor: 0xef4444, // Bright scarlet hull trim
      deckColor: 0xd97706,     // Warm teak deck
      accentColor: 0xb91c1c,
      figurehead: 'dragon',
      hasCannons: true,
      hasLanterns: true,
      cannonCountPerSide: 2,
      masts: 2
    },
    polar_tang: {
      id: 'polar_tang',
      name: 'Polar Tang',
      captain: 'Trafalgar Law',
      length: 3,
      crewId: 'heart',
      baseHullColor: 0xfacc15, // Vivid canary yellow submarine
      deckColor: 0x1e293b,
      accentColor: 0x38bdf8,   // Cyan-blue conning tower windows
      figurehead: 'sub_conning_tower',
      isSubmarine: true,
      hasCannons: false,
      hasLanterns: true,
      cannonCountPerSide: 0,
      masts: 0
    },
    baratie: {
      id: 'baratie',
      name: 'Baratie',
      captain: 'Zeff',
      length: 3,
      crewId: 'baratie',
      baseHullColor: 0xfb923c, // Bright golden-orange fish restaurant
      deckColor: 0xea580c,
      accentColor: 0x2dd4bf,   // Turquoise fins
      figurehead: 'fish_mouth',
      hasCannons: false,
      hasLanterns: true,
      cannonCountPerSide: 0,
      masts: 1
    },
    going_merry: {
      id: 'going_merry',
      name: 'Going Merry',
      captain: 'Monkey D. Luffy',
      length: 2,
      crewId: 'straw_hats',
      baseHullColor: 0xfef3c7, // Bright cream/white caravel
      deckColor: 0xb45309,
      accentColor: 0x4ade80,
      figurehead: 'sheep',
      hasCannons: true,
      hasLanterns: true,
      cannonCountPerSide: 1,
      masts: 1
    },
    // Thematic Marine Fleet
    marine_warship: {
      id: 'marine_warship',
      name: 'Encouraçado Almirante G-1',
      captain: 'Sakazuki (Akainu)',
      length: 5,
      crewId: 'marines',
      baseHullColor: 0x1e3a8a, // Navy blue
      deckColor: 0xf8fafc,     // White deck
      accentColor: 0xf59e0b,   // Gold anchor
      figurehead: 'whale',
      hasCannons: true,
      hasLanterns: true,
      cannonCountPerSide: 4,
      masts: 3
    },
    marine_battleship: {
      id: 'marine_battleship',
      name: 'Navio de Linha da Justiça',
      captain: 'Marinha',
      length: 4,
      crewId: 'marines',
      baseHullColor: 0x1e3a8a,
      deckColor: 0xf8fafc,
      accentColor: 0xf59e0b,
      figurehead: 'lion',
      hasCannons: true,
      hasLanterns: true,
      cannonCountPerSide: 3,
      masts: 2
    },
    marine_cruiser: {
      id: 'marine_cruiser',
      name: 'Cruzador Buster Call',
      captain: 'Marinha',
      length: 3,
      crewId: 'marines',
      baseHullColor: 0x1e3a8a,
      deckColor: 0xf8fafc,
      accentColor: 0x3b82f6,
      figurehead: 'dragon',
      hasCannons: true,
      hasLanterns: true,
      cannonCountPerSide: 2,
      masts: 2
    },
    marine_cutter: {
      id: 'marine_cutter',
      name: 'Cutter de Patrulha Costeira',
      captain: 'Marinha',
      length: 3,
      crewId: 'marines',
      baseHullColor: 0x1e3a8a,
      deckColor: 0xf8fafc,
      accentColor: 0x3b82f6,
      figurehead: 'fish_mouth',
      hasCannons: true,
      hasLanterns: true,
      cannonCountPerSide: 1,
      masts: 1
    },
    marine_scout: {
      id: 'marine_scout',
      name: 'Lancha de Reconhecimento',
      captain: 'Marinha',
      length: 2,
      crewId: 'marines',
      baseHullColor: 0x1e3a8a,
      deckColor: 0xf8fafc,
      accentColor: 0xf59e0b,
      figurehead: 'sheep',
      hasCannons: true,
      hasLanterns: true,
      cannonCountPerSide: 1,
      masts: 1
    },
    // Thematic Blackbeard Fleet
    saber_of_xebec: {
      id: 'saber_of_xebec',
      name: 'Saber of Xebec',
      captain: 'Marshall D. Teach',
      length: 4,
      crewId: 'blackbeard',
      baseHullColor: 0x09090b, // Obsidian black
      deckColor: 0x27272a,     // Charred deck
      accentColor: 0x7c3aed,   // Royal purple
      figurehead: 'lion',
      hasCannons: true,
      hasLanterns: true,
      cannonCountPerSide: 3,
      masts: 3
    },
    // Thematic Straw Hats Fleet
    barto_club: {
      id: 'barto_club',
      name: 'Galeão Barto Club',
      captain: 'Bartolomeo / Luffy',
      length: 5,
      crewId: 'straw_hats',
      baseHullColor: 0x1e293b,
      deckColor: 0xd97706,
      accentColor: 0xef4444,
      figurehead: 'whale',
      hasCannons: true,
      hasLanterns: true,
      cannonCountPerSide: 4,
      masts: 3
    },
    mini_merry: {
      id: 'mini_merry',
      name: 'Mini Merry II',
      captain: 'Monkey D. Luffy',
      length: 3,
      crewId: 'straw_hats',
      baseHullColor: 0xfef3c7,
      deckColor: 0xb45309,
      accentColor: 0x4ade80,
      figurehead: 'sheep',
      hasCannons: true,
      hasLanterns: true,
      cannonCountPerSide: 2,
      masts: 1
    },
    shark_submerge: {
      id: 'shark_submerge',
      name: 'Shark Submerge III',
      captain: 'Monkey D. Luffy',
      length: 3,
      crewId: 'straw_hats',
      baseHullColor: 0x0284c7, // Deep oceanic blue
      deckColor: 0x0f172a,
      accentColor: 0xfacc15,
      figurehead: 'sub_conning_tower',
      isSubmarine: true,
      hasCannons: false,
      hasLanterns: true,
      cannonCountPerSide: 0,
      masts: 0
    },
    // Thematic Whitebeard Fleet
    whitebeard_whale_flag: {
      id: 'whitebeard_whale_flag',
      name: 'Navio da 1ª Divisão Fênix',
      captain: 'Marco / Barba Branca',
      length: 4,
      crewId: 'whitebeard',
      baseHullColor: 0xf8fafc,
      deckColor: 0xd97706,
      accentColor: 0x38bdf8,
      figurehead: 'whale',
      hasCannons: true,
      hasLanterns: true,
      cannonCountPerSide: 3,
      masts: 2
    },
    whitebeard_vanguard: {
      id: 'whitebeard_vanguard',
      name: 'Baleia de Batalha Aliada',
      captain: 'Edward Newgate',
      length: 3,
      crewId: 'whitebeard',
      baseHullColor: 0xf8fafc,
      deckColor: 0xd97706,
      accentColor: 0x38bdf8,
      figurehead: 'whale',
      hasCannons: true,
      hasLanterns: true,
      cannonCountPerSide: 2,
      masts: 2
    },
    whitebeard_corvette: {
      id: 'whitebeard_corvette',
      name: 'Corveta Moby',
      captain: 'Edward Newgate',
      length: 3,
      crewId: 'whitebeard',
      baseHullColor: 0xf8fafc,
      deckColor: 0xd97706,
      accentColor: 0x38bdf8,
      figurehead: 'whale',
      hasCannons: true,
      hasLanterns: true,
      cannonCountPerSide: 2,
      masts: 1
    },
    whitebeard_skiff: {
      id: 'whitebeard_skiff',
      name: 'Chalupa de Vanguarda',
      captain: 'Edward Newgate',
      length: 2,
      crewId: 'whitebeard',
      baseHullColor: 0xf8fafc,
      deckColor: 0xd97706,
      accentColor: 0x38bdf8,
      figurehead: 'whale',
      hasCannons: true,
      hasLanterns: true,
      cannonCountPerSide: 1,
      masts: 1
    },
    // Thematic Red-Haired Fleet
    red_galleon: {
      id: 'red_galleon',
      name: 'Grande Galeão Escarlate',
      captain: 'Shanks',
      length: 5,
      crewId: 'red_haired',
      baseHullColor: 0x991b1b,
      deckColor: 0xd97706,
      accentColor: 0xef4444,
      figurehead: 'dragon',
      hasCannons: true,
      hasLanterns: true,
      cannonCountPerSide: 4,
      masts: 3
    },
    red_corvette: {
      id: 'red_corvette',
      name: 'Veleiro de Assalto Ruivo',
      captain: 'Shanks',
      length: 3,
      crewId: 'red_haired',
      baseHullColor: 0xef4444,
      deckColor: 0xd97706,
      accentColor: 0xb91c1c,
      figurehead: 'dragon',
      hasCannons: true,
      hasLanterns: true,
      cannonCountPerSide: 2,
      masts: 2
    },
    red_cutter: {
      id: 'red_cutter',
      name: 'Cutter do Novo Mundo',
      captain: 'Shanks',
      length: 3,
      crewId: 'red_haired',
      baseHullColor: 0xb91c1c,
      deckColor: 0xd97706,
      accentColor: 0xfacc15,
      figurehead: 'dragon',
      hasCannons: true,
      hasLanterns: true,
      cannonCountPerSide: 2,
      masts: 1
    },
    red_skiff: {
      id: 'red_skiff',
      name: 'Chalupa Dardo Veloz',
      captain: 'Shanks',
      length: 2,
      crewId: 'red_haired',
      baseHullColor: 0xef4444,
      deckColor: 0xd97706,
      accentColor: 0xb91c1c,
      figurehead: 'dragon',
      hasCannons: true,
      hasLanterns: true,
      cannonCountPerSide: 1,
      masts: 1
    },
    // Thematic Heart Fleet
    heart_nodachi: {
      id: 'heart_nodachi',
      name: 'Submarino Nodachi',
      captain: 'Trafalgar Law',
      length: 5,
      crewId: 'heart',
      baseHullColor: 0xfacc15,
      deckColor: 0x1e293b,
      accentColor: 0x38bdf8,
      figurehead: 'sub_conning_tower',
      isSubmarine: true,
      hasCannons: false,
      hasLanterns: true,
      cannonCountPerSide: 0,
      masts: 0
    },
    heart_hospital: {
      id: 'heart_hospital',
      name: 'Navio Hospital Tático',
      captain: 'Trafalgar Law',
      length: 4,
      crewId: 'heart',
      baseHullColor: 0xf8fafc,
      deckColor: 0x1e293b,
      accentColor: 0xfacc15,
      figurehead: 'lion',
      hasCannons: true,
      hasLanterns: true,
      cannonCountPerSide: 3,
      masts: 2
    },
    heart_capsule: {
      id: 'heart_capsule',
      name: 'Cápsula Cirúrgica Submersa',
      captain: 'Trafalgar Law',
      length: 3,
      crewId: 'heart',
      baseHullColor: 0xfacc15,
      deckColor: 0x1e293b,
      accentColor: 0x38bdf8,
      figurehead: 'sub_conning_tower',
      isSubmarine: true,
      hasCannons: false,
      hasLanterns: true,
      cannonCountPerSide: 0,
      masts: 0
    },
    heart_bepo_boat: {
      id: 'heart_bepo_boat',
      name: 'Bote Marcial do Bepo',
      captain: 'Trafalgar Law',
      length: 2,
      crewId: 'heart',
      baseHullColor: 0xfacc15,
      deckColor: 0x1e293b,
      accentColor: 0xf97316,
      figurehead: 'sheep',
      hasCannons: true,
      hasLanterns: true,
      cannonCountPerSide: 1,
      masts: 1
    },
    // Thematic Blackbeard Fleet Additions
    blackbeard_colossal: {
      id: 'blackbeard_colossal',
      name: 'Jangada Colossal da Morte',
      captain: 'Marshall D. Teach',
      length: 5,
      crewId: 'blackbeard',
      baseHullColor: 0x09090b,
      deckColor: 0x27272a,
      accentColor: 0x7c3aed,
      figurehead: 'lion',
      hasCannons: true,
      hasLanterns: true,
      cannonCountPerSide: 4,
      masts: 3
    },
    blackbeard_galley: {
      id: 'blackbeard_galley',
      name: 'Galé das Trevas',
      captain: 'Marshall D. Teach',
      length: 3,
      crewId: 'blackbeard',
      baseHullColor: 0x09090b,
      deckColor: 0x27272a,
      accentColor: 0x7c3aed,
      figurehead: 'lion',
      hasCannons: true,
      hasLanterns: true,
      cannonCountPerSide: 2,
      masts: 2
    },
    blackbeard_corvette: {
      id: 'blackbeard_corvette',
      name: 'Corveta do Vórtice',
      captain: 'Marshall D. Teach',
      length: 3,
      crewId: 'blackbeard',
      baseHullColor: 0x09090b,
      deckColor: 0x27272a,
      accentColor: 0x7c3aed,
      figurehead: 'lion',
      hasCannons: true,
      hasLanterns: true,
      cannonCountPerSide: 2,
      masts: 1
    },
    blackbeard_skiff: {
      id: 'blackbeard_skiff',
      name: 'Chalupa do Caos',
      captain: 'Marshall D. Teach',
      length: 2,
      crewId: 'blackbeard',
      baseHullColor: 0x09090b,
      deckColor: 0x27272a,
      accentColor: 0x7c3aed,
      figurehead: 'lion',
      hasCannons: true,
      hasLanterns: true,
      cannonCountPerSide: 1,
      masts: 1
    }
  };

  /**
   * Safe Config Resolver for Any Canonical or Thematic Ship
   */
  function getShipConfig(shipId) {
    if (!shipId) return SHIPS_VOXEL_CONFIG.going_merry;
    if (SHIPS_VOXEL_CONFIG[shipId]) return SHIPS_VOXEL_CONFIG[shipId];
    const cleanId = String(shipId).replace(/_alt$/, '');
    if (SHIPS_VOXEL_CONFIG[cleanId]) return SHIPS_VOXEL_CONFIG[cleanId];

    let rulesShip = null;
    if (typeof GLT !== 'undefined' && GLT.rules && GLT.rules.SHIPS_MAP) {
      rulesShip = GLT.rules.SHIPS_MAP[shipId] || GLT.rules.SHIPS_MAP[cleanId];
    } else if (typeof require !== 'undefined') {
      try {
        const r = require('../logic/rules.js');
        if (r && r.SHIPS_MAP) rulesShip = r.SHIPS_MAP[shipId] || r.SHIPS_MAP[cleanId];
      } catch (e) {}
    }

    if (rulesShip) {
      const baseKey = (rulesShip.baseModel && SHIPS_VOXEL_CONFIG[rulesShip.baseModel])
        ? rulesShip.baseModel
        : (rulesShip.length >= 5 ? 'moby_dick' : rulesShip.length === 4 ? 'thousand_sunny' : rulesShip.length === 3 ? 'red_force' : 'going_merry');
      const base = SHIPS_VOXEL_CONFIG[baseKey] || SHIPS_VOXEL_CONFIG.going_merry;
      const synthesized = Object.assign({}, base, {
        id: shipId,
        name: rulesShip.name || base.name,
        length: rulesShip.length || base.length,
        crewId: rulesShip.crewId || base.crewId,
        isSubmarine: !!rulesShip.isSubmarine,
        figurehead: rulesShip.isSubmarine ? 'sub_conning_tower' : base.figurehead,
        masts: rulesShip.isSubmarine ? 0 : base.masts,
        hasCannons: rulesShip.isSubmarine ? false : base.hasCannons,
        cannonCountPerSide: rulesShip.isSubmarine ? 0 : Math.max(0, Math.min(base.cannonCountPerSide, (rulesShip.length || base.length) - 1))
      });
      SHIPS_VOXEL_CONFIG[shipId] = synthesized;
      return synthesized;
    }

    return SHIPS_VOXEL_CONFIG.going_merry;
  }

  // ---------------------------------------------------------------------------
  // Procedural 64x64 Pixel-Art Canvas Jolly Roger Generator
  // ---------------------------------------------------------------------------
  const _textureCache = new Map();

  function getJollyRogerTexture(shipId, crewId) {
    if (!_THREE) return null;
    const config = getShipConfig(shipId);
    const targetCrew = crewId || (config ? config.crewId : 'straw_hats');
    const cacheKey = `${targetCrew}_${shipId}`;
    if (_textureCache.has(cacheKey)) return _textureCache.get(cacheKey);

    if (typeof document === 'undefined') return null;

    const canvas = document.createElement('canvas');
    canvas.width = 64;
    canvas.height = 64;
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = false;

    // Background canvas tone (sail fabric)
    if (targetCrew === 'whitebeard' || targetCrew === 'blackbeard') {
      ctx.fillStyle = '#0f172a';
    } else if (targetCrew === 'marines') {
      ctx.fillStyle = '#ffffff';
    } else {
      ctx.fillStyle = '#f2ecd9';
    }
    ctx.fillRect(0, 0, 64, 64);

    // Subtle sail weave texture
    ctx.fillStyle = 'rgba(0,0,0,0.035)';
    for (let y = 0; y < 64; y += 4) {
      ctx.fillRect(0, y, 64, 1);
    }

    if (targetCrew === 'marines') {
      // Official Marine Military Anchor & Seagull Medallion
      ctx.fillStyle = '#1e3a8a';
      // Anchor ring & vertical shank
      ctx.beginPath();
      ctx.arc(32, 18, 7, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(32, 18, 4, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = '#1e3a8a';
      ctx.fillRect(30, 24, 4, 24);
      // Crossbar
      ctx.fillRect(18, 28, 28, 4);

      // Curved bottom flukes
      ctx.beginPath();
      ctx.arc(32, 42, 15, 0.1 * Math.PI, 0.9 * Math.PI);
      ctx.lineWidth = 4;
      ctx.strokeStyle = '#1e3a8a';
      ctx.stroke();

      // Fluke arrow tips
      ctx.fillRect(15, 36, 5, 5);
      ctx.fillRect(44, 36, 5, 5);

      // Marine Navy Banner
      ctx.fillStyle = '#b91c1c';
      ctx.fillRect(14, 52, 36, 7);
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 5px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('MARINE', 32, 58);

    } else if (targetCrew === 'blackbeard') {
      // Blackbeard: 3 skulls with 4 crossed bones
      ctx.fillStyle = '#09090b';
      ctx.fillRect(0, 0, 64, 64);

      // Crossed bones
      ctx.fillStyle = '#cbd5e1';
      ctx.fillRect(12, 12, 40, 4);
      ctx.fillRect(12, 48, 40, 4);
      ctx.fillRect(12, 12, 4, 40);
      ctx.fillRect(48, 12, 4, 40);

      // 3 Skulls
      const skullXs = [22, 32, 42];
      const skullYs = [30, 25, 30];
      skullXs.forEach((sx, i) => {
        const sy = skullYs[i];
        ctx.fillStyle = '#f1f5f9';
        ctx.beginPath();
        ctx.arc(sx, sy, 6, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillRect(sx - 3, sy + 3, 6, 4);

        // Eyes
        ctx.fillStyle = '#09090b';
        ctx.fillRect(sx - 2, sy - 1, 2, 2);
        ctx.fillRect(sx + 1, sy - 1, 2, 2);
      });

    } else if (targetCrew === 'whitebeard' || shipId === 'moby_dick') {
      // Whitebeard: Crossbones + skull + colossal white crescent moustache
      ctx.fillStyle = '#1e293b';
      ctx.fillRect(0, 0, 64, 64);

      ctx.fillStyle = '#e2e8f0';
      ctx.fillRect(14, 14, 36, 6);
      ctx.fillRect(29, 0, 6, 64);
      ctx.fillRect(10, 12, 6, 10);
      ctx.fillRect(48, 12, 6, 10);
      ctx.fillRect(10, 42, 6, 10);
      ctx.fillRect(48, 42, 6, 10);

      ctx.beginPath();
      ctx.arc(32, 28, 12, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillRect(27, 36, 10, 6);

      ctx.fillStyle = '#1e293b';
      ctx.fillRect(26, 25, 4, 5);
      ctx.fillRect(34, 25, 4, 5);
      ctx.fillRect(31, 32, 2, 3);

      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.moveTo(8, 20);
      ctx.quadraticCurveTo(32, 40, 56, 20);
      ctx.quadraticCurveTo(32, 33, 8, 20);
      ctx.fill();

    } else if (targetCrew === 'red_haired' || shipId === 'red_force') {
      // Red-Haired Pirates: Crossed sabres, triple red scar over eye
      ctx.fillStyle = '#94a3b8';
      ctx.fillRect(16, 16, 32, 4);
      ctx.fillRect(16, 44, 32, 4);

      ctx.fillStyle = '#0f172a';
      ctx.beginPath();
      ctx.arc(32, 30, 12, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillRect(27, 39, 10, 6);

      ctx.fillStyle = '#f8fafc';
      ctx.fillRect(26, 27, 4, 5);
      ctx.fillRect(34, 27, 4, 5);

      ctx.fillStyle = '#b91c1c';
      ctx.fillRect(32, 20, 2, 18);
      ctx.fillRect(35, 21, 2, 17);
      ctx.fillRect(38, 23, 2, 14);

    } else if (targetCrew === 'heart' || shipId === 'polar_tang') {
      // Heart Pirates: Yellow background, black smiley hazard emblem
      ctx.fillStyle = '#eab308';
      ctx.fillRect(0, 0, 64, 64);

      ctx.fillStyle = '#0f172a';
      ctx.beginPath();
      ctx.arc(32, 32, 20, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#eab308';
      ctx.beginPath();
      ctx.arc(32, 32, 16, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = '#0f172a';
      for (let i = 0; i < 6; i++) {
        const rad = (i * Math.PI) / 3;
        const sx = 32 + Math.cos(rad) * 22;
        const sy = 32 + Math.sin(rad) * 22;
        ctx.fillRect(sx - 3, sy - 3, 6, 6);
      }

      ctx.beginPath();
      ctx.arc(32, 33, 9, 0.2 * Math.PI, 0.8 * Math.PI);
      ctx.lineWidth = 3;
      ctx.strokeStyle = '#0f172a';
      ctx.stroke();

    } else if (shipId === 'oro_jackson') {
      ctx.fillStyle = '#181113';
      ctx.fillRect(0, 0, 64, 64);
      ctx.fillStyle = '#cbd5e1';
      ctx.fillRect(14, 14, 36, 4);
      ctx.fillRect(14, 46, 36, 4);
      ctx.fillStyle = '#f1f5f9';
      ctx.beginPath();
      ctx.arc(32, 29, 11, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillRect(28, 37, 8, 5);
      ctx.fillStyle = '#0f172a';
      ctx.fillRect(24, 34, 16, 4);

    } else {
      // Straw Hats: Classic skull with yellow straw hat and red ribbon
      ctx.fillStyle = '#1e232a';
      ctx.fillRect(16, 16, 32, 6);
      ctx.fillRect(16, 42, 32, 6);
      ctx.fillRect(16, 16, 6, 32);
      ctx.fillRect(42, 16, 6, 32);

      ctx.fillStyle = '#111827';
      ctx.beginPath();
      ctx.arc(32, 32, 12, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillRect(27, 40, 10, 8);

      ctx.fillStyle = '#f8fafc';
      ctx.fillRect(26, 29, 4, 5);
      ctx.fillRect(34, 29, 4, 5);
      ctx.fillRect(28, 43, 8, 3);

      ctx.fillStyle = '#facc15';
      ctx.beginPath();
      ctx.ellipse(32, 22, 18, 5, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillRect(25, 14, 14, 9);
      ctx.fillStyle = '#dc2626';
      ctx.fillRect(25, 20, 14, 3);
    }

    const texture = new _THREE.CanvasTexture(canvas);
    texture.magFilter = _THREE.NearestFilter;
    texture.minFilter = _THREE.NearestFilter;
    _textureCache.set(cacheKey, texture);
    return texture;
  }

  // ---------------------------------------------------------------------------
  // High-Performance Voxel Geometry Builder (Merged per Material)
  // ---------------------------------------------------------------------------
  class VoxelBuilder {
    constructor() {
      this.positions = [];
      this.normals = [];
      this.colors = [];
      this.uvs = [];
      this.indices = [];
      this.vertexCount = 0;
    }

    /**
     * Adds an axis-aligned box with face lighting tints for crisp pixel-depth.
     * cx, cy, cz: center of box
     * sx, sy, sz: width (X), height (Y), depth (Z)
     * colorHex: base hex color (e.g. 0xffffff)
     */
    addBox(cx, cy, cz, sx, sy, sz, colorHex, options = {}) {
      const hx = sx * 0.5;
      const hy = sy * 0.5;
      const hz = sz * 0.5;

      const baseR = ((colorHex >> 16) & 255) / 255;
      const baseG = ((colorHex >> 8) & 255) / 255;
      const baseB = (colorHex & 255) / 255;

      // Subtle directional face shading (Sea of Stars style hand-dithered feel)
      const tints = {
        top: 1.18,    // +Y (sunlit deck/roofs)
        bottom: 0.70, // -Y (ambient keel occlusion)
        right: 1.05,  // +X (starboard)
        left: 0.95,   // -X (port)
        front: 1.05,  // +Z (bow/stern)
        back: 0.95    // -Z
      };

      // 6 Faces: [normal, [v0, v1, v2, v3], tint]
      const faces = [
        // Top (+Y)
        {
          n: [0, 1, 0],
          v: [
            [cx - hx, cy + hy, cz + hz],
            [cx + hx, cy + hy, cz + hz],
            [cx + hx, cy + hy, cz - hz],
            [cx - hx, cy + hy, cz - hz]
          ],
          tint: tints.top
        },
        // Bottom (-Y)
        {
          n: [0, -1, 0],
          v: [
            [cx - hx, cy - hy, cz + hz],
            [cx + hx, cy - hy, cz + hz],
            [cx + hx, cy - hy, cz - hz],
            [cx - hx, cy - hy, cz - hz]
          ],
          tint: tints.bottom
        },
        // Right (+X)
        {
          n: [1, 0, 0],
          v: [
            [cx + hx, cy - hy, cz + hz],
            [cx + hx, cy - hy, cz - hz],
            [cx + hx, cy + hy, cz - hz],
            [cx + hx, cy + hy, cz + hz]
          ],
          tint: tints.right
        },
        // Left (-X)
        {
          n: [-1, 0, 0],
          v: [
            [cx - hx, cy - hy, cz - hz],
            [cx - hx, cy - hy, cz + hz],
            [cx - hx, cy + hy, cz + hz],
            [cx - hx, cy + hy, cz - hz]
          ],
          tint: tints.left
        },
        // Front (+Z)
        {
          n: [0, 0, 1],
          v: [
            [cx - hx, cy - hy, cz + hz],
            [cx + hx, cy - hy, cz + hz],
            [cx + hx, cy + hy, cz + hz],
            [cx - hx, cy + hy, cz + hz]
          ],
          tint: tints.front
        },
        // Back (-Z)
        {
          n: [0, 0, -1],
          v: [
            [cx + hx, cy - hy, cz - hz],
            [cx - hx, cy - hy, cz - hz],
            [cx - hx, cy + hy, cz - hz],
            [cx + hx, cy + hy, cz - hz]
          ],
          tint: tints.back
        }
      ];

      for (let f = 0; f < 6; f++) {
        const face = faces[f];
        const r = Math.min(1.0, baseR * face.tint);
        const g = Math.min(1.0, baseG * face.tint);
        const b = Math.min(1.0, baseB * face.tint);

        const startIdx = this.vertexCount;

        for (let i = 0; i < 4; i++) {
          const pt = face.v[i];
          this.positions.push(pt[0], pt[1], pt[2]);
          this.normals.push(face.n[0], face.n[1], face.n[2]);
          this.colors.push(r, g, b);
        }

        this.uvs.push(0, 0, 1, 0, 1, 1, 0, 1);
        this.indices.push(
          startIdx, startIdx + 1, startIdx + 2,
          startIdx, startIdx + 2, startIdx + 3
        );
        this.vertexCount += 4;
      }
    }

    buildGeometry() {
      if (!_THREE) return null;
      const geom = new _THREE.BufferGeometry();
      geom.setAttribute('position', new _THREE.Float32BufferAttribute(this.positions, 3));
      geom.setAttribute('normal', new _THREE.Float32BufferAttribute(this.normals, 3));
      geom.setAttribute('color', new _THREE.Float32BufferAttribute(this.colors, 3));
      geom.setAttribute('uv', new _THREE.Float32BufferAttribute(this.uvs, 2));
      geom.setIndex(this.indices);
      return geom;
    }
  }

  // ---------------------------------------------------------------------------
  // Canonical Ship Voxel Model Generators
  // ---------------------------------------------------------------------------

  /**
   * Builds the merged hull, deck, and figurehead voxels for each canonical ship.
   * Adheres strictly to the bounding footprint:
   * Length max: (L * 0.85) * cellSize
   * Width max: 0.85 * cellSize
   * Guarantees a >= 7.5% margin on all borders, preventing any clipping.
   */
  function buildShipGeometry(shipId, cellSize, ownerColor, crewId) {
    const builder = new VoxelBuilder();
    const config = getShipConfig(shipId);
    const L = config.length;

    // Strict boundary clamps: 7.5% margin on each side
    const maxHalfLen = (L * 0.85 * cellSize) * 0.5;
    const maxHalfWidth = (0.85 * cellSize) * 0.5;

    const deckY = 0.36 * cellSize;
    const keelY = -0.16 * cellSize;
    const hullHeight = deckY - keelY;

    // Hull Wood/Base Tone (themed by crew faction)
    let hullCol = config.baseHullColor;
    let deckCol = config.deckColor;
    let accentCol = ownerColor !== undefined ? ownerColor : config.accentColor;

    if (crewId === 'marines') {
      hullCol = 0x1e3a8a; // Marine Navy Blue
      deckCol = 0xf8fafc; // Clean White Deck
      accentCol = 0xf59e0b; // Gold Anchor Trim
    } else if (crewId === 'blackbeard') {
      hullCol = 0x09090b; // Obsidian
      deckCol = 0x27272a; // Charred deck
      accentCol = 0x7c3aed; // Purple
    } else if (crewId === 'whitebeard' && shipId !== 'moby_dick') {
      hullCol = 0xf8fafc;
      deckCol = 0xd97706;
      accentCol = 0x38bdf8;
    }

    // 1. Base Keel & Hull Segments across cells (Sculpted Volumetric Hull)
    const cellStep = (maxHalfLen * 2) / L;
    for (let c = 0; c < L; c++) {
      const cellCenter = -maxHalfLen + (c + 0.5) * cellStep;
      const taper = (c === 0 || c === L - 1) ? 0.78 : 0.95;
      const w = maxHalfWidth * 2 * taper; // <= 0.80 * cellSize
      const len = cellStep * 0.92;

      // Lower Hull (Underwater Keel & Anti-fouling dark copper/wood tone)
      builder.addBox(cellCenter, keelY + hullHeight * 0.25, 0, len, hullHeight * 0.5, w * 0.75, 0x382214);
      // Mid Hull (Main Volumetric Timber)
      builder.addBox(cellCenter, keelY + hullHeight * 0.72, 0, len, hullHeight * 0.55, w * 0.92, hullCol);
      // Deck Planking (or Grass for Sunny)
      builder.addBox(cellCenter, deckY, 0, len * 0.92, 0.05 * cellSize, w * 0.82, deckCol);

      // Elevated Gunwales / Bulwarks with gunport recesses along sides
      const trimZ = (w * 0.5) - 0.01 * cellSize;
      builder.addBox(cellCenter, deckY + 0.07 * cellSize, trimZ, len, 0.10 * cellSize, 0.04 * cellSize, hullCol);
      builder.addBox(cellCenter, deckY + 0.07 * cellSize, -trimZ, len, 0.10 * cellSize, 0.04 * cellSize, hullCol);

      // Gilded / Faction Accent Sheer Line Strip
      builder.addBox(cellCenter, deckY + 0.12 * cellSize, trimZ, len, 0.03 * cellSize, 0.05 * cellSize, accentCol);
      builder.addBox(cellCenter, deckY + 0.12 * cellSize, -trimZ, len, 0.03 * cellSize, 0.05 * cellSize, accentCol);

      // Sheer line elevation: Forecastle on Bow & Poop Deck on Stern
      if (c === L - 1) {
        // Forecastle raised deck platform
        builder.addBox(cellCenter, deckY + 0.08 * cellSize, 0, len * 0.86, 0.12 * cellSize, w * 0.76, deckCol);
      } else if (c === 0) {
        // Quarterdeck / Poop deck raised aft castle
        builder.addBox(cellCenter, deckY + 0.10 * cellSize, 0, len * 0.86, 0.15 * cellSize, w * 0.86, deckCol);
      }
    }

    // 2. Ship-Specific Canonical Figureheads & Features (strictly clamped within bounds)
    if (config.figurehead === 'whale' || shipId === 'moby_dick') {
      // Whitebeard Whale Bow & Stern Quarters
      const bowX = maxHalfLen - 0.22 * cellSize;
      // Bright White/Ivory Whale Head
      builder.addBox(bowX, deckY + 0.14 * cellSize, 0, 0.28 * cellSize, 0.32 * cellSize, maxHalfWidth * 1.4, 0xf8fafc);
      // Whale mouth slit
      builder.addBox(bowX + 0.08 * cellSize, deckY + 0.04 * cellSize, 0, 0.14 * cellSize, 0.04 * cellSize, maxHalfWidth * 1.42, 0x1e293b);
      // Vivid Sky-Blue whale waterline stripes
      builder.addBox(bowX, keelY + 0.06 * cellSize, 0, 0.26 * cellSize, 0.07 * cellSize, maxHalfWidth * 1.35, 0x38bdf8);
      // Whale blowhole
      builder.addBox(bowX - 0.02 * cellSize, deckY + 0.30 * cellSize, 0, 0.07 * cellSize, 0.05 * cellSize, 0.07 * cellSize, 0x0284c7);

      // Elevated Stern Castle / Quarters
      const sternX = -maxHalfLen + 0.28 * cellSize;
      builder.addBox(sternX, deckY + 0.16 * cellSize, 0, 0.48 * cellSize, 0.24 * cellSize, maxHalfWidth * 1.5, 0x475569);
      // Stern Windows (golden glowing voxels)
      builder.addBox(sternX - 0.22 * cellSize, deckY + 0.18 * cellSize, 0, 0.03 * cellSize, 0.10 * cellSize, maxHalfWidth * 1.2, 0xfde047);

    } else if (config.figurehead === 'lion' || shipId === 'thousand_sunny') {
      // Oversized Golden Lion Figurehead (at least 0.55 * cellSize tall!)
      const bowX = maxHalfLen - 0.20 * cellSize;
      // Smiling Golden Face
      builder.addBox(bowX, deckY + 0.18 * cellSize, 0, 0.22 * cellSize, 0.34 * cellSize, 0.28 * cellSize, 0xfacc15);
      // 8 Radiant Lion Mane Petals (oversized ring)
      const maneR = 0.24 * cellSize;
      for (let m = 0; m < 8; m++) {
        const rad = (m * Math.PI) / 4;
        const my = deckY + 0.18 * cellSize + Math.sin(rad) * maneR;
        const mz = Math.cos(rad) * maneR;
        builder.addBox(bowX - 0.04 * cellSize, my, mz, 0.11 * cellSize, 0.09 * cellSize, 0.09 * cellSize, (m % 2 === 0 ? 0xf97316 : 0xfacc15));
      }
      // Cheerful Eyes & Nose
      builder.addBox(bowX + 0.08 * cellSize, deckY + 0.22 * cellSize, 0.06 * cellSize, 0.04 * cellSize, 0.04 * cellSize, 0.04 * cellSize, 0x0f172a);
      builder.addBox(bowX + 0.08 * cellSize, deckY + 0.22 * cellSize, -0.06 * cellSize, 0.04 * cellSize, 0.04 * cellSize, 0.04 * cellSize, 0x0f172a);
      // Crossbone paws
      builder.addBox(bowX, deckY - 0.02 * cellSize, 0.16 * cellSize, 0.12 * cellSize, 0.07 * cellSize, 0.07 * cellSize, 0xf8fafc);
      builder.addBox(bowX, deckY - 0.02 * cellSize, -0.16 * cellSize, 0.12 * cellSize, 0.07 * cellSize, 0.07 * cellSize, 0xf8fafc);

      // Tangerine Trees at upper aft deck (Nami's Mikan grove)
      const sternX = -maxHalfLen + 0.35 * cellSize;
      // Upper library deck
      builder.addBox(sternX, deckY + 0.14 * cellSize, 0, 0.45 * cellSize, 0.20 * cellSize, maxHalfWidth * 1.5, 0xffffff);
      // 3 Tangerine Trees
      const treeOffsets = [-0.12 * cellSize, 0, 0.12 * cellSize];
      for (const to of treeOffsets) {
        // Trunk
        builder.addBox(sternX + 0.04 * cellSize, deckY + 0.28 * cellSize, to, 0.03 * cellSize, 0.10 * cellSize, 0.03 * cellSize, 0x78350f);
        // Foliage
        builder.addBox(sternX + 0.04 * cellSize, deckY + 0.36 * cellSize, to, 0.10 * cellSize, 0.10 * cellSize, 0.10 * cellSize, 0x15803d);
        // Orange Tangerines
        builder.addBox(sternX + 0.06 * cellSize, deckY + 0.38 * cellSize, to + 0.03 * cellSize, 0.03 * cellSize, 0.03 * cellSize, 0.03 * cellSize, 0xf97316);
      }

      // Soldier Dock System number plates ("1", "2")
      const plateZ = maxHalfWidth * 0.92;
      builder.addBox(0, deckY - 0.02 * cellSize, plateZ, 0.16 * cellSize, 0.16 * cellSize, 0.02 * cellSize, 0x1e293b);
      builder.addBox(0, deckY - 0.02 * cellSize, -plateZ, 0.16 * cellSize, 0.16 * cellSize, 0.02 * cellSize, 0x1e293b);

    } else if (shipId === 'oro_jackson') {
      // Golden Mermaid Bow Arches & Oversized Spotted Egg
      const bowX = maxHalfLen - 0.18 * cellSize;
      // Twin Golden Mermaids flanking bow stem
      builder.addBox(bowX, deckY + 0.14 * cellSize, 0.12 * cellSize, 0.18 * cellSize, 0.28 * cellSize, 0.08 * cellSize, 0xfacc15);
      builder.addBox(bowX, deckY + 0.14 * cellSize, -0.12 * cellSize, 0.18 * cellSize, 0.28 * cellSize, 0.08 * cellSize, 0xfacc15);
      // Bow Chase Cannons
      builder.addBox(bowX + 0.06 * cellSize, deckY + 0.07 * cellSize, 0, 0.18 * cellSize, 0.07 * cellSize, 0.12 * cellSize, 0x334155);

      // Roger's Oversized Red-and-White Spotted Egg on mid-deck
      builder.addBox(-0.12 * cellSize, deckY + 0.22 * cellSize, 0, 0.30 * cellSize, 0.36 * cellSize, 0.30 * cellSize, 0xdc2626);
      builder.addBox(-0.12 * cellSize, deckY + 0.26 * cellSize, 0.14 * cellSize, 0.10 * cellSize, 0.10 * cellSize, 0.04 * cellSize, 0xf8fafc); // White spot
      builder.addBox(-0.12 * cellSize, deckY + 0.20 * cellSize, -0.14 * cellSize, 0.10 * cellSize, 0.10 * cellSize, 0.04 * cellSize, 0xf8fafc);
      builder.addBox(-0.02 * cellSize, deckY + 0.32 * cellSize, 0, 0.08 * cellSize, 0.08 * cellSize, 0.08 * cellSize, 0xf8fafc);

      // Ornate Stern Gallery
      const sternX = -maxHalfLen + 0.30 * cellSize;
      builder.addBox(sternX, deckY + 0.18 * cellSize, 0, 0.45 * cellSize, 0.28 * cellSize, maxHalfWidth * 1.5, 0x5c1414);
      builder.addBox(sternX - 0.20 * cellSize, deckY + 0.20 * cellSize, 0, 0.03 * cellSize, 0.12 * cellSize, maxHalfWidth * 1.3, 0xfacc15);

    } else if (config.figurehead === 'dragon' || shipId === 'red_force') {
      // Prominent Red Dragon Figurehead
      const bowX = maxHalfLen - 0.16 * cellSize;
      // Dragon Head
      builder.addBox(bowX, deckY + 0.16 * cellSize, 0, 0.24 * cellSize, 0.24 * cellSize, 0.20 * cellSize, 0xef4444);
      // Golden Dragon Horns
      builder.addBox(bowX - 0.05 * cellSize, deckY + 0.30 * cellSize, 0.06 * cellSize, 0.06 * cellSize, 0.14 * cellSize, 0.04 * cellSize, 0xfacc15);
      builder.addBox(bowX - 0.05 * cellSize, deckY + 0.30 * cellSize, -0.06 * cellSize, 0.06 * cellSize, 0.14 * cellSize, 0.04 * cellSize, 0xfacc15);
      // Dragon Snout
      builder.addBox(bowX + 0.10 * cellSize, deckY + 0.12 * cellSize, 0, 0.09 * cellSize, 0.10 * cellSize, 0.14 * cellSize, 0x991b1b);

      // Palm Tree in Tub at Stern Deck
      const sternX = -maxHalfLen + 0.22 * cellSize;
      // Wooden Tub
      builder.addBox(sternX, deckY + 0.07 * cellSize, 0, 0.14 * cellSize, 0.10 * cellSize, 0.14 * cellSize, 0x78350f);
      // Palm Trunk
      builder.addBox(sternX, deckY + 0.18 * cellSize, 0, 0.04 * cellSize, 0.16 * cellSize, 0.04 * cellSize, 0xb45309);
      // Palm Fronds
      builder.addBox(sternX, deckY + 0.26 * cellSize, 0, 0.24 * cellSize, 0.04 * cellSize, 0.24 * cellSize, 0x16a34a);

    } else if (config.isSubmarine || shipId === 'polar_tang') {
      // Vivid Canary Yellow Submarine with Cyan Windows
      const midY = deckY + 0.06 * cellSize;
      // Conning Tower
      builder.addBox(0.04 * cellSize, midY + 0.18 * cellSize, 0, 0.45 * cellSize, 0.28 * cellSize, 0.26 * cellSize, 0xfacc15);
      // Cyan-Blue Conning Tower Observation Windows
      builder.addBox(0.12 * cellSize, midY + 0.22 * cellSize, 0, 0.20 * cellSize, 0.08 * cellSize, 0.28 * cellSize, 0x38bdf8);
      // Periscope mast
      builder.addBox(0.10 * cellSize, midY + 0.38 * cellSize, 0, 0.03 * cellSize, 0.18 * cellSize, 0.03 * cellSize, 0x334155);
      builder.addBox(0.10 * cellSize, midY + 0.46 * cellSize, 0.02 * cellSize, 0.06 * cellSize, 0.03 * cellSize, 0.03 * cellSize, 0x38bdf8);

      // Twin Side Ballast Pontoons (strictly within maxHalfWidth)
      const pontoonLen = (maxHalfLen * 2) * 0.70;
      const pontoonZ = maxHalfWidth * 0.78;
      builder.addBox(0, keelY + 0.08 * cellSize, pontoonZ, pontoonLen, 0.12 * cellSize, 0.12 * cellSize, 0xeab308);
      builder.addBox(0, keelY + 0.08 * cellSize, -pontoonZ, pontoonLen, 0.12 * cellSize, 0.12 * cellSize, 0xeab308);

      // Aft Brass Screw Propeller & Rudder
      const aftX = -maxHalfLen + 0.08 * cellSize;
      builder.addBox(aftX, keelY + 0.09 * cellSize, 0, 0.06 * cellSize, 0.14 * cellSize, 0.03 * cellSize, 0xd97706);
      builder.addBox(aftX - 0.03 * cellSize, keelY + 0.09 * cellSize, 0, 0.03 * cellSize, 0.11 * cellSize, 0.11 * cellSize, 0xb45309);

    } else if (config.figurehead === 'fish_mouth' || shipId === 'baratie') {
      // Whimsical Giant Fish Restaurant with Big Eyes & Turquoise Fins
      const bowX = maxHalfLen - 0.18 * cellSize;
      // Open Fish-Mouth Bow
      builder.addBox(bowX, deckY + 0.14 * cellSize, 0, 0.22 * cellSize, 0.26 * cellSize, maxHalfWidth * 1.4, 0xfb923c);
      // Red interior mouth cavity
      builder.addBox(bowX + 0.07 * cellSize, deckY + 0.12 * cellSize, 0, 0.08 * cellSize, 0.14 * cellSize, maxHalfWidth * 1.0, 0xdc2626);
      // White teeth
      builder.addBox(bowX + 0.10 * cellSize, deckY + 0.18 * cellSize, 0, 0.04 * cellSize, 0.04 * cellSize, maxHalfWidth * 0.9, 0xffffff);
      builder.addBox(bowX + 0.10 * cellSize, deckY + 0.06 * cellSize, 0, 0.04 * cellSize, 0.04 * cellSize, maxHalfWidth * 0.9, 0xffffff);
      // Big round fish eyes with blue pupils
      builder.addBox(bowX - 0.02 * cellSize, deckY + 0.20 * cellSize, maxHalfWidth * 0.72, 0.07 * cellSize, 0.07 * cellSize, 0.03 * cellSize, 0xf8fafc);
      builder.addBox(bowX, deckY + 0.20 * cellSize, maxHalfWidth * 0.74, 0.04 * cellSize, 0.04 * cellSize, 0.03 * cellSize, 0x0284c7);
      builder.addBox(bowX - 0.02 * cellSize, deckY + 0.20 * cellSize, -maxHalfWidth * 0.72, 0.07 * cellSize, 0.07 * cellSize, 0.03 * cellSize, 0xf8fafc);
      builder.addBox(bowX, deckY + 0.20 * cellSize, -maxHalfWidth * 0.74, 0.04 * cellSize, 0.04 * cellSize, 0.03 * cellSize, 0x0284c7);

      // Tiered Restaurant Dining Decks & Striped Awnings
      builder.addBox(-0.08 * cellSize, deckY + 0.15 * cellSize, 0, 0.80 * cellSize, 0.22 * cellSize, maxHalfWidth * 1.4, 0xfde047);
      // Red & white striped awning roof
      builder.addBox(-0.08 * cellSize, deckY + 0.27 * cellSize, 0, 0.88 * cellSize, 0.05 * cellSize, maxHalfWidth * 1.5, 0xef4444);
      // Kitchen chimney stove pipe
      builder.addBox(-0.20 * cellSize, deckY + 0.38 * cellSize, 0.06 * cellSize, 0.05 * cellSize, 0.18 * cellSize, 0.05 * cellSize, 0x475569);

      // Turquoise side fins (Sabagashira battle platforms, strictly clamped to maxHalfWidth)
      const finZ = maxHalfWidth * 0.76;
      builder.addBox(-0.05 * cellSize, deckY - 0.02 * cellSize, finZ, 0.55 * cellSize, 0.03 * cellSize, 0.16 * cellSize, 0x2dd4bf);
      builder.addBox(-0.05 * cellSize, deckY - 0.02 * cellSize, -finZ, 0.55 * cellSize, 0.03 * cellSize, 0.16 * cellSize, 0x2dd4bf);

    } else if (config.figurehead === 'sheep' || shipId === 'going_merry') {
      // Prominent Sculpted White/Gold Curved-Horn Sheep Figurehead
      const bowX = maxHalfLen - 0.15 * cellSize;
      // White/Cream Sheep Head
      builder.addBox(bowX, deckY + 0.14 * cellSize, 0, 0.18 * cellSize, 0.20 * cellSize, 0.20 * cellSize, 0xfef3c7);
      // Curved Golden Ram Horns
      builder.addBox(bowX - 0.04 * cellSize, deckY + 0.22 * cellSize, 0.12 * cellSize, 0.07 * cellSize, 0.14 * cellSize, 0.07 * cellSize, 0xfacc15);
      builder.addBox(bowX - 0.04 * cellSize, deckY + 0.22 * cellSize, -0.12 * cellSize, 0.07 * cellSize, 0.14 * cellSize, 0.07 * cellSize, 0xfacc15);
      // Sheep Smile & Eyes
      builder.addBox(bowX + 0.08 * cellSize, deckY + 0.15 * cellSize, 0.04 * cellSize, 0.03 * cellSize, 0.03 * cellSize, 0.02 * cellSize, 0x0f172a);
      builder.addBox(bowX + 0.08 * cellSize, deckY + 0.15 * cellSize, -0.04 * cellSize, 0.03 * cellSize, 0.03 * cellSize, 0.02 * cellSize, 0x0f172a);
      builder.addBox(bowX + 0.08 * cellSize, deckY + 0.10 * cellSize, 0, 0.04 * cellSize, 0.03 * cellSize, 0.06 * cellSize, 0xf59e0b);

      // Bellemère's Tangerine Grove at Stern Poop Deck
      const sternX = -maxHalfLen + 0.20 * cellSize;
      builder.addBox(sternX, deckY + 0.10 * cellSize, 0, 0.28 * cellSize, 0.14 * cellSize, maxHalfWidth * 1.4, 0xb45309);
      // 3 Tiny Tangerine Trees
      const mikanOffsets = [-0.08 * cellSize, 0, 0.08 * cellSize];
      for (const mo of mikanOffsets) {
        builder.addBox(sternX + 0.02 * cellSize, deckY + 0.20 * cellSize, mo, 0.02 * cellSize, 0.08 * cellSize, 0.02 * cellSize, 0x78350f);
        builder.addBox(sternX + 0.02 * cellSize, deckY + 0.26 * cellSize, mo, 0.08 * cellSize, 0.08 * cellSize, 0.08 * cellSize, 0x16a34a);
        builder.addBox(sternX + 0.04 * cellSize, deckY + 0.28 * cellSize, mo + 0.02 * cellSize, 0.02 * cellSize, 0.02 * cellSize, 0.02 * cellSize, 0xf97316);
      }
    }

    return builder.buildGeometry();
  }

  // ---------------------------------------------------------------------------
  // Animated Sub-Nodes: Fluttering Sails, Masts, and Pennants
  // ---------------------------------------------------------------------------
  function buildSailAndMasts(shipId, cellSize, ownerColor, crewId) {
    if (!_THREE) return new _THREE.Group();

    const config = getShipConfig(shipId);
    const group = new _THREE.Group();
    group.name = 'mastsAndSailsGroup';

    if (config.masts === 0 || config.isSubmarine) return group;

    const L = config.length;
    const maxHalfLen = (L * 0.85 * cellSize) * 0.5;
    const targetCrew = crewId || (config ? config.crewId : 'straw_hats');
    const sailTexture = getJollyRogerTexture(shipId, targetCrew);

    const sailMat = new _THREE.MeshBasicMaterial({
      map: sailTexture,
      side: _THREE.DoubleSide
    });

    const gradMap = getToonGradientMap();
    const mastMat = (gradMap && _THREE.MeshToonMaterial) ? new _THREE.MeshToonMaterial({
      color: 0x78350f,
      gradientMap: gradMap
    }) : new _THREE.MeshLambertMaterial({
      color: 0x78350f
    });

    const pennantColor = ownerColor !== undefined ? ownerColor : config.accentColor;
    const pennantMat = new _THREE.MeshBasicMaterial({
      color: pennantColor,
      side: _THREE.DoubleSide
    });

    const mastCount = config.masts;
    const sailNodes = [];

    // Mast positions along ship length
    const mastXs = [];
    if (mastCount === 1) {
      mastXs.push(0);
    } else if (mastCount === 2) {
      mastXs.push(maxHalfLen * 0.35, -maxHalfLen * 0.35);
    } else if (mastCount === 3) {
      mastXs.push(maxHalfLen * 0.45, 0, -maxHalfLen * 0.45);
    }

    const deckBaseY = 0.36 * cellSize;

    for (let m = 0; m < mastCount; m++) {
      const mx = mastXs[m];
      const isMainMast = (mastCount === 1) || (mastCount === 3 && m === 1) || (mastCount === 2 && m === 0);
      const mastHeight = (isMainMast ? 1.65 : 1.35) * cellSize;

      const mastGeom = new _THREE.BoxGeometry(0.07 * cellSize, mastHeight, 0.07 * cellSize);
      const mastMesh = new _THREE.Mesh(mastGeom, mastMat);
      mastMesh.position.set(mx, deckBaseY + mastHeight * 0.5, 0);
      mastMesh.castShadow = true;
      group.add(mastMesh);

      // Yards (crossbars)
      const yardWidth = (isMainMast ? 0.82 : 0.64) * cellSize;
      const yardGeom = new _THREE.BoxGeometry(0.05 * cellSize, 0.05 * cellSize, yardWidth);
      const yardMesh = new _THREE.Mesh(yardGeom, mastMat);
      yardMesh.position.set(mx, deckBaseY + mastHeight * 0.85, 0);
      group.add(yardMesh);

      // Sail Quad Mesh (enlarged for prominent, billowing Jolly Roger display)
      const sailH = (isMainMast ? 0.95 : 0.75) * cellSize;
      const sailW = (isMainMast ? 0.80 : 0.62) * cellSize;
      const sailGeom = new _THREE.PlaneGeometry(sailW, sailH, 4, 4);

      // Bow sail curvature for realistic wind billow
      const posAttr = sailGeom && sailGeom.attributes ? sailGeom.attributes.position : null;
      if (posAttr && posAttr.count) {
        for (let i = 0; i < posAttr.count; i++) {
          const u = posAttr.getX(i) / (sailW * 0.5);
          const billow = (1.0 - u * u) * (0.13 * cellSize);
          posAttr.setZ(i, billow);
        }
      }
      if (sailGeom.computeVertexNormals) sailGeom.computeVertexNormals();

      const sailMesh = new _THREE.Mesh(sailGeom, sailMat);
      // Place sail hanging from crossbar, angled 35° diagonally toward isometric camera
      sailMesh.position.set(mx + 0.04 * cellSize, deckBaseY + mastHeight * 0.52, 0);
      sailMesh.rotation.y = Math.PI * 0.22;
      sailMesh.castShadow = true;
      group.add(sailMesh);

      sailNodes.push({
        mesh: sailMesh,
        baseY: sailMesh.position.y,
        phase: m * 1.3
      });

      // Top Mast Pennant (waving in wind)
      const pennantGeom = new _THREE.BufferGeometry();
      const pVertices = new Float32Array([
        0, 0, 0,
        -0.28 * cellSize, -0.05 * cellSize, 0,
        0, -0.11 * cellSize, 0
      ]);
      pennantGeom.setAttribute('position', new _THREE.BufferAttribute(pVertices, 3));
      if (pennantGeom.computeVertexNormals) pennantGeom.computeVertexNormals();
      const pennantMesh = new _THREE.Mesh(pennantGeom, pennantMat);
      pennantMesh.position.set(mx, deckBaseY + mastHeight, 0);
      group.add(pennantMesh);

      // Crow's nest for Thousand Sunny / Going Merry
      if (isMainMast && (shipId === 'thousand_sunny' || shipId === 'going_merry')) {
        const nestGeom = new _THREE.CylinderGeometry(0.14 * cellSize, 0.11 * cellSize, 0.14 * cellSize, 8);
        const nestMesh = new _THREE.Mesh(nestGeom, mastMat);
        nestMesh.position.set(mx, deckBaseY + mastHeight * 0.90, 0);
        group.add(nestMesh);
      }
    }

    group.userData.sailNodes = sailNodes;
    return group;
  }

  // ---------------------------------------------------------------------------
  // Broadside Recoiling Cannons
  // ---------------------------------------------------------------------------
  function buildCannons(shipId, cellSize) {
    if (!_THREE) return { port: new _THREE.Group(), starboard: new _THREE.Group() };

    const config = getShipConfig(shipId);
    const portGroup = new _THREE.Group();
    const stbdGroup = new _THREE.Group();
    portGroup.name = 'cannonsPort';
    stbdGroup.name = 'cannonsStarboard';

    if (!config.hasCannons || config.cannonCountPerSide === 0) {
      return { port: portGroup, starboard: stbdGroup };
    }

    const cannonCount = config.cannonCountPerSide;
    const L = config.length;
    const maxHalfLen = (L * 0.85 * cellSize) * 0.5;
    const maxHalfWidth = (0.85 * cellSize) * 0.5;

    const gradMap = getToonGradientMap();
    const cannonMat = (gradMap && _THREE.MeshToonMaterial) ? new _THREE.MeshToonMaterial({
      color: 0x334155,
      gradientMap: gradMap
    }) : new _THREE.MeshLambertMaterial({
      color: 0x334155
    });

    const spacing = (maxHalfLen * 1.5) / (cannonCount + 1);
    for (let i = 0; i < cannonCount; i++) {
      const cx = -maxHalfLen * 0.75 + (i + 1) * spacing;

      // Port Cannon (+Z side)
      const portBarrel = new _THREE.Mesh(
        new _THREE.CylinderGeometry(0.045 * cellSize, 0.055 * cellSize, 0.20 * cellSize, 8),
        cannonMat
      );
      portBarrel.rotation.x = Math.PI * 0.5;
      portBarrel.position.set(cx, 0.32 * cellSize, maxHalfWidth + 0.04 * cellSize);
      portGroup.add(portBarrel);

      // Starboard Cannon (-Z side)
      const stbdBarrel = new _THREE.Mesh(
        new _THREE.CylinderGeometry(0.045 * cellSize, 0.055 * cellSize, 0.20 * cellSize, 8),
        cannonMat
      );
      stbdBarrel.rotation.x = -Math.PI * 0.5;
      stbdBarrel.position.set(cx, 0.32 * cellSize, -maxHalfWidth - 0.04 * cellSize);
      stbdGroup.add(stbdBarrel);
    }

    return { port: portGroup, starboard: stbdGroup };
  }

  // ---------------------------------------------------------------------------
  // Ship Lanterns & Night Lighting
  // ---------------------------------------------------------------------------
  function buildLanterns(shipId, cellSize) {
    if (!_THREE) return new _THREE.Group();

    const group = new _THREE.Group();
    group.name = 'lanternsGroup';

    const lanternMat = new _THREE.MeshLambertMaterial({
      color: 0xffe066,
      emissive: 0xffaa22
    });

    const config = getShipConfig(shipId);
    const L = config.length;
    const maxHalfLen = (L * 0.85 * cellSize) * 0.5;

    // Stern Lantern
    const sternLantern = new _THREE.Mesh(
      new _THREE.BoxGeometry(0.08 * cellSize, 0.12 * cellSize, 0.08 * cellSize),
      lanternMat
    );
    sternLantern.position.set(-maxHalfLen + 0.10 * cellSize, 0.45 * cellSize, 0);
    group.add(sternLantern);

    // Optional Point Light for night mood
    const light = new _THREE.PointLight(0xffa726, 1.2, 3.5 * cellSize);
    light.position.copy(sternLantern.position);
    light.castShadow = false;
    group.add(light);
    group.userData.pointLight = light;

    return group;
  }

  // ---------------------------------------------------------------------------
  // Instanced Deck Crew (THREE.InstancedMesh)
  // ---------------------------------------------------------------------------
  function buildInstancedDeckCrew(shipId, cellSize) {
    if (!_THREE) return new _THREE.Group();

    const group = new _THREE.Group();
    group.name = 'deckCrewGroup';

    const config = getShipConfig(shipId);
    const L = config.length;
    const maxHalfLen = (L * 0.85 * cellSize) * 0.5;

    // Crew slots on deck
    const crewSlots = [];
    if (shipId === 'baratie') {
      // 4 Chefs in white toques
      crewSlots.push(
        { x: -0.15 * cellSize, z: 0.18 * cellSize, isChef: true },
        { x: -0.15 * cellSize, z: -0.18 * cellSize, isChef: true },
        { x: 0.15 * cellSize, z: 0.15 * cellSize, isChef: true },
        { x: 0.15 * cellSize, z: -0.15 * cellSize, isChef: true }
      );
    } else if (shipId === 'polar_tang') {
      // 2 Heart crew in orange boiler-suits
      crewSlots.push(
        { x: 0.05 * cellSize, z: 0.10 * cellSize, color: 0xf97316 },
        { x: 0.05 * cellSize, z: -0.10 * cellSize, color: 0xf97316 }
      );
    } else {
      // Pirates / Marines
      const count = Math.min(5, Math.max(2, L));
      for (let i = 0; i < count; i++) {
        const t = (i + 1) / (count + 1);
        const cx = -maxHalfLen * 0.6 + t * (maxHalfLen * 1.2);
        const cz = (i % 2 === 0 ? 1 : -1) * 0.15 * cellSize;
        crewSlots.push({ x: cx, z: cz, color: (i === 0 ? 0xdc2626 : 0x0284c7) });
      }
    }

    if (crewSlots.length === 0) return group;

    // Compact voxel figure geometry (Head, Torso, Legs) ~0.16 cellSize tall
    const figBuilder = new VoxelBuilder();
    figBuilder.addBox(0, 0.04 * cellSize, 0, 0.06 * cellSize, 0.08 * cellSize, 0.06 * cellSize, 0x1e293b); // Legs
    figBuilder.addBox(0, 0.10 * cellSize, 0, 0.08 * cellSize, 0.07 * cellSize, 0.07 * cellSize, 0xd97706); // Torso
    figBuilder.addBox(0, 0.16 * cellSize, 0, 0.07 * cellSize, 0.07 * cellSize, 0.07 * cellSize, 0xfde047); // Head

    if (shipId === 'baratie') {
      // White Chef Hat
      figBuilder.addBox(0, 0.22 * cellSize, 0, 0.08 * cellSize, 0.08 * cellSize, 0.08 * cellSize, 0xffffff);
    }

    const crewGeom = figBuilder.buildGeometry();
    const gradMap = getToonGradientMap();
    const crewMat = (gradMap && _THREE.MeshToonMaterial) ? new _THREE.MeshToonMaterial({
      vertexColors: true,
      gradientMap: gradMap,
      side: _THREE.DoubleSide
    }) : new _THREE.MeshLambertMaterial({
      vertexColors: true,
      side: _THREE.DoubleSide
    });

    const instMesh = new _THREE.InstancedMesh(crewGeom, crewMat, crewSlots.length);
    const dummy = new _THREE.Object3D();

    for (let i = 0; i < crewSlots.length; i++) {
      const slot = crewSlots[i];
      dummy.position.set(slot.x, 0.23 * cellSize, slot.z);
      dummy.scale.set(1, 1, 1);
      dummy.updateMatrix();
      instMesh.setMatrixAt(i, dummy.matrix);
    }
    instMesh.instanceMatrix.needsUpdate = true;
    instMesh.castShadow = true;

    group.add(instMesh);
    group.userData.instMesh = instMesh;
    group.userData.slots = crewSlots;
    group.userData.dummy = dummy;

    return group;
  }

  // ---------------------------------------------------------------------------
  // White Waterline Wake Voxels (Stepped Pixel-Art Blocks)
  // ---------------------------------------------------------------------------
  function buildWakeFoam(shipId, cellSize) {
    if (!_THREE) return new _THREE.Group();

    const group = new _THREE.Group();
    group.name = 'wakeFoamGroup';

    const config = getShipConfig(shipId);
    const L = config.length;
    const maxHalfLen = (L * 0.85 * cellSize) * 0.5;
    const maxHalfWidth = (0.85 * cellSize) * 0.5;

    const wakeMat = new _THREE.MeshLambertMaterial({
      color: 0xf0fdfa,
      emissive: 0x99f6e4,
      emissiveIntensity: 0.35,
      transparent: true,
      opacity: 0.85,
      side: _THREE.DoubleSide
    });

    const wakeBuilder = new VoxelBuilder();
    // Stepped pixel-art bow chevron wake blocks
    const bowX = maxHalfLen - 0.05 * cellSize;
    wakeBuilder.addBox(bowX + 0.06 * cellSize, 0.02 * cellSize, 0, 0.08 * cellSize, 0.04 * cellSize, 0.16 * cellSize, 0xffffff);
    wakeBuilder.addBox(bowX, 0.02 * cellSize, 0.14 * cellSize, 0.08 * cellSize, 0.04 * cellSize, 0.12 * cellSize, 0xf0fdfa);
    wakeBuilder.addBox(bowX, 0.02 * cellSize, -0.14 * cellSize, 0.08 * cellSize, 0.04 * cellSize, 0.12 * cellSize, 0xf0fdfa);

    // Flank stepped foam blocks along waterline
    const flankCount = Math.max(4, L * 2);
    for (let f = 0; f < flankCount; f++) {
      const fx = -maxHalfLen * 0.85 + (f / (flankCount - 1)) * (maxHalfLen * 1.7);
      const fz = maxHalfWidth * 0.95;
      const foamW = 0.08 * cellSize;
      const foamL = (maxHalfLen / flankCount) * 0.85;
      wakeBuilder.addBox(fx, 0.02 * cellSize, fz, foamL, 0.03 * cellSize, foamW, 0xf0fdfa);
      wakeBuilder.addBox(fx, 0.02 * cellSize, -fz, foamL, 0.03 * cellSize, foamW, 0xf0fdfa);
    }

    const geom = wakeBuilder.buildGeometry();
    const mesh = new _THREE.Mesh(geom, wakeMat);
    group.add(mesh);
    return group;
  }

  // ---------------------------------------------------------------------------
  // Discrete 4-Tone Cel-Shading Ramp for Anime / Flow Concept Art Look
  // ---------------------------------------------------------------------------
  let _toonGradientMap = null;
  function getToonGradientMap() {
    if (_toonGradientMap) return _toonGradientMap;
    if (typeof document === 'undefined' || !_THREE) return null;
    const canvas = document.createElement('canvas');
    canvas.width = 4;
    canvas.height = 1;
    const ctx = canvas.getContext('2d');
    // 4 discrete stepped shades for authentic hand-drawn cel-shading
    const shades = ['#555555', '#777777', '#bbbbbb', '#ffffff'];
    for (let i = 0; i < 4; i++) {
      ctx.fillStyle = shades[i];
      ctx.fillRect(i, 0, 1, 1);
    }
    const texture = new _THREE.CanvasTexture(canvas);
    texture.minFilter = _THREE.NearestFilter;
    texture.magFilter = _THREE.NearestFilter;
    _toonGradientMap = texture;
    return texture;
  }

  // ---------------------------------------------------------------------------
  // GLTF Low-Poly 3D Ship Model Loader, Per-Ship Custom Skin & Cache
  // ---------------------------------------------------------------------------
  const GLTF_SHIP_MODELS = {
    large_pirate: 'assets/models/ships/ship-pirate-large.glb',
    large_royal: 'assets/models/ships/ship-large.glb',
    medium_pirate: 'assets/models/ships/ship-pirate-medium.glb',
    medium_royal: 'assets/models/ships/ship-medium.glb',
    small_pirate: 'assets/models/ships/ship-pirate-small.glb',
    small_royal: 'assets/models/ships/ship-small.glb',
    boat_large: 'assets/models/ships/boat-row-large.glb',
    boat_small: 'assets/models/ships/boat-row-small.glb',
    ghost: 'assets/models/ships/ship-ghost.glb',
    wreck: 'assets/models/ships/ship-wreck.glb'
  };

  /**
   * Per-ship unique visual silhouette, color palette, bow figurehead & deck accents.
   * Ensures every faction AND every individual ship inside each 5-ship fleet
   * stands out with distinct geometry, sails, wood stain, and iconic traits.
   */
  const SHIP_VISUAL_IDENTITIES = {
    // ================= CHAPÉUS DE PALHA =================
    barto_club: {
      model: 'large_pirate',
      hull: '#15803d', cabin: '#dc2626', deck: '#b45309',
      sail: '#facc15', skull: '#ffffff', trim: '#f59e0b', iron: '#1e293b',
      figurehead: 'lion', mastFlag: true, hasBarrels: true, hideNodes: []
    },
    thousand_sunny: {
      model: 'large_royal',
      hull: '#dc2626', cabin: '#f8fafc', deck: '#22c55e',
      sail: '#fef9c3', skull: '#dc2626', trim: '#facc15', iron: '#334155',
      figurehead: 'lion', hasGrassDeck: true, mastFlag: true, hideNodes: []
    },
    mini_merry: {
      model: 'small_royal',
      hull: '#f8fafc', cabin: '#fef3c7', deck: '#d97706',
      sail: '#e0f2fe', skull: '#0284c7', trim: '#38bdf8', iron: '#475569',
      figurehead: 'sheep', hasPaddleWheels: true, mastFlag: true, hideNodes: ['flag-b']
    },
    shark_submerge: {
      isStylizedSub: true,
      hull: '#0284c7', belly: '#f8fafc', fin: '#ef4444', trim: '#facc15', dome: '#fde047',
      subVariant: 'shark'
    },
    going_merry: {
      model: 'medium_royal',
      hull: '#fef3c7', cabin: '#b45309', deck: '#d97706',
      sail: '#ffffff', skull: '#ffffff', trim: '#f97316', iron: '#334155',
      figurehead: 'sheep', mastFlag: true, hideNodes: ['sail-b', 'flag-c']
    },

    // ================= MARINHA (SAKAZUKI / AKAINU) =================
    marine_warship: {
      model: 'large_royal',
      hull: '#f8fafc', cabin: '#1e3a8a', deck: '#cbd5e1',
      sail: '#ffffff', skull: '#1e3a8a', trim: '#f59e0b', iron: '#0f172a',
      figurehead: 'marine_eagle', mastFlag: true, hideNodes: []
    },
    marine_battleship: {
      model: 'medium_royal',
      hull: '#475569', cabin: '#1e3a8a', deck: '#e2e8f0',
      sail: '#f1f5f9', skull: '#1e3a8a', trim: '#3b82f6', iron: '#0f172a',
      figurehead: 'marine_eagle', mastFlag: true, hideNodes: ['flag-c']
    },
    marine_cruiser: {
      model: 'medium_pirate',
      hull: '#334155', cabin: '#991b1b', deck: '#94a3b8',
      sail: '#b91c1c', skull: '#facc15', trim: '#f59e0b', iron: '#09090b',
      figurehead: 'marine_eagle', mastFlag: true, hideNodes: []
    },
    marine_cutter: {
      model: 'small_royal',
      hull: '#0284c7', cabin: '#f8fafc', deck: '#d97706',
      sail: '#ffffff', skull: '#0284c7', trim: '#38bdf8', iron: '#1e293b',
      figurehead: 'none', mastFlag: true, hideNodes: []
    },
    marine_scout: {
      model: 'boat_large',
      hull: '#f8fafc', cabin: '#1e3a8a', deck: '#94a3b8',
      sail: '#ffffff', skull: '#1e3a8a', trim: '#1e3a8a', iron: '#334155',
      figurehead: 'none', addSmallSailMast: true, mastFlag: true, hideNodes: []
    },

    // ================= BARBA BRANCA (EDWARD NEWGATE) =================
    moby_dick: {
      model: 'large_royal',
      hull: '#f8fafc', cabin: '#38bdf8', deck: '#d97706',
      sail: '#ffffff', skull: '#0284c7', trim: '#38bdf8', iron: '#334155',
      figurehead: 'whale', mastFlag: true, hideNodes: []
    },
    whitebeard_whale_flag: {
      model: 'large_pirate',
      hull: '#1e3a8a', cabin: '#38bdf8', deck: '#b45309',
      sail: '#06b6d4', skull: '#ffffff', trim: '#38bdf8', iron: '#0f172a',
      figurehead: 'phoenix', mastFlag: true, hideNodes: []
    },
    whitebeard_vanguard: {
      model: 'medium_royal',
      hull: '#334155', cabin: '#f8fafc', deck: '#c2410c',
      sail: '#bae6fd', skull: '#1e3a8a', trim: '#f8fafc', iron: '#1e293b',
      figurehead: 'whale', mastFlag: true, hideNodes: []
    },
    whitebeard_corvette: {
      model: 'small_pirate',
      hull: '#78350f', cabin: '#0284c7', deck: '#d97706',
      sail: '#f1f5f9', skull: '#1e3a8a', trim: '#38bdf8', iron: '#1e293b',
      figurehead: 'none', mastFlag: true, hideNodes: []
    },
    whitebeard_skiff: {
      model: 'boat_large',
      hull: '#f1f5f9', cabin: '#0284c7', deck: '#b45309',
      sail: '#38bdf8', skull: '#ffffff', trim: '#38bdf8', iron: '#334155',
      figurehead: 'none', addSmallSailMast: true, hasBarrels: true, mastFlag: true, hideNodes: []
    },

    // ================= CABELO VERMELHO (SHANKS) =================
    red_galleon: {
      model: 'large_pirate',
      hull: '#451a03', cabin: '#991b1b', deck: '#92400e',
      sail: '#b91c1c', skull: '#ffffff', trim: '#f59e0b', iron: '#1c1917',
      figurehead: 'dragon', mastFlag: true, hideNodes: []
    },
    red_force: {
      model: 'large_royal',
      hull: '#b91c1c', cabin: '#78350f', deck: '#d97706',
      sail: '#fef3c7', skull: '#b91c1c', trim: '#facc15', iron: '#1c1917',
      figurehead: 'dragon', mastFlag: true, hideNodes: []
    },
    red_corvette: {
      model: 'medium_pirate',
      hull: '#1c1917', cabin: '#dc2626', deck: '#78350f',
      sail: '#dc2626', skull: '#facc15', trim: '#f59e0b', iron: '#09090b',
      figurehead: 'none', mastFlag: true, hideNodes: []
    },
    red_cutter: {
      model: 'small_royal',
      hull: '#7c2d12', cabin: '#dc2626', deck: '#d97706',
      sail: '#f59e0b', skull: '#7c2d12', trim: '#dc2626', iron: '#1c1917',
      figurehead: 'none', mastFlag: true, hideNodes: []
    },
    red_skiff: {
      model: 'boat_small',
      hull: '#991b1b', cabin: '#f59e0b', deck: '#78350f',
      sail: '#dc2626', skull: '#ffffff', trim: '#facc15', iron: '#1c1917',
      figurehead: 'none', addSmallSailMast: true, mastFlag: true, hideNodes: []
    },

    // ================= PIRATAS DO CORAÇÃO (TRAFALGAR LAW) =================
    heart_nodachi: {
      isStylizedSub: true,
      hull: '#eab308', belly: '#18181b', fin: '#1e293b', trim: '#facc15', dome: '#38bdf8',
      subVariant: 'nodachi'
    },
    heart_hospital: {
      model: 'medium_royal',
      hull: '#ffffff', cabin: '#facc15', deck: '#cbd5e1',
      sail: '#2dd4bf', skull: '#0f172a', trim: '#facc15', iron: '#1e293b',
      figurehead: 'medical_cross', mastFlag: true, hideNodes: []
    },
    polar_tang: {
      isStylizedSub: true,
      hull: '#facc15', belly: '#1e293b', fin: '#facc15', trim: '#38bdf8', dome: '#38bdf8',
      subVariant: 'polar'
    },
    heart_capsule: {
      isStylizedSub: true,
      hull: '#0f172a', belly: '#1e293b', fin: '#f59e0b', trim: '#22d3ee', dome: '#22d3ee',
      subVariant: 'capsule'
    },
    heart_bepo_boat: {
      model: 'boat_large',
      hull: '#f97316', cabin: '#f8fafc', deck: '#fdba74',
      sail: '#facc15', skull: '#0f172a', trim: '#f97316', iron: '#1e293b',
      figurehead: 'none', addSmallSailMast: true, mastFlag: true, hideNodes: []
    },

    // ================= BARBA NEGRA (MARSHALL D. TEACH) =================
    blackbeard_colossal: {
      model: 'wreck',
      hull: '#3f2e21', cabin: '#1c1917', deck: '#573b26',
      sail: '#4c1d95', skull: '#e2e8f0', trim: '#7e22ce', iron: '#09090b',
      grass: '#581c87', figurehead: 'skull_ram', hasBarrels: true, mastFlag: true, hideNodes: []
    },
    saber_of_xebec: {
      model: 'large_pirate',
      hull: '#18181b', cabin: '#581c87', deck: '#27272a',
      sail: '#7e22ce', skull: '#ffffff', trim: '#f59e0b', iron: '#09090b',
      figurehead: 'skull_ram', mastFlag: true, hideNodes: []
    },
    blackbeard_galley: {
      model: 'medium_pirate',
      hull: '#27272a', cabin: '#7c3aed', deck: '#3f3f46',
      sail: '#0f172a', skull: '#ef4444', trim: '#7c3aed', iron: '#09090b',
      figurehead: 'none', mastFlag: true, hideNodes: []
    },
    blackbeard_corvette: {
      model: 'medium_royal',
      hull: '#3b0764', cabin: '#18181b', deck: '#52525b',
      sail: '#334155', skull: '#facc15', trim: '#a855f7', iron: '#09090b',
      figurehead: 'none', mastFlag: true, hideNodes: ['sail-b', 'flag-c']
    },
    blackbeard_skiff: {
      model: 'boat_small',
      hull: '#18181b', cabin: '#7e22ce', deck: '#27272a',
      sail: '#581c87', skull: '#ffffff', trim: '#a855f7', iron: '#09090b',
      figurehead: 'none', addSmallSailMast: true, mastFlag: true, hideNodes: []
    },

    // ================= CANÔNICOS BÔNUS (GRAND LINE 12x12) =================
    oro_jackson: {
      model: 'large_pirate',
      hull: '#991b1b', cabin: '#f59e0b', deck: '#78350f',
      sail: '#fef3c7', skull: '#b91c1c', trim: '#facc15', iron: '#1c1917',
      figurehead: 'mermaid_cannons', mastFlag: true, hideNodes: []
    },
    baratie: {
      model: 'medium_royal',
      hull: '#ea580c', cabin: '#f8fafc', deck: '#f59e0b',
      sail: '#fef08a', skull: '#0f766e', trim: '#2dd4bf', iron: '#334155',
      figurehead: 'fish_mouth', mastFlag: true, hideNodes: ['sail-b']
    }
  };

  function getShipVisualSpec(shipId, crewId, isGhost) {
    if (isGhost) {
      return { model: 'ghost', hull: '#38bdf8', sail: '#bae6fd', deck: '#0284c7', isGhost: true };
    }
    if (SHIP_VISUAL_IDENTITIES[shipId]) {
      return SHIP_VISUAL_IDENTITIES[shipId];
    }
    const cleanId = String(shipId || '').replace(/_alt$/, '');
    if (SHIP_VISUAL_IDENTITIES[cleanId]) {
      return SHIP_VISUAL_IDENTITIES[cleanId];
    }
    const config = getShipConfig(shipId);
    if (config && config.isSubmarine) {
      return {
        isStylizedSub: true,
        hull: '#facc15', belly: '#1e293b', fin: '#eab308', trim: '#38bdf8', dome: '#38bdf8',
        subVariant: 'polar'
      };
    }
    const L = config ? config.length : 3;
    const isMarine = (crewId === 'marines' || (shipId && String(shipId).indexOf('marine') !== -1));
    let model = 'medium_pirate';
    if (L >= 4) model = isMarine ? 'large_royal' : 'large_pirate';
    else if (L === 3) model = isMarine ? 'medium_royal' : 'medium_pirate';
    else if (L === 2) model = isMarine ? 'small_royal' : 'boat_large';

    return {
      model: model,
      hull: isMarine ? '#f8fafc' : '#78350f',
      cabin: isMarine ? '#1e3a8a' : '#b45309',
      deck: '#d97706',
      sail: isMarine ? '#ffffff' : '#1e293b',
      skull: '#ffffff',
      trim: isMarine ? '#f59e0b' : '#ef4444',
      iron: '#1e293b',
      figurehead: config ? config.figurehead : 'none',
      mastFlag: true,
      hideNodes: []
    };
  }

  function _shadeHexColor(hexStr, amount) {
    const num = parseInt(String(hexStr || '#ffffff').replace('#', ''), 16);
    const r = Math.min(255, Math.max(0, ((num >> 16) & 255) + amount));
    const g = Math.min(255, Math.max(0, ((num >> 8) & 255) + amount));
    const b = Math.min(255, Math.max(0, (num & 255) + amount));
    return '#' + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
  }

  /**
   * Generates a cached 512x512 CanvasTexture replacing Kenney UV palette cells
   * (row 3 cols 0..7 + row 2 col 1) to create bespoke crew & ship liveries.
   */
  const _skinTextureCache = new Map();
  function getCustomColormapTexture(shipId, spec) {
    if (!_THREE || typeof document === 'undefined') return null;
    const cacheKey = `${shipId}_${spec.model}_${spec.hull}_${spec.sail}_${spec.cabin}`;
    if (_skinTextureCache.has(cacheKey)) return _skinTextureCache.get(cacheKey);

    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 512;
    const ctx = canvas.getContext('2d');

    function paintSwatch(col, row, hexColor) {
      const x = col * 64;
      const y = row * 128;
      // Left 32px: lit top-to-bottom subtle bevel
      const gLeft = ctx.createLinearGradient(x, y, x, y + 128);
      gLeft.addColorStop(0, _shadeHexColor(hexColor, 20));
      gLeft.addColorStop(1, hexColor);
      ctx.fillStyle = gLeft;
      ctx.fillRect(x, y, 32, 128);
      // Right 32px: slightly richer shadow side
      const gRight = ctx.createLinearGradient(x + 32, y, x + 32, y + 128);
      gRight.addColorStop(0, hexColor);
      gRight.addColorStop(1, _shadeHexColor(hexColor, -24));
      ctx.fillStyle = gRight;
      ctx.fillRect(x + 32, y, 32, 128);
    }

    // Default neutral palette fill
    paintSwatch(0, 0, '#000000');
    paintSwatch(1, 2, spec.grass || '#22c55e');

    const isPirateModel = spec.model && spec.model.indexOf('pirate') !== -1;
    const isBoatModel = spec.model === 'boat_large' || spec.model === 'boat_small';
    const isWreckModel = spec.model === 'wreck';

    if (isBoatModel) {
      paintSwatch(0, 3, spec.iron || '#1e293b');
      paintSwatch(4, 3, spec.cabin || '#f8fafc'); // interior seats/oars trim
      paintSwatch(5, 3, spec.hull || '#78350f');  // main boat hull planks
      paintSwatch(6, 3, spec.hull || '#78350f');
      paintSwatch(7, 3, spec.trim || '#f59e0b');
    } else if (isWreckModel) {
      paintSwatch(0, 3, spec.iron || '#09090b');
      paintSwatch(4, 3, spec.trim || '#7e22ce');
      paintSwatch(5, 3, spec.deck || '#573b26');
      paintSwatch(6, 3, spec.hull || '#3f2e21');
      paintSwatch(1, 2, spec.grass || '#581c87');
    } else if (isPirateModel) {
      paintSwatch(0, 3, spec.iron || '#0f172a');
      paintSwatch(1, 3, spec.skull || '#ffffff'); // skull bone fill
      paintSwatch(2, 3, spec.sail || '#18181b');  // sails & flags & dark accent stripes
      paintSwatch(3, 3, _shadeHexColor(spec.skull || '#ffffff', -26)); // skull shade
      paintSwatch(4, 3, spec.trim || '#facc15');  // bright trim stripes
      paintSwatch(5, 3, spec.deck || '#d97706');  // decks & masts
      paintSwatch(6, 3, spec.hull || '#78350f');  // main outer hull planks
      paintSwatch(7, 3, spec.cabin || '#b45309');
    } else {
      // royal clean vessels (ship-large, ship-medium, ship-small)
      paintSwatch(0, 3, spec.iron || '#1e293b');
      paintSwatch(4, 3, spec.sail || '#ffffff');  // sails, flags & light trim stripes
      paintSwatch(5, 3, spec.deck || '#d97706');  // deck planks & masts
      paintSwatch(6, 3, spec.hull || '#f8fafc');  // main outer hull planks
      paintSwatch(7, 3, spec.cabin || '#1e3a8a'); // upper cabin walls & castle
    }

    const texture = new _THREE.CanvasTexture(canvas);
    texture.flipY = false; // Essential: glTF v=0 is canvas top!
    texture.encoding = _THREE.sRGBEncoding || 3001;
    texture.magFilter = _THREE.NearestFilter;
    texture.minFilter = _THREE.NearestFilter;
    texture.needsUpdate = true;

    _skinTextureCache.set(cacheKey, texture);
    return texture;
  }

  /**
   * Builds a sculpted, smooth low-poly 3D Submarine mesh so underwater ships
   * (Polar Tang, Shark Submerge III, Nodachi, Cápsula) never turn into generic sailboats.
   */
  function buildStylizedSubmarineMesh(shipId, cellSize, crewId, spec, isGhost) {
    const subWrap = new _THREE.Group();
    subWrap.name = 'stylizedSubmarineMesh';

    const config = getShipConfig(shipId);
    const L = config ? config.length : 3;
    const totalLen = L * 0.86 * cellSize;
    const radius = Math.min(0.32 * cellSize, (totalLen * 0.16));

    const makeMat = (colorHex, opts = {}) => {
      if (isGhost) {
        return new _THREE.MeshLambertMaterial({
          color: 0x58c0ff, emissive: 0x1e3a8a, transparent: true, opacity: 0.55, side: _THREE.DoubleSide
        });
      }
      return new _THREE.MeshLambertMaterial(Object.assign({ color: colorHex, side: _THREE.DoubleSide }, opts));
    };

    const hullMat = makeMat(spec.hull || '#facc15');
    const bellyMat = makeMat(spec.belly || '#1e293b');
    const finMat = makeMat(spec.fin || '#ef4444');
    const trimMat = makeMat(spec.trim || '#38bdf8');
    const domeMat = isGhost
      ? makeMat(0x58c0ff)
      : new _THREE.MeshLambertMaterial({ color: spec.dome || '#38bdf8', emissive: 0x0284c7, emissiveIntensity: 0.45 });

    // 1. Main Cylindrical Torpedo Hull (oriented along +X)
    const bodyLen = totalLen * 0.64;
    const bodyGeo = new _THREE.CylinderGeometry(radius, radius * 0.94, bodyLen, 14);
    bodyGeo.rotateZ(-Math.PI / 2);
    const bodyMesh = new _THREE.Mesh(bodyGeo, hullMat);
    bodyMesh.castShadow = !isGhost;
    bodyMesh.receiveShadow = !isGhost;
    subWrap.add(bodyMesh);

    // 2. Nose & Tapered Stern Cones/Domes
    const noseLen = totalLen * 0.22;
    const noseGeo = new _THREE.SphereGeometry(radius, 14, 10);
    noseGeo.scale(noseLen / radius, 1, 1);
    const noseMesh = new _THREE.Mesh(noseGeo, spec.subVariant === 'capsule' ? domeMat : hullMat);
    noseMesh.position.x = bodyLen * 0.5;
    noseMesh.castShadow = !isGhost;
    subWrap.add(noseMesh);

    const tailLen = totalLen * 0.20;
    const tailGeo = new _THREE.ConeGeometry(radius * 0.94, tailLen, 14);
    tailGeo.rotateZ(Math.PI / 2);
    const tailMesh = new _THREE.Mesh(tailGeo, bellyMat);
    tailMesh.position.x = -(bodyLen * 0.5 + tailLen * 0.5);
    tailMesh.castShadow = !isGhost;
    subWrap.add(tailMesh);

    // Hazard/Racing Stripes Collar
    const ringGeo = new _THREE.CylinderGeometry(radius * 1.04, radius * 1.04, bodyLen * 0.14, 14);
    ringGeo.rotateZ(-Math.PI / 2);
    const ringMesh = new _THREE.Mesh(ringGeo, spec.subVariant === 'shark' ? finMat : trimMat);
    ringMesh.position.x = bodyLen * 0.34;
    subWrap.add(ringMesh);

    // 3. Conning Tower(s) + Windows + Periscope
    const towerCount = spec.subVariant === 'nodachi' ? 2 : 1;
    for (let t = 0; t < towerCount; t++) {
      const tx = towerCount === 2 ? (t === 0 ? bodyLen * 0.18 : -bodyLen * 0.20) : 0.04 * cellSize;
      const towerH = (spec.subVariant === 'shark' ? 0.34 : 0.42) * cellSize;
      const towerGeo = new _THREE.CylinderGeometry(radius * 0.55, radius * 0.72, towerH, 10);
      const towerMesh = new _THREE.Mesh(towerGeo, hullMat);
      towerMesh.position.set(tx, radius * 0.65 + towerH * 0.45, 0);
      towerMesh.scale.set(1.5, 1, 0.82);
      towerMesh.castShadow = !isGhost;
      subWrap.add(towerMesh);

      // Glowing Viewport Strip / Dome
      const winGeo = new _THREE.BoxGeometry(radius * 1.15, towerH * 0.26, radius * 1.12);
      const winMesh = new _THREE.Mesh(winGeo, domeMat);
      winMesh.position.set(tx + radius * 0.18, radius * 0.65 + towerH * 0.55, 0);
      subWrap.add(winMesh);
    }

    // Shark Submerge III Dorsal Fin & Teeth!
    if (spec.subVariant === 'shark') {
      const dorsalGeo = new _THREE.ConeGeometry(radius * 0.42, 0.45 * cellSize, 4);
      const dorsal = new _THREE.Mesh(dorsalGeo, finMat);
      dorsal.scale.set(1.6, 1, 0.35);
      dorsal.rotation.z = -0.25;
      dorsal.position.set(-bodyLen * 0.14, radius * 1.1, 0);
      subWrap.add(dorsal);

      // White shark underbelly strip
      const underGeo = new _THREE.CylinderGeometry(radius * 0.92, radius * 0.92, bodyLen * 0.75, 10, 1, false, Math.PI * 0.5, Math.PI);
      underGeo.rotateZ(-Math.PI / 2);
      const underMesh = new _THREE.Mesh(underGeo, bellyMat);
      underMesh.position.y = -radius * 0.10;
      subWrap.add(underMesh);
    }

    // Twin Lateral Ballast Tanks / Diving Planes (strictly inside 0.80 * cellSize)
    const planeW = Math.min(0.76 * cellSize, radius * 2.55);
    const wingGeo = new _THREE.BoxGeometry(bodyLen * 0.48, 0.06 * cellSize, planeW);
    const wingMesh = new _THREE.Mesh(wingGeo, spec.subVariant === 'polar' ? bellyMat : finMat);
    wingMesh.position.set(0, -radius * 0.08, 0);
    subWrap.add(wingMesh);

    // Flag Mast + Crew Jolly Roger on Top
    if (!isGhost) {
      const flagPole = new _THREE.Mesh(
        new _THREE.CylinderGeometry(0.025 * cellSize, 0.025 * cellSize, 0.55 * cellSize, 6),
        makeMat('#334155')
      );
      flagPole.position.set(0.04 * cellSize, radius * 0.65 + 0.62 * cellSize, 0);
      subWrap.add(flagPole);

      const flagTex = getJollyRogerTexture(shipId, crewId);
      if (flagTex) {
        const flagMesh = new _THREE.Mesh(
          new _THREE.PlaneGeometry(0.42 * cellSize, 0.28 * cellSize),
          new _THREE.MeshBasicMaterial({ map: flagTex, side: _THREE.DoubleSide })
        );
        flagMesh.position.set(0.04 * cellSize - 0.20 * cellSize, radius * 0.65 + 0.76 * cellSize, 0);
        flagMesh.name = 'crewJollyRogerFlag';
        subWrap.add(flagMesh);
      }
    }

    // Rotating Stern Propeller
    const propGroup = new _THREE.Group();
    propGroup.position.set(-(bodyLen * 0.5 + tailLen + 0.04 * cellSize), 0, 0);
    const bladeMat = makeMat('#f59e0b');
    const b1 = new _THREE.Mesh(new _THREE.BoxGeometry(0.05 * cellSize, radius * 0.95, 0.08 * cellSize), bladeMat);
    const b2 = new _THREE.Mesh(new _THREE.BoxGeometry(0.05 * cellSize, 0.08 * cellSize, radius * 0.95), bladeMat);
    propGroup.add(b1, b2);
    subWrap.add(propGroup);

    subWrap.position.y = radius * 0.72;
    return { mesh: subWrap, propeller: propGroup };
  }

  /**
   * Mounts clean 3D Bow Figureheads and Deck Signatures on top of GLB ships.
   */
  function attachShipSignatureFeatures(glbWrap, shipId, crewId, spec, bounds, cellSize) {
    if (!glbWrap || spec.isGhost) return { paddleWheels: null, crewFlag: null };

    const makeMat = (hex) => new _THREE.MeshLambertMaterial({ color: hex, side: _THREE.DoubleSide });
    const bowX = bounds.halfLen;
    const deckY = bounds.height * 0.22;
    const result = { paddleWheels: null, crewFlag: null };

    // 1. Bow Figurehead Sculpture (+X tip)
    const fh = spec.figurehead;
    if (fh && fh !== 'none') {
      const fhGroup = new _THREE.Group();
      fhGroup.position.set(bowX - 0.06 * cellSize, deckY + 0.16 * cellSize, 0);

      if (fh === 'lion') {
        const face = new _THREE.Mesh(new _THREE.CylinderGeometry(0.14 * cellSize, 0.14 * cellSize, 0.14 * cellSize, 8), makeMat('#facc15'));
        face.rotation.z = Math.PI / 2;
        const mane = new _THREE.Mesh(new _THREE.TorusGeometry(0.17 * cellSize, 0.05 * cellSize, 6, 8), makeMat('#f97316'));
        mane.rotation.y = Math.PI / 2;
        fhGroup.add(face, mane);
      } else if (fh === 'sheep') {
        const head = new _THREE.Mesh(new _THREE.BoxGeometry(0.18 * cellSize, 0.16 * cellSize, 0.16 * cellSize), makeMat('#fef3c7'));
        const hornL = new _THREE.Mesh(new _THREE.TorusGeometry(0.06 * cellSize, 0.025 * cellSize, 5, 8, Math.PI * 1.3), makeMat('#facc15'));
        hornL.position.set(-0.02 * cellSize, 0.06 * cellSize, 0.09 * cellSize);
        const hornR = hornL.clone();
        hornR.position.z = -0.09 * cellSize;
        fhGroup.add(head, hornL, hornR);
      } else if (fh === 'whale') {
        const snout = new _THREE.Mesh(new _THREE.SphereGeometry(0.22 * cellSize, 10, 8), makeMat('#ffffff'));
        snout.scale.set(1.3, 1.0, 0.88);
        const stripe = new _THREE.Mesh(new _THREE.BoxGeometry(0.32 * cellSize, 0.05 * cellSize, 0.36 * cellSize), makeMat('#38bdf8'));
        stripe.position.y = -0.06 * cellSize;
        fhGroup.add(snout, stripe);
      } else if (fh === 'dragon') {
        const snout = new _THREE.Mesh(new _THREE.ConeGeometry(0.14 * cellSize, 0.34 * cellSize, 6), makeMat('#dc2626'));
        snout.rotation.z = -Math.PI / 2.2;
        const hornL = new _THREE.Mesh(new _THREE.ConeGeometry(0.03 * cellSize, 0.18 * cellSize, 5), makeMat('#facc15'));
        hornL.position.set(-0.06 * cellSize, 0.14 * cellSize, 0.07 * cellSize);
        const hornR = hornL.clone();
        hornR.position.z = -0.07 * cellSize;
        fhGroup.add(snout, hornL, hornR);
      } else if (fh === 'marine_eagle' || fh === 'phoenix') {
        const colHex = fh === 'phoenix' ? '#06b6d4' : '#facc15';
        const crest = new _THREE.Mesh(new _THREE.BoxGeometry(0.20 * cellSize, 0.12 * cellSize, 0.12 * cellSize), makeMat(colHex));
        const wingL = new _THREE.Mesh(new _THREE.BoxGeometry(0.10 * cellSize, 0.04 * cellSize, 0.34 * cellSize), makeMat(colHex));
        wingL.rotation.x = 0.25;
        wingL.position.set(-0.02 * cellSize, 0.08 * cellSize, 0);
        fhGroup.add(crest, wingL);
      } else if (fh === 'skull_ram') {
        const skull = new _THREE.Mesh(new _THREE.SphereGeometry(0.14 * cellSize, 8, 8), makeMat('#f1f5f9'));
        const spike = new _THREE.Mesh(new _THREE.ConeGeometry(0.06 * cellSize, 0.26 * cellSize, 6), makeMat('#a855f7'));
        spike.rotation.z = -Math.PI / 2;
        spike.position.x = 0.14 * cellSize;
        fhGroup.add(skull, spike);
      } else if (fh === 'medical_cross') {
        const box1 = new _THREE.Mesh(new _THREE.BoxGeometry(0.08 * cellSize, 0.24 * cellSize, 0.08 * cellSize), makeMat('#ef4444'));
        const box2 = new _THREE.Mesh(new _THREE.BoxGeometry(0.08 * cellSize, 0.08 * cellSize, 0.24 * cellSize), makeMat('#ef4444'));
        fhGroup.add(box1, box2);
      } else if (fh === 'fish_mouth') {
        const head = new _THREE.Mesh(new _THREE.SphereGeometry(0.20 * cellSize, 8, 8), makeMat('#fb923c'));
        const fin = new _THREE.Mesh(new _THREE.ConeGeometry(0.08 * cellSize, 0.20 * cellSize, 5), makeMat('#2dd4bf'));
        fin.position.set(0, 0.18 * cellSize, 0);
        fhGroup.add(head, fin);
      } else if (fh === 'mermaid_cannons') {
        const goldProw = new _THREE.Mesh(new _THREE.CylinderGeometry(0.07 * cellSize, 0.12 * cellSize, 0.26 * cellSize, 8), makeMat('#facc15'));
        goldProw.rotation.z = -Math.PI / 3;
        fhGroup.add(goldProw);
      }
      glbWrap.add(fhGroup);
    }

    // 2. Mini Merry II Twin Rotating Side Paddle Wheels
    if (spec.hasPaddleWheels) {
      const pwGroup = new _THREE.Group();
      const wheelMat = makeMat('#f8fafc');
      const hubMat = makeMat('#dc2626');
      [-1, 1].forEach((sideSign) => {
        const wheel = new _THREE.Group();
        wheel.position.set(0, deckY * 0.45, sideSign * (bounds.halfWidth + 0.05 * cellSize));
        const rim = new _THREE.Mesh(new _THREE.CylinderGeometry(0.18 * cellSize, 0.18 * cellSize, 0.07 * cellSize, 8), wheelMat);
        rim.rotation.x = Math.PI / 2;
        const hub = new _THREE.Mesh(new _THREE.BoxGeometry(0.28 * cellSize, 0.05 * cellSize, 0.09 * cellSize), hubMat);
        const hub2 = new _THREE.Mesh(new _THREE.BoxGeometry(0.05 * cellSize, 0.28 * cellSize, 0.09 * cellSize), hubMat);
        wheel.add(rim, hub, hub2);
        pwGroup.add(wheel);
      });
      glbWrap.add(pwGroup);
      result.paddleWheels = pwGroup;
    }

    // 3. Thousand Sunny Signature Lush Emerald Lawn Courtyard on Mid-Deck
    if (spec.hasGrassDeck) {
      const grassPatch = new _THREE.Mesh(
        new _THREE.BoxGeometry(bounds.halfLen * 0.95, 0.05 * cellSize, bounds.halfWidth * 1.15),
        makeMat('#22c55e')
      );
      grassPatch.position.set(0, deckY + 0.02 * cellSize, 0);
      glbWrap.add(grassPatch);
    }

    // 4. Scout Rowboat Armed Mini Mast & Sail (prevents small rowboats from looking bare)
    if (spec.addSmallSailMast) {
      const mastH = 0.85 * cellSize;
      const mast = new _THREE.Mesh(new _THREE.CylinderGeometry(0.028 * cellSize, 0.035 * cellSize, mastH, 6), makeMat('#78350f'));
      mast.position.set(0.06 * cellSize, deckY + mastH * 0.45, 0);
      glbWrap.add(mast);

      const sailTri = new _THREE.Mesh(
        new _THREE.PlaneGeometry(0.45 * cellSize, 0.48 * cellSize),
        makeMat(spec.sail || '#ffffff')
      );
      sailTri.position.set(0.08 * cellSize, deckY + mastH * 0.56, 0);
      sailTri.rotation.y = Math.PI * 0.25;
      glbWrap.add(sailTri);
    }

    // 5. Authentic Faction Jolly Roger / Marine Flag Flying at Peak Height
    if (spec.mastFlag) {
      const flagTex = getJollyRogerTexture(shipId, crewId);
      if (flagTex) {
        const peakY = spec.addSmallSailMast ? (deckY + 0.90 * cellSize) : (bounds.height * 0.90);
        const flagMesh = new _THREE.Mesh(
          new _THREE.PlaneGeometry(0.42 * cellSize, 0.28 * cellSize),
          new _THREE.MeshBasicMaterial({ map: flagTex, side: _THREE.DoubleSide })
        );
        flagMesh.position.set(-0.18 * cellSize, peakY, 0);
        flagMesh.name = 'crewJollyRogerFlag';
        glbWrap.add(flagMesh);
        result.crewFlag = flagMesh;
      }
    }

    return result;
  }

  function getModelKeyForShip(shipId, crewId, isGhost) {
    const spec = getShipVisualSpec(shipId, crewId, isGhost);
    return spec.model || 'medium_pirate';
  }

  const _gltfCache = new Map();
  const _gltfLoading = new Map();

  function loadShipGLTF(modelKey, callback) {
    if (typeof callback !== 'function') return;
    const LoaderClass = (_THREE && _THREE.GLTFLoader) || (typeof THREE !== 'undefined' && THREE.GLTFLoader);
    if (!LoaderClass) {
      return callback(null);
    }
    // Under file:// Chrome blocks XHR to local .glb (origin 'null'), flooding the console
    // with CORS errors. Skip the request entirely; the voxel ship is the fallback there.
    // Served over http(s) (LAN server) the GLB models load normally.
    try {
      if (typeof location !== 'undefined' && location.protocol === 'file:' &&
          !(typeof window !== 'undefined' && window.GLT_FORCE_GLB)) {
        return callback(null);
      }
    } catch (_) { return callback(null); }
    if (_gltfCache.has(modelKey)) {
      return callback(_gltfCache.get(modelKey).clone(true));
    }
    if (_gltfLoading.has(modelKey)) {
      _gltfLoading.get(modelKey).push(callback);
      return;
    }
    _gltfLoading.set(modelKey, [callback]);

    const url = GLTF_SHIP_MODELS[modelKey];
    if (!url) {
      _gltfLoading.delete(modelKey);
      return callback(null);
    }

    try {
      const loader = new LoaderClass();
      loader.load(
        url,
        function (gltf) {
          const scene = gltf.scene || (gltf.scenes && gltf.scenes[0]);
          if (scene) {
            _gltfCache.set(modelKey, scene);
            const cbs = _gltfLoading.get(modelKey) || [];
            _gltfLoading.delete(modelKey);
            cbs.forEach(function (cb) {
              try { cb(scene.clone(true)); } catch (_) { cb(null); }
            });
          } else {
            const cbs = _gltfLoading.get(modelKey) || [];
            _gltfLoading.delete(modelKey);
            cbs.forEach(function (cb) { cb(null); });
          }
        },
        undefined,
        function () {
          const cbs = _gltfLoading.get(modelKey) || [];
          _gltfLoading.delete(modelKey);
          cbs.forEach(function (cb) { cb(null); });
        }
      );
    } catch (_) {
      const cbs = _gltfLoading.get(modelKey) || [];
      _gltfLoading.delete(modelKey);
      cbs.forEach(function (cb) { cb(null); });
    }
  }

  // ---------------------------------------------------------------------------
  // Public Ship Factory: createShipMesh
  // ---------------------------------------------------------------------------
  function createShipMesh(shipId, options = {}) {
    if (!_THREE) {
      return { id: shipId, isMock: true, options };
    }

    const config = getShipConfig(shipId);
    const crewId = options.crewId || (config ? config.crewId : 'straw_hats');

    const cellSize = options.cellSize || 1.0;
    const ownerColor = options.ownerColor;
    const isGhost = !!options.isGhost;
    const visualSpec = getShipVisualSpec(shipId, crewId, isGhost);

    const shipGroup = new _THREE.Group();
    shipGroup.name = `ship_${shipId}`;

    // User metadata & animation hooks (initialized upfront)
    shipGroup.userData = {
      shipId: shipId,
      crewId: crewId,
      length: config.length,
      cellSize: cellSize,
      ownerColor: ownerColor,
      isGhost: isGhost,
      isSubmarine: !!config.isSubmarine,
      damageMask: new Set(),
      sinking: null,
      cannonAnim: { side: null, t: 0, active: false },
      cheering: 0.0,
      basePosY: 0,
      hasGlb: false,
      propeller: null,
      paddleWheels: null,
      glbSails: [],
      glbFlags: []
    };

    // 1. Stylized Smooth Low-Poly 3D Submarines (Polar Tang, Shark Submerge III, Nodachi, Cápsula)
    if (visualSpec.isStylizedSub) {
      const subData = buildStylizedSubmarineMesh(shipId, cellSize, crewId, visualSpec, isGhost);
      shipGroup.add(subData.mesh);
      shipGroup.userData.propeller = subData.propeller;
      shipGroup.userData.hasGlb = true; // Stylized native 3D submarine!
      const wakeGroup = buildWakeFoam(shipId, cellSize);
      shipGroup.add(wakeGroup);

      shipGroup.fireCannon = function () {};
      shipGroup.setDamage = function (hitCellsArray) { setShipDamage(shipGroup, hitCellsArray); };
      shipGroup.startSinking = function (onComplete) { startShipSinking(shipGroup, onComplete); };
      return shipGroup;
    }

    // 2. Procedural Voxel Subgroup (Serves as instant 0ms fallback while GLB streams)
    const proceduralGroup = new _THREE.Group();
    proceduralGroup.name = 'proceduralGroup';

    let hullMat;
    if (isGhost) {
      hullMat = new _THREE.MeshLambertMaterial({
        color: 0x58c0ff,
        emissive: 0x1e3a8a,
        transparent: true,
        opacity: 0.55,
        side: _THREE.DoubleSide
      });
    } else {
      const gradMap = getToonGradientMap();
      hullMat = (gradMap && _THREE.MeshToonMaterial) ? new _THREE.MeshToonMaterial({
        vertexColors: true,
        gradientMap: gradMap,
        side: _THREE.DoubleSide
      }) : new _THREE.MeshLambertMaterial({
        vertexColors: true,
        side: _THREE.DoubleSide
      });
    }

    const hullGeom = buildShipGeometry(shipId, cellSize, ownerColor, crewId);
    const hullMesh = new _THREE.Mesh(hullGeom, hullMat);
    hullMesh.name = 'hullMesh';
    hullMesh.castShadow = !isGhost;
    hullMesh.receiveShadow = !isGhost;
    proceduralGroup.add(hullMesh);

    const mastsGroup = buildSailAndMasts(shipId, cellSize, ownerColor, crewId);
    proceduralGroup.add(mastsGroup);

    const cannons = buildCannons(shipId, cellSize);
    proceduralGroup.add(cannons.port);
    proceduralGroup.add(cannons.starboard);
    shipGroup.cannonsPort = cannons.port;
    shipGroup.cannonsStarboard = cannons.starboard;

    const lanterns = buildLanterns(shipId, cellSize);
    proceduralGroup.add(lanterns);

    if (!isGhost) {
      const crewGroup = buildInstancedDeckCrew(shipId, cellSize);
      proceduralGroup.add(crewGroup);
    }

    shipGroup.add(proceduralGroup);

    // 3. Waterline Wake (Active for both GLB and procedural)
    const wakeGroup = buildWakeFoam(shipId, cellSize);
    shipGroup.add(wakeGroup);

    // 4. Asynchronous High-Quality GLB Model + Bespoke Faction/Ship Skin Injection
    const modelKey = getModelKeyForShip(shipId, crewId, isGhost);
    loadShipGLTF(modelKey, function (glbScene) {
      if (!glbScene) return;

      const glbWrap = new _THREE.Group();
      glbWrap.name = 'glbShipModel';

      // Measure unscaled model bounding box
      const box = new _THREE.Box3().setFromObject(glbScene);
      const size = new _THREE.Vector3();
      box.getSize(size);
      const center = new _THREE.Vector3();
      box.getCenter(center);

      // Hide specific sub-meshes for ship silhouette variety (e.g. convert 2-mast into sleek 1-mast sloop)
      const hideSet = new Set(visualSpec.hideNodes || []);
      const customTex = isGhost ? null : getCustomColormapTexture(shipId, visualSpec);
      const customMat = isGhost
        ? new _THREE.MeshLambertMaterial({
            color: 0x58c0ff, emissive: 0x1e3a8a, transparent: true, opacity: 0.55, side: _THREE.DoubleSide
          })
        : new _THREE.MeshLambertMaterial({
            map: customTex, color: 0xffffff, side: _THREE.DoubleSide
          });

      const glbSails = [];
      const glbFlags = [];

      glbScene.traverse(function (node) {
        if (hideSet.has(node.name)) {
          node.visible = false;
          return;
        }
        if (node.isMesh) {
          node.castShadow = !isGhost;
          node.receiveShadow = !isGhost;

          // Override material for wreck's ragged sail so it shows Blackbeard purple instead of wood
          if (!isGhost && visualSpec.model === 'wreck' && node.name && node.name.indexOf('sail') === 0) {
            node.material = new _THREE.MeshLambertMaterial({
              color: visualSpec.sail || '#4c1d95',
              side: _THREE.DoubleSide
            });
          } else {
            node.material = customMat;
          }

          if (node.name && node.name.indexOf('sail') === 0) {
            glbSails.push(node);
          } else if (node.name && node.name.indexOf('flag') === 0) {
            glbFlags.push(node);
          }
        }
      });

      // Strictly center and ground model BEFORE rotating/scaling inside scalerGroup
      glbScene.position.set(-center.x, -box.min.y, -center.z);

      const originalLen = Math.max(0.1, size.z);
      const originalWid = Math.max(0.1, size.x);
      const targetLen = config.length * 0.88 * cellSize;
      const scaleLen = targetLen / originalLen;
      // Strict cell width clamp (<= 0.84 * cellSize) prevents adjacent ships from overlapping!
      const scaleWid = Math.min(scaleLen, (0.84 * cellSize) / originalWid);
      const scaleHgt = scaleLen * 0.42 + scaleWid * 0.58;

      const scalerGroup = new _THREE.Group();
      scalerGroup.add(glbScene);
      scalerGroup.scale.set(scaleWid, scaleHgt, scaleLen);
      scalerGroup.rotation.y = Math.PI / 2; // Maps +Z (Bow) cleanly onto +X!

      glbWrap.add(scalerGroup);
      glbWrap.position.y = 0.04 * cellSize;

      // Attach bespoke 3D bow figureheads, Jolly Roger mast flags, Sunny grass, & Mini Merry wheels
      const featureBounds = {
        halfLen: targetLen * 0.5,
        halfWidth: (originalWid * scaleWid) * 0.5,
        height: size.y * scaleHgt
      };
      const extras = attachShipSignatureFeatures(glbWrap, shipId, crewId, visualSpec, featureBounds, cellSize);
      if (extras.crewFlag) glbFlags.push(extras.crewFlag);

      shipGroup.add(glbWrap);
      shipGroup.userData.glbSails = glbSails;
      shipGroup.userData.glbFlags = glbFlags;
      shipGroup.userData.paddleWheels = extras.paddleWheels;

      // Hide procedural voxel fallback once custom 3D GLB is mounted
      proceduralGroup.visible = false;
      shipGroup.userData.hasGlb = true;
    });

    // Firing cannon trigger
    shipGroup.fireCannon = function (side = 'port', onFired = null) {
      shipGroup.userData.cannonAnim.side = side;
      shipGroup.userData.cannonAnim.t = 0.0;
      shipGroup.userData.cannonAnim.active = true;
      if (typeof onFired === 'function') onFired();
    };

    // Battle damage trigger
    shipGroup.setDamage = function (hitCellsArray) {
      setShipDamage(shipGroup, hitCellsArray);
    };

    // Sinking trigger
    shipGroup.startSinking = function (onComplete) {
      startShipSinking(shipGroup, onComplete);
    };

    return shipGroup;
  }

  // ---------------------------------------------------------------------------
  // Ghost Revealed Ship Builder (Enemy Plate Sunk Ships)
  // ---------------------------------------------------------------------------
  function createGhostShipMesh(shipId, options = {}) {
    return createShipMesh(shipId, Object.assign({}, options, { isGhost: true }));
  }

  // ---------------------------------------------------------------------------
  // Battle Damage: Charred Voxels & Tilted Mast
  // ---------------------------------------------------------------------------
  function setShipDamage(shipGroup, hitIndices) {
    if (!shipGroup || !shipGroup.userData) return;
    const hitSet = new Set(hitIndices);
    shipGroup.userData.damageMask = hitSet;

    const cellSize = shipGroup.userData.cellSize || 1.0;
    const L = shipGroup.userData.length || 3;
    const maxHalfLen = (L * 0.85 * cellSize) * 0.5;

    let damageGroup = shipGroup.getObjectByName('damageFxGroup');
    if (!damageGroup) {
      damageGroup = new _THREE.Group();
      damageGroup.name = 'damageFxGroup';
      shipGroup.add(damageGroup);
    }

    // Clear old scorch marks
    while (damageGroup.children.length > 0) {
      damageGroup.remove(damageGroup.children[0]);
    }

    if (hitSet.size === 0) return;

    const scorchBuilder = new VoxelBuilder();
    const cellStep = (maxHalfLen * 2) / L;

    hitSet.forEach(cellIdx => {
      const cx = -maxHalfLen + (cellIdx + 0.5) * cellStep;
      // Charred black voxels
      scorchBuilder.addBox(cx, 0.24 * cellSize, 0, cellStep * 0.75, 0.05 * cellSize, 0.45 * cellSize, 0x18181b);
      // Glowing ember voxels
      scorchBuilder.addBox(cx + 0.05 * cellSize, 0.26 * cellSize, 0.05 * cellSize, 0.12 * cellSize, 0.04 * cellSize, 0.12 * cellSize, 0xf97316);
      scorchBuilder.addBox(cx - 0.05 * cellSize, 0.26 * cellSize, -0.05 * cellSize, 0.09 * cellSize, 0.04 * cellSize, 0.09 * cellSize, 0xef4444);
    });

    const scorchGeom = scorchBuilder.buildGeometry();
    const scorchMat = new _THREE.MeshLambertMaterial({
      vertexColors: true,
      side: _THREE.DoubleSide
    });
    damageGroup.add(new _THREE.Mesh(scorchGeom, scorchMat));

    // Tilt mast slightly if multiple hits
    const masts = shipGroup.getObjectByName('mastsAndSailsGroup');
    if (masts && hitSet.size >= 2) {
      masts.rotation.z = 0.08; // ~4.5 degrees lean
      masts.rotation.x = 0.04;
    }
  }

  // ---------------------------------------------------------------------------
  // Sinking Animation & Buoy Flag Deployment
  // ---------------------------------------------------------------------------
  function startShipSinking(shipGroup, onComplete) {
    if (!shipGroup || !shipGroup.userData) return;
    shipGroup.userData.sinking = {
      progress: 0.0,
      duration: 2.6,
      onComplete: onComplete,
      active: true
    };

    // Create floating Jolly Roger Flag Buoy (Stepped pixel-art lifebuoy ring)
    const cellSize = shipGroup.userData.cellSize || 1.0;
    const buoyGroup = new _THREE.Group();
    buoyGroup.name = 'sunkFlagBuoy';

    const buoyRingBuilder = new VoxelBuilder();
    const br = 0.14 * cellSize;
    const bw = 0.06 * cellSize;
    buoyRingBuilder.addBox(0, 0, br, br * 2 + bw, bw, bw, 0xef4444);
    buoyRingBuilder.addBox(0, 0, -br, br * 2 + bw, bw, bw, 0xef4444);
    buoyRingBuilder.addBox(br, 0, 0, bw, bw, br * 2, 0xf8fafc);
    buoyRingBuilder.addBox(-br, 0, 0, bw, bw, br * 2, 0xf8fafc);

    const ringMesh = new _THREE.Mesh(
      buoyRingBuilder.buildGeometry(),
      new _THREE.MeshLambertMaterial({ vertexColors: true, side: _THREE.DoubleSide })
    );
    buoyGroup.add(ringMesh);

    // Mast & flag
    const flagPole = new _THREE.Mesh(
      new _THREE.CylinderGeometry(0.02 * cellSize, 0.02 * cellSize, 0.45 * cellSize, 6),
      new _THREE.MeshLambertMaterial({ color: 0x78350f })
    );
    flagPole.position.y = 0.22 * cellSize;
    buoyGroup.add(flagPole);

    const flagTexture = getJollyRogerTexture(shipGroup.userData.shipId);
    const flagMesh = new _THREE.Mesh(
      new _THREE.PlaneGeometry(0.24 * cellSize, 0.16 * cellSize),
      new _THREE.MeshBasicMaterial({ map: flagTexture, side: _THREE.DoubleSide })
    );
    flagMesh.position.set(0.12 * cellSize, 0.35 * cellSize, 0);
    buoyGroup.add(flagMesh);

    buoyGroup.position.copy(shipGroup.position);
    buoyGroup.position.y = 0.05 * cellSize;

    if (shipGroup.parent) {
      shipGroup.parent.add(buoyGroup);
    }
    shipGroup.userData.buoy = buoyGroup;
  }

  // ---------------------------------------------------------------------------
  // Frame Update: Swell Bobbing, Billowing Sails, Cannon Recoil & Sinking
  // ---------------------------------------------------------------------------
  function updateShip(shipGroup, dt, time, options = {}) {
    if (!shipGroup || !shipGroup.userData) return;
    const u = shipGroup.userData;
    const cellSize = u.cellSize || 1.0;

    // 1. Sinking Progression
    if (u.sinking && u.sinking.active) {
      const s = u.sinking;
      s.progress += dt / s.duration;

      if (u.isSubmarine) {
        // Polar Tang Dive Motion
        shipGroup.rotation.x = -Math.sin(s.progress * Math.PI * 0.5) * 0.35;
        shipGroup.position.y = -s.progress * 1.6 * cellSize;
        shipGroup.position.x += dt * 0.4 * cellSize; // Glides forward under water
      } else {
        // Galleon Sinking Motion
        shipGroup.rotation.x = Math.sin(s.progress * Math.PI * 0.5) * 0.45;
        shipGroup.rotation.z = Math.sin(s.progress * Math.PI * 0.5) * 0.30;
        shipGroup.position.y = -s.progress * 1.8 * cellSize;
      }

      if (s.progress >= 1.0) {
        s.active = false;
        shipGroup.visible = false;
        if (typeof s.onComplete === 'function') s.onComplete();
      }
      return;
    }

    // 2. Wave Swell Bob & Roll
    const wavePhase = (options.wavePhase !== undefined ? options.wavePhase : time * 1.8) +
      (shipGroup.position.x * 0.25) + (shipGroup.position.z * 0.25);

    const bobY = Math.sin(wavePhase) * (0.04 * cellSize);
    const rollZ = Math.sin(wavePhase * 0.8) * 0.035;
    const pitchX = Math.cos(wavePhase * 0.9) * 0.025;

    shipGroup.position.y = u.basePosY + bobY;
    shipGroup.rotation.z = rollZ;
    shipGroup.rotation.x = pitchX;

    // 3. Billowing Sails Flutter
    const masts = shipGroup.getObjectByName('mastsAndSailsGroup');
    if (masts && masts.userData && masts.userData.sailNodes) {
      const sailNodes = masts.userData.sailNodes;
      for (let i = 0; i < sailNodes.length; i++) {
        const sn = sailNodes[i];
        sn.mesh.rotation.y = (Math.PI * 0.22) + Math.sin(time * 3.5 + sn.phase) * 0.06;
        sn.mesh.rotation.x = Math.cos(time * 2.8 + sn.phase) * 0.03;
      }
    }

    // 4. Cannon Recoil Animation
    if (u.cannonAnim && u.cannonAnim.active) {
      const ca = u.cannonAnim;
      ca.t += dt * 4.0;
      const targetGroup = (ca.side === 'starboard') ? shipGroup.cannonsStarboard : shipGroup.cannonsPort;
      const dir = (ca.side === 'starboard') ? 1 : -1;

      if (targetGroup) {
        if (ca.t < 0.25) {
          // Sharp recoil backward
          const recoil = (ca.t / 0.25) * (0.12 * cellSize);
          targetGroup.position.z = recoil * dir;
        } else if (ca.t < 1.0) {
          // Smooth return forward
          const recover = (1.0 - (ca.t - 0.25) / 0.75) * (0.12 * cellSize);
          targetGroup.position.z = recover * dir;
        } else {
          targetGroup.position.z = 0;
          ca.active = false;
        }
      }
    }

    // 5. Deck Crew Idle Sway or Cheer Jump
    const crewGroup = shipGroup.getObjectByName('deckCrewGroup');
    if (crewGroup && crewGroup.userData && crewGroup.userData.instMesh) {
      const im = crewGroup.userData.instMesh;
      const slots = crewGroup.userData.slots;
      const dummy = crewGroup.userData.dummy;

      const isCheering = u.cheering > 0.0;
      if (isCheering) u.cheering = Math.max(0, u.cheering - dt);

      for (let i = 0; i < slots.length; i++) {
        const slot = slots[i];
        let py = 0.23 * cellSize;
        let rotY = Math.sin(time * 2.0 + i) * 0.15;

        if (isCheering) {
          py += Math.abs(Math.sin(time * 8.0 + i * 0.8)) * (0.06 * cellSize);
          rotY += Math.sin(time * 12.0) * 0.35;
        } else {
          py += Math.sin(time * 2.5 + i) * (0.01 * cellSize);
        }

        dummy.position.set(slot.x, py, slot.z);
        dummy.rotation.y = rotY;
        dummy.scale.set(1, 1, 1);
        dummy.updateMatrix();
        im.setMatrixAt(i, dummy.matrix);
      }
      im.instanceMatrix.needsUpdate = true;
    }

    // 6. Waterline Wake Foam Pulsing with Wave Swell
    const wake = shipGroup.getObjectByName('wakeFoamGroup');
    if (wake) {
      const foamPulse = 0.95 + 0.10 * Math.sin(time * 2.8 + wavePhase);
      wake.scale.set(foamPulse, 1.0, foamPulse);
    }
  }

  // ---------------------------------------------------------------------------
  // Module Exports under globalThis.GLT
  // ---------------------------------------------------------------------------
  root.GLT = root.GLT || {};
  root.GLT.shipsVoxel = {
    SHIPS_VOXEL_CONFIG: SHIPS_VOXEL_CONFIG,
    getShipConfig: getShipConfig,
    createShipMesh: createShipMesh,
    createGhostShipMesh: createGhostShipMesh,
    setShipDamage: setShipDamage,
    startShipSinking: startShipSinking,
    updateShip: updateShip,
    getJollyRogerTexture: getJollyRogerTexture,
    VoxelBuilder: VoxelBuilder
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = root.GLT.shipsVoxel;
  }

})(typeof globalThis !== 'undefined' ? globalThis : this);
