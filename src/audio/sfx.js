/**
 * Grand Line Tactics — Web Audio Synthesizer (`src/audio/sfx.js`)
 *
 * Pure procedural Web Audio API sound engine:
 * - Zero external audio files/assets (100% procedural synthesis).
 * - Safe lazy initialization on first user interaction.
 * - Graceful headless/restricted fallback (never throws in Node.js or restricted browsers).
 * - Authentic 6/8 pirate sea shanty chiptune loop with lookahead scheduler.
 * - Distinct signature SFX for cannon, splash, hit, sinking, 6 crew techniques, and UI.
 * - Volume and mute persistence in localStorage (try/catch protected).
 * - Strict AudioNode lifecycle management (`autoDisconnect` on `onended`) to prevent
 *   memory leaks over long sessions.
 * - Lookahead catch-up spiral prevention when returning from backgrounded tabs.
 * - Suspends AudioContext on document.hidden to conserve mobile battery & CPU.
 * - Immediate zero-allocation bypass for all one-shot SFX & music steps when muted.
 *
 * Attaches to: globalThis.GLT = globalThis.GLT || {}; GLT.audio = ...
 * CommonJS export: module.exports = GLT.audio
 */

(function () {
  'use strict';

  // --- Safe Storage Keys & Defaults ---
  const STORAGE_KEY_MUTED = 'glt_audio_muted';
  const STORAGE_KEY_VOLUME = 'glt_audio_volume';
  const DEFAULT_VOLUME = 0.75;
  const DEFAULT_MUTED = false;

  // --- Internal State ---
  let isMutedState = DEFAULT_MUTED;
  let volumeState = DEFAULT_VOLUME;

  // Active intermediate/source audio node counter (for memory leak verification)
  let activeNodeCount = 0;

  // Read persisted preferences safely
  try {
    if (typeof localStorage !== 'undefined') {
      const storedMuted = localStorage.getItem(STORAGE_KEY_MUTED);
      if (storedMuted !== null) {
        isMutedState = storedMuted === 'true';
      }
      const storedVol = localStorage.getItem(STORAGE_KEY_VOLUME);
      if (storedVol !== null) {
        const parsed = parseFloat(storedVol);
        if (!Number.isNaN(parsed) && parsed >= 0 && parsed <= 1) {
          volumeState = parsed;
        }
      }
    }
  } catch (_e) {
    // SecurityError in sandbox/iframe or unavailable in Node
  }

  // --- Web Audio Graph Variables ---
  let ctx = null;
  let masterGain = null;
  let sfxGain = null;
  let musicGain = null;
  let compressor = null;
  let whiteNoiseBuffer = null;
  let pinkNoiseBuffer = null;

  // --- Shanty Music Loop Scheduler State ---
  let shantyPlaying = false;
  let shantyTimerId = null;
  let shantyCurrentStep = 0;
  let shantyNextStepTime = 0;
  const SHANTY_TEMPO_BPM = 116; // 6/8 dotted-quarter pulse (~116 bpm)
  // In 6/8, each step is one 8th note. 1 dotted quarter = 3 eighths.
  // Step duration in seconds: (60 / 116) / 3 ≈ 0.1724s
  const STEP_DURATION = (60 / SHANTY_TEMPO_BPM) / 3;
  const LOOKAHEAD_MS = 25;
  const SCHEDULE_AHEAD_SEC = 0.12;
  const TOTAL_STEPS = 96; // 16 measures * 6 eighth notes per measure

  /**
   * Strict AudioNode lifecycle cleaner.
   * Disconnects the source and any upstream/downstream intermediate nodes
   * (filters, gains, panners) when playback finishes (`sourceNode.onended`),
   * allowing the browser's garbage collector to free them immediately.
   */
  function autoDisconnect(sourceNode, ...chainedNodes) {
    if (!sourceNode) return;
    const nodeCount = 1 + chainedNodes.length;
    activeNodeCount += nodeCount;

    sourceNode.onended = () => {
      try {
        sourceNode.disconnect();
      } catch (_e) {}

      for (let i = 0; i < chainedNodes.length; i++) {
        const node = chainedNodes[i];
        if (node && typeof node.disconnect === 'function') {
          try {
            node.disconnect();
          } catch (_e) {}
        }
      }

      activeNodeCount = Math.max(0, activeNodeCount - nodeCount);
      sourceNode.onended = null;
    };
  }

  /**
   * Lazily initializes the Web Audio Context and audio graph.
   * Safe to call anywhere, returns null if Web Audio is unsupported (e.g. Node).
   */
  function initAudio() {
    if (ctx) {
      if (ctx.state === 'suspended') {
        try {
          ctx.resume().catch(() => {});
        } catch (_e) {}
      }
      return ctx;
    }

    try {
      const AudioCtxClass =
        (typeof window !== 'undefined' && (window.AudioContext || window.webkitAudioContext)) ||
        (typeof globalThis !== 'undefined' && (globalThis.AudioContext || globalThis.webkitAudioContext));

      if (!AudioCtxClass) {
        return null;
      }

      ctx = new AudioCtxClass();

      // Master Dynamics Compressor / Brickwall Limiter to prevent clipping
      compressor = ctx.createDynamicsCompressor();
      compressor.threshold.setValueAtTime(-4, ctx.currentTime);
      compressor.knee.setValueAtTime(8, ctx.currentTime);
      compressor.ratio.setValueAtTime(12, ctx.currentTime);
      compressor.attack.setValueAtTime(0.003, ctx.currentTime);
      compressor.release.setValueAtTime(0.12, ctx.currentTime);
      compressor.connect(ctx.destination);

      // Master Gain
      masterGain = ctx.createGain();
      const currentGain = isMutedState ? 0 : volumeState;
      masterGain.gain.setValueAtTime(currentGain, ctx.currentTime);
      masterGain.connect(compressor);

      // SFX Bus Gain (Full dynamic range for punchy impacts)
      sfxGain = ctx.createGain();
      sfxGain.gain.setValueAtTime(1.0, ctx.currentTime);
      sfxGain.connect(masterGain);

      // Music Bus Gain (Warm balance beneath SFX)
      musicGain = ctx.createGain();
      musicGain.gain.setValueAtTime(0.42, ctx.currentTime);
      musicGain.connect(masterGain);

      // Pre-generate reusable noise buffers (2 seconds mono)
      const sampleRate = ctx.sampleRate || 44100;
      const bufferLength = sampleRate * 2;

      // 1. White Noise Buffer
      whiteNoiseBuffer = ctx.createBuffer(1, bufferLength, sampleRate);
      const whiteData = whiteNoiseBuffer.getChannelData(0);
      for (let i = 0; i < bufferLength; i++) {
        whiteData[i] = Math.random() * 2 - 1;
      }

      // 2. Pink Noise Buffer (Paul Kellet's filter algorithm)
      pinkNoiseBuffer = ctx.createBuffer(1, bufferLength, sampleRate);
      const pinkData = pinkNoiseBuffer.getChannelData(0);
      let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
      for (let i = 0; i < bufferLength; i++) {
        const white = Math.random() * 2 - 1;
        b0 = 0.99886 * b0 + white * 0.0555179;
        b1 = 0.99332 * b1 + white * 0.0750759;
        b2 = 0.96900 * b2 + white * 0.1538520;
        b3 = 0.86650 * b3 + white * 0.3104856;
        b4 = 0.55000 * b4 + white * 0.5329522;
        b5 = -0.7616 * b5 - white * 0.0168980;
        pinkData[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362) * 0.11;
        b6 = white * 0.115926;
      }

      return ctx;
    } catch (_err) {
      ctx = null;
      return null;
    }
  }

  // Helper to ensure context is active on user gestures
  function ensureContext() {
    const context = initAudio();
    if (context && context.state === 'suspended') {
      try {
        context.resume().catch(() => {});
      } catch (_e) {}
    }
    return context;
  }

  // --- Document Visibility Management ---
  // Suspend context when hidden to conserve battery; resume when visible.
  if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
    try {
      document.addEventListener('visibilitychange', () => {
        if (!ctx) return;
        if (document.hidden) {
          if (ctx.state === 'running') {
            try {
              ctx.suspend().catch(() => {});
            } catch (_e) {}
          }
        } else {
          // Tab became visible again: resume context if suspended
          if (ctx.state === 'suspended') {
            try {
              ctx.resume().catch(() => {});
            } catch (_e) {}
          }
          // Reset scheduler next step time to prevent lookahead catch-up burst
          if (shantyPlaying) {
            shantyNextStepTime = ctx.currentTime + 0.02;
          }
        }
      });
    } catch (_e) {}
  }

  // --- Reusable Audio Synthesis Primitives ---

  /**
   * Helper to play a filtered noise burst with strict lifecycle cleanup.
   */
  function playNoise({
    type = 'white',
    filterType = 'bandpass',
    freqStart = 1000,
    freqEnd = null,
    q = 1.0,
    duration = 0.3,
    gain = 0.5,
    attack = 0.005,
    target = sfxGain,
    time = null
  } = {}) {
    if (isMutedState || volumeState <= 0) return;
    if (!ctx) return;
    const startTime = time !== null ? time : ctx.currentTime;
    const buffer = type === 'pink' && pinkNoiseBuffer ? pinkNoiseBuffer : whiteNoiseBuffer;
    if (!buffer) return;

    try {
      const src = ctx.createBufferSource();
      src.buffer = buffer;
      src.loop = true;

      const filter = ctx.createBiquadFilter();
      filter.type = filterType;
      filter.frequency.setValueAtTime(Math.max(20, freqStart), startTime);
      if (freqEnd !== null && freqEnd !== freqStart) {
        filter.frequency.exponentialRampToValueAtTime(Math.max(20, freqEnd), startTime + duration);
      }
      filter.Q.setValueAtTime(q, startTime);

      const gainNode = ctx.createGain();
      gainNode.gain.setValueAtTime(0.0001, startTime);
      gainNode.gain.linearRampToValueAtTime(gain, startTime + attack);
      gainNode.gain.exponentialRampToValueAtTime(0.0001, startTime + duration);

      src.connect(filter);
      filter.connect(gainNode);
      gainNode.connect(target);

      autoDisconnect(src, filter, gainNode);

      src.start(startTime);
      src.stop(startTime + duration + 0.05);
    } catch (_e) {}
  }

  /**
   * Helper to play an oscillator tone with pitch bend & envelope with strict lifecycle cleanup.
   */
  function playTone({
    type = 'sine',
    freqStart = 440,
    freqEnd = null,
    duration = 0.3,
    gain = 0.5,
    attack = 0.005,
    target = sfxGain,
    time = null
  } = {}) {
    if (isMutedState || volumeState <= 0) return;
    if (!ctx) return;
    const startTime = time !== null ? time : ctx.currentTime;

    try {
      const osc = ctx.createOscillator();
      osc.type = type;
      osc.frequency.setValueAtTime(Math.max(10, freqStart), startTime);
      if (freqEnd !== null && freqEnd !== freqStart) {
        osc.frequency.exponentialRampToValueAtTime(Math.max(10, freqEnd), startTime + duration);
      }

      const gainNode = ctx.createGain();
      gainNode.gain.setValueAtTime(0.0001, startTime);
      gainNode.gain.linearRampToValueAtTime(gain, startTime + attack);
      gainNode.gain.exponentialRampToValueAtTime(0.0001, startTime + duration);

      osc.connect(gainNode);
      gainNode.connect(target);

      autoDisconnect(osc, gainNode);

      osc.start(startTime);
      osc.stop(startTime + duration + 0.05);
    } catch (_e) {}
  }

  // =========================================================================
  // CORE SOUND EFFECTS
  // =========================================================================

  /**
   * 1. Cannon Boom
   * Punchy low-end sub-bass thump + filtered noise burst muzzle blast +
   * pitch-dropping whistling cannonball arc.
   */
  function playCannon() {
    if (isMutedState || volumeState <= 0) return;
    if (!ensureContext()) return;
    const t0 = ctx.currentTime;

    try {
      // Layer 1: Sub-bass chest thump (Sine 160Hz -> 32Hz)
      const subOsc = ctx.createOscillator();
      const subGain = ctx.createGain();
      subOsc.type = 'sine';
      subOsc.frequency.setValueAtTime(160, t0);
      subOsc.frequency.exponentialRampToValueAtTime(32, t0 + 0.38);

      subGain.gain.setValueAtTime(0.9, t0);
      subGain.gain.exponentialRampToValueAtTime(0.001, t0 + 0.42);

      subOsc.connect(subGain);
      subGain.connect(sfxGain);

      autoDisconnect(subOsc, subGain);

      subOsc.start(t0);
      subOsc.stop(t0 + 0.45);

      // Layer 2: Muzzle blast powder ignition (Filtered pink noise)
      playNoise({
        type: 'pink',
        filterType: 'lowpass',
        freqStart: 1800,
        freqEnd: 110,
        duration: 0.35,
        gain: 0.85,
        attack: 0.004,
        time: t0
      });

      // Layer 3: Sharp gunpowder crack (High-pass snap)
      playNoise({
        type: 'white',
        filterType: 'bandpass',
        freqStart: 950,
        freqEnd: 400,
        q: 2.5,
        duration: 0.12,
        gain: 0.5,
        attack: 0.002,
        time: t0
      });

      // Layer 4: Whistling cannonball arc in flight (Doppler whistling sweep)
      const whistleOsc = ctx.createOscillator();
      const whistleFilter = ctx.createBiquadFilter();
      const whistleGain = ctx.createGain();

      whistleOsc.type = 'triangle';
      whistleOsc.frequency.setValueAtTime(740, t0 + 0.1);
      whistleOsc.frequency.exponentialRampToValueAtTime(260, t0 + 0.65);

      whistleFilter.type = 'bandpass';
      whistleFilter.frequency.setValueAtTime(740, t0 + 0.1);
      whistleFilter.frequency.exponentialRampToValueAtTime(260, t0 + 0.65);
      whistleFilter.Q.setValueAtTime(5.0, t0 + 0.1);

      whistleGain.gain.setValueAtTime(0.0001, t0 + 0.1);
      whistleGain.gain.linearRampToValueAtTime(0.28, t0 + 0.22);
      whistleGain.gain.exponentialRampToValueAtTime(0.001, t0 + 0.68);

      whistleOsc.connect(whistleFilter);
      whistleFilter.connect(whistleGain);
      whistleGain.connect(sfxGain);

      autoDisconnect(whistleOsc, whistleFilter, whistleGain);

      whistleOsc.start(t0 + 0.1);
      whistleOsc.stop(t0 + 0.7);
    } catch (_e) {}
  }

  /**
   * 2. Splash Plume ("Água!")
   * Bandpass-filtered white/pink noise water plume + resonant bubble droplets.
   */
  function playSplash() {
    if (isMutedState || volumeState <= 0) return;
    if (!ensureContext()) return;
    const t0 = ctx.currentTime;

    try {
      // Layer 1: Water rush / column plume (Pink noise bandpass wash)
      playNoise({
        type: 'pink',
        filterType: 'bandpass',
        freqStart: 600,
        freqEnd: 1200,
        q: 1.6,
        duration: 0.65,
        gain: 0.7,
        attack: 0.025,
        time: t0
      });

      // Layer 2: Deep water displacement body
      playNoise({
        type: 'pink',
        filterType: 'lowpass',
        freqStart: 380,
        freqEnd: 140,
        q: 1.0,
        duration: 0.5,
        gain: 0.55,
        attack: 0.015,
        time: t0
      });

      // Layer 3: Characteristic resonant water droplets / cartoon bubble blips
      const bubbles = [
        { start: 0.05, f0: 420, f1: 880, dur: 0.045, g: 0.32 },
        { start: 0.12, f0: 560, f1: 1140, dur: 0.04, g: 0.28 },
        { start: 0.20, f0: 480, f1: 960, dur: 0.05, g: 0.25 },
        { start: 0.29, f0: 660, f1: 1300, dur: 0.035, g: 0.22 },
        { start: 0.38, f0: 520, f1: 1020, dur: 0.04, g: 0.18 }
      ];

      bubbles.forEach(b => {
        const time = t0 + b.start;
        const bOsc = ctx.createOscillator();
        const bGain = ctx.createGain();

        bOsc.type = 'sine';
        bOsc.frequency.setValueAtTime(b.f0, time);
        bOsc.frequency.exponentialRampToValueAtTime(b.f1, time + b.dur);

        bGain.gain.setValueAtTime(0.001, time);
        bGain.gain.linearRampToValueAtTime(b.g, time + 0.004);
        bGain.gain.exponentialRampToValueAtTime(0.0001, time + b.dur);

        bOsc.connect(bGain);
        bGain.connect(sfxGain);

        autoDisconnect(bOsc, bGain);

        bOsc.start(time);
        bOsc.stop(time + b.dur + 0.01);
      });
    } catch (_e) {}
  }

  /**
   * 3. Hit Crunch ("Acertou!")
   * Metallic/wooden timber crunch + crackling fire burst.
   */
  function playHit() {
    if (isMutedState || volumeState <= 0) return;
    if (!ensureContext()) return;
    const t0 = ctx.currentTime;

    try {
      // Layer 1: Wooden timber splinter FM crunch (Two detuned triangle sweeps)
      const osc1 = ctx.createOscillator();
      const osc2 = ctx.createOscillator();
      const woodGain = ctx.createGain();

      osc1.type = 'triangle';
      osc2.type = 'sawtooth';
      osc1.frequency.setValueAtTime(175, t0);
      osc1.frequency.exponentialRampToValueAtTime(55, t0 + 0.18);
      osc2.frequency.setValueAtTime(235, t0);
      osc2.frequency.exponentialRampToValueAtTime(65, t0 + 0.18);

      woodGain.gain.setValueAtTime(0.85, t0);
      woodGain.gain.exponentialRampToValueAtTime(0.001, t0 + 0.22);

      osc1.connect(woodGain);
      osc2.connect(woodGain);
      woodGain.connect(sfxGain);

      autoDisconnect(osc1);
      autoDisconnect(osc2, woodGain);

      osc1.start(t0);
      osc2.start(t0);
      osc1.stop(t0 + 0.25);
      osc2.stop(t0 + 0.25);

      // Layer 2: Planks splintering micro-bursts
      playNoise({
        type: 'white',
        filterType: 'bandpass',
        freqStart: 900,
        freqEnd: 450,
        q: 3.5,
        duration: 0.15,
        gain: 0.65,
        attack: 0.002,
        time: t0
      });

      // Layer 3: Metallic iron fitting clank / ringing hit
      const metalOsc = ctx.createOscillator();
      const metalFilter = ctx.createBiquadFilter();
      const metalGain = ctx.createGain();

      metalOsc.type = 'square';
      metalOsc.frequency.setValueAtTime(1120, t0);

      metalFilter.type = 'highpass';
      metalFilter.frequency.setValueAtTime(800, t0);

      metalGain.gain.setValueAtTime(0.4, t0);
      metalGain.gain.exponentialRampToValueAtTime(0.001, t0 + 0.14);

      metalOsc.connect(metalFilter);
      metalFilter.connect(metalGain);
      metalGain.connect(sfxGain);

      autoDisconnect(metalOsc, metalFilter, metalGain);

      metalOsc.start(t0);
      metalOsc.stop(t0 + 0.16);

      // Layer 4: Crackling fire burst (staggered micro noise snaps)
      const crackles = [0.07, 0.14, 0.21, 0.29, 0.38, 0.48];
      crackles.forEach((dt, idx) => {
        playNoise({
          type: 'white',
          filterType: 'highpass',
          freqStart: 2200 + (idx * 300),
          duration: 0.035,
          gain: 0.28 - (idx * 0.03),
          attack: 0.002,
          time: t0 + dt
        });
      });
    } catch (_e) {}
  }

  /**
   * 4. Sunk Hull Groan & Gurgle ("Afundou!")
   * Dramatic multi-stage hull groan + descending low-pass bubble gurgle +
   * triumphant brass/chiptune fanfare chord.
   */
  function playSunk() {
    if (isMutedState || volumeState <= 0) return;
    if (!ensureContext()) return;
    const t0 = ctx.currentTime;

    try {
      // Stage 1: Catastrophic structural hull groan (Deep groaning saw with LFO tremolo)
      const hullOsc = ctx.createOscillator();
      const hullFilter = ctx.createBiquadFilter();
      const hullGain = ctx.createGain();

      // Tremolo LFO for groaning stress
      const lfo = ctx.createOscillator();
      const lfoGain = ctx.createGain();
      lfo.frequency.setValueAtTime(5.5, t0);
      lfoGain.gain.setValueAtTime(0.3, t0);

      hullOsc.type = 'sawtooth';
      hullOsc.frequency.setValueAtTime(95, t0);
      hullOsc.frequency.exponentialRampToValueAtTime(38, t0 + 1.1);

      hullFilter.type = 'lowpass';
      hullFilter.frequency.setValueAtTime(450, t0);
      hullFilter.frequency.exponentialRampToValueAtTime(80, t0 + 1.1);
      hullFilter.Q.setValueAtTime(4.0, t0);

      hullGain.gain.setValueAtTime(0.75, t0);
      hullGain.gain.exponentialRampToValueAtTime(0.001, t0 + 1.25);

      // Connected via lfoGain modulation bus
      lfo.connect(lfoGain);
      lfoGain.connect(hullGain.gain);

      hullOsc.connect(hullFilter);
      hullFilter.connect(hullGain);
      hullGain.connect(sfxGain);

      autoDisconnect(lfo, lfoGain);
      autoDisconnect(hullOsc, hullFilter, hullGain);

      lfo.start(t0);
      hullOsc.start(t0);
      lfo.stop(t0 + 1.3);
      hullOsc.stop(t0 + 1.3);

      // Stage 2: Descending low-pass bubble gurgle (Flooding chambers)
      const gurgles = [
        { dt: 0.20, f0: 540, f1: 270, dur: 0.12, g: 0.35 },
        { dt: 0.38, f0: 460, f1: 230, dur: 0.13, g: 0.33 },
        { dt: 0.55, f0: 380, f1: 190, dur: 0.14, g: 0.30 },
        { dt: 0.72, f0: 300, f1: 140, dur: 0.15, g: 0.28 },
        { dt: 0.90, f0: 240, f1: 110, dur: 0.16, g: 0.25 },
        { dt: 1.10, f0: 180, f1: 80,  dur: 0.18, g: 0.22 },
        { dt: 1.32, f0: 140, f1: 50,  dur: 0.20, g: 0.18 }
      ];

      gurgles.forEach(g => {
        const time = t0 + g.dt;
        const gOsc = ctx.createOscillator();
        const gFilter = ctx.createBiquadFilter();
        const gGainNode = ctx.createGain();

        gOsc.type = 'sine';
        gOsc.frequency.setValueAtTime(g.f0, time);
        gOsc.frequency.exponentialRampToValueAtTime(g.f1, time + g.dur);

        gFilter.type = 'bandpass';
        gFilter.frequency.setValueAtTime((g.f0 + g.f1) / 2, time);
        gFilter.Q.setValueAtTime(3.0, time);

        gGainNode.gain.setValueAtTime(0.001, time);
        gGainNode.gain.linearRampToValueAtTime(g.g, time + 0.01);
        gGainNode.gain.exponentialRampToValueAtTime(0.0001, time + g.dur);

        gOsc.connect(gFilter);
        gFilter.connect(gGainNode);
        gGainNode.connect(sfxGain);

        autoDisconnect(gOsc, gFilter, gGainNode);

        gOsc.start(time);
        gOsc.stop(time + g.dur + 0.02);
      });

      // Stage 3: Triumphant brass/chiptune fanfare chord as ship disappears!
      // F-Major / D-Minor Pirate Triumph: F4, A4, C5, F5
      const fanfareTime = t0 + 0.65;
      const notes = [349.23, 440.00, 523.25, 698.46]; // F4, A4, C5, F5

      notes.forEach((freq, idx) => {
        const chordOsc = ctx.createOscillator();
        const chordFilter = ctx.createBiquadFilter();
        const chordGain = ctx.createGain();

        chordOsc.type = 'square';
        chordOsc.frequency.setValueAtTime(freq, fanfareTime);

        // Brass envelope filter opening up
        chordFilter.type = 'lowpass';
        chordFilter.frequency.setValueAtTime(600, fanfareTime);
        chordFilter.frequency.exponentialRampToValueAtTime(2600, fanfareTime + 0.12);
        chordFilter.frequency.exponentialRampToValueAtTime(900, fanfareTime + 0.8);
        chordFilter.Q.setValueAtTime(1.5, fanfareTime);

        chordGain.gain.setValueAtTime(0.0001, fanfareTime);
        chordGain.gain.linearRampToValueAtTime(0.18, fanfareTime + 0.04 + (idx * 0.015));
        chordGain.gain.exponentialRampToValueAtTime(0.0001, fanfareTime + 0.9);

        chordOsc.connect(chordFilter);
        chordFilter.connect(chordGain);
        chordGain.connect(sfxGain);

        autoDisconnect(chordOsc, chordFilter, chordGain);

        chordOsc.start(fanfareTime);
        chordOsc.stop(fanfareTime + 0.95);
      });
    } catch (_e) {}
  }

  /**
   * 5. Crew Techniques (`playTechnique(techId)`)
   * Distinct procedural signature sound for each of the 6 crew techniques:
   * - 'bazooka'     (Straw Hats / Luffy)
   * - 'tremor'      (Whitebeard / Newgate)
   * - 'haki_do_rei' (Red-Haired / Shanks)
   * - 'room'        (Heart / Law)
   * - 'vortice'     (Blackbeard / Teach)
   * - 'observacao'  (Marines / Sakazuki)
   */
  function playTechnique(techId) {
    if (isMutedState || volumeState <= 0) return;
    if (!ensureContext()) return;
    const t0 = ctx.currentTime;

    try {
      switch (techId) {
        case 'bazooka': {
          // Gomu Gomu no Bazooka:
          // 1. Rubber stretch tension (rising sine sweep with rubber wobble)
          const stretchOsc = ctx.createOscillator();
          const stretchGain = ctx.createGain();
          stretchOsc.type = 'sine';
          stretchOsc.frequency.setValueAtTime(160, t0);
          stretchOsc.frequency.exponentialRampToValueAtTime(620, t0 + 0.28);

          stretchGain.gain.setValueAtTime(0.01, t0);
          stretchGain.gain.linearRampToValueAtTime(0.45, t0 + 0.24);
          stretchGain.gain.exponentialRampToValueAtTime(0.001, t0 + 0.3);

          stretchOsc.connect(stretchGain);
          stretchGain.connect(sfxGain);

          autoDisconnect(stretchOsc, stretchGain);

          stretchOsc.start(t0);
          stretchOsc.stop(t0 + 0.32);

          // 2. Devastating dual-palm rubber release & shockwave impact at 0.28s
          const impactTime = t0 + 0.28;
          const bassOsc = ctx.createOscillator();
          const bassGain = ctx.createGain();
          bassOsc.type = 'triangle';
          bassOsc.frequency.setValueAtTime(190, impactTime);
          bassOsc.frequency.exponentialRampToValueAtTime(32, impactTime + 0.45);

          bassGain.gain.setValueAtTime(0.95, impactTime);
          bassGain.gain.exponentialRampToValueAtTime(0.001, impactTime + 0.5);

          bassOsc.connect(bassGain);
          bassGain.connect(sfxGain);

          autoDisconnect(bassOsc, bassGain);

          bassOsc.start(impactTime);
          bassOsc.stop(impactTime + 0.55);

          // Slap transient & blast noise
          playNoise({
            type: 'white',
            filterType: 'bandpass',
            freqStart: 1600,
            freqEnd: 300,
            q: 2.0,
            duration: 0.35,
            gain: 0.8,
            attack: 0.002,
            time: impactTime
          });
          break;
        }

        case 'tremor': {
          // Gura Gura no Mi (Whitebeard earthquake & sky-shattering):
          // 1. Air glass-crack transient (FM glass fracture chirp)
          const glassCarrier = ctx.createOscillator();
          const glassMod = ctx.createOscillator();
          const glassModGain = ctx.createGain();
          const glassGain = ctx.createGain();

          glassCarrier.type = 'sine';
          glassCarrier.frequency.setValueAtTime(2400, t0);
          glassCarrier.frequency.exponentialRampToValueAtTime(600, t0 + 0.08);

          glassMod.type = 'square';
          glassMod.frequency.setValueAtTime(780, t0);
          glassModGain.gain.setValueAtTime(1200, t0);
          glassModGain.gain.exponentialRampToValueAtTime(10, t0 + 0.08);

          glassGain.gain.setValueAtTime(0.7, t0);
          glassGain.gain.exponentialRampToValueAtTime(0.001, t0 + 0.1);

          // Connected via glassModGain modulation bus
          glassMod.connect(glassModGain);
          glassModGain.connect(glassCarrier.frequency);

          glassCarrier.connect(glassGain);
          glassGain.connect(sfxGain);

          autoDisconnect(glassMod, glassModGain);
          autoDisconnect(glassCarrier, glassGain);

          glassMod.start(t0);
          glassCarrier.start(t0);
          glassMod.stop(t0 + 0.12);
          glassCarrier.stop(t0 + 0.12);

          // 2. Massive seismic earthquake rumble (binaural 38Hz + 44Hz beating at 6Hz)
          const rumble1 = ctx.createOscillator();
          const rumble2 = ctx.createOscillator();
          const rumbleFilter = ctx.createBiquadFilter();
          const rumbleGain = ctx.createGain();

          rumble1.type = 'sawtooth';
          rumble2.type = 'sawtooth';
          rumble1.frequency.setValueAtTime(38, t0 + 0.04);
          rumble2.frequency.setValueAtTime(44, t0 + 0.04);

          rumbleFilter.type = 'lowpass';
          rumbleFilter.frequency.setValueAtTime(180, t0 + 0.04);
          rumbleFilter.frequency.exponentialRampToValueAtTime(60, t0 + 1.3);

          rumbleGain.gain.setValueAtTime(0.001, t0 + 0.04);
          rumbleGain.gain.linearRampToValueAtTime(0.9, t0 + 0.12);
          rumbleGain.gain.exponentialRampToValueAtTime(0.001, t0 + 1.4);

          rumble1.connect(rumbleFilter);
          rumble2.connect(rumbleFilter);
          rumbleFilter.connect(rumbleGain);
          rumbleGain.connect(sfxGain);

          autoDisconnect(rumble1);
          autoDisconnect(rumble2, rumbleFilter, rumbleGain);

          rumble1.start(t0 + 0.04);
          rumble2.start(t0 + 0.04);
          rumble1.stop(t0 + 1.45);
          rumble2.stop(t0 + 1.45);

          // Sub rumble noise
          playNoise({
            type: 'pink',
            filterType: 'lowpass',
            freqStart: 250,
            freqEnd: 40,
            duration: 1.2,
            gain: 0.75,
            attack: 0.05,
            time: t0 + 0.05
          });
          break;
        }

        case 'haki_do_rei': {
          // Conqueror's Haki (Shanks):
          // 1. High ethereal intimidation ring (1760Hz A6)
          const chimeOsc = ctx.createOscillator();
          const chimeGain = ctx.createGain();
          chimeOsc.type = 'sine';
          chimeOsc.frequency.setValueAtTime(1760, t0);

          chimeGain.gain.setValueAtTime(0.001, t0);
          chimeGain.gain.linearRampToValueAtTime(0.45, t0 + 0.015);
          chimeGain.gain.exponentialRampToValueAtTime(0.001, t0 + 0.8);

          chimeOsc.connect(chimeGain);
          chimeGain.connect(sfxGain);

          autoDisconnect(chimeOsc, chimeGain);

          chimeOsc.start(t0);
          chimeOsc.stop(t0 + 0.85);

          // 2. Sudden crushing gravitational sub drone (55Hz)
          const crushOsc = ctx.createOscillator();
          const crushGain = ctx.createGain();
          crushOsc.type = 'triangle';
          crushOsc.frequency.setValueAtTime(55, t0 + 0.06);

          crushGain.gain.setValueAtTime(0.001, t0 + 0.06);
          crushGain.gain.linearRampToValueAtTime(0.85, t0 + 0.15);
          crushGain.gain.exponentialRampToValueAtTime(0.001, t0 + 1.2);

          crushOsc.connect(crushGain);
          crushGain.connect(sfxGain);

          autoDisconnect(crushOsc, crushGain);

          crushOsc.start(t0 + 0.06);
          crushOsc.stop(t0 + 1.25);

          // 3. Black lightning discharge crackles
          [0.08, 0.17, 0.28, 0.42, 0.58].forEach(dt => {
            playNoise({
              type: 'white',
              filterType: 'highpass',
              freqStart: 3400,
              duration: 0.025,
              gain: 0.35,
              attack: 0.001,
              time: t0 + dt
            });
          });
          break;
        }

        case 'room': {
          // Ope Ope no Mi (Law's ROOM dome activation):
          // High-tech spherical crystal glide (440Hz -> 1320Hz with shimmer)
          const domeOsc1 = ctx.createOscillator();
          const domeOsc2 = ctx.createOscillator();
          const domeFilter = ctx.createBiquadFilter();
          const domeGain = ctx.createGain();

          domeOsc1.type = 'sine';
          domeOsc2.type = 'triangle';
          // Detuned chorus pair
          domeOsc1.frequency.setValueAtTime(440, t0);
          domeOsc1.frequency.exponentialRampToValueAtTime(1320, t0 + 0.45);
          domeOsc2.frequency.setValueAtTime(444, t0);
          domeOsc2.frequency.exponentialRampToValueAtTime(1326, t0 + 0.45);

          domeFilter.type = 'bandpass';
          domeFilter.frequency.setValueAtTime(600, t0);
          domeFilter.frequency.exponentialRampToValueAtTime(1400, t0 + 0.45);
          domeFilter.Q.setValueAtTime(3.0, t0);

          domeGain.gain.setValueAtTime(0.001, t0);
          domeGain.gain.linearRampToValueAtTime(0.55, t0 + 0.2);
          domeGain.gain.exponentialRampToValueAtTime(0.001, t0 + 0.65);

          domeOsc1.connect(domeFilter);
          domeOsc2.connect(domeFilter);
          domeFilter.connect(domeGain);
          domeGain.connect(sfxGain);

          autoDisconnect(domeOsc1);
          autoDisconnect(domeOsc2, domeFilter, domeGain);

          domeOsc1.start(t0);
          domeOsc2.start(t0);
          domeOsc1.stop(t0 + 0.7);
          domeOsc2.stop(t0 + 0.7);

          // Soft spatial pulse at completion (0.45s)
          playTone({
            type: 'sine',
            freqStart: 1320,
            freqEnd: 880,
            duration: 0.25,
            gain: 0.35,
            time: t0 + 0.45
          });
          break;
        }

        case 'vortice': {
          // Yami Yami no Mi (Blackbeard dark black-hole vortex):
          // Swirling suction whoosh with modulating bandpass
          const swirlFilter = ctx.createBiquadFilter();
          const swirlGain = ctx.createGain();
          const swirlLFO = ctx.createOscillator();
          const swirlLFOGain = ctx.createGain();

          swirlFilter.type = 'bandpass';
          swirlFilter.frequency.setValueAtTime(450, t0);
          swirlFilter.frequency.linearRampToValueAtTime(1400, t0 + 0.6);
          swirlFilter.Q.setValueAtTime(4.5, t0);

          // Fast swirling frequency modulation
          swirlLFO.frequency.setValueAtTime(4, t0);
          swirlLFO.frequency.linearRampToValueAtTime(9, t0 + 0.6);
          swirlLFOGain.gain.setValueAtTime(250, t0);

          swirlGain.gain.setValueAtTime(0.01, t0);
          swirlGain.gain.linearRampToValueAtTime(0.75, t0 + 0.55);
          swirlGain.gain.exponentialRampToValueAtTime(0.001, t0 + 0.85);

          // Connected via swirlLFOGain modulation bus
          swirlLFO.connect(swirlLFOGain);
          swirlLFOGain.connect(swirlFilter.frequency);

          autoDisconnect(swirlLFO, swirlLFOGain);

          swirlLFO.start(t0);
          swirlLFO.stop(t0 + 0.9);

          const buffer = pinkNoiseBuffer || whiteNoiseBuffer;
          if (buffer) {
            const noiseSrc = ctx.createBufferSource();
            noiseSrc.buffer = buffer;
            noiseSrc.loop = true;
            noiseSrc.connect(swirlFilter);
            swirlFilter.connect(swirlGain);
            swirlGain.connect(sfxGain);

            autoDisconnect(noiseSrc, swirlFilter, swirlGain);

            noiseSrc.start(t0);
            noiseSrc.stop(t0 + 0.9);
          }

          // Dark gravitational lock thud at 0.6s
          playTone({
            type: 'sine',
            freqStart: 110,
            freqEnd: 35,
            duration: 0.35,
            gain: 0.8,
            attack: 0.005,
            time: t0 + 0.6
          });
          break;
        }

        case 'observacao': {
          // Kenbunshoku Haki Observation Radar (Marines):
          // High-Q tactical sonar radar ping (D6 -> D7) with echoes
          const pingFreqs = [1174.66, 2349.32]; // D6, D7
          pingFreqs.forEach((f, idx) => {
            const time = t0 + (idx * 0.05);
            const pingOsc = ctx.createOscillator();
            const pingGain = ctx.createGain();

            pingOsc.type = 'sine';
            pingOsc.frequency.setValueAtTime(f, time);

            pingGain.gain.setValueAtTime(0.001, time);
            pingGain.gain.linearRampToValueAtTime(0.4, time + 0.008);
            pingGain.gain.exponentialRampToValueAtTime(0.0001, time + 0.6);

            pingOsc.connect(pingGain);
            pingGain.connect(sfxGain);

            autoDisconnect(pingOsc, pingGain);

            pingOsc.start(time);
            pingOsc.stop(time + 0.65);
          });

          // Echo 1 (0.24s)
          playTone({
            type: 'sine',
            freqStart: 2349.32,
            duration: 0.45,
            gain: 0.18,
            time: t0 + 0.24
          });

          // Echo 2 (0.48s)
          playTone({
            type: 'sine',
            freqStart: 2349.32,
            duration: 0.35,
            gain: 0.08,
            time: t0 + 0.48
          });
          break;
        }

        default:
          // Fallback generic punchy technique
          playCannon();
          break;
      }
    } catch (_e) {}
  }

  // =========================================================================
  // UI & MATCH AUDIO FX
  // =========================================================================

  /**
   * 6. Coin Toss (Berry Flip)
   * Rapid spinning metallic ringing coin in air + crisp catch snap.
   */
  function playCoinToss() {
    if (isMutedState || volumeState <= 0) return;
    if (!ensureContext()) return;
    const t0 = ctx.currentTime;

    try {
      // 5 rapid spinning flips (C7, D7, E7, C7, F7)
      const flipPings = [2093.00, 2349.32, 2637.02, 2093.00, 2793.83];
      flipPings.forEach((freq, idx) => {
        const time = t0 + (idx * 0.055);
        const osc = ctx.createOscillator();
        const gainNode = ctx.createGain();

        osc.type = 'triangle';
        osc.frequency.setValueAtTime(freq, time);

        gainNode.gain.setValueAtTime(0.001, time);
        gainNode.gain.linearRampToValueAtTime(0.28, time + 0.004);
        gainNode.gain.exponentialRampToValueAtTime(0.0001, time + 0.08);

        osc.connect(gainNode);
        gainNode.connect(sfxGain);

        autoDisconnect(osc, gainNode);

        osc.start(time);
        osc.stop(time + 0.09);
      });

      // Coin catch slap at 0.36s
      const catchTime = t0 + 0.36;
      playTone({
        type: 'sine',
        freqStart: 880,
        freqEnd: 320,
        duration: 0.06,
        gain: 0.4,
        attack: 0.002,
        time: catchTime
      });
      playNoise({
        type: 'white',
        filterType: 'bandpass',
        freqStart: 1800,
        duration: 0.04,
        gain: 0.25,
        time: catchTime
      });
    } catch (_e) {}
  }

  /**
   * 7. UI Click (Tactile nautical wooden peg tap)
   */
  function playUiClick() {
    if (isMutedState || volumeState <= 0) return;
    if (!ensureContext()) return;
    const t0 = ctx.currentTime;

    try {
      playTone({
        type: 'triangle',
        freqStart: 620,
        freqEnd: 210,
        duration: 0.035,
        gain: 0.35,
        attack: 0.002,
        time: t0
      });
      playNoise({
        type: 'white',
        filterType: 'highpass',
        freqStart: 1200,
        duration: 0.015,
        gain: 0.2,
        attack: 0.001,
        time: t0
      });
    } catch (_e) {}
  }

  /**
   * 8. Victory Fanfare
   * Authentic upbeat pirate sea victory fanfare in D Major (Chiptune Brass).
   */
  function playVictoryFanfare() {
    if (isMutedState || volumeState <= 0) return;
    if (!ensureContext()) return;
    const t0 = ctx.currentTime;

    try {
      // Notes: D4 (0.0s), F#4 (0.12s), A4 (0.24s), D5 (0.36s), C#5 (0.50s), D5 (0.64s held)
      const fanfare = [
        { note: 293.66, time: 0.00, dur: 0.11 }, // D4
        { note: 369.99, time: 0.12, dur: 0.11 }, // F#4
        { note: 440.00, time: 0.24, dur: 0.11 }, // A4
        { note: 587.33, time: 0.36, dur: 0.13 }, // D5
        { note: 554.37, time: 0.50, dur: 0.13 }, // C#5
        { note: 587.33, time: 0.64, dur: 0.75 }  // D5 (held)
      ];

      fanfare.forEach(f => {
        const startTime = t0 + f.time;
        const osc = ctx.createOscillator();
        const filter = ctx.createBiquadFilter();
        const gainNode = ctx.createGain();

        osc.type = 'square';
        osc.frequency.setValueAtTime(f.note, startTime);

        filter.type = 'lowpass';
        filter.frequency.setValueAtTime(1400, startTime);
        filter.frequency.linearRampToValueAtTime(2600, startTime + 0.04);
        filter.frequency.exponentialRampToValueAtTime(1000, startTime + f.dur);

        gainNode.gain.setValueAtTime(0.001, startTime);
        gainNode.gain.linearRampToValueAtTime(0.35, startTime + 0.02);
        gainNode.gain.exponentialRampToValueAtTime(0.0001, startTime + f.dur);

        osc.connect(filter);
        filter.connect(gainNode);
        gainNode.connect(sfxGain);

        autoDisconnect(osc, filter, gainNode);

        osc.start(startTime);
        osc.stop(startTime + f.dur + 0.05);
      });

      // Harmonic backing chord on the final resolved note
      const resolveTime = t0 + 0.64;
      [369.99, 440.00].forEach(hNote => {
        const hOsc = ctx.createOscillator();
        const hGain = ctx.createGain();
        hOsc.type = 'triangle';
        hOsc.frequency.setValueAtTime(hNote, resolveTime);

        hGain.gain.setValueAtTime(0.001, resolveTime);
        hGain.gain.linearRampToValueAtTime(0.22, resolveTime + 0.03);
        hGain.gain.exponentialRampToValueAtTime(0.0001, resolveTime + 0.75);

        hOsc.connect(hGain);
        hGain.connect(sfxGain);

        autoDisconnect(hOsc, hGain);

        hOsc.start(resolveTime);
        hOsc.stop(resolveTime + 0.8);
      });
    } catch (_e) {}
  }

  /**
   * 9. Defeat Dirge
   * Melancholic descending pirate dirge in D Minor (Low sorrowful accordion tone).
   */
  function playDefeatDirge() {
    if (isMutedState || volumeState <= 0) return;
    if (!ensureContext()) return;
    const t0 = ctx.currentTime;

    try {
      // D4 (0.0s), F4 (0.28s), E4 (0.56s), D4 (0.84s), C#4 (1.12s), D4 (1.40s sustained)
      const dirge = [
        { note: 293.66, time: 0.00, dur: 0.26 }, // D4
        { note: 349.23, time: 0.28, dur: 0.26 }, // F4
        { note: 329.63, time: 0.56, dur: 0.26 }, // E4
        { note: 293.66, time: 0.84, dur: 0.26 }, // D4
        { note: 277.18, time: 1.12, dur: 0.26 }, // C#4
        { note: 293.66, time: 1.40, dur: 1.10 }  // D4
      ];

      dirge.forEach(d => {
        const startTime = t0 + d.time;
        const osc = ctx.createOscillator();
        const filter = ctx.createBiquadFilter();
        const gainNode = ctx.createGain();

        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(d.note, startTime);

        filter.type = 'lowpass';
        filter.frequency.setValueAtTime(550, startTime);

        gainNode.gain.setValueAtTime(0.001, startTime);
        gainNode.gain.linearRampToValueAtTime(0.24, startTime + 0.04);
        gainNode.gain.exponentialRampToValueAtTime(0.0001, startTime + d.dur);

        osc.connect(filter);
        filter.connect(gainNode);
        gainNode.connect(sfxGain);

        autoDisconnect(osc, filter, gainNode);

        osc.start(startTime);
        osc.stop(startTime + d.dur + 0.05);
      });

      // Ocean wave mist wash at the end
      playNoise({
        type: 'pink',
        filterType: 'bandpass',
        freqStart: 450,
        freqEnd: 200,
        q: 1.2,
        duration: 1.8,
        gain: 0.35,
        attack: 0.2,
        time: t0 + 0.5
      });
    } catch (_e) {}
  }

  /**
   * 10. Den Den Mushi Snail Phone
   * Canonical "purupurupuru... purupurupuru... gacha!"
   */
  function playDenDenMushi() {
    if (isMutedState || volumeState <= 0) return;
    if (!ensureContext()) return;
    const t0 = ctx.currentTime;

    try {
      // 2 rounds of "pu-ru-pu-ru-pu-ru"
      const rounds = [0.0, 0.45];
      rounds.forEach(roundStart => {
        for (let ring = 0; ring < 3; ring++) {
          const ringTime = t0 + roundStart + (ring * 0.12);
          const osc1 = ctx.createOscillator();
          const osc2 = ctx.createOscillator();
          const ringGain = ctx.createGain();

          osc1.type = 'triangle';
          osc2.type = 'sine';
          osc1.frequency.setValueAtTime(760, ringTime);
          osc1.frequency.linearRampToValueAtTime(860, ringTime + 0.04);
          osc1.frequency.linearRampToValueAtTime(760, ringTime + 0.08);

          osc2.frequency.setValueAtTime(880, ringTime);

          ringGain.gain.setValueAtTime(0.001, ringTime);
          ringGain.gain.linearRampToValueAtTime(0.22, ringTime + 0.01);
          ringGain.gain.exponentialRampToValueAtTime(0.0001, ringTime + 0.09);

          osc1.connect(ringGain);
          osc2.connect(ringGain);
          ringGain.connect(sfxGain);

          autoDisconnect(osc1);
          autoDisconnect(osc2, ringGain);

          osc1.start(ringTime);
          osc2.start(ringTime);
          osc1.stop(ringTime + 0.1);
          osc2.stop(ringTime + 0.1);
        }
      });

      // "GACHA!" receiver pickup at 0.95s (Plastic/shell latch snap)
      const gachaTime = t0 + 0.95;
      playTone({
        type: 'square',
        freqStart: 380,
        freqEnd: 120,
        duration: 0.065,
        gain: 0.45,
        attack: 0.002,
        time: gachaTime
      });
      playNoise({
        type: 'white',
        filterType: 'highpass',
        freqStart: 1800,
        duration: 0.04,
        gain: 0.35,
        time: gachaTime
      });
    } catch (_e) {}
  }

  // =========================================================================
  // CHIPTUNE SEA SHANTY LOOP (6/8 NAUTICAL JIG)
  // =========================================================================

  /**
   * Note frequency lookup helper.
   */
  const NOTES = {
    REST: 0,
    D2: 73.42,  E2: 82.41,  F2: 87.31,  G2: 98.00,  A2: 110.00, Bb2: 116.54, C3: 130.81,
    D3: 146.83, E3: 164.81, F3: 174.61, G3: 196.00, A3: 220.00, Bb3: 233.08, C4: 261.63, Csh4: 277.18,
    D4: 293.66, E4: 329.63, F4: 349.23, G4: 392.00, A4: 440.00, Bb4: 466.16, B4: 493.88, C5: 523.25, Csh5: 554.37,
    D5: 587.33, E5: 659.25, F5: 698.46, G5: 783.99, A5: 880.00
  };

  /**
   * 16-Measure 6/8 Sea Shanty Score
   * Each measure = 6 eighth notes. Total = 96 steps.
   */
  // Channel 1: Accordion / Square Lead Melody
  const SHANTY_MELODY = [
    // Measure 1 (Dm)
    NOTES.D4, NOTES.E4, NOTES.F4, NOTES.G4, NOTES.F4, NOTES.E4,
    // Measure 2 (Dm)
    NOTES.D4, NOTES.F4, NOTES.A4, NOTES.D5, NOTES.A4, NOTES.F4,
    // Measure 3 (F)
    NOTES.C5, NOTES.A4, NOTES.F4, NOTES.G4, NOTES.A4, NOTES.C5,
    // Measure 4 (C)
    NOTES.A4, NOTES.G4, NOTES.E4, NOTES.G4, NOTES.REST, NOTES.REST,
    // Measure 5 (Bb)
    NOTES.F4, NOTES.G4, NOTES.A4, NOTES.Bb4, NOTES.A4, NOTES.G4,
    // Measure 6 (F)
    NOTES.A4, NOTES.F4, NOTES.D4, NOTES.F4, NOTES.REST, NOTES.REST,
    // Measure 7 (Gm -> A7)
    NOTES.G4, NOTES.A4, NOTES.Bb4, NOTES.A4, NOTES.G4, NOTES.E4,
    // Measure 8 (Dm)
    NOTES.D4, NOTES.F4, NOTES.E4, NOTES.D4, NOTES.REST, NOTES.REST,

    // Measure 9 (F Chorus!)
    NOTES.F5, NOTES.E5, NOTES.D5, NOTES.C5, NOTES.A4, NOTES.F4,
    // Measure 10 (C)
    NOTES.G4, NOTES.A4, NOTES.C5, NOTES.G4, NOTES.REST, NOTES.REST,
    // Measure 11 (Dm)
    NOTES.A4, NOTES.D5, NOTES.C5, NOTES.A4, NOTES.F4, NOTES.D4,
    // Measure 12 (Bb)
    NOTES.D4, NOTES.F4, NOTES.Bb4, NOTES.A4, NOTES.G4, NOTES.F4,
    // Measure 13 (Gm)
    NOTES.G4, NOTES.Bb4, NOTES.D5, NOTES.C5, NOTES.Bb4, NOTES.G4,
    // Measure 14 (F -> A7)
    NOTES.A4, NOTES.C5, NOTES.F5, NOTES.E5, NOTES.Csh5, NOTES.A4,
    // Measure 15 (Dm)
    NOTES.D5, NOTES.A4, NOTES.F4, NOTES.G4, NOTES.F4, NOTES.E4,
    // Measure 16 (Dm Cadence)
    NOTES.D4, NOTES.F4, NOTES.A4, NOTES.D5, NOTES.REST, NOTES.REST
  ];

  // Channel 2: Accordion Harmony (3rds and 6ths underneath)
  const SHANTY_HARMONY = [
    // M1
    NOTES.REST, NOTES.REST, NOTES.D4, NOTES.E4, NOTES.D4, NOTES.C4,
    // M2
    NOTES.D4, NOTES.D4, NOTES.F4, NOTES.F4, NOTES.F4, NOTES.D4,
    // M3
    NOTES.A4, NOTES.F4, NOTES.C4, NOTES.E4, NOTES.F4, NOTES.A4,
    // M4
    NOTES.F4, NOTES.E4, NOTES.C4, NOTES.E4, NOTES.REST, NOTES.REST,
    // M5
    NOTES.D4, NOTES.E4, NOTES.F4, NOTES.G4, NOTES.F4, NOTES.E4,
    // M6
    NOTES.F4, NOTES.D4, NOTES.Bb3, NOTES.D4, NOTES.REST, NOTES.REST,
    // M7
    NOTES.E4, NOTES.F4, NOTES.G4, NOTES.F4, NOTES.E4, NOTES.Csh4,
    // M8
    NOTES.D4, NOTES.D4, NOTES.Csh4, NOTES.D4, NOTES.REST, NOTES.REST,

    // M9
    NOTES.C5, NOTES.C5, NOTES.Bb4, NOTES.A4, NOTES.F4, NOTES.C4,
    // M10
    NOTES.E4, NOTES.F4, NOTES.G4, NOTES.E4, NOTES.REST, NOTES.REST,
    // M11
    NOTES.F4, NOTES.F4, NOTES.E4, NOTES.F4, NOTES.D4, NOTES.Bb3,
    // M12
    NOTES.Bb3, NOTES.D4, NOTES.G4, NOTES.F4, NOTES.E4, NOTES.D4,
    // M13
    NOTES.E4, NOTES.G4, NOTES.Bb4, NOTES.A4, NOTES.G4, NOTES.E4,
    // M14
    NOTES.F4, NOTES.A4, NOTES.C5, NOTES.Csh5, NOTES.A4, NOTES.E4,
    // M15
    NOTES.F4, NOTES.F4, NOTES.D4, NOTES.E4, NOTES.D4, NOTES.Csh4,
    // M16
    NOTES.D4, NOTES.D4, NOTES.F4, NOTES.F4, NOTES.REST, NOTES.REST
  ];

  // Channel 3: 6/8 Pirate Bassline (Root on 1, Fifth on 4)
  const SHANTY_BASS = [
    // M1 (Dm)
    NOTES.D2, NOTES.REST, NOTES.REST, NOTES.A2, NOTES.REST, NOTES.REST,
    // M2 (Dm)
    NOTES.D3, NOTES.REST, NOTES.REST, NOTES.A2, NOTES.REST, NOTES.REST,
    // M3 (F)
    NOTES.F2, NOTES.REST, NOTES.REST, NOTES.C3, NOTES.REST, NOTES.REST,
    // M4 (C)
    NOTES.C3, NOTES.REST, NOTES.REST, NOTES.G2, NOTES.REST, NOTES.REST,
    // M5 (Bb)
    NOTES.Bb2, NOTES.REST, NOTES.REST, NOTES.F2, NOTES.REST, NOTES.REST,
    // M6 (F)
    NOTES.F2, NOTES.REST, NOTES.REST, NOTES.C3, NOTES.REST, NOTES.REST,
    // M7 (Gm -> A7)
    NOTES.G2, NOTES.REST, NOTES.REST, NOTES.A2, NOTES.REST, NOTES.REST,
    // M8 (Dm)
    NOTES.D2, NOTES.REST, NOTES.REST, NOTES.A2, NOTES.REST, NOTES.REST,

    // M9 (F)
    NOTES.F2, NOTES.REST, NOTES.REST, NOTES.C3, NOTES.REST, NOTES.REST,
    // M10 (C)
    NOTES.C3, NOTES.REST, NOTES.REST, NOTES.G2, NOTES.REST, NOTES.REST,
    // M11 (Dm)
    NOTES.D3, NOTES.REST, NOTES.REST, NOTES.A2, NOTES.REST, NOTES.REST,
    // M12 (Bb)
    NOTES.Bb2, NOTES.REST, NOTES.REST, NOTES.F2, NOTES.REST, NOTES.REST,
    // M13 (Gm)
    NOTES.G2, NOTES.REST, NOTES.REST, NOTES.D3, NOTES.REST, NOTES.REST,
    // M14 (A7)
    NOTES.A2, NOTES.REST, NOTES.REST, NOTES.E2, NOTES.REST, NOTES.REST,
    // M15 (Dm)
    NOTES.D2, NOTES.REST, NOTES.REST, NOTES.A2, NOTES.REST, NOTES.REST,
    // M16 (Dm)
    NOTES.D2, NOTES.REST, NOTES.REST, NOTES.D3, NOTES.REST, NOTES.REST
  ];

  /**
   * Schedules notes for a single 8th-note step at exact audio context time.
   */
  function scheduleShantyStep(stepIdx, stepTime) {
    if (!ctx) return;

    try {
      // 1. Lead Melody Note (Accordion / Chiptune Square Lead)
      const leadNote = SHANTY_MELODY[stepIdx];
      if (leadNote > 0) {
        const leadOsc = ctx.createOscillator();
        const leadFilter = ctx.createBiquadFilter();
        const leadGain = ctx.createGain();

        leadOsc.type = 'square';
        leadOsc.frequency.setValueAtTime(leadNote, stepTime);

        leadFilter.type = 'lowpass';
        leadFilter.frequency.setValueAtTime(2200, stepTime);
        leadFilter.Q.setValueAtTime(1.2, stepTime);

        // Crisp accordion articulation
        leadGain.gain.setValueAtTime(0.001, stepTime);
        leadGain.gain.linearRampToValueAtTime(0.24, stepTime + 0.015);
        leadGain.gain.exponentialRampToValueAtTime(0.0001, stepTime + (STEP_DURATION * 0.88));

        leadOsc.connect(leadFilter);
        leadFilter.connect(leadGain);
        leadGain.connect(musicGain);

        autoDisconnect(leadOsc, leadFilter, leadGain);

        leadOsc.start(stepTime);
        leadOsc.stop(stepTime + STEP_DURATION);
      }

      // 2. Harmony Note (Warm Pulse / Triangle)
      const harmNote = SHANTY_HARMONY[stepIdx];
      if (harmNote > 0) {
        const harmOsc = ctx.createOscillator();
        const harmFilter = ctx.createBiquadFilter();
        const harmGain = ctx.createGain();

        harmOsc.type = 'triangle';
        harmOsc.frequency.setValueAtTime(harmNote, stepTime);

        harmFilter.type = 'lowpass';
        harmFilter.frequency.setValueAtTime(1600, stepTime);

        harmGain.gain.setValueAtTime(0.001, stepTime);
        harmGain.gain.linearRampToValueAtTime(0.14, stepTime + 0.02);
        harmGain.gain.exponentialRampToValueAtTime(0.0001, stepTime + (STEP_DURATION * 0.85));

        harmOsc.connect(harmFilter);
        harmFilter.connect(harmGain);
        harmGain.connect(musicGain);

        autoDisconnect(harmOsc, harmFilter, harmGain);

        harmOsc.start(stepTime);
        harmOsc.stop(stepTime + STEP_DURATION);
      }

      // 3. Bassline Note (Bouncy Triangle)
      const bassNote = SHANTY_BASS[stepIdx];
      if (bassNote > 0) {
        const bassOsc = ctx.createOscillator();
        const bassGain = ctx.createGain();

        bassOsc.type = 'triangle';
        bassOsc.frequency.setValueAtTime(bassNote, stepTime);

        // Punchy root attack sustained for dotted quarter feel
        bassGain.gain.setValueAtTime(0.001, stepTime);
        bassGain.gain.linearRampToValueAtTime(0.35, stepTime + 0.015);
        bassGain.gain.exponentialRampToValueAtTime(0.0001, stepTime + (STEP_DURATION * 2.5));

        bassOsc.connect(bassGain);
        bassGain.connect(musicGain);

        autoDisconnect(bassOsc, bassGain);

        bassOsc.start(stepTime);
        bassOsc.stop(stepTime + (STEP_DURATION * 2.6));
      }

      // 4. Rhythm & Percussion (6/8 Nautical Jig Rhythm)
      // Step modulo 6:
      // 0: Kick + Hat
      // 1: Hat
      // 2: Hat
      // 3: Pirate Snare / Stomp
      // 4: Hat
      // 5: Open Hat / Sizzle
      const beatInMeasure = stepIdx % 6;

      if (beatInMeasure === 0) {
        // Kick Drum (Sine drop 130Hz -> 42Hz)
        const kickOsc = ctx.createOscillator();
        const kickGain = ctx.createGain();
        kickOsc.type = 'sine';
        kickOsc.frequency.setValueAtTime(130, stepTime);
        kickOsc.frequency.exponentialRampToValueAtTime(42, stepTime + 0.09);

        kickGain.gain.setValueAtTime(0.35, stepTime);
        kickGain.gain.exponentialRampToValueAtTime(0.001, stepTime + 0.1);

        kickOsc.connect(kickGain);
        kickGain.connect(musicGain);

        autoDisconnect(kickOsc, kickGain);

        kickOsc.start(stepTime);
        kickOsc.stop(stepTime + 0.11);

        // Closed hi-hat
        playNoise({
          type: 'white',
          filterType: 'highpass',
          freqStart: 6000,
          duration: 0.025,
          gain: 0.09,
          target: musicGain,
          time: stepTime
        });
      } else if (beatInMeasure === 3) {
        // Pirate Snare / Wood Stomp (Noise + mid-tap)
        playNoise({
          type: 'white',
          filterType: 'bandpass',
          freqStart: 1800,
          q: 2.0,
          duration: 0.065,
          gain: 0.22,
          target: musicGain,
          time: stepTime
        });
        playTone({
          type: 'triangle',
          freqStart: 240,
          freqEnd: 80,
          duration: 0.045,
          gain: 0.18,
          target: musicGain,
          time: stepTime
        });
      } else if (beatInMeasure === 5) {
        // Open hi-hat sizzle
        playNoise({
          type: 'white',
          filterType: 'highpass',
          freqStart: 5500,
          duration: 0.065,
          gain: 0.11,
          target: musicGain,
          time: stepTime
        });
      } else {
        // Soft closed hi-hat on offbeats
        playNoise({
          type: 'white',
          filterType: 'highpass',
          freqStart: 6500,
          duration: 0.02,
          gain: 0.06,
          target: musicGain,
          time: stepTime
        });
      }
    } catch (_e) {}
  }

  /**
   * Music lookahead scheduler loop. Runs on a high-frequency timer (~25ms)
   * and schedules notes ahead to ensure rock-solid timing without main-thread jitter.
   *
   * Includes lookahead catch-up clamp to prevent node allocation spirals
   * when returning to a backgrounded tab.
   */
  function shantyScheduler() {
    if (!shantyPlaying || !ctx) return;

    // Prevent catch-up death spiral if tab was backgrounded or thread stalled
    if (shantyNextStepTime < ctx.currentTime - 0.05) {
      shantyNextStepTime = ctx.currentTime + 0.02;
    }

    try {
      while (shantyNextStepTime < ctx.currentTime + SCHEDULE_AHEAD_SEC) {
        // CPU & Memory optimization: if audio is muted or zero volume, advance step without allocating nodes
        if (isMutedState || volumeState <= 0) {
          shantyNextStepTime += STEP_DURATION;
          shantyCurrentStep = (shantyCurrentStep + 1) % TOTAL_STEPS;
          continue;
        }

        scheduleShantyStep(shantyCurrentStep, shantyNextStepTime);
        shantyNextStepTime += STEP_DURATION;
        shantyCurrentStep = (shantyCurrentStep + 1) % TOTAL_STEPS;
      }
    } catch (_e) {}
  }

  /**
   * Starts the procedural Chiptune Sea Shanty loop.
   */
  function startShanty() {
    if (shantyPlaying) return;
    if (!ensureContext()) return;

    try {
      shantyPlaying = true;
      shantyCurrentStep = 0;
      shantyNextStepTime = ctx.currentTime + 0.05;

      // Bring music bus gain to desired balance
      musicGain.gain.setValueAtTime(0.42, ctx.currentTime);

      if (typeof setInterval !== 'undefined') {
        shantyTimerId = setInterval(shantyScheduler, LOOKAHEAD_MS);
      }
    } catch (_e) {
      shantyPlaying = false;
    }
  }

  /**
   * Stops the Chiptune Sea Shanty loop with smooth fadeout.
   */
  function stopShanty() {
    if (!shantyPlaying) return;
    shantyPlaying = false;

    if (shantyTimerId) {
      clearInterval(shantyTimerId);
      shantyTimerId = null;
    }

    if (ctx && musicGain) {
      try {
        musicGain.gain.setValueAtTime(musicGain.gain.value, ctx.currentTime);
        musicGain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.2);
      } catch (_e) {}
    }
  }

  /**
   * Returns whether the Sea Shanty loop is currently active.
   */
  function isShantyPlaying() {
    return shantyPlaying;
  }

  // =========================================================================
  // VOLUME & MUTE CONTROLS
  // =========================================================================

  /**
   * Sets mute state. Persists in localStorage wrapped in try/catch.
   * @param {boolean} muted
   */
  function setMuted(muted) {
    isMutedState = Boolean(muted);

    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(STORAGE_KEY_MUTED, String(isMutedState));
      }
    } catch (_e) {}

    if (ctx && masterGain) {
      try {
        const targetGain = isMutedState ? 0 : volumeState;
        masterGain.gain.setValueAtTime(targetGain, ctx.currentTime);
      } catch (_e) {}
    }

    return isMutedState;
  }

  /**
   * Returns current mute state.
   */
  function isMuted() {
    return isMutedState;
  }

  /**
   * Toggles mute state.
   */
  function toggleMute() {
    return setMuted(!isMutedState);
  }

  /**
   * Sets master volume (0.0 to 1.0). Persists in localStorage wrapped in try/catch.
   * @param {number} vol
   */
  function setVolume(vol) {
    const num = parseFloat(vol);
    if (Number.isNaN(num)) return volumeState;

    volumeState = Math.max(0, Math.min(1, num));

    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(STORAGE_KEY_VOLUME, String(volumeState));
      }
    } catch (_e) {}

    if (ctx && masterGain && !isMutedState) {
      try {
        masterGain.gain.setValueAtTime(volumeState, ctx.currentTime);
      } catch (_e) {}
    }

    return volumeState;
  }

  /**
   * Returns current volume level (0.0 to 1.0).
   */
  function getVolume() {
    return volumeState;
  }

  /**
   * Resumes audio context if suspended (useful on user gesture).
   */
  function resume() {
    return ensureContext();
  }

  /**
   * Returns number of active intermediate/source AudioNodes currently in flight.
   * When all playback finishes and onended callbacks fire, this returns to 0.
   */
  function getActiveNodeCount() {
    return activeNodeCount;
  }

  /**
   * Destroys engine, closes context, stops all schedulers and disconnects graph.
   */
  function destroy() {
    stopShanty();
    if (typeof clearInterval !== 'undefined' && shantyTimerId) {
      clearInterval(shantyTimerId);
      shantyTimerId = null;
    }
    if (musicGain) {
      try { musicGain.disconnect(); } catch (_e) {}
    }
    if (sfxGain) {
      try { sfxGain.disconnect(); } catch (_e) {}
    }
    if (masterGain) {
      try { masterGain.disconnect(); } catch (_e) {}
    }
    if (compressor) {
      try { compressor.disconnect(); } catch (_e) {}
    }
    if (ctx) {
      try {
        if (typeof ctx.close === 'function') {
          ctx.close().catch(() => {});
        }
      } catch (_e) {}
    }
    ctx = null;
    masterGain = null;
    sfxGain = null;
    musicGain = null;
    compressor = null;
    whiteNoiseBuffer = null;
    pinkNoiseBuffer = null;
    activeNodeCount = 0;
    shantyPlaying = false;
  }

  /**
   * Returns engine status snapshot.
   */
  function getStatus() {
    return {
      initialized: Boolean(ctx),
      state: ctx ? ctx.state : 'uninitialized',
      muted: isMutedState,
      volume: volumeState,
      shantyPlaying: shantyPlaying,
      activeNodes: activeNodeCount
    };
  }

  // =========================================================================
  // PUBLIC API & EXPORT
  // =========================================================================

  const audioApi = {
    // Lifecycle & Initialization
    init: initAudio,
    resume: resume,
    destroy: destroy,
    getStatus: getStatus,
    getActiveNodeCount: getActiveNodeCount,

    // Core Combat SFX
    playCannon: playCannon,
    playSplash: playSplash,
    playHit: playHit,
    playSunk: playSunk,

    // Crew Special Techniques
    playTechnique: playTechnique,

    // UI & Match SFX
    playCoinToss: playCoinToss,
    playUiClick: playUiClick,
    playVictoryFanfare: playVictoryFanfare,
    playDefeatDirge: playDefeatDirge,
    playDenDenMushi: playDenDenMushi,

    // Chiptune Sea Shanty Loop
    startShanty: startShanty,
    stopShanty: stopShanty,
    isShantyPlaying: isShantyPlaying,

    // Audio Controls
    setMuted: setMuted,
    isMuted: isMuted,
    toggleMute: toggleMute,
    setVolume: setVolume,
    getVolume: getVolume
  };

  // Attach to globalThis.GLT for concatenated browser artifact
  if (typeof globalThis !== 'undefined') {
    globalThis.GLT = globalThis.GLT || {};
    globalThis.GLT.audio = audioApi;
  }

  // CommonJS export for Node.js test runners
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = audioApi;
  }
})();
