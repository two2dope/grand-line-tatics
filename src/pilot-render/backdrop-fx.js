/**
 * Grand Line Tactics — WANTED poster and captain avatars
 * Piece 5: backdrop-fx.js (Round 2 Updated)
 *
 * Implements the procedural 24x24 pixel-art WANTED poster (Canvas2D, illustrated portrait, non-overflowing
 * disclaimer borders) and the captain avatars. The backdrop ring, Den Den Mushi boards and crowd come from our world
 * modules (src/sea/bridge.js); shot, splash, hit, sinking, technique FX and fireworks from src/fx (src/sea/fx-bridge.js).
 */

(function (root) {
  'use strict';



  // Shot, splash, hit, sinking, technique FX and fireworks: src/sea/fx-bridge.js (GLT.backdropFx.createFxSystem on
  // top of our src/fx modules). This file keeps the WANTED poster and the captain avatars.

  // ---------------------------------------------------------------------------
  // Procedural 24x24 Pixel-Art WANTED Poster Generator (Canvas2D)
  // ---------------------------------------------------------------------------
  function generateWantedPoster(captainInfo = {}, bounty = 1500000000, options = {}) {
    if (typeof document === 'undefined') {
      return { canvas: null, dataUrl: '' };
    }

    const width = options.width || 420;
    const height = options.height || 600;

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = false;

    const captainName = (captainInfo.name || 'MONKEY D. LUFFY').toUpperCase();
    const crewName = (captainInfo.crewName || 'Chapéus de Palha').toUpperCase();
    const crewId = captainInfo.crewId || 'straw_hats';

    // 1. Aged Weathered Parchment Background
    const bgGrad = ctx.createLinearGradient(0, 0, width, height);
    bgGrad.addColorStop(0, '#ebd8b7');
    bgGrad.addColorStop(0.5, '#e4cd9f');
    bgGrad.addColorStop(1, '#d8be8d');
    ctx.fillStyle = bgGrad;
    ctx.fillRect(0, 0, width, height);

    // Weathered Vignette & Stains
    ctx.fillStyle = 'rgba(74, 44, 18, 0.08)';
    ctx.fillRect(0, 0, width, 16);
    ctx.fillRect(0, height - 16, width, 16);
    ctx.fillRect(0, 0, 16, height);
    ctx.fillRect(width - 16, 0, 16, height);

    // Subtle paper speckles
    ctx.fillStyle = 'rgba(60, 35, 12, 0.04)';
    for (let s = 0; s < 120; s++) {
      const rx = (s * 37) % width;
      const ry = (s * 71) % height;
      ctx.fillRect(rx, ry, 3, 3);
    }

    // Outer Dark Border Frame
    ctx.strokeStyle = '#2b1b11';
    ctx.lineWidth = 4;
    ctx.strokeRect(14, 14, width - 28, height - 28);
    ctx.lineWidth = 1;
    ctx.strokeRect(18, 18, width - 36, height - 36);

    // 2. Bold Stamped Header: "WANTED"
    ctx.fillStyle = '#22140d';
    ctx.font = '900 60px "Impact", "Arial Black", serif';
    ctx.textAlign = 'center';
    ctx.letterSpacing = '6px';
    ctx.fillText('WANTED', width * 0.5, 78);
    ctx.letterSpacing = '0px';

    // 3. Center Portrait Frame
    const portX = 36;
    const portY = 96;
    const portW = width - 72; // 348 px
    const portH = 260;

    ctx.fillStyle = '#1e293b';
    ctx.fillRect(portX, portY, portW, portH);
    ctx.strokeStyle = '#3e2723';
    ctx.lineWidth = 3;
    ctx.strokeRect(portX, portY, portW, portH);

    // 4. True 24x22 Pixel-Art Captain Portrait
    drawCaptainPixelPortrait(ctx, portX, portY, portW, portH, crewId);

    // Progressive Visual Polish: Load authentic high-resolution Chibi Captain Portrait without aspect ratio distortion
    if (typeof Image !== 'undefined' && GLT_ASSETS && GLT_ASSETS.portraits && GLT_ASSETS.portraits[crewId]) {
      try {
        const chibi = new Image();
        chibi.onload = function() {
          ctx.save();
          ctx.beginPath();
          ctx.rect(portX, portY, portW, portH);
          ctx.clip();

          // Crop with strict aspect ratio preservation (object-fit: cover centered on face)
          const imgW = chibi.naturalWidth || chibi.width || 512;
          const imgH = chibi.naturalHeight || chibi.height || 512;
          const imgAspect = imgW / imgH;
          const targetAspect = portW / portH;
          let sx = 0, sy = 0, sw = imgW, sh = imgH;
          if (imgAspect > targetAspect) {
            sw = imgH * targetAspect;
            sx = (imgW - sw) * 0.5;
          } else {
            sh = imgW / targetAspect;
            sy = (imgH - sh) * 0.16; // focus slightly upward on eyes and face
          }
          ctx.drawImage(chibi, sx, sy, sw, sh, portX, portY, portW, portH);

          // Subtle aged parchment tone
          ctx.fillStyle = 'rgba(216, 190, 141, 0.12)';
          ctx.fillRect(portX, portY, portW, portH);
          ctx.restore();
        };
        chibi.src = GLT_ASSETS.portraits[crewId];
      } catch (e) {}
    }

    // 5. Subheader: "DEAD OR ALIVE"
    ctx.fillStyle = '#22140d';
    ctx.font = 'bold 24px "Times New Roman", serif';
    ctx.textAlign = 'center';
    ctx.fillText('DEAD OR ALIVE', width * 0.5, 390);

    // 6. Captain Name
    ctx.font = '900 36px "Impact", "Arial Black", sans-serif';
    ctx.fillText(captainName, width * 0.5, 436);

    // Crew Name Sub-label
    ctx.font = 'italic bold 15px sans-serif';
    ctx.fillStyle = '#4a2c13';
    ctx.fillText(crewName, width * 0.5, 462);

    // 7. Berry Bounty Counter (฿ 1.500.000.000 -)
    const formattedBounty = new Intl.NumberFormat('pt-BR').format(Math.round(bounty));
    ctx.fillStyle = '#1c100a';
    ctx.font = '900 38px "Impact", "Courier New", monospace';
    ctx.fillText(`฿ ${formattedBounty} -`, width * 0.5, 520);

    // 8. Official Marine Watermark Seal
    ctx.save();
    ctx.translate(width - 70, height - 60);
    ctx.rotate(-0.2);
    ctx.strokeStyle = 'rgba(185, 28, 28, 0.45)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(0, 0, 32, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = 'rgba(185, 28, 28, 0.45)';
    ctx.font = 'bold 10px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('MARINE', 0, -4);
    ctx.fillText('GOVERNMENT', 0, 10);
    ctx.restore();

    // Progressive Seal Stamp Overlay
    if (typeof Image !== 'undefined' && GLT_ASSETS && GLT_ASSETS.emblems && GLT_ASSETS.emblems[crewId]) {
      try {
        const sImg = new Image();
        sImg.onload = function() {
          ctx.save();
          ctx.translate(width - 70, height - 60);
          ctx.rotate(-0.15);
          ctx.globalAlpha = 0.82;
          ctx.drawImage(sImg, -30, -30, 60, 60);
          ctx.restore();
        };
        sImg.src = GLT_ASSETS.emblems[crewId];
      } catch (e) {}
    }

    // 9. Authentic Disclaimer Footer (Strictly fitted within borders, font = bold 8px monospace)
    ctx.fillStyle = '#4a2c13';
    ctx.font = 'bold 8px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('KONO SAKUHIN HA FICTION DETHUNODE JITSUZAISURU JINBUTSU DANTAI', width * 0.5, 574);
    ctx.fillText('SONOTA NO SOSHIKI TO HA ISSAI KANKEI ARIMASEN', width * 0.5, 586);

    function drawBountyOnly(newBounty) {
      ctx.fillStyle = '#ebd8b7';
      ctx.fillRect(portX, 480, portW, 55);
      const fb = new Intl.NumberFormat('pt-BR').format(Math.round(newBounty));
      ctx.fillStyle = '#1c100a';
      ctx.font = '900 38px "Impact", "Courier New", monospace';
      ctx.textAlign = 'center';
      ctx.fillText(`฿ ${fb} -`, width * 0.5, 520);
    }

    return {
      canvas: canvas,
      dataUrl: canvas.toDataURL('image/png'),
      drawBountyOnly: drawBountyOnly,
      updateBounty: (newBounty) => {
        drawBountyOnly(newBounty);
        return canvas.toDataURL('image/png');
      }
    };
  }

  /**
   * Draws a true 24x22 crisp pixel-art captain portrait.
   * Renders each pixel block with ctx.fillRect(x, y, pixelScale, pixelScale).
   */
  function drawCaptainPixelPortrait(ctx, portX, portY, portW, portH, crewId) {
    const COLS = 24;
    const ROWS = 22;
    const pixelScale = Math.floor(Math.min(portW / COLS, portH / ROWS)); // 11px
    const gridW = COLS * pixelScale;
    const gridH = ROWS * pixelScale;
    const startX = portX + Math.floor((portW - gridW) * 0.5);
    const startY = portY + Math.floor((portH - gridH) * 0.5);

    function px(c, r, colHex, count = 1) {
      ctx.fillStyle = colHex;
      ctx.fillRect(startX + c * pixelScale, startY + r * pixelScale, pixelScale * count, pixelScale);
    }

    if (crewId === 'straw_hats') {
      // 1. Monkey D. Luffy (Straw Hats):
      // Sky blue backdrop
      for (let r = 0; r < ROWS; r++) {
        for (let c = 0; c < COLS; c++) {
          px(c, r, (r < 7 ? '#38bdf8' : '#0284c7'));
        }
      }
      // White cloud puffs
      px(2, 3, '#f8fafc', 4); px(3, 2, '#f8fafc', 2);
      px(18, 4, '#f8fafc', 4); px(19, 3, '#f8fafc', 2);

      // Straw Hat Crown
      for (let r = 2; r <= 4; r++) px(8, r, '#facc15', 8);
      // Red Ribbon
      px(8, 4, '#dc2626', 8);
      // Straw Hat Wide Brim
      px(3, 5, '#eab308', 18);
      px(4, 6, '#ca8a04', 16);

      // Wild Black Spiky Hair
      px(5, 7, '#0f172a', 3); px(16, 7, '#0f172a', 3);
      px(4, 8, '#0f172a', 3); px(17, 8, '#0f172a', 3);

      // Face (Tan skin)
      for (let r = 7; r <= 15; r++) {
        const span = (r >= 14 ? 8 : 10);
        const colStart = (r >= 14 ? 8 : 7);
        px(colStart, r, '#fed7aa', span);
      }

      // Eyebrows
      px(8, 7, '#0f172a', 3); px(13, 7, '#0f172a', 3);
      // Expressive Eyes (White sclera + dark pupil + shine)
      px(8, 8, '#ffffff', 3); px(9, 8, '#0f172a', 2); px(9, 8, '#ffffff', 1);
      px(13, 8, '#ffffff', 3); px(13, 8, '#0f172a', 2); px(14, 8, '#ffffff', 1);

      // Classic Scar under Left Eye (crisp 2-stitch curved line)
      px(8, 10, '#991b1b', 2);
      px(9, 11, '#991b1b', 1);

      // Nose
      px(11, 10, '#f59e0b', 2);

      // Giant Open Laughing Grin
      px(7, 12, '#0f172a', 10);
      px(8, 13, '#ffffff', 8); // White teeth row
      px(9, 14, '#ef4444', 6); // Red mouth inside

      // Red Vest & Neck
      px(10, 16, '#fed7aa', 4); px(10, 17, '#fed7aa', 4);
      for (let r = 18; r < ROWS; r++) {
        px(4, r, '#dc2626', 16);
      }
      px(11, 19, '#facc15', 2); // Gold vest button

    } else if (crewId === 'whitebeard') {
      // 2. Edward Newgate (Whitebeard):
      // Indigo Stormy Dusk Sky
      for (let r = 0; r < ROWS; r++) {
        for (let c = 0; c < COLS; c++) {
          px(c, r, (r < 8 ? '#1e1b4b' : '#312e81'));
        }
      }
      // Golden aura rays
      px(3, 2, '#facc15', 2); px(20, 2, '#facc15', 2);

      // Black Pirate Bandana
      for (let r = 2; r <= 5; r++) px(6, r, '#0f172a', 12);
      px(11, 3, '#f8fafc', 2); // Whitebeard cross emblem on bandana

      // Chiseled Rugged Face
      for (let r = 6; r <= 15; r++) px(7, r, '#fed7aa', 10);

      // Heavy Grey Eyebrows
      px(8, 7, '#64748b', 3); px(13, 7, '#64748b', 3);
      // Piercing Eyes
      px(8, 8, '#ffffff', 3); px(9, 8, '#0f172a', 2);
      px(13, 8, '#ffffff', 3); px(13, 8, '#0f172a', 2);
      // Nose
      px(11, 9, '#d97706', 2); px(11, 10, '#d97706', 2);

      // Colossal White Crescent Moustache! (Sweeping up from chin to outer ears)
      px(10, 13, '#ffffff', 4);
      px(7, 12, '#ffffff', 3); px(14, 12, '#ffffff', 3);
      px(4, 11, '#ffffff', 3); px(17, 11, '#ffffff', 3);
      px(2, 9, '#ffffff', 2);  px(20, 9, '#ffffff', 2); // Tips curving up

      // Stern Chin
      px(10, 14, '#fed7aa', 4); px(10, 15, '#fed7aa', 4);

      // White Captain Coat & Golden Epaulets
      for (let r = 16; r < ROWS; r++) {
        px(3, r, '#f8fafc', 18);
        px(4, r, '#facc15', 2); px(18, r, '#facc15', 2); // Epaulets
      }

    } else if (crewId === 'red_haired') {
      // 3. Shanks (Red-Haired Pirates):
      // Sunset orange sea sky
      for (let r = 0; r < ROWS; r++) {
        for (let c = 0; c < COLS; c++) {
          px(c, r, (r < 8 ? '#f97316' : '#c2410c'));
        }
      }

      // Crimson Red Hair (parted in center)
      for (let r = 2; r <= 5; r++) {
        px(4, r, '#dc2626', 7); px(13, r, '#dc2626', 7);
      }
      px(3, 6, '#b91c1c', 4); px(17, 6, '#b91c1c', 4);

      // Face
      for (let r = 6; r <= 15; r++) px(7, r, '#fed7aa', 10);

      // Eyebrows
      px(8, 7, '#991b1b', 3); px(13, 7, '#991b1b', 3);

      // Triple Red Claw Scars over left eye!
      px(9, 6, '#7f1d1d', 1); px(9, 7, '#7f1d1d', 1); px(9, 8, '#7f1d1d', 1); px(9, 9, '#7f1d1d', 1);
      px(10, 6, '#991b1b', 1); px(10, 7, '#991b1b', 1); px(10, 8, '#991b1b', 1); px(10, 9, '#991b1b', 1);

      // Eyes
      px(8, 8, '#ffffff', 3); px(9, 8, '#0f172a', 1);
      px(13, 8, '#ffffff', 3); px(14, 8, '#0f172a', 1);

      // Nose
      px(11, 10, '#d97706', 2);
      // Smirk
      px(10, 12, '#7c2d12', 4); px(13, 11, '#7c2d12', 1);
      // Goatee Stubble
      px(11, 14, '#78350f', 2); px(10, 15, '#78350f', 4);

      // Open White Shirt & Black Cape
      for (let r = 16; r < ROWS; r++) {
        px(3, r, '#0f172a', 18);
        px(9, r, '#ffffff', 6);
      }

    } else if (crewId === 'heart') {
      // 4. Trafalgar Law (Heart Pirates):
      // Cyan Room Spatial Grid
      for (let r = 0; r < ROWS; r++) {
        for (let c = 0; c < COLS; c++) {
          px(c, r, ((r % 4 === 0 || c % 4 === 0) ? '#06b6d4' : '#083344'));
        }
      }

      // White Fur Cap with Black Spots
      for (let r = 2; r <= 5; r++) px(6, r, '#f8fafc', 12);
      px(8, 3, '#0f172a', 2); px(14, 3, '#0f172a', 2); // Spots
      px(11, 4, '#0f172a', 2);
      px(5, 6, '#f1f5f9', 14); // Cap rim

      // Face & Black Sideburns
      for (let r = 7; r <= 15; r++) {
        px(6, r, '#0f172a', 2); // Left sideburn
        px(8, r, '#fed7aa', 8); // Face
        px(16, r, '#0f172a', 2); // Right sideburn
      }

      // Eyebrows & Sharp Dark-Circled Eyes
      px(8, 7, '#0f172a', 3); px(13, 7, '#0f172a', 3);
      px(8, 8, '#ffffff', 3); px(9, 8, '#0f172a', 2); px(8, 9, '#94a3b8', 3);
      px(13, 8, '#ffffff', 3); px(14, 8, '#0f172a', 2); px(13, 9, '#94a3b8', 3);

      // Nose & Smirk
      px(11, 10, '#d97706', 2);
      px(10, 12, '#0f172a', 4);
      // Goatee
      px(11, 14, '#0f172a', 2); px(11, 15, '#0f172a', 2);
      // Gold Earring
      px(5, 10, '#facc15', 1);

      // Yellow/Black Heart Hoodie Collar
      for (let r = 16; r < ROWS; r++) {
        px(4, r, '#0f172a', 16);
        px(9, r, '#facc15', 6);
      }

    } else if (crewId === 'blackbeard') {
      // 5. Marshall D. Teach (Blackbeard):
      // Swirling Purple/Black Darkness Void
      for (let r = 0; r < ROWS; r++) {
        for (let c = 0; c < COLS; c++) {
          px(c, r, (r % 2 === 0 ? '#1e1b4b' : '#3b0764'));
        }
      }

      // Green Bandana with Jeweled Pins
      px(5, 2, '#15803d', 14); px(5, 3, '#15803d', 14);
      px(7, 2, '#facc15', 2); px(11, 2, '#ef4444', 2); px(15, 2, '#facc15', 2); // Jewels

      // Wild Curly Black Hair
      px(3, 4, '#0f172a', 3); px(18, 4, '#0f172a', 3);
      px(2, 5, '#0f172a', 4); px(18, 5, '#0f172a', 4);

      // Face
      for (let r = 4; r <= 13; r++) px(7, r, '#d97706', 10);

      // Fierce Eyes
      px(8, 6, '#ffffff', 3); px(9, 6, '#0f172a', 2);
      px(13, 6, '#ffffff', 3); px(14, 6, '#0f172a', 2);
      // Big Nose
      px(11, 8, '#92400e', 2); px(11, 9, '#92400e', 2);

      // Gap-Toothed Evil Grin
      px(7, 10, '#0f172a', 10);
      px(8, 11, '#ffffff', 8);
      px(9, 11, '#0f172a', 1); // Missing tooth gap
      px(12, 11, '#0f172a', 1); // Missing tooth gap

      // Bushy Thick Black Beard
      for (let r = 12; r <= 17; r++) {
        px(5, r, '#0f172a', 14);
      }

      // Red Pirate Captain Coat & Gold Chains
      for (let r = 18; r < ROWS; r++) {
        px(3, r, '#b91c1c', 18);
        px(9, r, '#facc15', 6);
      }

    } else {
      // 6. Fleet Admiral Sakazuki (Marines):
      // Magma Volcano Glow
      for (let r = 0; r < ROWS; r++) {
        for (let c = 0; c < COLS; c++) {
          px(c, r, (r < 7 ? '#7f1d1d' : '#ea580c'));
        }
      }

      // White Marine Peaked Cap
      for (let r = 2; r <= 4; r++) px(6, r, '#ffffff', 12);
      px(10, 3, '#0284c7', 4); // "MARINE" logo block
      px(4, 5, '#1e293b', 16); // Visor

      // Severe Face & Stern Jaw
      for (let r = 6; r <= 15; r++) px(7, r, '#fed7aa', 10);

      // Scowling Eyebrows
      px(8, 7, '#0f172a', 3); px(13, 7, '#0f172a', 3);
      // Cold Focused Eyes
      px(8, 8, '#ffffff', 3); px(9, 8, '#0f172a', 2);
      px(13, 8, '#ffffff', 3); px(13, 8, '#0f172a', 2);

      // Nose
      px(11, 10, '#d97706', 2);
      // Downward Scowling Mouth
      px(9, 13, '#7c2d12', 6);
      px(8, 14, '#7c2d12', 2); px(14, 14, '#7c2d12', 2);

      // Red Suit Collar & Hibiscus Flower
      for (let r = 16; r < ROWS; r++) {
        px(3, r, '#dc2626', 18);
      }
      px(6, 17, '#ec4899', 3); // Pink Hibiscus Flower
      px(7, 18, '#ec4899', 2);
    }
  }

  // ---------------------------------------------------------------------------
  // Canonical Flow Assets Registry (Portraits, Emblems, Maps & Blessings)
  // ---------------------------------------------------------------------------
  const GLT_ASSETS = {
    portraits: {
      straw_hats: 'assets/portraits/captain-luffy-chibi.jpg',
      whitebeard: 'assets/portraits/captain-whitebeard-chibi.jpg',
      red_haired: 'assets/portraits/captain-shanks-chibi.jpg',
      heart: 'assets/portraits/captain-law-chibi.jpg',
      blackbeard: 'assets/portraits/captain-blackbeard-chibi.jpg',
      marines: 'assets/portraits/captain-sakazuki-chibi.jpg',
      smoker: 'assets/officers/officer-smoker.jpg',
      crocodile: 'assets/portraits/captain-crocodile-chibi.jpg'
    },
    ships: {
      thousand_sunny: 'assets/ships/ship-thousand-sunny.jpg',
      going_merry: 'assets/ships/ship-going-merry.jpg',
      moby_dick: 'assets/ships/ship-moby-dick.jpg',
      red_force: 'assets/ships/ship-red-force.jpg',
      polar_tang: 'assets/ships/ship-polar-tang.jpg',
      saber_of_xebec: 'assets/ships/ship-saber-of-xebec.jpg',
      marine_warship: 'assets/ships/ship-marine-warship.jpg',
      baratie: 'assets/ships/ship-baratie.jpg',
      oro_jackson: 'assets/ships/ship-oro-jackson.jpg',
      straw_hats: 'assets/ships/ship-thousand-sunny.jpg',
      whitebeard: 'assets/ships/ship-moby-dick.jpg',
      red_haired: 'assets/ships/ship-red-force.jpg',
      heart: 'assets/ships/ship-polar-tang.jpg',
      blackbeard: 'assets/ships/ship-saber-of-xebec.jpg',
      marines: 'assets/ships/ship-marine-warship.jpg'
    },
    officers: {
      zoro: { name: 'Roronoa Zoro', crewId: 'straw_hats', role: 'Espadachim & Imediato', image: 'assets/officers/officer-zoro.jpg' },
      nami: { name: 'Nami', crewId: 'straw_hats', role: 'Navegadora & Cartógrafa', image: 'assets/officers/officer-nami.jpg' },
      sanji: { name: 'Sanji', crewId: 'straw_hats', role: 'Cozinheiro de Bordo', image: 'assets/officers/officer-sanji.jpg' },
      marco: { name: 'Marco a Fênix', crewId: 'whitebeard', role: 'Comandante da 1ª Divisão', image: 'assets/officers/officer-marco.jpg' },
      ace: { name: 'Portgas D. Ace', crewId: 'whitebeard', role: 'Comandante da 2ª Divisão', image: 'assets/officers/officer-ace.jpg' },
      beckman: { name: 'Benn Beckman', crewId: 'red_haired', role: 'Primeiro Imediato Tático', image: 'assets/officers/officer-beckman.jpg' },
      bepo: { name: 'Bepo', crewId: 'heart', role: 'Navegador Marcial', image: 'assets/officers/officer-bepo.jpg' },
      kizaru: { name: 'Borsalino (Kizaru)', crewId: 'marines', role: 'Almirante da Marinha', image: 'assets/officers/officer-kizaru.jpg' },
      smoker: { name: 'Smoker', crewId: 'marines', role: 'Vice-Almirante de Loguetown', image: 'assets/officers/officer-smoker.jpg' }
    },
    techniques: {
      bazooka: { name: 'Gomu Gomu no Bazooka', crewId: 'straw_hats', image: 'assets/techniques/tech-bazooka-ptbr.jpg' },
      tremor: { name: 'Terremoto dos Mares', crewId: 'whitebeard', image: 'assets/techniques/tech-tremor-ptbr.jpg' },
      haki_do_rei: { name: 'Haki do Rei Supremo', crewId: 'red_haired', image: 'assets/techniques/tech-haki-rei-ptbr.jpg' },
      room: { name: 'Cirurgia Tática (ROOM)', crewId: 'heart', image: 'assets/techniques/tech-room-ptbr.jpg' },
      vortice: { name: 'Vórtice da Escuridão', crewId: 'blackbeard', image: 'assets/techniques/tech-vortice-ptbr.jpg' },
      observacao: { name: 'Justiça Absoluta (Observação)', crewId: 'marines', image: 'assets/techniques/tech-observacao-ptbr.jpg' }
    },
    hazards: {
      knockup_stream: { name: 'Knock Up Stream', image: 'assets/hazards/hazard-knockup-stream.jpg' },
      calm_belt: { name: 'Reis dos Mares (Calm Belt)', image: 'assets/hazards/hazard-calmbelt-seakings.jpg' },
      aqua_laguna: { name: 'Maré Gigante Aqua Laguna', image: 'assets/hazards/hazard-aqua-laguna.jpg' },
      sandora_storm: { name: 'Tempestade de Areia de Sandora', image: 'assets/hazards/hazard-sandora-storm.jpg' },
      el_thor: { name: 'Julgamento El Thor', image: 'assets/hazards/hazard-el-thor.jpg' }
    },
    props: {
      berry_coin: 'assets/props/prop-berry-coin.jpg',
      denden_mushi: 'assets/props/prop-denden-mushi.jpg',
      barrel_rations: 'assets/props/prop-barrel-rations.jpg',
      triple_logpose: 'assets/props/prop-triple-logpose.jpg'
    },
    emblems: {
      straw_hats: 'assets/emblems/emblem-strawhats-seal.jpg',
      whitebeard: 'assets/emblems/emblem-whitebeard-seal.jpg',
      red_haired: 'assets/emblems/emblem-redhair-seal.jpg',
      heart: 'assets/emblems/emblem-heart-seal.jpg',
      blackbeard: 'assets/emblems/emblem-blackbeard-seal.jpg',
      marines: 'assets/emblems/emblem-marine-military-seal.jpg'
    },
    maps: {
      grandLineHorizontal: 'assets/maps/grand-line-chart-horizontal-ptbr.jpg',
      grandLineVertical: 'assets/maps/grand-line-chart-vertical-ptbr.jpg',
      islands: {
        loguetown: {
          id: 'loguetown',
          name: 'Loguetown',
          tag: 'A Cidade do Começo e do Fim',
          seaId: 'mar_calmo',
          chart: 'assets/maps/map-loguetown-chart.jpg',
          sky: 'assets/backgrounds/sky-biome-loguetown.jpg',
          desc: 'Último porto antes da Red Line. Berço e sepulcro do Rei dos Piratas Gol D. Roger, vigiado sob a fumaça implacável do Capitão Smoker.'
        },
        alabasta: {
          id: 'alabasta',
          name: 'Alabasta',
          tag: 'Reino Desértico de Sandora',
          seaId: 'grand_line',
          chart: 'assets/maps/map-alabasta-chart.jpg',
          sky: 'assets/backgrounds/sky-biome-alabasta.jpg',
          desc: 'Reino banhado por tempestades de areia dourada e calor abrasador. Lar de conspirações milenares e do Rio Poneglyph ancestral.'
        },
        skypiea: {
          id: 'skypiea',
          name: 'Skypiea',
          tag: 'Mar Branco & Terra Sagrada',
          seaId: 'novo_mundo',
          chart: 'assets/maps/map-skypiea-chart.jpg',
          sky: 'assets/backgrounds/sky-biome-skypiea.jpg',
          desc: 'A 10.000 metros de altitude sobre nuvens de mar branco. Navegue sob o eco sagrado do Sino Dourado de Shandora.'
        },
        water7: {
          id: 'water7',
          name: 'Water 7',
          tag: 'A Metrópole dos Carpinteiros',
          seaId: 'tempestade',
          chart: 'assets/maps/map-water7-chart.jpg',
          sky: 'assets/backgrounds/sky-biome-water7.jpg',
          desc: 'Cidade flutuante entrecortada por canais colossais e a fúria da maré Aqua Laguna. Berço dos maiores mestres carpinteiros.'
        },
        marineford: {
          id: 'marineford',
          name: 'Marineford',
          tag: 'Quartel General Supremo',
          seaId: 'marineford',
          chart: 'assets/maps/map-marineford-chart.jpg',
          sky: 'assets/backgrounds/sky-biome-marineford.jpg',
          desc: 'A fortaleza inexpugnável no centro do mundo marinho. Sede do Almirantado da Marinha e palco da batalha dos mais fortes.'
        }
      }
    },
    blessings: [
      {
        id: 'sanji_banquet',
        name: 'Banquete de Sanji',
        type: 'Cura & Revigor',
        badge: 'Cozinheiro de Bordo',
        desc: 'Uma refeição farta no mar que restaura a integridade de embarcações e fortalece a moral da tripulação.',
        image: 'assets/blessings/blessing-sanji-banquet.jpg'
      },
      {
        id: 'enel_gunpowder',
        name: 'Pólvora de Enel',
        type: 'Artilharia Élfica',
        badge: 'Trovão Divino',
        desc: 'Pólvora energizada por raios divinos capaz de provocar detonações em área devastadoras.',
        image: 'assets/blessings/blessing-enel-gunpowder.jpg'
      },
      {
        id: 'golden_den_den',
        name: 'Den Den Dourado',
        type: 'Comunicação Tática',
        badge: 'Transmissão Militar',
        desc: 'Sussurros de emergência e escuta criptografada interceptam as coordenadas secretas da esquadra inimiga.',
        image: 'assets/blessings/blessing-golden-den-den-ptbr.jpg'
      },
      {
        id: 'tailwind_log_pose',
        name: 'Vento de Cauda',
        type: 'Navegação Avançada',
        badge: 'Log Pose',
        desc: 'As correntes místicas da Grand Line alinham os ventos marítimos para conferir mobilidade e resposta imediata.',
        image: 'assets/blessings/blessing-tailwind-log-pose-ptbr.jpg'
      },
      {
        id: 'adam_wood_hull',
        name: 'Madeira de Adão',
        type: 'Blindagem Lendária',
        badge: 'Árvore do Tesouro',
        desc: 'Estrutura naval reforçada com o cerne da lendária Árvore do Tesouro Adão, imune a impactos ordinários.',
        image: 'assets/blessings/blessing-adam-wood-ptbr.jpg'
      },
      {
        id: 'sniper_goggles',
        name: 'Luneta de Sniper',
        type: 'Precisão Absoluta',
        badge: 'Mira Telescópica',
        desc: 'Lentes ópticas de cristal marítimo que garantem mira milimétrica mesmo sob tempestades intensas ou neblina.',
        image: 'assets/blessings/blessing-sniper-goggles-ptbr.jpg'
      }
    ]
  };

  const _avatarCache = {};

  /**
   * Generates a cached crisp pixel-art Captain Avatar dataURL for UI cards & HUD.
   */
  function generateCaptainAvatarDataUrl(crewId = 'straw_hats', size = 72) {
    if (typeof document === 'undefined') return '';
    const key = `${crewId}_${size}`;
    if (_avatarCache[key]) return _avatarCache[key];

    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = '#091426';
    ctx.fillRect(0, 0, size, size);
    drawCaptainPixelPortrait(ctx, 0, 0, size, size, crewId);
    const url = canvas.toDataURL('image/png');
    _avatarCache[key] = url;
    return url;
  }

  // ---------------------------------------------------------------------------
  // Module Exports under globalThis.GLT
  // ---------------------------------------------------------------------------
  root.GLT = root.GLT || {};
  root.GLT.assets = GLT_ASSETS;
  root.GLT.backdropFx = {
    assets: GLT_ASSETS,
    generateWantedPoster: generateWantedPoster,
    generateCaptainAvatarDataUrl: generateCaptainAvatarDataUrl,
    drawCaptainPixelPortrait: drawCaptainPixelPortrait
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = root.GLT.backdropFx;
  }

})(typeof globalThis !== 'undefined' ? globalThis : this);
