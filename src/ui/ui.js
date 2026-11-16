/**
 * Grand Line Tactics — Polished PT-BR Panel UI, Setup 2D/3D Drag-and-Drop,
 * Keyboard/A11y, Online PvP Lobby & Full Game Controller (`GLT.ui`)
 *
 * ZERO HARDCODED VISIBLE STRINGS: Every visible string comes exclusively from GLT.T.
 */

(function(root) {
  'use strict';

  var GLT = root.GLT = root.GLT || {};

  function getT() {
    return GLT.T || (GLT.i18n ? GLT.i18n.T : null);
  }

  function getI18n() {
    return GLT.i18n || {
      formatNumber: function(n) { return new Intl.NumberFormat('pt-BR').format(n); },
      formatBounty: function(n) { return '฿ ' + new Intl.NumberFormat('pt-BR').format(Math.round(n)); },
      plural: function(c, s, p) { return c + ' ' + (c === 1 ? s : p); }
    };
  }

  function createMatchConfigObject() {
    var cfg = {
      crewId: 'straw_hats',
      enemyCrewId: 'marines',
      boardId: 'classica',
      mode: 'tatico',
      sea: 'mar_calmo',
      seriesLength: 1,
      difficulty: 'capitao',
      allowTouch: false,
      continueOnHit: false,
      salvo: false,
      turnTimer: 30,
      fog: false
    };
    Object.defineProperty(cfg, 'format', {
      enumerable: false,
      configurable: true,
      get: function() { return cfg.boardId; },
      set: function(v) { if (v) cfg.boardId = v; }
    });
    return cfg;
  }

  var UIController = {
    // 3D & Audio Systems
    renderer: null,
    scene: null,
    platesSystem: null,
    postPipeline: null,
    backdrop: null,
    fx: null,
    audio: null,
    webglAvailable: true,

    // Match & Series State
    gamePhase: 'SETUP', // 'SETUP' | 'COIN_TOSS' | 'BATTLE' | 'CEREMONY'
    matchConfig: createMatchConfigObject(),
    matchState: null,
    matchRng: null,
    aiPlayer: null,
    seriesMemory: null,
    seriesWins: [0, 0],
    currentSeriesGame: 1,
    matchSeq: 0,

    // Setup Placement State
    placedPlayerFleet: [],
    selectedCandidateShipIndex: -1,
    candidateHorizontal: true,
    hoveredPlacementCell: null,
    placementValid: false,

    // Battle & Targeting State
    selectedAimCell: null,
    hoveredAimCell: null,
    hintsRemaining: 2,
    isCpuThinking: false,
    shotInFlight: false,
    isUsingTechnique: false,
    playerRevealedCells: [],
    cpuRevealedCells: [],

    // Timers & Async Handles
    turnTimerInterval: null,
    coinTossTimeout: null,
    cpuTurnTimeout: null,
    shotFlightTimeout: null,
    ceremonyTimeout: null,
    bountyAnimRaf: null,
    secondsLeftInTurn: 30,

    // Visual & Comfort Settings
    pixelSize: 2,
    outlines: true,
    dither: true,
    raw3d: false,
    liftScenery: true,
    cameraPreset: 'duas_aguas',
    theme: 'dark',
    animSpeed: 1.0,
    isPaused: false,
    autoNextGame: false,
    show2dRadar: true,

    // Online PvP State
    pvpClient: null,
    pvpLobbyTransport: null,
    pvpOpenRoomsUnsub: null,
    pvpOpenRooms: [],
    isPvpMode: false,
    pvpRoomId: '',
    pvpPlayerId: '',
    pvpNickname: '',
    pvpRole: 'player',
    pvpStatus: 'connecting', // 'connecting' | 'connected' | 'unavailable'
    pvpBackend: null,
    pvpReady: null,
    pvpUnavailableReason: '',
    pvpSyncedShots: {},
    pvpLastReactionCount: 0,

    // Active 3D Meshes & Loop
    playerShipMeshes: [],
    enemyGhostShipMeshes: [],
    simTime: 0,
    lastFrameTime: 0,
    rafId: null,
    lastFocusedTrigger: null,
    dom: {},

    // Tablet & Ergonomics State
    isSidePanelCollapsed: false,
    minimapTargetPlate: 1, // 0 = minhas águas, 1 = mira inimiga


    getMyPlatesIndices: function() {
      if (this.isPvpMode && this.pvpClient && this.pvpClient.role === 'player') {
        var isGuest = this.pvpClient.playerIndex === 1;
        return {
          myPlate: isGuest ? 1 : 0,
          oppPlate: isGuest ? 0 : 1,
          isGuest: isGuest
        };
      }
      return { myPlate: 0, oppPlate: 1, isGuest: false };
    },

    init: function(options) {
      options = options || {};
      if (GLT.appShell && !GLT.appShell._started) {
        GLT.appShell._started = true;
        GLT.appShell.init();
      }
      this.audio = GLT.audio || null;
      this.seriesMemory = (GLT.ai && GLT.ai.createSeriesMemory) ? GLT.ai.createSeriesMemory() : null;

      if (typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        this.animSpeed = 2.0;
      }

      this.pvpNickname = this.loadStoredNickname();
      this.pvpPlayerId = this.loadStoredPlayerId();

      this.buildDomStructure(options.container || document.body);
      this.init3dPipeline();
      this.initAudioControls();
      this.initInputControls();
      this.initPvpLobby();
      this.applyTheme(this.theme);
      this.setupFleetPlacementPhase();
      this.startRenderLoop();
      this.checkUrlForRoom();

      var T = getT();
      this.announce(T.meta.title + ' — ' + T.meta.subtitle + '. ' + T.ui.selectCrewPrompt);
    },

    loadStoredNickname: function() {
      var T = getT();
      try {
        var saved = localStorage.getItem('GLT_NICKNAME');
        if (saved && saved.trim()) return saved.trim();
        var generated = (GLT.protocol && GLT.protocol.generateDefaultNickname)
          ? GLT.protocol.generateDefaultNickname()
          : T.ui.defaultCaptainPrefix + '777';
        localStorage.setItem('GLT_NICKNAME', generated);
        return generated;
      } catch (_) {
        return T.ui.defaultCaptainName;
      }
    },

    saveStoredNickname: function(nick) {
      if (!nick || !nick.trim()) return;
      this.pvpNickname = nick.trim();
      try {
        localStorage.setItem('GLT_NICKNAME', this.pvpNickname);
      } catch (_) {}
    },

    loadStoredPlayerId: function() {
      try {
        var saved = localStorage.getItem('GLT_PLAYER_ID');
        if (saved && saved.trim()) return saved.trim();
        var pid = (GLT.protocol && GLT.protocol.generatePlayerId)
          ? GLT.protocol.generatePlayerId()
          : 'P_' + Date.now();
        localStorage.setItem('GLT_PLAYER_ID', pid);
        return pid;
      } catch (_) {
        return (GLT.protocol && GLT.protocol.generatePlayerId)
          ? GLT.protocol.generatePlayerId()
          : 'P_' + Date.now();
      }
    },

    clearTurnTimers: function() {
      if (this.turnTimerInterval) {
        clearInterval(this.turnTimerInterval);
        this.turnTimerInterval = null;
      }
      if (this.coinTossTimeout) {
        clearTimeout(this.coinTossTimeout);
        this.coinTossTimeout = null;
      }
      if (this.cpuTurnTimeout) {
        clearTimeout(this.cpuTurnTimeout);
        this.cpuTurnTimeout = null;
      }
      if (this.shotFlightTimeout) {
        clearTimeout(this.shotFlightTimeout);
        this.shotFlightTimeout = null;
      }
      if (this.ceremonyTimeout) {
        clearTimeout(this.ceremonyTimeout);
        this.ceremonyTimeout = null;
      }
      if (this.bountyAnimRaf) {
        cancelAnimationFrame(this.bountyAnimRaf);
        this.bountyAnimRaf = null;
      }
      this.isCpuThinking = false;
      this.shotInFlight = false;
    },

    returnToSetupPhase: function() {
      this.clearTurnTimers();
      this.hideModal();
      if (this.backdrop) {
        this.backdrop.setCeremonyActive(false);
        this.backdrop.setDollsHouseLiftEnabled(this.liftScenery);
      }
      if (this.isPvpMode) {
        this.leavePvpRoom();
      }
      this.seriesWins = [0, 0];
      this.currentSeriesGame = 1;
      this.setupFleetPlacementPhase();
    },

    buildDomStructure: function(parent) {
      var self = this;
      var T = getT();
      var i18n = getI18n();

      var appRoot = document.createElement('div');
      appRoot.id = 'glt-app';
      appRoot.className = 'glt-theme-dark';
      appRoot.setAttribute('role', 'application');
      appRoot.setAttribute('aria-label', T.meta.title + ' - ' + T.meta.subtitle);

      var announcer = document.createElement('div');
      announcer.id = 'glt-announcer';
      announcer.className = 'sr-only';
      announcer.setAttribute('aria-live', 'polite');
      announcer.setAttribute('aria-atomic', 'true');
      appRoot.appendChild(announcer);

      // 1. TOP SCOREBOARD BUG & HUD
      var topHud = document.createElement('header');
      topHud.id = 'glt-top-hud';
      topHud.className = 'glt-panel-bar';

      var brandGroup = document.createElement('div');
      brandGroup.className = 'glt-brand-group';

      var titleHeading = document.createElement('h1');
      titleHeading.className = 'glt-main-title';
      titleHeading.textContent = T.meta.title;

      var subtitleSpan = document.createElement('span');
      subtitleSpan.className = 'glt-subtitle';
      subtitleSpan.textContent = T.meta.subtitle;

      brandGroup.appendChild(titleHeading);
      brandGroup.appendChild(subtitleSpan);

      var statusBug = document.createElement('div');
      statusBug.id = 'glt-status-bug';
      statusBug.className = 'glt-status-bug';

      var modeBadge = document.createElement('span');
      modeBadge.id = 'hud-mode-badge';
      modeBadge.className = 'glt-badge badge-mode';
      modeBadge.textContent = T.modes[this.matchConfig.mode].name;

      var seaBadge = document.createElement('span');
      seaBadge.id = 'hud-sea-badge';
      seaBadge.className = 'glt-badge badge-sea';
      seaBadge.textContent = T.seas[this.matchConfig.sea].name;

      var seriesBadge = document.createElement('span');
      seriesBadge.id = 'hud-series-badge';
      seriesBadge.className = 'glt-badge badge-series';
      seriesBadge.style.display = 'none';

      var turnPill = document.createElement('div');
      turnPill.id = 'hud-turn-pill';
      turnPill.className = 'glt-turn-pill ready';
      turnPill.textContent = T.ui.readyStatus;

      var timerPill = document.createElement('div');
      timerPill.id = 'hud-timer-pill';
      timerPill.className = 'glt-timer-pill';
      timerPill.textContent = T.turns.timerSeconds(this.matchConfig.turnTimer);

      var bountyBadge = document.createElement('div');
      bountyBadge.id = 'hud-bounty-badge';
      bountyBadge.className = 'glt-bounty-pill';
      bountyBadge.textContent = i18n.formatBounty(1500000000);

      statusBug.appendChild(modeBadge);
      statusBug.appendChild(seaBadge);
      statusBug.appendChild(seriesBadge);
      statusBug.appendChild(turnPill);
      statusBug.appendChild(timerPill);
      statusBug.appendChild(bountyBadge);

      var quickTools = document.createElement('div');
      quickTools.className = 'glt-quick-tools';

      function makeQuickBtn(id, icon, label, active) {
        var b = document.createElement('button');
        b.type = 'button';
        b.id = id;
        b.className = 'glt-icon-btn' + (active ? ' active' : '');
        b.setAttribute('aria-label', label);
        b.setAttribute('aria-pressed', active ? 'true' : 'false');
        b.title = label;
        b.textContent = icon;
        return b;
      }

      var soundBtn = makeQuickBtn('btn-toggle-sound', '🔊', T.ui.soundToggle, true);
      var shantyBtn = makeQuickBtn('btn-toggle-shanty', '🎵', T.ui.shantyToggle, false);
      var pauseBtn = makeQuickBtn('btn-toggle-pause', '⏸️', T.ui.pauseButton, false);
      var radarBtn = makeQuickBtn('btn-toggle-radar', '🗺️', T.ui.twoDViewToggle, true);
      var themeBtn = makeQuickBtn('btn-toggle-theme', '🌓', T.ui.themeToggle, false);

      var collapseSidePanelBtn = makeQuickBtn('btn-toggle-sidepanel', '📐', 'Recolher/Expandir Barra Lateral (Atalho: P)', false);
      collapseSidePanelBtn.addEventListener('click', function() {
        self.toggleSidePanelCollapse();
      });

      // Full screen: shown only where the browser allows it for a page (not iPhone Safari, not
      // the installed app, which has no browser bars to hide).
      var shell = GLT.appShell || null;
      var fullscreenBtn = makeQuickBtn('btn-toggle-fullscreen', '', T.ui.fullscreenEnter, false);
      fullscreenBtn.innerHTML = '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/></svg>';
      fullscreenBtn.addEventListener('click', function() {
        if (shell) shell.toggleFullscreen();
      });
      function syncFullscreenBtn() {
        var show = !!shell && shell.canFullscreen() && !shell.isStandalone();
        fullscreenBtn.style.display = show ? '' : 'none';
        var on = !!shell && shell.isFullscreen();
        fullscreenBtn.classList.toggle('active', on);
        fullscreenBtn.setAttribute('aria-pressed', on ? 'true' : 'false');
        var label = on ? T.ui.fullscreenExit : T.ui.fullscreenEnter;
        fullscreenBtn.setAttribute('aria-label', label);
        fullscreenBtn.title = label;
      }
      syncFullscreenBtn();
      if (shell) shell.onChange(syncFullscreenBtn);

      quickTools.appendChild(soundBtn);
      quickTools.appendChild(shantyBtn);
      quickTools.appendChild(pauseBtn);
      quickTools.appendChild(radarBtn);
      quickTools.appendChild(themeBtn);
      quickTools.appendChild(fullscreenBtn);
      quickTools.appendChild(collapseSidePanelBtn);

      topHud.appendChild(brandGroup);
      topHud.appendChild(statusBug);
      topHud.appendChild(quickTools);
      appRoot.appendChild(topHud);

      // 2. MAIN WORKSPACE
      var workspace = document.createElement('main');
      workspace.id = 'glt-workspace';
      workspace.className = 'glt-workspace';

      var viewportContainer = document.createElement('section');
      viewportContainer.id = 'glt-viewport-container';
      viewportContainer.className = 'glt-viewport-container';
      viewportContainer.setAttribute('aria-label', T.ui.viewportAriaLabel);

      var canvas = document.createElement('canvas');
      canvas.id = 'stage-canvas';
      viewportContainer.appendChild(canvas);

      var cameraBar = document.createElement('div');
      cameraBar.id = 'glt-camera-bar';
      cameraBar.className = 'glt-camera-bar';

      ['duas_aguas', 'minhas_aguas', 'mira_inimiga', 'panorama'].forEach(function(presetKey) {
        var cBtn = document.createElement('button');
        cBtn.type = 'button';
        cBtn.className = 'glt-pill-btn' + (presetKey === 'duas_aguas' ? ' active' : '');
        cBtn.dataset.camera = presetKey;
        cBtn.setAttribute('aria-pressed', presetKey === 'duas_aguas' ? 'true' : 'false');
        cBtn.textContent = T.cameras[presetKey].name;
        cBtn.title = T.cameras[presetKey].desc;
        cameraBar.appendChild(cBtn);
      });
      viewportContainer.appendChild(cameraBar);

      var rivalOverlay = document.createElement('div');
      rivalOverlay.id = 'glt-rival-overlay';
      rivalOverlay.className = 'glt-rival-overlay';

      var rivalAvatar = document.createElement('div');
      rivalAvatar.id = 'rival-avatar';
      rivalAvatar.className = 'glt-captain-avatar';

      var rivalBubble = document.createElement('div');
      rivalBubble.id = 'rival-bubble';
      rivalBubble.className = 'glt-taunt-bubble';
      var initCrew = this.matchConfig.crewId || 'straw_hats';
      rivalBubble.textContent = (T.crews[initCrew] && T.crews[initCrew].taunts && T.crews[initCrew].taunts.intro)
        ? T.crews[initCrew].taunts.intro[0]
        : T.crews.straw_hats.taunts.intro[0];

      rivalOverlay.appendChild(rivalAvatar);
      rivalOverlay.appendChild(rivalBubble);
      viewportContainer.appendChild(rivalOverlay);

      var aimTargetBadge = document.createElement('div');
      aimTargetBadge.id = 'aim-target-badge';
      aimTargetBadge.className = 'glt-aim-badge';
      aimTargetBadge.textContent = T.ui.setupCanvasHint;
      viewportContainer.appendChild(aimTargetBadge);

      var floatRestoreBtn = document.createElement('button');
      floatRestoreBtn.type = 'button';
      floatRestoreBtn.id = 'glt-float-restore-btn';
      floatRestoreBtn.className = 'glt-float-restore-btn';
      floatRestoreBtn.style.display = 'none';
      floatRestoreBtn.setAttribute('aria-label', 'Expandir Painel Lateral');
      floatRestoreBtn.innerHTML = '📋 <span>Painel</span>';
      floatRestoreBtn.addEventListener('click', function() {
        self.toggleSidePanelCollapse(false);
      });
      viewportContainer.appendChild(floatRestoreBtn);

      var floatingActionBar = document.createElement('div');
      floatingActionBar.id = 'glt-floating-action-bar';
      floatingActionBar.className = 'glt-floating-action-bar';
      floatingActionBar.style.display = 'none';
      viewportContainer.appendChild(floatingActionBar);

      var hudMinimap = document.createElement('aside');
      hudMinimap.id = 'glt-hud-minimap';
      hudMinimap.className = 'glt-hud-minimap';
      hudMinimap.style.display = 'none';
      hudMinimap.setAttribute('aria-label', 'Radar Tático HUD');
      viewportContainer.appendChild(hudMinimap);

      workspace.appendChild(viewportContainer);

      // Right Side Panel
      var sidePanel = document.createElement('aside');
      sidePanel.id = 'glt-side-panel';
      sidePanel.className = 'glt-side-panel';

      var navTabs = document.createElement('nav');
      navTabs.className = 'glt-tabs-nav';
      navTabs.setAttribute('role', 'tablist');
      navTabs.setAttribute('aria-label', T.meta.title);

      var tabNames = [
        { id: 'tab-gameplay', label: T.ui.tabsCompact.combat },
        { id: 'tab-pvp', label: T.ui.tabsCompact.pvp },
        { id: 'tab-fleet', label: T.ui.tabsCompact.fleet },
        { id: 'tab-logbook', label: T.ui.tabsCompact.logbook },
        { id: 'tab-settings', label: T.ui.tabsCompact.settings }
      ];

      tabNames.forEach(function(t, idx) {
        var tBtn = document.createElement('button');
        tBtn.type = 'button';
        tBtn.className = 'glt-tab-btn' + (idx === 0 ? ' active' : '');
        tBtn.id = 'btn-' + t.id;
        tBtn.setAttribute('role', 'tab');
        tBtn.setAttribute('aria-selected', idx === 0 ? 'true' : 'false');
        tBtn.setAttribute('aria-controls', 'content-' + t.id);
        tBtn.tabIndex = idx === 0 ? 0 : -1;
        tBtn.textContent = t.label;
        navTabs.appendChild(tBtn);
      });
      sidePanel.appendChild(navTabs);

      var tabContentWrapper = document.createElement('div');
      tabContentWrapper.className = 'glt-tab-content-wrapper';

      function makePane(id, active) {
        var p = document.createElement('div');
        p.id = 'content-' + id;
        p.className = 'glt-tab-pane' + (active ? ' active' : '');
        p.setAttribute('role', 'tabpanel');
        p.setAttribute('aria-labelledby', 'btn-' + id);
        return p;
      }

      var tabGameplay = makePane('tab-gameplay', true);
      var tabPvp = makePane('tab-pvp', false);
      var tabFleet = makePane('tab-fleet', false);
      var tabLogbook = makePane('tab-logbook', false);
      var tabSettings = makePane('tab-settings', false);

      tabContentWrapper.appendChild(tabGameplay);
      tabContentWrapper.appendChild(tabPvp);
      tabContentWrapper.appendChild(tabFleet);
      tabContentWrapper.appendChild(tabLogbook);
      tabContentWrapper.appendChild(tabSettings);

      sidePanel.appendChild(tabContentWrapper);
      workspace.appendChild(sidePanel);
      appRoot.appendChild(workspace);

      // 3. FOOTER
      var footer = document.createElement('footer');
      footer.id = 'glt-footer';
      footer.className = 'glt-footer';

      var footerText = document.createElement('p');
      footerText.className = 'glt-disclaimer';
      footerText.textContent = T.meta.disclaimer;

      var keyboardHelp = document.createElement('div');
      keyboardHelp.className = 'glt-keyboard-help';
      keyboardHelp.textContent = T.ui.keyboardShortcuts;

      footer.appendChild(footerText);
      footer.appendChild(keyboardHelp);
      appRoot.appendChild(footer);

      // 4. MODAL OVERLAY
      var modalOverlay = document.createElement('div');
      modalOverlay.id = 'glt-modal-overlay';
      modalOverlay.className = 'glt-modal-overlay';
      modalOverlay.style.display = 'none';

      var modalBox = document.createElement('div');
      modalBox.id = 'glt-modal-box';
      modalBox.className = 'glt-modal-box';
      modalBox.setAttribute('role', 'dialog');
      modalBox.setAttribute('aria-modal', 'true');
      modalBox.setAttribute('aria-labelledby', 'glt-modal-heading-id');
      modalOverlay.appendChild(modalBox);
      modalOverlay.addEventListener('click', function(ev) {
        if (ev.target === modalOverlay) {
          if (self.gamePhase !== 'COIN_TOSS' && self.gamePhase !== 'CEREMONY') {
            self.hideModal();
          }
        }
      });
      appRoot.appendChild(modalOverlay);

      parent.appendChild(appRoot);

      this.dom = {
        appRoot: appRoot,
        announcer: announcer,
        canvas: canvas,
        viewportContainer: viewportContainer,
        topHud: topHud,
        modeBadge: modeBadge,
        seaBadge: seaBadge,
        seriesBadge: seriesBadge,
        turnPill: turnPill,
        timerPill: timerPill,
        bountyBadge: bountyBadge,
        soundBtn: soundBtn,
        shantyBtn: shantyBtn,
        pauseBtn: pauseBtn,
        radarBtn: radarBtn,
        themeBtn: themeBtn,
        collapseSidePanelBtn: collapseSidePanelBtn,
        floatingActionBar: floatingActionBar,
        floatRestoreBtn: floatRestoreBtn,
        hudMinimap: hudMinimap,
        cameraBar: cameraBar,
        rivalOverlay: rivalOverlay,
        rivalAvatar: rivalAvatar,
        rivalBubble: rivalBubble,
        aimTargetBadge: aimTargetBadge,
        sidePanel: sidePanel,
        navTabs: navTabs,
        tabGameplay: tabGameplay,
        tabPvp: tabPvp,
        tabFleet: tabFleet,
        tabLogbook: tabLogbook,
        tabSettings: tabSettings,
        modalOverlay: modalOverlay,
        modalBox: modalBox
      };

      this.updateRivalAvatar();
      this.updateRivalTaunt('intro');

      // Tab clicks & roving keyboard navigation
      var tabButtons = Array.prototype.slice.call(navTabs.querySelectorAll('.glt-tab-btn'));
      tabButtons.forEach(function(btn, idx) {
        btn.addEventListener('click', function() {
          self.switchTab(btn.id.replace('btn-', ''));
        });
        btn.addEventListener('keydown', function(ev) {
          if (ev.key === 'ArrowRight' || ev.key === 'ArrowLeft') {
            ev.preventDefault();
            var dir = ev.key === 'ArrowRight' ? 1 : -1;
            var next = (idx + dir + tabButtons.length) % tabButtons.length;
            tabButtons[next].focus();
            self.switchTab(tabButtons[next].id.replace('btn-', ''));
          }
        });
      });

      cameraBar.querySelectorAll('.glt-pill-btn').forEach(function(cBtn) {
        cBtn.addEventListener('click', function() {
          self.setCameraPreset(cBtn.dataset.camera);
        });
      });

      pauseBtn.addEventListener('click', function() {
        self.togglePause();
      });

      radarBtn.addEventListener('click', function() {
        self.show2dRadar = !self.show2dRadar;
        radarBtn.classList.toggle('active', self.show2dRadar);
        radarBtn.setAttribute('aria-pressed', self.show2dRadar ? 'true' : 'false');
        self.renderGameplayTab();
        self.announce(self.show2dRadar ? T.ui.twoDViewOn : T.ui.twoDViewOff);
      });

      themeBtn.addEventListener('click', function() {
        self.toggleTheme();
      });
    },

    updateDialogueBox: function(targetCrewId, isAdversary, textType, customText) {
      if (!this.dom.rivalAvatar || !this.dom.rivalBubble) return;

      var crewId = targetCrewId || (isAdversary ? this.matchConfig.enemyCrewId : this.matchConfig.crewId);
      var crew = GLT.rules.CREWS_MAP[crewId] || GLT.rules.CREWS_MAP.straw_hats;

      this.dom.rivalAvatar.style.borderColor = crew.colors.primary;

      var fallbackUrl = (GLT.backdropFx && GLT.backdropFx.generateCaptainAvatarDataUrl)
        ? GLT.backdropFx.generateCaptainAvatarDataUrl(crew.id, 72)
        : '';
      var portraitUrl = (GLT.assets && GLT.assets.portraits && GLT.assets.portraits[crew.id]) || fallbackUrl;

      this.dom.rivalAvatar.innerHTML =
        '<img class="rival-portrait-img" src="' + portraitUrl + '" alt="' + crew.captain + '" onerror="this.onerror=null;this.src=\'' + fallbackUrl + '\'">';

      var phrase = customText;
      if (!phrase) {
        var tObj = (getT().crews[crew.id] && getT().crews[crew.id].taunts) || {};
        var list = tObj[textType || 'intro'] || tObj.intro || ['Às armas, marujos!'];
        var idx = this.matchState ? (this.matchState.history.length % list.length) : 0;
        phrase = list[idx];
      }

      var badgeClass = isAdversary ? 'rival-badge' : 'rival-badge player-badge';
      var badgeText = isAdversary ? '⚔️ ADVERSÁRIO' : '⛵ SUA TRIPULAÇÃO';

      this.dom.rivalBubble.innerHTML =
        '<div class="rival-bubble-header">' +
          '<span class="' + badgeClass + '">' + badgeText + '</span>' +
          '<strong class="rival-speaker">' + crew.captain + ' (' + crew.name + ')</strong>' +
        '</div>' +
        '<div class="rival-bubble-text">"' + phrase + '"</div>';
    },

    updateRivalAvatar: function() {
      if (this.gamePhase === 'SETUP') {
        this.updateDialogueBox(this.matchConfig.crewId, false, 'intro');
      } else {
        this.updateDialogueBox(this.matchConfig.enemyCrewId, true, 'intro');
      }
    },

    switchTab: function(tabId) {
      this.dom.navTabs.querySelectorAll('.glt-tab-btn').forEach(function(btn) {
        var active = btn.id === 'btn-' + tabId;
        btn.classList.toggle('active', active);
        btn.setAttribute('aria-selected', active ? 'true' : 'false');
        btn.tabIndex = active ? 0 : -1;
      });

      [
        this.dom.tabGameplay,
        this.dom.tabPvp,
        this.dom.tabFleet,
        this.dom.tabLogbook,
        this.dom.tabSettings
      ].forEach(function(pane) {
        pane.classList.toggle('active', pane.id === 'content-' + tabId);
      });

      // The panes share one scroll box: without this a tab opens scrolled to wherever the last one was.
      var scrollBox = this.dom.tabGameplay ? this.dom.tabGameplay.parentNode : null;
      if (scrollBox && this._shownTabId !== tabId) scrollBox.scrollTop = 0;
      // Ajustes shows app state that changes after start (install prompt, offline cache, full screen).
      if (tabId === 'tab-settings' && this._shownTabId !== tabId && typeof this.renderSettingsTab === 'function') this.renderSettingsTab();
      this._shownTabId = tabId;
      if (this.gamePhase === 'BATTLE' && typeof this.fitBattleRadar === 'function') this.fitBattleRadar();

      if (this.audio) this.audio.playUiClick();
    },

    announce: function(message) {
      if (!this.dom.announcer || !message) return;
      this.dom.announcer.textContent = message;
    },

    applyTheme: function(theme) {
      this.theme = theme === 'light' ? 'light' : 'dark';
      this.dom.appRoot.className = this.theme === 'light' ? 'glt-theme-light' : 'glt-theme-dark';
      if (this.dom.themeBtn) {
        this.dom.themeBtn.setAttribute('aria-pressed', this.theme === 'light' ? 'true' : 'false');
      }
    },

    toggleTheme: function() {
      this.applyTheme(this.theme === 'dark' ? 'light' : 'dark');
      if (this.audio) this.audio.playUiClick();
    },

    togglePause: function() {
      if (this.isPvpMode) return;
      this.isPaused = !this.isPaused;
      var T = getT();
      if (this.dom.pauseBtn) {
        this.dom.pauseBtn.textContent = this.isPaused ? '▶️' : '⏸️';
        this.dom.pauseBtn.setAttribute('aria-label', this.isPaused ? T.ui.resumeButton : T.ui.pauseButton);
        this.dom.pauseBtn.setAttribute('aria-pressed', this.isPaused ? 'true' : 'false');
        this.dom.pauseBtn.title = this.isPaused ? T.ui.resumeButton : T.ui.pauseButton;
      }
      this.announce(this.isPaused ? T.ui.isPaused : T.ui.resumeButton);
      if (this.audio) this.audio.playUiClick();
    },

    setCameraPreset: function(presetKey) {
      this.cameraPreset = presetKey;
      var resolvedPreset = presetKey;
      var plates = this.getMyPlatesIndices();
      if (plates.isGuest) {
        if (presetKey === 'minhas_aguas') resolvedPreset = 'mira_inimiga';
        else if (presetKey === 'mira_inimiga') resolvedPreset = 'minhas_aguas';
      }
      if (this.platesSystem && typeof this.platesSystem.setCameraPreset === 'function') {
        this.platesSystem.setCameraPreset(resolvedPreset, 750);
      }
      if (this.backdrop) {
        this.backdrop.setCameraMode(presetKey);
      }
      if (this.dom.cameraBar) {
        this.dom.cameraBar.querySelectorAll('.glt-pill-btn').forEach(function(btn) {
          var active = btn.dataset.camera === presetKey;
          btn.classList.toggle('active', active);
          btn.setAttribute('aria-pressed', active ? 'true' : 'false');
        });
      }
      if (this.audio) this.audio.playUiClick();
    },

    toggleSidePanelCollapse: function(forceState) {
      this.isSidePanelCollapsed = (typeof forceState === 'boolean') ? forceState : !this.isSidePanelCollapsed;
      var doc = (typeof document !== 'undefined' && typeof document.getElementById === 'function') ? document : null;
      var sidePanel = this.dom.sidePanel || (doc ? doc.getElementById('glt-side-panel') : null);
      if (sidePanel) {
        sidePanel.classList.toggle('collapsed', this.isSidePanelCollapsed);
      }
      var vp = this.dom.viewportContainer || (doc ? doc.getElementById('glt-viewport-container') : null);
      if (vp) {
        vp.classList.toggle('panel-collapsed', this.isSidePanelCollapsed);
      }
      var toggleBtn = doc ? doc.getElementById('btn-toggle-sidepanel') : null;
      if (toggleBtn) {
        toggleBtn.classList.toggle('active', this.isSidePanelCollapsed);
        toggleBtn.setAttribute('aria-pressed', this.isSidePanelCollapsed ? 'true' : 'false');
      }
      this.renderFloatingControls();
      this.renderHudMinimap();
      // the canvas itself must grow with the viewport (resizing only the 3D pipeline left a dead strip)
      this.handleResize();
      if (this.audio && typeof this.audio.playUiClick === 'function') this.audio.playUiClick();
    },

    renderFloatingControls: function() {
      var doc = (typeof document !== 'undefined' && typeof document.getElementById === 'function') ? document : null;
      var bar = this.dom.floatingActionBar || (doc ? doc.getElementById('glt-floating-action-bar') : null);
      var restoreBtn = this.dom.floatRestoreBtn || (doc ? doc.getElementById('glt-float-restore-btn') : null);
      if (!bar) return;

      var shouldShow = this.isSidePanelCollapsed;
      var oldPopover = doc ? doc.getElementById('glt-float-reactions') : null;
      if (oldPopover && oldPopover.parentNode) oldPopover.parentNode.removeChild(oldPopover);
      if (!shouldShow || !this.isPvpMode || this.gamePhase !== 'BATTLE') this.floatReactionsOpen = false;
      if (!shouldShow) {
        bar.style.display = 'none';
        if (restoreBtn) restoreBtn.style.display = 'none';
        return;
      }

      if (this.floatReactionsOpen && bar.parentNode && typeof this.buildReactionsGridDom === 'function') {
        var selfPop = this;
        var popover = document.createElement('div');
        popover.id = 'glt-float-reactions';
        popover.className = 'glt-float-reactions';
        popover.setAttribute('role', 'group');
        popover.setAttribute('aria-label', getT().reactions.reactionsPopoverAria || 'Den Den Mushi');
        popover.appendChild(this.buildReactionsGridDom());
        popover.addEventListener('click', function(ev) {
          var hit = ev.target && ev.target.closest ? ev.target.closest('.glt-reaction-btn') : null;
          if (!hit) return;
          // One reaction per opening: send it and get out of the way of the board.
          selfPop.floatReactionsOpen = false;
          setTimeout(function() { selfPop.renderFloatingControls(); }, 250);
        });
        bar.parentNode.appendChild(popover);
      }

      if (restoreBtn) restoreBtn.style.display = 'inline-flex';
      bar.style.display = 'flex';
      bar.innerHTML = '';
      var self = this;
      var T = getT();

      if (this.gamePhase === 'SETUP') {
        var startBtn = document.createElement('button');
        startBtn.type = 'button';
        startBtn.className = 'glt-float-btn btn-fire ready';
        var totalShips = GLT.rules.getShipsForBoard(this.matchConfig.boardId).length;
        var allPlaced = this.placedPlayerFleet.length >= totalShips;
        var isPvp = this.isPvpMode && this.pvpClient;
        var myPvpReady = isPvp && this.pvpClient.state && this.pvpClient.state.players[this.pvpClient.playerIndex]
          ? this.pvpClient.state.players[this.pvpClient.playerIndex].ready
          : false;

        if (isPvp) {
          startBtn.disabled = myPvpReady || !allPlaced;
          startBtn.innerHTML = myPvpReady ? '✓ <span>Frota Pronta</span>' : '🔒 <span>Pronto p/ Batalha</span>';
          startBtn.addEventListener('click', function() {
            self.readyPvpMatch().then(function() {
              self.renderFloatingControls();
              self.renderHudMinimap();
            });
          });
        } else {
          startBtn.disabled = !allPlaced;
          startBtn.innerHTML = '⚔️ <span>' + T.ui.startBattleButton + '</span>';
          startBtn.addEventListener('click', function() {
            self.startMatchWithCoinToss(false);
          });
        }
        bar.appendChild(startBtn);

        var rotateBtn = document.createElement('button');
        rotateBtn.type = 'button';
        rotateBtn.className = 'glt-float-btn';
        rotateBtn.innerHTML = '🔄 <span>' + (this.candidateHorizontal ? 'Horizontal' : 'Vertical') + '</span>';
        rotateBtn.title = 'Alternar rotação do navio selecionado (R)';
        rotateBtn.addEventListener('click', function() {
          self.rotateCandidateShip();
          self.renderFloatingControls();
          self.renderHudMinimap();
        });
        bar.appendChild(rotateBtn);

        var autoBtn = document.createElement('button');
        autoBtn.type = 'button';
        autoBtn.className = 'glt-float-btn';
        autoBtn.innerHTML = '🎲 <span>Auto</span>';
        autoBtn.addEventListener('click', function() {
          self.autoPlacePlayerFleet('spread');
          self.renderFloatingControls();
          self.renderHudMinimap();
        });
        bar.appendChild(autoBtn);

        var clearBtn = document.createElement('button');
        clearBtn.type = 'button';
        clearBtn.className = 'glt-float-btn';
        clearBtn.innerHTML = '🧹 <span>Limpar</span>';
        clearBtn.addEventListener('click', function() {
          self.clearPlayerFleet();
          self.renderFloatingControls();
          self.renderHudMinimap();
        });
        bar.appendChild(clearBtn);

      } else if (this.gamePhase === 'BATTLE') {
        var isMyTurn = this.isPvpMode ? this.isMyPvpTurn() : (this.matchState && this.matchState.turn === 0 && !this.isCpuThinking && !this.shotInFlight);
        var hasAim = !!this.selectedAimCell;
        var label = hasAim ? GLT.rules.coordToLabel(this.selectedAimCell.r, this.selectedAimCell.c) : '';

        // 1. Fire Cannon Button
        var fireBtn = document.createElement('button');
        fireBtn.type = 'button';
        fireBtn.id = 'btn-float-fire';
        fireBtn.className = 'glt-float-btn btn-fire' + (isMyTurn && hasAim ? ' ready' : '');
        fireBtn.disabled = !isMyTurn || !hasAim;
        fireBtn.innerHTML = '🎯 <span>' + (hasAim ? (T.ui.fireButton + ' ' + label) : T.ui.fireButton) + '</span>';
        fireBtn.addEventListener('click', function() {
          self.confirmFireShot();
        });
        bar.appendChild(fireBtn);

        // 2. Signature Technique Button
        var techBtn = document.createElement('button');
        techBtn.type = 'button';
        techBtn.id = 'btn-float-tech';
        var myCrew = GLT.rules.CREWS_MAP[this.matchConfig.crewId] || GLT.rules.CREWS_MAP.straw_hats;
        var techDef = T.techniques[myCrew.technique] || { shortName: 'Técnica' };
        var techUsed = this.isPvpMode
          ? (this.pvpClient && this.pvpClient.state && this.pvpClient.state.players[this.pvpClient.playerIndex] && this.pvpClient.state.players[this.pvpClient.playerIndex].techniqueUsed)
          : (this.matchState && this.matchState.players[0] && this.matchState.players[0].techniqueUsed);

        techBtn.className = 'glt-float-btn btn-tech' + (this.isUsingTechnique ? ' active' : '');
        techBtn.disabled = !isMyTurn || !!techUsed;
        techBtn.innerHTML = '💥 <span>' + techDef.shortName + (techUsed ? ' (Usado)' : '') + '</span>';
        techBtn.addEventListener('click', function() {
          self.triggerSpecialTechnique();
          self.renderFloatingControls();
        });
        bar.appendChild(techBtn);

        // 3. Log Pose Hint (offline) or Den Den Mushi Reaction (PvP)
        if (!this.isPvpMode) {
          var hintBtn = document.createElement('button');
          hintBtn.type = 'button';
          hintBtn.className = 'glt-float-btn';
          hintBtn.disabled = !isMyTurn || this.hintsRemaining <= 0;
          hintBtn.innerHTML = '🧭 <span>Dica (' + this.hintsRemaining + ')</span>';
          hintBtn.addEventListener('click', function() {
            self.useLogPoseHint();
            self.renderFloatingControls();
          });
          bar.appendChild(hintBtn);
        } else {
          var reactBtn = document.createElement('button');
          reactBtn.type = 'button';
          reactBtn.className = 'glt-float-btn';
          reactBtn.id = 'btn-float-den-den';
          reactBtn.innerHTML = '🐌 <span>Den Den</span>';
          reactBtn.setAttribute('aria-haspopup', 'true');
          reactBtn.setAttribute('aria-expanded', self.floatReactionsOpen ? 'true' : 'false');
          reactBtn.addEventListener('click', function() {
            self.floatReactionsOpen = !self.floatReactionsOpen;
            self.renderFloatingControls();
          });
          bar.appendChild(reactBtn);
        }

        // 4. Surrender / Abandon Ship Button
        var forfeitBtn = document.createElement('button');
        forfeitBtn.type = 'button';
        forfeitBtn.className = 'glt-float-btn';
        forfeitBtn.style.color = '#ef4444';
        forfeitBtn.innerHTML = '🏳️ <span>Render-se</span>';
        forfeitBtn.addEventListener('click', function() {
          self.showAbandonShipModal();
        });
        bar.appendChild(forfeitBtn);
      }

      // 5. Expand side panel button
      var expandBtn = document.createElement('button');
      expandBtn.type = 'button';
      expandBtn.className = 'glt-float-btn';
      expandBtn.innerHTML = '📋 <span>Painel</span>';
      expandBtn.addEventListener('click', function() {
        self.toggleSidePanelCollapse(false);
      });
      bar.appendChild(expandBtn);
    },

    renderHudMinimap: function() {
      var doc = (typeof document !== 'undefined' && typeof document.getElementById === 'function') ? document : null;
      var mapEl = this.dom.hudMinimap || (doc ? doc.getElementById('glt-hud-minimap') : null);
      if (!mapEl) return;

      var shouldShow = this.isSidePanelCollapsed && (this.gamePhase === 'BATTLE' || this.gamePhase === 'SETUP');
      if (!shouldShow) {
        mapEl.style.display = 'none';
        return;
      }

      mapEl.style.display = 'flex';
      mapEl.innerHTML = '';
      var self = this;
      var T = getT();
      var plates = this.getMyPlatesIndices();

      var boardSize = 10;
      if (this.isPvpMode && this.pvpClient && this.pvpClient.state && this.pvpClient.state.matchConfig) {
        boardSize = this.pvpClient.state.matchConfig.boardSize || 10;
      } else if (this.matchState) {
        boardSize = this.matchState.boardSize || 10;
      } else if (this.matchConfig) {
        boardSize = (GLT.rules.BOARDS_MAP[this.matchConfig.boardId] || { size: 10 }).size;
      }

      var viewingOpp = (this.gamePhase === 'SETUP')
        ? (this.minimapTargetPlate === 1)
        : (this.minimapTargetPlate !== 0);

      // Header row
      var header = document.createElement('div');
      header.className = 'glt-minimap-header';

      var title = document.createElement('span');
      title.className = 'glt-minimap-title';
      title.innerHTML = '📡 ' + (viewingOpp ? 'Águas Inimigas' : 'Minhas Águas');

      var toggleBtn = document.createElement('button');
      toggleBtn.type = 'button';
      toggleBtn.className = 'glt-minimap-toggle-btn';
      toggleBtn.textContent = viewingOpp ? '👁️ Alvo' : '🛡️ Defesa';
      toggleBtn.title = 'Alternar visão do radar (Minhas Águas / Águas Inimigas)';
      toggleBtn.addEventListener('click', function() {
        self.minimapTargetPlate = viewingOpp ? 0 : 1;
        self.renderHudMinimap();
      });

      header.appendChild(title);
      header.appendChild(toggleBtn);
      mapEl.appendChild(header);

      // Grid container
      var grid = document.createElement('div');
      grid.className = 'glt-minimap-grid';
      grid.style.gridTemplateColumns = 'repeat(' + boardSize + ', 1fr)';
      grid.style.gridTemplateRows = 'repeat(' + boardSize + ', 1fr)';

      // Determine state for cells
      var myShots = {};
      var oppShots = {};
      var shipCellSet = {};
      var revealedSet = {};

      if (this.isPvpMode && this.pvpClient && this.pvpClient.state && this.pvpClient.state.boards) {
        var myIdx = this.pvpClient.role === 'player' ? this.pvpClient.playerIndex : 0;
        var oppIdx = 1 - myIdx;
        myShots =(this.pvpClient.state.boards[myIdx] && this.pvpClient.state.boards[myIdx].shots) || {};
        oppShots = (this.pvpClient.state.boards[oppIdx] && this.pvpClient.state.boards[oppIdx].shots) || {};
      } else if (this.matchState && this.matchState.players) {
        myShots = (this.matchState.players[1] && this.matchState.players[1].shotsTaken) || {};
        oppShots = (this.matchState.players[0] && this.matchState.players[0].shotsTaken) || {};
      }

      (this.placedPlayerFleet || []).forEach(function(s) {
        (s.cells || []).forEach(function(c) {
          shipCellSet[c.r + ',' + c.c] = true;
        });
      });

      (this.playerRevealedCells || []).forEach(function(c) {
        revealedSet[c.r + ',' + c.c] = true;
      });

      var activeShots = viewingOpp ? myShots : oppShots;

      for (var r = 0; r < boardSize; r++) {
        for (var c = 0; c < boardSize; c++) {
          (function(row, col) {
            var cellEl = document.createElement('div');
            cellEl.className = 'glt-minimap-cell cell-water';
            var key = row + ',' + col;
            var isSel = self.selectedAimCell && self.selectedAimCell.r === row && self.selectedAimCell.c === col;

            if (!viewingOpp && shipCellSet[key]) {
              cellEl.classList.add('cell-ship');
            }

            var shot = activeShots[key];
            if (shot) {
              var outcome = shot.outcome || shot.result;
              if (outcome === 'sunk') {
                cellEl.classList.add('cell-sunk');
                cellEl.textContent = '💀';
              } else if (outcome === 'hit') {
                cellEl.classList.add('cell-hit');
                cellEl.textContent = '💥';
              } else if (outcome === 'water') {
                cellEl.classList.add('cell-water-shot');
                cellEl.textContent = '•';
              } else if (outcome === 'absorbed') {
                cellEl.classList.add('cell-water-shot');
                cellEl.textContent = '🌀';
              }
            } else if (viewingOpp && revealedSet[key]) {
              cellEl.classList.add('cell-revealed');
              cellEl.textContent = '👁️';
            }

            if (viewingOpp && isSel) {
              cellEl.classList.add('cell-selected');
            }

            cellEl.addEventListener('click', function() {
              if (self.gamePhase === 'SETUP') {
                if (!viewingOpp) {
                  self.handlePlacementClick(row, col);
                  self.renderHudMinimap();
                  self.renderFloatingControls();
                } else {
                  self.setCameraPreset('mira_inimiga');
                }
                return;
              }
              if (viewingOpp) {
                self.selectAimCoordinate(row, col);
                self.renderHudMinimap();
                self.renderFloatingControls();
              } else {
                self.setCameraPreset('minhas_aguas');
              }
            });

            grid.appendChild(cellEl);
          })(r, c);
        }
      }

      mapEl.appendChild(grid);
    },

    setLiftScenery: function(enabled) {
      this.liftScenery = !!enabled;
      if (this.backdrop) {
        this.backdrop.setDollsHouseLiftEnabled(this.liftScenery);
      }
    },

    init3dPipeline: function() {
      var self = this;
      var T = getT();
      var canvas = this.dom.canvas;
      var width = canvas.parentElement.clientWidth || window.innerWidth;
      var height = canvas.parentElement.clientHeight || window.innerHeight;

      try {
        if (typeof THREE === 'undefined') throw new Error('THREE indisponivel');
        this.renderer = new THREE.WebGLRenderer({
          canvas: canvas,
          antialias: false,
          powerPreference: 'high-performance'
        });
        this.renderer.setSize(width, height);
        this.renderer.setPixelRatio(1);

        // Phones drop the GPU context under memory pressure. Without preventDefault the browser
        // never gives it back and the page is left dead; with it, the context returns. An online
        // match then reloads and resumes from its session (render targets do not survive the loss).
        var uiSelf = this;
        canvas.addEventListener('webglcontextlost', function(ev) {
          ev.preventDefault();
          uiSelf.announce(getT().ui.graphicsLost);
        }, false);
        canvas.addEventListener('webglcontextrestored', function() {
          if (uiSelf.pvpRoomId && uiSelf.pvpClient) {
            uiSelf.savePvpSession();
            window.location.reload();
            return;
          }
          uiSelf.announce(getT().ui.graphicsRestored);
        }, false);
        this.renderer.shadowMap.enabled = true;
        this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

        this.scene = new THREE.Scene();

        var boardSize = (GLT.rules.BOARDS_MAP[this.matchConfig.boardId] || { size: 10 }).size;
        this.platesSystem = GLT.platesLighting.createPlatesLightingSystem(this.renderer, this.scene, {
          boardSize: boardSize,
          cellSize: 2.0,
          aspect: width / Math.max(1, height),
          pixelSize: this.pixelSize,
          renderTargetHeight: Math.max(64, Math.floor(height / this.pixelSize))
        });

        this.postPipeline = GLT.paletteShader.createPostPipeline(
          this.renderer,
          this.scene,
          this.platesSystem.camera,
          {
            pixelSize: this.pixelSize,
            outlines: this.outlines,
            dither: this.dither,
            paletteSnap: !this.raw3d
          }
        );

        this.backdrop = GLT.backdropFx.createBackdropRing(this.scene, {
          radius: 64.0,
          dollsHouseLift: this.liftScenery
        });
        this.fx = GLT.backdropFx.createFxSystem(this.scene);

        this.platesSystem.setEnvironment(this.seaToEnvProfile(this.matchConfig.sea), 0, this.matchConfig.sea);

        window.addEventListener('resize', function() {
          self.handleResize();
        });
        // layout changes without a window resize (side panel collapsing, its CSS transition) also resize the canvas
        if (typeof ResizeObserver !== 'undefined' && canvas.parentElement) {
          new ResizeObserver(function() { self.handleResize(); }).observe(canvas.parentElement);
        }
        this.handleResize();
      } catch (err) {
        this.webglAvailable = false;
        this.show2dRadar = true;
        if (this.dom.aimTargetBadge) {
          this.dom.aimTargetBadge.textContent = T.ui.webglFallbackNotice;
        }
      }
    },

    prefersReducedMotion: function() {
      try {
        return typeof window !== 'undefined' && !!window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      } catch (e) {
        return false;
      }
    },

    seaToEnvProfile: function(seaId) {
      if (seaId === 'mar_calmo') return 'day';
      if (seaId === 'grand_line') return 'dusk';
      if (seaId === 'novo_mundo') return 'night';
      if (seaId === 'marineford') return 'day';
      return 'storm';
    },

    handleResize: function() {
      if (this.gamePhase === 'BATTLE' && typeof this.fitBattleRadar === 'function') this.fitBattleRadar();
      if (!this.webglAvailable || !this.dom.canvas || !this.renderer) return;
      var container = this.dom.canvas.parentElement;
      var width = Math.max(1, container.clientWidth || window.innerWidth);
      var height = Math.max(1, container.clientHeight || window.innerHeight);

      this.renderer.setSize(width, height);
      if (this.platesSystem) {
        this.platesSystem.resize(width, height, this.pixelSize);
      }
      if (this.postPipeline) {
        this.postPipeline.setSize(width, height);
      }
    },

    initAudioControls: function() {
      var self = this;
      if (!this.audio) return;

      this.dom.soundBtn.addEventListener('click', function() {
        var muted = self.audio.toggleMute();
        self.dom.soundBtn.textContent = muted ? '🔇' : '🔊';
        self.dom.soundBtn.setAttribute('aria-pressed', muted ? 'false' : 'true');
      });

      this.dom.shantyBtn.addEventListener('click', function() {
        if (self.audio.isShantyPlaying()) {
          self.audio.stopShanty();
          self.dom.shantyBtn.classList.remove('active');
          self.dom.shantyBtn.setAttribute('aria-pressed', 'false');
        } else {
          self.audio.startShanty();
          self.dom.shantyBtn.classList.add('active');
          self.dom.shantyBtn.setAttribute('aria-pressed', 'true');
        }
      });
    },

    initInputControls: function() {
      var self = this;

      // 1. Keyboard Navigation & Modal Escape
      window.addEventListener('keydown', function(ev) {
        if (ev.key === 'Escape') {
          if (self.dom.modalOverlay && self.dom.modalOverlay.style.display !== 'none') {
            ev.preventDefault();
            if (self.gamePhase === 'CEREMONY') {
              self.skipCeremony();
            } else if (self.gamePhase !== 'COIN_TOSS') {
              self.hideModal();
            }
            return;
          }
          if (self.isUsingTechnique) {
            self.isUsingTechnique = false;
            self.renderGameplayTab();
            return;
          }
        }

        if (ev.target && (ev.target.tagName === 'INPUT' || ev.target.tagName === 'TEXTAREA' || ev.target.tagName === 'SELECT')) {
          return;
        }
        if (ev.target && ev.target.getAttribute && ev.target.getAttribute('role') === 'tab') {
          return;
        }

        var key = ev.key.toUpperCase();

        if (key === 'R' && self.gamePhase === 'SETUP') {
          ev.preventDefault();
          self.rotateCandidateShip();
          return;
        }

        if (key === 'P') {
          ev.preventDefault();
          self.toggleSidePanelCollapse();
          return;
        }

        if (key === '1' && self.gamePhase !== 'BATTLE') { self.setCameraPreset('duas_aguas'); return; }
        if (key === '2' && self.gamePhase !== 'BATTLE') { self.setCameraPreset('minhas_aguas'); return; }
        if (key === '3' && self.gamePhase !== 'BATTLE') { self.setCameraPreset('mira_inimiga'); return; }
        if (key === '4' && self.gamePhase !== 'BATTLE') { self.setCameraPreset('panorama'); return; }

        if (key === 'M' && self.audio) {
          var muted = self.audio.toggleMute();
          self.dom.soundBtn.textContent = muted ? '🔇' : '🔊';
          return;
        }

        if (self.gamePhase === 'BATTLE') {
          var boardSize = self.getActiveBoardSize();
          var cur = self.selectedAimCell || { r: 0, c: 0 };

          if (ev.key === 'ArrowUp') {
            ev.preventDefault();
            self.selectAimCoordinate(Math.max(0, cur.r - 1), cur.c);
            return;
          }
          if (ev.key === 'ArrowDown') {
            ev.preventDefault();
            self.selectAimCoordinate(Math.min(boardSize - 1, cur.r + 1), cur.c);
            return;
          }
          if (ev.key === 'ArrowLeft') {
            ev.preventDefault();
            self.selectAimCoordinate(cur.r, Math.max(0, cur.c - 1));
            return;
          }
          if (ev.key === 'ArrowRight') {
            ev.preventDefault();
            self.selectAimCoordinate(cur.r, Math.min(boardSize - 1, cur.c + 1));
            return;
          }
          if (ev.key === 'Enter' || ev.key === ' ') {
            if (ev.target && ev.target.tagName === 'BUTTON' && !ev.target.classList.contains('radar-cell')) {
              return;
            }
            ev.preventDefault();
            self.confirmFireShot();
            return;
          }
          if (key === 'H' && !self.isPvpMode) {
            ev.preventDefault();
            self.useLogPoseHint();
            return;
          }
          if (key === 'T') {
            ev.preventDefault();
            self.triggerSpecialTechnique();
            return;
          }
          if (key.length === 1 && key >= 'A' && key <= 'L') {
            var r = key.charCodeAt(0) - 65;
            if (r < boardSize) {
              ev.preventDefault();
              self.selectAimCoordinate(r, cur.c);
              return;
            }
          }
          if (key >= '1' && key <= '9') {
            var c = parseInt(key, 10) - 1;
            if (c < boardSize) {
              ev.preventDefault();
              self.selectAimCoordinate(cur.r, c);
              return;
            }
          }
          if (key === '0' && boardSize >= 10) {
            ev.preventDefault();
            self.selectAimCoordinate(cur.r, 9);
            return;
          }
        }
      });

      if (!this.webglAvailable || typeof THREE === 'undefined') return;

      // 2. 3D Raycasting + Desktop Mouse Orbit / Wheel Zoom
      var raycaster = new THREE.Raycaster();
      var mouse = new THREE.Vector2();
      var isDraggingOrbit = false;
      var dragMovedDist = 0;
      var lastMouseX = 0;
      var lastMouseY = 0;

      function getCanvasRelativeCoords(e) {
        var rect = self.dom.canvas.getBoundingClientRect();
        var clientX = e.clientX !== undefined ? e.clientX : (e.touches && e.touches[0] ? e.touches[0].clientX : 0);
        var clientY = e.clientY !== undefined ? e.clientY : (e.touches && e.touches[0] ? e.touches[0].clientY : 0);
        return {
          x: ((clientX - rect.left) / Math.max(1, rect.width)) * 2 - 1,
          y: -((clientY - rect.top) / Math.max(1, rect.height)) * 2 + 1
        };
      }

      this.dom.canvas.addEventListener('mousedown', function(e) {
        isDraggingOrbit = true;
        dragMovedDist = 0;
        lastMouseX = e.clientX;
        lastMouseY = e.clientY;
      });

      window.addEventListener('mouseup', function() {
        isDraggingOrbit = false;
      });

      this.dom.canvas.addEventListener('mousemove', function(e) {
        if (isDraggingOrbit) {
          var dx = e.clientX - lastMouseX;
          var dy = e.clientY - lastMouseY;
          lastMouseX = e.clientX;
          lastMouseY = e.clientY;
          dragMovedDist += Math.hypot(dx, dy);

          if (dragMovedDist > 5 && self.platesSystem && self.platesSystem.cameraController) {
            self.platesSystem.cameraController.orbit(-dx * 0.006, dy * 0.005);
            return;
          }
        }

        if (!self.platesSystem) return;
        var coords = getCanvasRelativeCoords(e);
        mouse.x = coords.x;
        mouse.y = coords.y;
        raycaster.setFromCamera(mouse, self.platesSystem.camera);

        var hit = self.platesSystem.seaPlates.raycastCell(raycaster);
        if (hit) {
          var plates = self.getMyPlatesIndices();
          if (self.gamePhase === 'SETUP' && hit.plateIndex === plates.myPlate) {
            self.handlePlacementHover(hit.r, hit.c);
          } else if (self.gamePhase === 'BATTLE' && hit.plateIndex === plates.oppPlate) {
            self.handleAimHover(hit.r, hit.c);
          }
        } else if (self.gamePhase === 'SETUP') {
          self.platesSystem.seaPlates.hideValidityGhost();
        }
      });

      this.dom.canvas.addEventListener('click', function(e) {
        if (dragMovedDist > 6 || !self.platesSystem) return;
        var coords = getCanvasRelativeCoords(e);
        mouse.x = coords.x;
        mouse.y = coords.y;
        raycaster.setFromCamera(mouse, self.platesSystem.camera);

        var hit = self.platesSystem.seaPlates.raycastCell(raycaster);
        if (hit) {
          var plates = self.getMyPlatesIndices();
          if (self.gamePhase === 'SETUP' && hit.plateIndex === plates.myPlate) {
            self.handlePlacementClick(hit.r, hit.c);
          } else if (self.gamePhase === 'BATTLE' && hit.plateIndex === plates.oppPlate) {
            self.handleBattleCellClick(hit.r, hit.c);
          }
        }
      });

      this.dom.canvas.addEventListener('wheel', function(e) {
        if (!self.platesSystem || !self.platesSystem.cameraController) return;
        e.preventDefault();
        self.platesSystem.cameraController.zoomBy(-e.deltaY * 0.0012);
      }, { passive: false });

      this.dom.canvas.addEventListener('contextmenu', function(e) {
        if (self.gamePhase === 'SETUP') {
          e.preventDefault();
          self.rotateCandidateShip();
        }
      });

      // 3. Touch Drag-to-Turn & Pinch-to-Zoom
      var lastTouchDist = 0;
      var lastTouchX = 0;
      var lastTouchY = 0;
      var lastTapTime = 0;

      this.dom.canvas.addEventListener('touchstart', function(e) {
        if (e.touches.length === 1) {
          lastTouchX = e.touches[0].clientX;
          lastTouchY = e.touches[0].clientY;
          var now = Date.now();
          if (now - lastTapTime < 300 && self.gamePhase === 'SETUP') {
            self.rotateCandidateShip();
          }
          lastTapTime = now;
        } else if (e.touches.length === 2) {
          var dx = e.touches[0].clientX - e.touches[1].clientX;
          var dy = e.touches[0].clientY - e.touches[1].clientY;
          lastTouchDist = Math.hypot(dx, dy);
        }
      }, { passive: true });

      this.dom.canvas.addEventListener('touchmove', function(e) {
        if (!self.platesSystem || !self.platesSystem.cameraController) return;
        var ctrl = self.platesSystem.cameraController;
        if (e.touches.length === 1) {
          var curX = e.touches[0].clientX;
          var curY = e.touches[0].clientY;
          var deltaX = curX - lastTouchX;
          var deltaY = curY - lastTouchY;
          lastTouchX = curX;
          lastTouchY = curY;
          ctrl.orbit(-deltaX * 0.006, deltaY * 0.005);
        } else if (e.touches.length === 2) {
          var dx = e.touches[0].clientX - e.touches[1].clientX;
          var dy = e.touches[0].clientY - e.touches[1].clientY;
          var dist = Math.hypot(dx, dy);
          var zoomDelta = (dist - lastTouchDist) * 0.008;
          lastTouchDist = dist;
          ctrl.zoomBy(zoomDelta);
        }
      }, { passive: true });
    },

    getActiveBoardSize: function() {
      if (this.isPvpMode && this.pvpClient && this.pvpClient.state) {
        return this.pvpClient.state.matchConfig.boardSize || 10;
      }
      if (this.matchState) return this.matchState.boardSize;
      return (GLT.rules.BOARDS_MAP[this.matchConfig.boardId] || { size: 10 }).size;
    },

    /**
     * =========================================================================
     * PHASE 1: SETUP & FLEET PLACEMENT
     * =========================================================================
     */
    setupFleetPlacementPhase: function() {
      this.clearTurnTimers();
      this.gamePhase = 'SETUP';
      this.isPvpMode = false;
      this.isUsingTechnique = false;
      this.placedPlayerFleet = [];
      this.selectedCandidateShipIndex = -1;
      this.candidateHorizontal = true;
      this.hoveredPlacementCell = null;
      this.selectedAimCell = null;
      this.playerRevealedCells = [];
      this.cpuRevealedCells = [];
      this.hintsRemaining = 2;

      var boardSize = (GLT.rules.BOARDS_MAP[this.matchConfig.boardId] || { size: 10 }).size;
      if (this.platesSystem) {
        this.platesSystem.setBoardSize(boardSize);
        this.platesSystem.seaPlates.clearShotMarkers();
        this.platesSystem.seaPlates.setShipFoamCells(0, []);
        this.platesSystem.seaPlates.setShipFoamCells(1, []);
        this.platesSystem.seaPlates.hideValidityGhost();
      }
      this.clearAllShipMeshes();
      this.setCameraPreset('duas_aguas');

      if (this.dom.aimTargetBadge && this.webglAvailable) {
        this.dom.aimTargetBadge.textContent = getT().ui.setupCanvasHint;
      }

      this.autoPlacePlayerFleet('spread');
      this.updateRivalAvatar();
      this.updateRivalTaunt('intro');
      this.updateTopHudStatus();
      this.renderGameplayTab();
      this.renderFleetTab();
      this.renderLogbookTab();
      this.renderSettingsTab();
      this.renderPvpTab();
    },

    autoPlacePlayerFleet: function(strategy) {
      var seed = (++this.matchSeq) * 7919 + 104729;
      var rngInstance = GLT.rng.createRng(seed ^ (Date.now() & 0xfffffff));
      var placed = GLT.rules.autoPlaceFleet(this.matchConfig.boardId, rngInstance, {
        allowTouch: this.matchConfig.allowTouch,
        strategy: strategy || 'spread',
        crewId: this.matchConfig.crewId
      });
      this.placedPlayerFleet = placed;
      this.selectedCandidateShipIndex = -1;
      if (this.platesSystem) {
        this.platesSystem.seaPlates.hideValidityGhost();
      }
      this.syncPlayerFleetTo3d();
      if (this.gamePhase === 'SETUP') {
        this.renderGameplayTab();
      }
      this.renderFleetTab();
      this.renderFloatingControls();
      this.renderHudMinimap();
      if (this.audio && typeof this.audio.playUiClick === 'function') this.audio.playUiClick();
    },

    clearPlayerFleet: function() {
      this.placedPlayerFleet = [];
      this.selectedCandidateShipIndex = -1;
      this.clearAllShipMeshes();
      if (this.platesSystem) {
        var plates = this.getMyPlatesIndices();
        this.platesSystem.seaPlates.setShipFoamCells(plates.myPlate, []);
        this.platesSystem.seaPlates.hideValidityGhost();
      }
      this.renderGameplayTab();
      this.renderFleetTab();
      this.renderFloatingControls();
      this.renderHudMinimap();
      if (this.audio && typeof this.audio.playUiClick === 'function') this.audio.playUiClick();
    },

    rotateCandidateShip: function() {
      this.candidateHorizontal = !this.candidateHorizontal;
      if (this.hoveredPlacementCell) {
        this.handlePlacementHover(this.hoveredPlacementCell.r, this.hoveredPlacementCell.c);
      }
      this.renderGameplayTab();
      this.renderFloatingControls();
      this.renderHudMinimap();
      if (this.audio && typeof this.audio.playUiClick === 'function') this.audio.playUiClick();
    },

    handlePlacementHover: function(r, c) {
      this.hoveredPlacementCell = { r: r, c: c };
      if (this.selectedCandidateShipIndex === -1) {
        if (this.platesSystem) {
          this.platesSystem.seaPlates.hideValidityGhost();
        }
        return;
      }
      var ships = GLT.rules.getShipsForBoard(this.matchConfig.boardId, this.matchConfig.crewId);
      var candidateTemplate = ships[this.selectedCandidateShipIndex];
      if (!candidateTemplate) {
        if (this.platesSystem) {
          this.platesSystem.seaPlates.hideValidityGhost();
        }
        return;
      }

      var boardSize = (GLT.rules.BOARDS_MAP[this.matchConfig.boardId] || { size: 10 }).size;
      var otherShips = this.placedPlayerFleet.filter(function(s) { return s.id !== candidateTemplate.id; });
      var candidate = {
        id: candidateTemplate.id,
        name: candidateTemplate.name,
        length: candidateTemplate.length,
        r: r,
        c: c,
        horizontal: this.candidateHorizontal
      };

      var validation = GLT.rules.validatePlacement(
        boardSize,
        otherShips,
        candidate,
        { allowTouch: this.matchConfig.allowTouch }
      );

      this.placementValid = validation.valid;
      if (this.platesSystem) {
        var plates = this.getMyPlatesIndices();
        this.platesSystem.seaPlates.showValidityGhost(
          plates.myPlate,
          r,
          c,
          candidateTemplate.length,
          this.candidateHorizontal,
          validation.valid
        );
      }
    },

    handlePlacementClick: function(r, c) {
      var ships = GLT.rules.getShipsForBoard(this.matchConfig.boardId, this.matchConfig.crewId);
      var existingAtCell = this.placedPlayerFleet.find(function(s) {
        return s.cells && s.cells.some(function(sc) { return sc.r === r && sc.c === c; });
      });

      // If user clicks an existing ship cell, toggle selection for repositioning
      if (existingAtCell) {
        var idxFound = ships.findIndex(function(st) { return st.id === existingAtCell.id; });
        if (idxFound !== -1) {
          if (this.selectedCandidateShipIndex === idxFound) {
            this.selectedCandidateShipIndex = -1;
            if (this.platesSystem) this.platesSystem.seaPlates.hideValidityGhost();
          } else {
            this.selectedCandidateShipIndex = idxFound;
            this.candidateHorizontal = existingAtCell.horizontal !== false;
          }
          this.renderGameplayTab();
          this.renderFleetTab();
          this.renderFloatingControls();
          this.renderHudMinimap();
          if (this.audio && typeof this.audio.playUiClick === 'function') this.audio.playUiClick();
          return;
        }
      }

      if (this.selectedCandidateShipIndex === -1) {
        return;
      }

      var candidateTemplate = ships[this.selectedCandidateShipIndex];
      if (!candidateTemplate) return;

      var boardSize = (GLT.rules.BOARDS_MAP[this.matchConfig.boardId] || { size: 10 }).size;
      var otherShips = this.placedPlayerFleet.filter(function(s) { return s.id !== candidateTemplate.id; });
      var candidate = {
        id: candidateTemplate.id,
        name: candidateTemplate.name,
        length: candidateTemplate.length,
        isSubmarine: !!candidateTemplate.isSubmarine,
        r: r,
        c: c,
        horizontal: this.candidateHorizontal
      };

      var validation = GLT.rules.validatePlacement(
        boardSize,
        otherShips,
        candidate,
        { allowTouch: this.matchConfig.allowTouch }
      );

      if (validation.valid) {
        this.placedPlayerFleet = otherShips.concat([Object.assign({}, candidate, { cells: validation.cells })]);

        var nextIdx = -1;
        for (var i = 0; i < ships.length; i++) {
          var isPlaced = this.placedPlayerFleet.some(function(s) { return s.id === ships[i].id; });
          if (!isPlaced) {
            nextIdx = i;
            break;
          }
        }
        this.selectedCandidateShipIndex = nextIdx;
        if (nextIdx === -1 && this.platesSystem) {
          this.platesSystem.seaPlates.hideValidityGhost();
        }

        this.syncPlayerFleetTo3d();
        this.renderGameplayTab();
        this.renderFleetTab();
        this.renderFloatingControls();
        this.renderHudMinimap();
        if (this.audio && typeof this.audio.playUiClick === 'function') this.audio.playUiClick();
        this.announce(getT().ui.shipPlacedAt(candidate.name, GLT.rules.coordToLabel(r, c)));
      } else {
        if (this.audio) this.audio.playDefeatDirge();
        this.announce(validation.message || getT().errors.placementOverlap);
      }
    },

    syncPlayerFleetTo3d: function() {
      var self = this;
      if (!this.webglAvailable || !this.platesSystem || !this.scene) return;
      this.clearAllShipMeshes();

      var plates = this.getMyPlatesIndices();
      var foamCells = [];
      var crew = GLT.rules.CREWS_MAP[this.matchConfig.crewId] || GLT.rules.CREWS_MAP.straw_hats;
      var ownerColor = parseInt(crew.colors.primary.replace('#', '0x'), 16);

      this.placedPlayerFleet.forEach(function(s) {
        var cells = s.cells && s.cells.length > 0 ? s.cells : null;
        var r0 = cells ? cells[0].r : s.r;
        var c0 = cells ? cells[0].c : s.c;
        var rEnd = cells ? cells[cells.length - 1].r : (s.horizontal ? s.r : s.r + s.length - 1);
        var cEnd = cells ? cells[cells.length - 1].c : (s.horizontal ? s.c + s.length - 1 : s.c);
        var horiz = r0 === rEnd;

        var mesh = GLT.shipsVoxel.createShipMesh(s.id, {
          cellSize: 2.0,
          ownerColor: ownerColor,
          crewId: self.matchConfig.crewId,
          length: s.length || (cells ? cells.length : undefined),
          horizontal: horiz
        });

        var startPos = self.platesSystem.seaPlates.cellToWorld(plates.myPlate, r0, c0);
        var endPos = self.platesSystem.seaPlates.cellToWorld(plates.myPlate, rEnd, cEnd);

        mesh.position.set((startPos.x + endPos.x) * 0.5, 0.15, (startPos.z + endPos.z) * 0.5);
        mesh.userData.basePosY = 0.15;
        mesh.userData.shipId = s.id;
        if (!horiz) {
          mesh.rotation.y = Math.PI * 0.5;
        }

        self.scene.add(mesh);
        self.playerShipMeshes.push(mesh);

        if (cells) {
          cells.forEach(function(cl) { foamCells.push({ r: cl.r, c: cl.c }); });
        } else {
          for (var i = 0; i < s.length; i++) {
            foamCells.push({ r: horiz ? r0 : r0 + i, c: horiz ? c0 + i : c0 });
          }
        }
      });

      this.platesSystem.seaPlates.setShipFoamCells(plates.myPlate, foamCells);
    },

    clearAllShipMeshes: function() {
      var self = this;
      if (this.scene) {
        this.playerShipMeshes.forEach(function(m) { self.scene.remove(m); });
        this.enemyGhostShipMeshes.forEach(function(m) { self.scene.remove(m); });
      }
      this.playerShipMeshes = [];
      this.enemyGhostShipMeshes = [];
    },

    /**
     * =========================================================================
     * PHASE 2: BERRY COIN TOSS, BATTLE ENGINE, AI & ALL 6 TECHNIQUES
     * =========================================================================
     */
    startMatchWithCoinToss: function(continueSeries) {
      var self = this;
      var T = getT();
      var ships = GLT.rules.getShipsForBoard(this.matchConfig.boardId, this.matchConfig.crewId);

      this.clearTurnTimers();
      this.isPvpMode = false;
      this.isUsingTechnique = false;

      if (!continueSeries) {
        this.seriesWins = [0, 0];
        this.currentSeriesGame = 1;
      }

      if (this.placedPlayerFleet.length < ships.length) {
        if (continueSeries) {
          this.autoPlacePlayerFleet('spread');
        } else {
          this.announce(T.errors.placementIncomplete);
          return;
        }
      }

      // Reset board visuals for fresh match
      this.playerRevealedCells = [];
      this.cpuRevealedCells = [];
      this.hintsRemaining = 2;
      if (this.platesSystem) {
        var bSize = (GLT.rules.BOARDS_MAP[this.matchConfig.boardId] || { size: 10 }).size;
        this.platesSystem.setBoardSize(bSize);
        this.platesSystem.seaPlates.clearShotMarkers();
        this.platesSystem.seaPlates.setShipFoamCells(1, []);
      }
      this.syncPlayerFleetTo3d();

      this.gamePhase = 'COIN_TOSS';
      var seed = 'glt_s_' + (++this.matchSeq) + '_' + Date.now();
      this.matchRng = GLT.rng.createRng(seed);
      var startingPlayer = GLT.rng.coinToss(seed);

      if (!this.seriesMemory && GLT.ai && GLT.ai.createSeriesMemory) {
        this.seriesMemory = GLT.ai.createSeriesMemory();
      }

      this.aiPlayer = GLT.ai.createAiPlayer(
        this.matchConfig.difficulty,
        this.matchConfig.enemyCrewId,
        this.matchConfig.boardId,
        {
          mode: this.matchConfig.mode,
          allowTouch: this.matchConfig.allowTouch,
          continueOnHit: this.matchConfig.continueOnHit,
          salvo: this.matchConfig.salvo
        },
        this.seriesMemory
      );

      var enemyRng = this.matchRng.fork('enemy_fleet');
      var enemyFleet = (this.aiPlayer && this.aiPlayer.placeFleet)
        ? this.aiPlayer.placeFleet(enemyRng)
        : GLT.rules.autoPlaceFleet(this.matchConfig.boardId, enemyRng, {
            allowTouch: this.matchConfig.allowTouch,
            strategy: 'spread'
          });

      this.matchState = GLT.rules.createMatchState({
        seed: seed,
        boardId: this.matchConfig.boardId,
        mode: this.matchConfig.mode,
        sea: this.matchConfig.sea,
        allowTouch: this.matchConfig.allowTouch,
        continueOnHit: this.matchConfig.continueOnHit,
        salvo: this.matchConfig.salvo,
        turnTimer: this.matchConfig.turnTimer,
        fog: this.matchConfig.fog,
        seriesLength: this.matchConfig.seriesLength,
        crews: [this.matchConfig.crewId, this.matchConfig.enemyCrewId],
        fleets: [this.placedPlayerFleet, enemyFleet]
      });

      if (continueSeries && Array.isArray(this.seriesWins)) {
        this.matchState.seriesWins = this.seriesWins.slice();
      }
      this.matchState.turn = startingPlayer;

      if (this.audio) this.audio.playCoinToss();

      var winnerMsg = startingPlayer === 0 ? T.ui.coinTossPlayerWon : T.ui.coinTossEnemyWon;
      this.showModal(
        T.ui.coinTossTitle,
        '<div class="glt-coin-toss-box">' +
          '<div class="glt-berry-coin spin-animation">฿</div>' +
          '<p class="glt-coin-result">' + winnerMsg + '</p>' +
        '</div>'
      );
      this.announce(winnerMsg);

      var tossDelay = Math.max(380, Math.round(1450 / Math.max(0.5, this.animSpeed)));
      this.coinTossTimeout = setTimeout(function() {
        self.coinTossTimeout = null;
        self.hideModal();
        self.launchBattlePhase();
      }, tossDelay);
    },

    launchBattlePhase: function() {
      var T = getT();
      this.gamePhase = 'BATTLE';
      this.selectedAimCell = { r: 0, c: 0 };
      this.secondsLeftInTurn = this.matchConfig.turnTimer > 0 ? this.matchConfig.turnTimer : 0;

      this.setCameraPreset('mira_inimiga');
      this.updateRivalAvatar();
      this.updateRivalTaunt('intro');
      this.updateTopHudStatus();

      var c0 = GLT.rules.CREWS_MAP[this.matchConfig.crewId] || GLT.rules.CREWS_MAP.straw_hats;
      var c1 = GLT.rules.CREWS_MAP[this.matchConfig.enemyCrewId] || GLT.rules.CREWS_MAP.marines;
      var plates = this.getMyPlatesIndices();
      if (this.platesSystem) {
        var color0 = plates.isGuest ? c1.colors.primary : c0.colors.primary;
        var color1 = plates.isGuest ? c0.colors.primary : c1.colors.primary;
        this.platesSystem.seaPlates.setPlateOwnerColors(color0, color1);
        this.platesSystem.seaPlates.setSelection(plates.oppPlate, 0, 0);
      }
      if (this.dom.aimTargetBadge) {
        this.dom.aimTargetBadge.textContent = T.ui.targetSelected(GLT.rules.coordToLabel(0, 0));
      }

      this.appendLogBookEntry(T.ui.battleStarted(T.meta.title, T.meta.subtitle));
      this.startTurnTimer();

      this.renderGameplayTab();
      this.renderFleetTab();
      this.renderLogbookTab();
      this.renderFloatingControls();
      this.renderHudMinimap();

      if (!this.isPvpMode && this.matchState && this.matchState.turn === 1) {
        this.triggerCpuTurn();
      }
    },

    startTurnTimer: function() {
      var self = this;
      if (this.turnTimerInterval) {
        clearInterval(this.turnTimerInterval);
        this.turnTimerInterval = null;
      }

      var timerSec = this.isPvpMode && this.pvpClient && this.pvpClient.state
        ? this.pvpClient.state.matchConfig.turnTimer
        : this.matchConfig.turnTimer;

      if (!timerSec || timerSec <= 0) {
        if (this.dom.timerPill) {
          this.dom.timerPill.textContent = getT().rules.turnTimer.off;
          this.dom.timerPill.classList.remove('expiring');
        }
        return;
      }

      this.secondsLeftInTurn = timerSec;
      this.updateTimerDisplay();

      var tickMs = this.isPvpMode ? 1000 : Math.max(200, Math.round(1000 / Math.max(0.5, this.animSpeed)));
      this.turnTimerInterval = setInterval(function() {
        if (self.isPaused || self.gamePhase !== 'BATTLE') return;
        self.secondsLeftInTurn--;
        self.updateTimerDisplay();

        if (self.secondsLeftInTurn <= 0) {
          clearInterval(self.turnTimerInterval);
          self.turnTimerInterval = null;
          self.handleTurnTimeout();
        }
      }, tickMs);
    },

    updateTimerDisplay: function() {
      if (this.dom.timerPill) {
        this.dom.timerPill.textContent = getT().turns.timerSeconds(Math.max(0, this.secondsLeftInTurn));
        this.dom.timerPill.classList.toggle('expiring', this.secondsLeftInTurn > 0 && this.secondsLeftInTurn <= 5);
      }
    },

    handleTurnTimeout: function() {
      if (this.gamePhase !== 'BATTLE') return;
      if (this.isPvpMode) {
        if (this.isMyPvpTurn()) {
          var bSize = this.getActiveBoardSize();
          var myShots = this.pvpClient.state.boards[this.pvpClient.playerIndex].shots;
          for (var r = 0; r < bSize; r++) {
            for (var c = 0; c < bSize; c++) {
              if (!myShots[r + ',' + c]) {
                this.selectAimCoordinate(r, c);
                this.confirmFireShot();
                return;
              }
            }
          }
        }
        return;
      }

      if (!this.matchState || this.matchState.gameOver) return;
      if (this.matchState.turn === 0) {
        var boardSize = this.matchState.boardSize;
        var defender = this.matchState.players[1];
        for (var pr = 0; pr < boardSize; pr++) {
          for (var pc = 0; pc < boardSize; pc++) {
            if (!defender.shotsTaken[pr + ',' + pc]) {
              this.selectAimCoordinate(pr, pc);
              this.confirmFireShot();
              return;
            }
          }
        }
      } else if (!this.isCpuThinking) {
        this.triggerCpuTurn();
      }
    },

    handleBattleCellClick: function(r, c) {
      this.selectAimCoordinate(r, c);
      if (this.isUsingTechnique) {
        this.executePlayerTechnique({ r: r, c: c });
      }
    },

    selectAimCoordinate: function(r, c) {
      this.selectedAimCell = { r: r, c: c };
      var label = GLT.rules.coordToLabel(r, c);
      var T = getT();
      var plates = this.getMyPlatesIndices();

      if (this.platesSystem) {
        this.platesSystem.seaPlates.setSelection(plates.oppPlate, r, c);
      }
      if (this.dom.aimTargetBadge) {
        if (this.isUsingTechnique) {
          var crew = GLT.rules.CREWS_MAP[this.matchConfig.crewId] || GLT.rules.CREWS_MAP.straw_hats;
          this.dom.aimTargetBadge.textContent = T.ui.techniqueTargetingPrompt(T.techniques[crew.technique].shortName) + ' (' + label + ')';
        } else {
          this.dom.aimTargetBadge.textContent = T.ui.targetSelected(label);
        }
      }

      this.renderGameplayTab();
      this.renderFloatingControls();
      this.renderHudMinimap();
      if (this.audio && typeof this.audio.playUiClick === 'function') this.audio.playUiClick();
    },

    handleAimHover: function(r, c) {
      this.hoveredAimCell = { r: r, c: c };
      var plates = this.getMyPlatesIndices();
      if (this.platesSystem) {
        this.platesSystem.seaPlates.setHover(plates.oppPlate, r, c);
      }
    },

    isMyPvpTurn: function() {
      if (!this.isPvpMode || !this.pvpClient || !this.pvpClient.state) return false;
      var st = this.pvpClient.state;
      return this.pvpClient.role === 'player' &&
        st.phase === 'playing' &&
        st.currentTurn === this.pvpClient.playerIndex &&
        !st.pendingShot &&
        !st.pendingTech;
    },

    // the live ship nearest the rival waters fires (the fx ball leaves from its muzzle: a short, visible arc)
    triggerPlayerShipRecoil: function() {
      var rivalX = 0;
      if (this.platesSystem) {
        rivalX = this.platesSystem.seaPlates.cellToWorld(this.getMyPlatesIndices().oppPlate, 0, 0).x;
      }
      var best = null, bestD = Infinity;
      for (var i = 0; i < this.playerShipMeshes.length; i++) {
        var m = this.playerShipMeshes[i];
        if (m && m.userData && !m.userData.sinking && typeof m.fireCannon === 'function') {
          var d = Math.abs(m.position.x - rivalX);
          if (d < bestD) { bestD = d; best = m; }
        }
      }
      if (best) best.fireCannon('starboard');
    },

    confirmFireShot: function() {
      var self = this;
      var T = getT();

      if (this.gamePhase !== 'BATTLE') return;

      if (this.isUsingTechnique) {
        var techTarget = this.selectedAimCell || { r: 0, c: 0 };
        this.executePlayerTechnique({ r: techTarget.r, c: techTarget.c });
        return;
      }

      // Online PvP Branch
      if (this.isPvpMode && this.pvpClient) {
        if (!this.isMyPvpTurn() || this.shotInFlight) {
          this.announce(T.errors.notYourTurn);
          return;
        }
        if (!this.selectedAimCell) {
          this.announce(T.ui.noTargetSelected);
          return;
        }
        var pTarget = this.selectedAimCell;
        var myIdx = this.pvpClient.playerIndex;
        if (this.pvpClient.state.boards[myIdx].shots[pTarget.r + ',' + pTarget.c]) {
          this.announce(T.outcomes.alreadyShot);
          return;
        }

        var plates = this.getMyPlatesIndices();
        if (this.audio) this.audio.playCannon();
        this.triggerPlayerShipRecoil();
        if (this.platesSystem && this.fx) {
          var sPos = this.platesSystem.seaPlates.cellToWorld(plates.myPlate, 3, 2);
          var ePos = this.platesSystem.seaPlates.cellToWorld(plates.oppPlate, pTarget.r, pTarget.c);
          this.fx.fireCannonball(sPos, ePos, 'water');
        }
        this.pvpClient.fireShot(pTarget.r, pTarget.c);
        this.renderGameplayTab();
        this.renderFloatingControls();
        this.renderHudMinimap();
        return;
      }

      // Offline PvC Branch
      if (!this.matchState || this.matchState.gameOver) return;
      if (this.matchState.turn !== 0 || this.isCpuThinking || this.shotInFlight) return;
      if (!this.selectedAimCell) {
        this.announce(T.ui.noTargetSelected);
        return;
      }

      var target = this.selectedAimCell;
      var cellKey = target.r + ',' + target.c;
      if (this.matchState.players[1].shotsTaken[cellKey]) {
        this.announce(T.outcomes.alreadyShot);
        return;
      }

      var shotResult = GLT.rules.resolveShot(this.matchState, 0, target);
      if (!shotResult.valid) {
        this.announce(shotResult.message);
        return;
      }

      this.shotInFlight = true;
      if (this.audio) this.audio.playCannon();
      this.triggerPlayerShipRecoil();

      var endPos = null;
      if (this.platesSystem && this.fx) {
        var startPos = this.platesSystem.seaPlates.cellToWorld(0, 3, 2);
        endPos = this.platesSystem.seaPlates.cellToWorld(1, target.r, target.c);
        this.fx.fireCannonball(startPos, endPos, shotResult.outcome);
      }

      // the ball flies GLT.backdropFx.SHOT_FLIGHT_S game seconds; the outcome lands with it
      var flightMs = Math.max(25, Math.round(560 / Math.max(0.5, this.animSpeed)));
      this.shotFlightTimeout = setTimeout(function() {
        self.shotFlightTimeout = null;
        self.shotInFlight = false;
        self.applyShotOutcome(0, shotResult, endPos);
      }, flightMs);
    },

    /**
     * Unified cell impact visual handler for single shots AND multi-cell techniques
     */
    applyCellImpactVisual: function(defenderIdx, cellRes, playAudio) {
      var self = this;
      var r = cellRes.cell ? cellRes.cell.r : (cellRes.targetCell ? cellRes.targetCell.r : cellRes.r);
      var c = cellRes.cell ? cellRes.cell.c : (cellRes.targetCell ? cellRes.targetCell.c : cellRes.c);
      var outcome = cellRes.outcome;
      var worldPos = (this.platesSystem && this.platesSystem.seaPlates)
        ? this.platesSystem.seaPlates.cellToWorld(defenderIdx, r, c)
        : null;

      // Clear any revealed beacon on this coordinate now that it has been fired upon
      if (defenderIdx === 1) {
        this.playerRevealedCells = this.playerRevealedCells.filter(function(rc) { return rc.r !== r || rc.c !== c; });
      } else {
        this.cpuRevealedCells = this.cpuRevealedCells.filter(function(rc) { return rc.r !== r || rc.c !== c; });
      }

      if (outcome === 'water') {
        if (playAudio && this.audio) this.audio.playSplash();
        if (this.fx && worldPos) this.fx.spawnWaterSplash(worldPos);
        if (this.platesSystem) this.platesSystem.seaPlates.addShotMarker(defenderIdx, r, c, 'water');
        this.spawnMangaImpact(defenderIdx, r, c, 'water', 'ざばーん!!', 'ÁGUA');
      } else if (outcome === 'hit') {
        if (playAudio && this.audio) this.audio.playHit();
        if (playAudio && GLT.appShell) GLT.appShell.vibrate('hit');
        if (this.fx && worldPos) this.fx.spawnHitExplosion(worldPos);
        if (this.platesSystem) {
          this.platesSystem.seaPlates.addShotMarker(defenderIdx, r, c, 'hit');
          if (this.platesSystem.triggerScreenShake) this.platesSystem.triggerScreenShake(0.42, 0.32);
        }
        if (this.backdrop) this.backdrop.triggerCrowdCheer(0.8);
        this.spawnMangaImpact(defenderIdx, r, c, 'hit', 'ドカン!!', 'FOGO!');

        if (defenderIdx === 0 && cellRes.shipId && this.matchState) {
          this.updatePlayerShipMeshDamage(cellRes.shipId);
        }
      } else if (outcome === 'sunk') {
        if (playAudio && this.audio) this.audio.playSunk();
        if (playAudio && GLT.appShell) GLT.appShell.vibrate('sunk');
        if (this.fx && worldPos) this.fx.spawnHitExplosion(worldPos, 'sunk');
        if (this.platesSystem) {
          if (this.platesSystem.triggerScreenShake) this.platesSystem.triggerScreenShake(0.9, 0.55);
        }
        if (this.backdrop) this.backdrop.triggerCrowdCheer(1.5);
        this.spawnMangaImpact(defenderIdx, r, c, 'sunk', 'ドン!!', 'AFUNDADO!');

        if (this.platesSystem) {
          if (cellRes.sunkCells && cellRes.sunkCells.length > 0) {
            cellRes.sunkCells.forEach(function(sc) {
              self.platesSystem.seaPlates.addShotMarker(defenderIdx, sc.r, sc.c, 'sunk');
            });
          } else {
            this.platesSystem.seaPlates.addShotMarker(defenderIdx, r, c, 'sunk');
          }
        }

        var sinkingMesh = null;
        if (defenderIdx === 1 && cellRes.shipId) {
          this.createEnemyGhostShip(cellRes.shipId, cellRes.sunkCells);
          sinkingMesh = this.enemyGhostShipMeshes.find(function(g) { return g.userData && g.userData.shipId === cellRes.shipId; });
        } else if (defenderIdx === 0 && cellRes.shipId) {
          var playerMesh = this.playerShipMeshes.find(function(m) {
            return m.userData.shipId === cellRes.shipId;
          });
          if (playerMesh && !playerMesh.userData.sinking) {
            GLT.shipsVoxel.startShipSinking(playerMesh);
          }
          sinkingMesh = playerMesh;
        }
        // blasts along the hull, boiling bubbles, the swallow splash and floating planks (oil for a submarine)
        if (this.fx && this.fx.playSinkFx && cellRes.sunkCells && cellRes.sunkCells.length) {
          this.fx.playSinkFx(defenderIdx, cellRes.sunkCells, cellRes.shipId, {
            sub: !!(sinkingMesh && sinkingMesh.gltShip && sinkingMesh.gltShip.isSub)
          });
        }
      } else if (outcome === 'absorbed') {
        if (this.fx && worldPos && this.fx.spawnAbsorbed) this.fx.spawnAbsorbed(worldPos);
        if (this.platesSystem) this.platesSystem.seaPlates.addShotMarker(defenderIdx, r, c, 'fog');
        this.spawnMangaImpact(defenderIdx, r, c, 'water', 'ズバッ!!', 'ABSORVIDO');
      }
    },

    spawnMangaImpact: function(defenderIdx, r, c, type, textJp, textPt) {
      if (!this.platesSystem || !this.platesSystem.camera || typeof THREE === 'undefined') return;
      var viewport = document.getElementById('glt-viewport-container');
      if (!viewport) return;
      var worldPos = this.platesSystem.seaPlates.cellToWorld(defenderIdx, r, c);
      var cam = this.platesSystem.camera;
      var p = worldPos.clone().add(new THREE.Vector3(0, 2.5, 0));
      p.project(cam);
      var rect = viewport.getBoundingClientRect();
      var x = (p.x * 0.5 + 0.5) * rect.width;
      var y = (-p.y * 0.5 + 0.5) * rect.height;

      if (x < 15 || x > rect.width - 15 || y < 15 || y > rect.height - 15) return;

      var el = document.createElement('div');
      el.className = 'glt-manga-impact impact-' + type;
      el.style.left = Math.round(x) + 'px';
      el.style.top = Math.round(y) + 'px';
      el.innerHTML =
        '<span class="manga-jp">' + textJp + '</span>' +
        '<span class="manga-pt">' + textPt + '</span>';

      viewport.appendChild(el);
      setTimeout(function() {
        if (el.parentNode) el.parentNode.removeChild(el);
      }, 1300);
    },

    updatePlayerShipMeshDamage: function(shipId) {
      if (!this.matchState || !GLT.shipsVoxel || !GLT.shipsVoxel.setShipDamage) return;
      var p0 = this.matchState.players[0];
      var shipData = p0.fleet.find(function(s) { return s.id === shipId; });
      var mesh = this.playerShipMeshes.find(function(m) { return m.userData.shipId === shipId; });
      if (!shipData || !mesh || !shipData.cells) return;

      var hitIndices = [];
      shipData.cells.forEach(function(cl, idx) {
        var st = p0.shotsTaken[cl.r + ',' + cl.c];
        if (st && (st.result === 'hit' || st.result === 'sunk')) {
          hitIndices.push(idx);
        }
      });
      GLT.shipsVoxel.setShipDamage(mesh, hitIndices);
    },

    syncFogMarkers3d: function() {
      if (!this.platesSystem || !this.matchState || !this.matchState.fog) return;
      for (var pIdx = 0; pIdx <= 1; pIdx++) {
        var shots = this.matchState.players[pIdx].shotsTaken;
        for (var key in shots) {
          if (Object.prototype.hasOwnProperty.call(shots, key)) {
            var s = shots[key];
            if (s.result === 'water' && GLT.rules.isShotFaded(this.matchState, s.turn)) {
              this.platesSystem.seaPlates.addShotMarker(pIdx, s.r, s.c, 'fog');
            }
          }
        }
      }
    },

    applyShotOutcome: function(shooterIdx, shotResult) {
      var self = this;
      var T = getT();
      if (!this.matchState) return;
      var defenderIdx = 1 - shooterIdx;
      var outcome = shotResult.outcome;

      this.applyCellImpactVisual(defenderIdx, shotResult, true);
      this.syncFogMarkers3d();

      if (this.backdrop) {
        this.backdrop.updateDenDenBoard({
          p1Shots: this.matchState.players[0].stats.shots,
          p1Hits: this.matchState.players[0].stats.hits,
          p1ShipsRemaining: this.matchState.players[0].shipsRemaining,
          p2Shots: this.matchState.players[1].stats.shots,
          p2Hits: this.matchState.players[1].stats.hits,
          p2ShipsRemaining: this.matchState.players[1].shipsRemaining,
          turnTimeRemaining: this.secondsLeftInTurn,
          lastShotCall: shotResult.coordLabel + ' — ' + shotResult.message
        });
      }

      this.updateRivalTaunt(outcome === 'hit' ? 'hit' : outcome === 'sunk' ? 'sink' : 'miss');

      var actor = shooterIdx === 0 ? T.ui.you : this.matchState.players[1].captain;
      var logLine = T.ui.shotLogLine(actor, shotResult.coordLabel, shotResult.message);
      this.appendLogBookEntry(logLine);
      this.announce(logLine);

      this.updateTopHudStatus();
      this.renderGameplayTab();
      this.renderFleetTab();

      if (this.matchState.gameOver) {
        var cerDelay = Math.max(120, Math.round(650 / Math.max(0.5, this.animSpeed)));
        this.ceremonyTimeout = setTimeout(function() {
          self.ceremonyTimeout = null;
          self.launchCeremonyPhase();
        }, cerDelay);
        return;
      }

      this.startTurnTimer();
      if (this.matchState.turn === 1) {
        this.triggerCpuTurn();
      }
    },

    createEnemyGhostShip: function(shipId, sunkCells) {
      if (!this.webglAvailable || !this.platesSystem || !this.scene || !sunkCells || sunkCells.length === 0) return;
      var alreadyExists = this.enemyGhostShipMeshes.some(function(g) {
        return g.userData && g.userData.shipId === shipId;
      });
      if (alreadyExists) return;

      var sorted = sunkCells.slice().sort(function(a, b) {
        return a.r !== b.r ? a.r - b.r : a.c - b.c;
      });
      var r0 = sorted[0].r;
      var c0 = sorted[0].c;
      var rLast = sorted[sorted.length - 1].r;
      var cLast = sorted[sorted.length - 1].c;
      var horizontal = r0 === rLast;

      var crew = GLT.rules.CREWS_MAP[this.matchConfig.enemyCrewId] || GLT.rules.CREWS_MAP.marines;
      var ghostMesh = GLT.shipsVoxel.createGhostShipMesh(shipId, {
        cellSize: 2.0,
        ownerColor: parseInt(crew.colors.primary.replace('#', '0x'), 16),
        crewId: this.matchConfig.enemyCrewId,
        length: sorted.length,
        horizontal: horizontal
      });
      var plates = this.getMyPlatesIndices();

      var pStart = this.platesSystem.seaPlates.cellToWorld(plates.oppPlate, r0, c0);
      var pEnd = this.platesSystem.seaPlates.cellToWorld(plates.oppPlate, rLast, cLast);

      ghostMesh.position.set((pStart.x + pEnd.x) * 0.5, 0.15, (pStart.z + pEnd.z) * 0.5);
      ghostMesh.userData.basePosY = 0.15;
      ghostMesh.userData.shipId = shipId;
      if (!horizontal) {
        ghostMesh.rotation.y = Math.PI * 0.5;
      }

      this.scene.add(ghostMesh);
      this.enemyGhostShipMeshes.push(ghostMesh);
    },

    triggerCpuTurn: function() {
      var self = this;
      if (this.isPvpMode || this.gamePhase !== 'BATTLE' || !this.matchState || this.matchState.gameOver || this.matchState.turn !== 1) {
        return;
      }

      if (this.cpuTurnTimeout) {
        clearTimeout(this.cpuTurnTimeout);
        this.cpuTurnTimeout = null;
      }

      this.isCpuThinking = true;
      this.updateTopHudStatus();
      this.renderGameplayTab();

      var stepKey = 'cpu_' + this.matchState.turnNumber + '_' + this.matchState.history.length;
      var turnRng = this.matchRng ? this.matchRng.fork(stepKey) : GLT.rng.createRng(stepKey);
      var delayMs = Math.max(60, Math.round((420 + turnRng.next() * 580) / Math.max(0.5, this.animSpeed)));

      this.cpuTurnTimeout = setTimeout(function() {
        self.cpuTurnTimeout = null;
        if (self.isPvpMode || self.gamePhase !== 'BATTLE' || !self.matchState || self.matchState.gameOver || self.matchState.turn !== 1) {
          self.isCpuThinking = false;
          return;
        }

        var p0 = self.matchState.players[0];
        var p1 = self.matchState.players[1];
        var viewState = {
          boardSize: self.matchState.boardSize,
          mode: self.matchState.mode,
          shotsTaken: p0.shotsTaken,
          remainingShipLengths: p0.fleet.filter(function(s) { return !s.isSunk; }).map(function(s) { return s.length; }),
          techniqueAvailable: self.matchState.mode === 'tatico' && !p1.techniqueUsed,
          revealedCells: self.cpuRevealedCells
        };

        var action = self.aiPlayer ? self.aiPlayer.chooseAction(viewState, turnRng) : null;
        self.isCpuThinking = false;

        if (action && action.type === 'technique' && self.matchState.mode === 'tatico' && !p1.techniqueUsed) {
          self.executeCpuTechnique(action);
          return;
        }

        var targetR = (action && typeof action.r === 'number') ? action.r : (action && action.target ? action.target.r : 0);
        var targetC = (action && typeof action.c === 'number') ? action.c : (action && action.target ? action.target.c : 0);

        // Guaranteed untried fallback so CPU can never freeze on already_shot
        if (p0.shotsTaken[targetR + ',' + targetC]) {
          var foundFallback = false;
          for (var fr = 0; fr < self.matchState.boardSize && !foundFallback; fr++) {
            for (var fc = 0; fc < self.matchState.boardSize && !foundFallback; fc++) {
              if (!p0.shotsTaken[fr + ',' + fc]) {
                targetR = fr;
                targetC = fc;
                foundFallback = true;
              }
            }
          }
        }

        var target = { r: targetR, c: targetC };
        var shotResult = GLT.rules.resolveShot(self.matchState, 1, target);
        if (!shotResult.valid) return;

        self.shotInFlight = true;
        if (self.audio) self.audio.playCannon();

        var endPos = null;
        if (self.platesSystem && self.fx) {
          var startPos = self.platesSystem.seaPlates.cellToWorld(1, 3, 2);
          endPos = self.platesSystem.seaPlates.cellToWorld(0, target.r, target.c);
          self.fx.fireCannonball(startPos, endPos, shotResult.outcome);
        }

        var flightMs = Math.max(25, Math.round(560 / Math.max(0.5, self.animSpeed)));
        self.shotFlightTimeout = setTimeout(function() {
          self.shotFlightTimeout = null;
          self.shotInFlight = false;
          self.applyShotOutcome(1, shotResult, endPos);
        }, flightMs);
      }, delayMs);
    },

    executeCpuTechnique: function(action) {
      var self = this;
      var techResult = GLT.rules.resolveTechnique(this.matchState, 1, action.params || {});
      if (!techResult.valid) {
        // Fallback to normal shot if AI picked invalid technique params
        this.matchState.players[1].techniqueUsed = true;
        this.triggerCpuTurn();
        return;
      }

      this.applyTechniqueOutcome(1, techResult);
      this.appendLogBookEntry(this.matchState.players[1].captain + ': ' + techResult.message);
      this.announce(techResult.message);

      this.updateTopHudStatus();
      this.renderGameplayTab();
      this.renderFleetTab();

      if (this.matchState.gameOver) {
        var cerDelay = Math.max(120, Math.round(650 / Math.max(0.5, this.animSpeed)));
        this.ceremonyTimeout = setTimeout(function() {
          self.ceremonyTimeout = null;
          self.launchCeremonyPhase();
        }, cerDelay);
      } else {
        this.startTurnTimer();
        if (this.matchState.turn === 1) {
          this.triggerCpuTurn();
        }
      }
    },

    activateCrewTechnique: function() {
      return this.triggerSpecialTechnique();
    },

    triggerSpecialTechnique: function() {
      var self = this;
      var T = getT();

      if (this.gamePhase !== 'BATTLE') return;

      // Online PvP Technique Branch
      if (this.isPvpMode && this.pvpClient) {
        var pState = this.pvpClient.state;
        var myIdx = this.pvpClient.playerIndex;
        if (pState.matchConfig.mode !== 'tatico') {
          this.announce(T.errors.techniqueInClassicMode);
          return;
        }
        if (!this.isMyPvpTurn()) {
          this.announce(T.errors.notYourTurn);
          return;
        }
        if (pState.players[myIdx].techniqueUsed) {
          this.announce(T.errors.techniqueAlreadyUsed);
          return;
        }
        if (pState.pendingShot || pState.pendingTech) {
          this.announce(T.errors.techniqueBusy);
          return;
        }
        // The crew the fleet was committed with, not whatever the Combate tab shows now.
        var committedCrewId = (pState.players[myIdx] && pState.players[myIdx].crewId) || this.matchConfig.crewId;
        var myCrew = GLT.rules.CREWS_MAP[committedCrewId] || GLT.rules.CREWS_MAP.straw_hats;
        var pvpTechId = myCrew.technique;
        var sendTech = function(params) {
          try {
            self.pvpClient.useTechnique(pvpTechId, params);
          } catch (err) {
            self.announce((err && err.message) || T.errors.notYourTurn);
          }
          self.renderGameplayTab();
        };

        if (pvpTechId === 'room') {
          this.showRoomSelectorModal(function(axis, index) {
            sendTech({ axis: axis, index: index });
          });
          return;
        }
        if (pvpTechId === 'vortice' || pvpTechId === 'observacao') {
          sendTech({ seed: pState.matchConfig.seed + '_' + pState.turnNumber });
          return;
        }
        if (!this.selectedAimCell) {
          this.announce(T.errors.techniqueNeedsTarget);
          return;
        }
        sendTech({ r: this.selectedAimCell.r, c: this.selectedAimCell.c });
        return;
      }

      // Offline PvC Technique Branch
      if (!this.matchState || this.matchState.gameOver) return;
      if (this.matchState.mode !== 'tatico') {
        this.announce(T.errors.techniqueInClassicMode);
        return;
      }
      if (this.matchState.turn !== 0 || this.isCpuThinking || this.shotInFlight) {
        this.announce(T.errors.notYourTurn);
        return;
      }
      if (this.matchState.players[0].techniqueUsed) {
        this.announce(T.errors.techniqueAlreadyUsed);
        return;
      }

      var techId = this.matchState.players[0].technique;

      if (techId === 'room') {
        this.showRoomSelectorModal(function(axis, index) {
          self.executePlayerTechnique({ axis: axis, index: index });
        });
        return;
      }

      if (techId === 'vortice' || techId === 'observacao') {
        this.executePlayerTechnique({});
        return;
      }

      // Spatial techniques (bazooka, tremor, haki_do_rei): execute at the selected cell.
      // The technique is single-use: never spend it on a cell the player did not pick.
      if (!this.selectedAimCell) {
        this.announce(T.errors.techniqueNeedsTarget);
        return;
      }
      this.executePlayerTechnique({ r: this.selectedAimCell.r, c: this.selectedAimCell.c });
    },

    executePlayerTechnique: function(arg1, arg2) {
      var self = this;
      var params = (typeof arg1 === 'number')
        ? { r: arg1, c: typeof arg2 === 'number' ? arg2 : 0 }
        : (arg1 || {});

      if (!this.matchState || this.gamePhase !== 'BATTLE') return;

      this.isUsingTechnique = false;
      var techResult = GLT.rules.resolveTechnique(this.matchState, 0, params);
      if (!techResult.valid) {
        this.announce(techResult.message);
        return;
      }

      this.applyTechniqueOutcome(0, techResult);

      var T = getT();
      this.appendLogBookEntry(T.ui.techniqueActivated(techResult.message));
      this.announce(techResult.message);

      this.updateTopHudStatus();
      this.renderGameplayTab();
      this.renderFleetTab();

      if (this.matchState.gameOver) {
        var cerDelay = Math.max(120, Math.round(650 / Math.max(0.5, this.animSpeed)));
        this.ceremonyTimeout = setTimeout(function() {
          self.ceremonyTimeout = null;
          self.launchCeremonyPhase();
        }, cerDelay);
      } else {
        this.startTurnTimer();
        if (this.matchState.turn === 1) {
          this.triggerCpuTurn();
        }
      }
    },

    applyTechniqueOutcome: function(shooterIdx, techResult) {
      var self = this;
      var defenderIdx = 1 - shooterIdx;

      // Show animated visual technique banner if asset exists
      this.showTechniqueBanner(techResult.type);

      // 3D technique FX first: the Bazooka balls / Tremor quake then carry the cell impacts below to their moment
      this.playTechniqueFxVisuals(shooterIdx, techResult);

      // 1. Multi-cell offensive techniques (Bazooka 2x2, Tremor 5-cell cross)
      if (Array.isArray(techResult.results) && techResult.results.length > 0) {
        techResult.results.forEach(function(cellRes, idx) {
          self.applyCellImpactVisual(defenderIdx, cellRes, idx === 0);
        });
      }

      // 2. Marines Observação: mark revealed cell on 3D seaPlate + 2D radar
      if (techResult.type === 'observacao' && techResult.revealedCell) {
        var rev = techResult.revealedCell;
        var plates = this.getMyPlatesIndices();
        if (shooterIdx === 0) {
          this.playerRevealedCells.push({ r: rev.r, c: rev.c });
          if (this.platesSystem) {
            this.platesSystem.seaPlates.addShotMarker(plates.oppPlate, rev.r, rev.c, 'revealed');
            this.platesSystem.seaPlates.setSelection(plates.oppPlate, rev.r, rev.c);
          }
          this.selectedAimCell = { r: rev.r, c: rev.c };
        } else {
          this.cpuRevealedCells.push({ r: rev.r, c: rev.c });
        }
      }

      this.syncFogMarkers3d();
    },

    showTechniqueBanner: function(techId) {
      if (!GLT.assets || !GLT.assets.techniques) return;
      var tech = GLT.assets.techniques[techId];
      if (!tech || !tech.image) return;
      var existing = document.getElementById('glt-technique-banner');
      if (existing) existing.remove();

      var jpTitles = {
        bazooka: 'ゴムゴムの 暴風雨!!',
        tremor: 'グラグラの 実・激震!!',
        haki_do_rei: '覇王色の覇気・威圧!!',
        room: '死の外科医・ROOM!!',
        vortice: '闇穴道・BLACK HOLE!!',
        observacao: '見聞色・絶対的正義!!'
      };
      var jpText = jpTitles[techId] || '必殺技発動!!';

      var banner = document.createElement('div');
      banner.id = 'glt-technique-banner';
      banner.className = 'glt-technique-banner';
      banner.innerHTML =
        '<img class="tech-banner-img" src="' + tech.image + '" alt="' + tech.name + '">' +
        '<div class="tech-banner-text">' +
          '<span class="tech-banner-tag">⚔️ TÉCNICA SUPREMA ATIVADA</span>' +
          '<div class="tech-banner-jp">' + jpText + '</div>' +
          '<strong class="tech-banner-title">' + tech.name + '</strong>' +
        '</div>';

      var viewport = document.getElementById('glt-viewport-container');
      if (viewport) {
        viewport.appendChild(banner);
        setTimeout(function() {
          if (banner.parentNode) banner.parentNode.removeChild(banner);
        }, 2500);
      }
    },

    playTechniqueFxVisuals: function(shooterIdx, techResult) {
      if (this.platesSystem && this.platesSystem.triggerScreenShake) {
        this.platesSystem.triggerScreenShake(1.15, 0.65);
      }
      if (!this.webglAvailable || !this.platesSystem || !this.fx || typeof THREE === 'undefined') {
        if (this.audio) {
          if (typeof this.audio.playTechnique === 'function') this.audio.playTechnique(techResult.type);
          else if (typeof this.audio.playUiClick === 'function') this.audio.playUiClick();
        }
        return;
      }
      // GLT.backdropFx.createFxSystem (src/sea/fx-bridge.js): shapes + particles for the six crews, timed to the impacts
      this.fx.playTechnique(techResult.type, {
        shooterIdx: shooterIdx,
        defenderIdx: 1 - shooterIdx,
        cells: techResult.cellsAffected || [],
        axis: techResult.axis,
        index: techResult.index,
        sonarDetected: !!techResult.sonarDetected,
        revealedCell: techResult.revealedCell || null
      });

      if (this.audio) {
        if (typeof this.audio.playTechnique === 'function') {
          this.audio.playTechnique(techResult.type);
        } else if (typeof this.audio.playUiClick === 'function') {
          this.audio.playUiClick();
        }
      }
    },

    useLogPoseHint: function() {
      var T = getT();
      if (this.isPvpMode || this.gamePhase !== 'BATTLE' || !this.matchState) return;
      if (this.hintsRemaining <= 0) {
        this.announce(T.ui.techniqueUsedBadge);
        return;
      }

      this.hintsRemaining--;
      var boardSize = this.matchState.boardSize;
      var defender = this.matchState.players[1];
      var remainingLengths = defender.fleet.filter(function(s) { return !s.isSunk; }).map(function(s) { return s.length; });

      var hint = GLT.ai.getLogPoseHint(boardSize, defender.shotsTaken, remainingLengths, {
        allowTouch: this.matchConfig.allowTouch
      });

      if (this.platesSystem && this.backdrop) {
        var worldTarget = this.platesSystem.seaPlates.cellToWorld(1, hint.r, hint.c);
        this.backdrop.setLogPoseTarget(worldTarget);
      }

      var hintMsg = T.ui.hintResult(hint.directionLabel, hint.sectorLabel);
      this.appendLogBookEntry(hintMsg);
      this.announce(hintMsg);
      this.selectAimCoordinate(hint.r, hint.c);
    },

    showRoomSelectorModal: function(onConfirm) {
      var self = this;
      var T = getT();
      var boardSize = this.getActiveBoardSize();

      var content = document.createElement('div');
      content.className = 'glt-room-selector';

      var desc = document.createElement('p');
      desc.textContent = T.ui.roomSelectDesc;
      content.appendChild(desc);

      var axisRow = document.createElement('div');
      axisRow.className = 'glt-form-group';
      var axisLabel = document.createElement('label');
      axisLabel.htmlFor = 'room-axis-select';
      axisLabel.textContent = T.ui.axisLabel;
      var axisSelect = document.createElement('select');
      axisSelect.id = 'room-axis-select';
      axisSelect.innerHTML = '<option value="row">' + T.ui.roomRow + '</option><option value="col">' + T.ui.roomCol + '</option>';
      axisRow.appendChild(axisLabel);
      axisRow.appendChild(axisSelect);
      content.appendChild(axisRow);

      var indexRow = document.createElement('div');
      indexRow.className = 'glt-form-group';
      var idxLabel = document.createElement('label');
      idxLabel.htmlFor = 'room-idx-select';
      idxLabel.textContent = T.ui.coordLabel;
      var idxSelect = document.createElement('select');
      idxSelect.id = 'room-idx-select';

      function updateIndices() {
        var isRow = axisSelect.value === 'row';
        idxSelect.innerHTML = '';
        for (var i = 0; i < boardSize; i++) {
          var opt = document.createElement('option');
          opt.value = i;
          opt.textContent = isRow
            ? T.ui.rowPrefix + String.fromCharCode(65 + i)
            : T.ui.colPrefix + (i + 1);
          idxSelect.appendChild(opt);
        }
      }

      axisSelect.addEventListener('change', updateIndices);
      updateIndices();

      indexRow.appendChild(idxLabel);
      indexRow.appendChild(idxSelect);
      content.appendChild(indexRow);

      var confirmBtn = document.createElement('button');
      confirmBtn.type = 'button';
      confirmBtn.className = 'glt-btn btn-primary';
      confirmBtn.style.marginTop = '10px';
      confirmBtn.textContent = T.ui.roomExecute;
      confirmBtn.addEventListener('click', function() {
        var ax = axisSelect.value;
        var ix = parseInt(idxSelect.value, 10);
        self.hideModal();
        if (onConfirm) onConfirm(ax, ix);
      });
      content.appendChild(confirmBtn);

      this.showModal(T.ui.roomSelectTitle, content);
    },

    /**
     * =========================================================================
     * PHASE 3: CEREMONY, WANTED POSTER COUNT-UP & SERIES RETENTION
     * =========================================================================
     */
    launchCeremonyPhase: function() {
      var self = this;
      var T = getT();
      var i18n = getI18n();

      this.clearTurnTimers();
      this.gamePhase = 'CEREMONY';

      var winnerIdx = 0;
      var isPlayerWinner = true;
      var winnerCaptain = '';
      var winnerCrewName = '';
      var winnerCrewId = 'straw_hats';
      var pStats = { shots: 0, hits: 0, longestStreak: 0 };
      var totalTurns = 1;

      if (this.isPvpMode && this.pvpClient && this.pvpClient.state) {
        var pSt = this.pvpClient.state;
        winnerIdx = pSt.winner !== null ? pSt.winner : 0;
        var myIdx = this.pvpClient.role === 'player' ? this.pvpClient.playerIndex : 0;
        isPlayerWinner = winnerIdx === myIdx;
        var wPlayer = pSt.players[winnerIdx] || pSt.players[0];
        var wCrewObj = GLT.rules.CREWS_MAP[wPlayer.crewId] || GLT.rules.CREWS_MAP.straw_hats;
        winnerCaptain = wPlayer.nickname || wCrewObj.captain;
        winnerCrewName = wCrewObj.name;
        winnerCrewId = wCrewObj.id;

        var myShotValues = Object.keys(pSt.boards[myIdx].shots).map(function(k) { return pSt.boards[myIdx].shots[k]; });
        var hitsCount = myShotValues.filter(function(s) { return s.outcome === 'hit' || s.outcome === 'sunk'; }).length;
        // Longest run of consecutive hits among my own shots, in the order they were answered.
        var streak = 0;
        var bestStreak = 0;
        (pSt.shotHistory || []).forEach(function(h) {
          if (h.shooterIndex !== myIdx) return;
          streak = (h.outcome === 'hit' || h.outcome === 'sunk') ? streak + 1 : 0;
          if (streak > bestStreak) bestStreak = streak;
        });
        pStats = { shots: myShotValues.length, hits: hitsCount, longestStreak: bestStreak };
        totalTurns = pSt.turnNumber;
      } else if (this.matchState) {
        winnerIdx = this.matchState.winner !== null ? this.matchState.winner : 0;
        isPlayerWinner = winnerIdx === 0;
        var wCrew = this.matchState.players[winnerIdx];
        winnerCaptain = wCrew.captain;
        winnerCrewName = wCrew.crewName;
        winnerCrewId = wCrew.crewId;
        pStats = this.matchState.players[0].stats;
        totalTurns = this.matchState.turnNumber;

        this.seriesWins = this.matchState.seriesWins.slice();
        if (this.aiPlayer && typeof this.aiPlayer.recordOpponentPlacement === 'function') {
          this.aiPlayer.recordOpponentPlacement(this.placedPlayerFleet);
        }
      }

      // the winner hoists its Jolly Roger on its plate; fireworks (src/fx) celebrate a local victory
      if (this.backdrop) {
        this.backdrop.setDollsHouseLiftEnabled(false);
        this.backdrop.setCeremonyActive(true, { winnerPlate: winnerIdx, crewId: winnerCrewId, fireworks: isPlayerWinner });
      }
      this.setCameraPreset('cerimonia');

      if (isPlayerWinner) {
        if (this.audio) this.audio.playVictoryFanfare();
      } else if (this.audio) {
        this.audio.playDefeatDirge();
      }

      var finalBounty = GLT.rules.calculateBounty(pStats, {
        difficulty: this.matchConfig.difficulty,
        mode: this.matchConfig.mode,
        boardId: this.matchConfig.boardId,
        sea: this.matchConfig.sea
      });

      this.persistMatchRecord(isPlayerWinner, finalBounty);
      if (this.dom.bountyBadge) {
        this.dom.bountyBadge.textContent = i18n.formatBounty(finalBounty);
      }

      var ceremonyBox = document.createElement('div');
      ceremonyBox.className = 'glt-ceremony-box';

      var heading = document.createElement('h3');
      heading.className = 'glt-ceremony-title';
      heading.textContent = T.stats.congratulationsWinner(winnerCaptain);
      ceremonyBox.appendChild(heading);

      // White flag forfeit subtitle if game was abandoned
      var isForfeit = false;
      var forfeitSubtitleText = '';
      if (this.isPvpMode && this.pvpClient && this.pvpClient.state) {
        if (this.pvpClient.state.gameOverReason === 'manual_forfeit') {
          isForfeit = true;
          var myPlayerIdx = this.pvpClient.role === 'player' ? this.pvpClient.playerIndex : 0;
          var oppPlayerIdx = myPlayerIdx === 0 ? 1 : 0;
          var oppObj = this.pvpClient.state.players[oppPlayerIdx] || {};
          var oppName = oppObj.nickname || T.ui.defaultCaptainName;
          if (this.pvpClient.state.forfeitedBy === myPlayerIdx) {
            forfeitSubtitleText = T.forfeit.ceremonyPlayerForfeit;
          } else {
            forfeitSubtitleText = T.forfeit.ceremonyEnemyForfeit(oppName);
          }
        }
      } else if (this.matchState && this.matchState.gameOverReason === 'manual_forfeit') {
        isForfeit = true;
        var enemyCaptainName = this.matchState.players[1] ? this.matchState.players[1].captain : T.ui.defaultCaptainName;
        if (this.matchState.forfeitedBy === 0) {
          forfeitSubtitleText = T.forfeit.ceremonyPlayerForfeit;
        } else {
          forfeitSubtitleText = T.forfeit.ceremonyEnemyForfeit(enemyCaptainName);
        }
      }

      if (isForfeit && forfeitSubtitleText) {
        var forfeitSub = document.createElement('p');
        forfeitSub.className = 'glt-ceremony-forfeit-subtitle';
        forfeitSub.textContent = forfeitSubtitleText;
        ceremonyBox.appendChild(forfeitSub);
      }


      // Series banner if MD3/MD5
      var maxWinsNeeded = Math.ceil(this.matchConfig.seriesLength / 2);
      var p0Wins = this.seriesWins[0] || 0;
      var p1Wins = this.seriesWins[1] || 0;
      if (!this.isPvpMode && this.matchConfig.seriesLength > 1) {
        var seriesBanner = document.createElement('div');
        seriesBanner.className = 'glt-badge badge-series';
        if (p0Wins >= maxWinsNeeded || p1Wins >= maxWinsNeeded) {
          var champName = p0Wins >= maxWinsNeeded ? T.ui.you : winnerCaptain;
          seriesBanner.textContent = T.ui.seriesChampionBanner(champName, p0Wins, p1Wins);
        } else {
          seriesBanner.textContent = T.ui.seriesScore(p0Wins, p1Wins, this.matchConfig.seriesLength);
        }
        ceremonyBox.appendChild(seriesBanner);
      }

      // PvP Cryptographic SHA-256 Verification Badge
      if (this.isPvpMode && this.pvpClient && this.pvpClient.state) {
        var integBadge = document.createElement('div');
        integBadge.id = 'pvp-ceremony-integrity';
        integBadge.className = 'glt-badge badge-mode';
        var integ = this.pvpClient.state.integrity;
        integBadge.textContent = this.pvpIntegrityText(integ);
        ceremonyBox.appendChild(integBadge);
      }

      // Mount canvas directly for zero-lag 60fps bounty count-up
      var poster = GLT.backdropFx.generateWantedPoster({
        name: winnerCaptain.toUpperCase(),
        crewName: winnerCrewName,
        crewId: winnerCrewId
      }, finalBounty);

      poster.canvas.className = 'glt-wanted-poster-canvas glt-wanted-poster-img';
      poster.canvas.setAttribute('role', 'img');
      poster.canvas.setAttribute('aria-label', T.stats.wantedPosterHeading + ' — ' + winnerCaptain);
      ceremonyBox.appendChild(poster.canvas);

      if (poster.drawBountyOnly && this.animSpeed < 3.5) {
        var animStart = performance.now();
        var animDur = 900;
        var tickBounty = function(nowT) {
          var prog = Math.min(1, (nowT - animStart) / animDur);
          var eased = 1 - Math.pow(1 - prog, 3);
          poster.drawBountyOnly(Math.round(finalBounty * eased));
          if (prog < 1 && self.gamePhase === 'CEREMONY') {
            self.bountyAnimRaf = requestAnimationFrame(tickBounty);
          }
        };
        this.bountyAnimRaf = requestAnimationFrame(tickBounty);
      }

      var statsList = document.createElement('div');
      statsList.className = 'glt-stats-grid';
      var acc = pStats.shots > 0 ? Math.round((pStats.hits / pStats.shots) * 100) : 0;

      [
        { label: T.stats.shotsFired, val: pStats.shots },
        { label: T.stats.directHits, val: pStats.hits },
        { label: T.stats.accuracyPercentage, val: acc + '%' },
        { label: T.stats.longestStreak, val: pStats.longestStreak },
        { label: T.stats.turnsTaken, val: totalTurns },
        { label: T.stats.finalBounty, val: i18n.formatBounty(finalBounty) }
      ].forEach(function(item) {
        var row = document.createElement('div');
        row.className = 'stat-item';
        row.innerHTML = '<span class="stat-label">' + item.label + '</span><strong class="stat-val">' + item.val + '</strong>';
        statsList.appendChild(row);
      });
      ceremonyBox.appendChild(statsList);

      // Legendary Blessing Reward Draw on Victory
      if (isPlayerWinner && GLT.assets && GLT.assets.blessings && GLT.assets.blessings.length > 0) {
        var blessingsList = GLT.assets.blessings;
        var bIdx = (this.matchState ? (this.matchState.history.length + pStats.hits) : 0) % blessingsList.length;
        var wonBlessing = blessingsList[bIdx];

        try {
          var unlocked = JSON.parse(localStorage.getItem('glt_unlocked_blessings') || '[]');
          if (unlocked.indexOf(wonBlessing.id) === -1) {
            unlocked.push(wonBlessing.id);
            localStorage.setItem('glt_unlocked_blessings', JSON.stringify(unlocked));
          }
        } catch (e) {}

        var blessingReward = document.createElement('div');
        blessingReward.className = 'glt-blessing-reward-box';
        blessingReward.innerHTML =
          '<h4 class="glt-blessing-reward-title">' + (T.ui.blessingRewardTitle || '🎁 Bênção Lendária Concedida!') + '</h4>' +
          '<div class="glt-blessing-card-preview" role="button" tabindex="0" aria-label="Inspecionar ' + wonBlessing.name + '">' +
            '<img class="blessing-card-art" src="' + wonBlessing.image + '" alt="' + wonBlessing.name + '">' +
            '<div class="blessing-card-info">' +
              '<div class="blessing-type-badge">' + wonBlessing.badge + '</div>' +
              '<strong class="blessing-name">' + wonBlessing.name + '</strong>' +
              '<p class="blessing-desc">' + wonBlessing.desc + '</p>' +
            '</div>' +
          '</div>';

        var rewardCard = blessingReward.querySelector('.glt-blessing-card-preview');
        rewardCard.addEventListener('click', function() {
          self.openBlessingInspectorModal(wonBlessing.id);
        });
        rewardCard.addEventListener('keydown', function(ev) {
          if (ev.key === 'Enter' || ev.key === ' ') {
            ev.preventDefault();
            self.openBlessingInspectorModal(wonBlessing.id);
          }
        });

        ceremonyBox.appendChild(blessingReward);
      }

      var actions = document.createElement('div');
      actions.className = 'glt-ceremony-actions';

      var hasMoreSeriesGames = !this.isPvpMode && this.matchConfig.seriesLength > 1 && p0Wins < maxWinsNeeded && p1Wins < maxWinsNeeded;

      if (hasMoreSeriesGames) {
        var nextSeriesBtn = document.createElement('button');
        nextSeriesBtn.type = 'button';
        nextSeriesBtn.id = 'btn-next-series';
        nextSeriesBtn.className = 'glt-btn btn-primary';
        nextSeriesBtn.textContent = T.ui.nextGameButton;
        nextSeriesBtn.addEventListener('click', function() {
          self.hideModal();
          if (self.backdrop) {
            self.backdrop.setCeremonyActive(false);
            self.backdrop.setDollsHouseLiftEnabled(self.liftScenery);
          }
          self.currentSeriesGame++;
          self.autoPlacePlayerFleet('spread');
          self.startMatchWithCoinToss(true);
        });
        actions.appendChild(nextSeriesBtn);
      }

      var rematchBtn = document.createElement('button');
      rematchBtn.type = 'button';
      rematchBtn.className = 'glt-btn ' + (hasMoreSeriesGames ? 'btn-secondary' : 'btn-primary');
      var pvpMyRematch = this.isPvpMode && this.pvpClient && this.pvpClient.state && this.pvpClient.state.rematchRequested
        ? this.pvpClient.state.rematchRequested[this.pvpClient.playerIndex]
        : false;

      rematchBtn.textContent = this.isPvpMode
        ? (pvpMyRematch ? '⏳ Aguardando Rival...' : T.ui.pvpRematchButton)
        : T.ui.rematchButton;
      rematchBtn.disabled = !!pvpMyRematch;

      rematchBtn.addEventListener('click', function() {
        if (self.isPvpMode && self.pvpClient) {
          self.pvpClient.requestRematch();
          rematchBtn.textContent = '⏳ Aguardando Rival...';
          rematchBtn.disabled = true;
          self.hideModal();
          if (self.backdrop) self.backdrop.setCeremonyActive(false);
          self.switchTab('tab-pvp');
        } else {
          self.returnToSetupPhase();
        }
      });
      actions.appendChild(rematchBtn);

      var skipCeremonyBtn = document.createElement('button');
      skipCeremonyBtn.type = 'button';
      skipCeremonyBtn.className = 'glt-btn btn-sm';
      skipCeremonyBtn.textContent = T.ui.skipCeremony;
      skipCeremonyBtn.addEventListener('click', function() {
        self.skipCeremony();
      });
      actions.appendChild(skipCeremonyBtn);

      ceremonyBox.appendChild(actions);

      if (!this.isPvpMode && this.matchConfig.seriesLength > 1) {
        var autoNextRow = document.createElement('div');
        autoNextRow.className = 'glt-checkbox-row';
        var autoNextCb = document.createElement('input');
        autoNextCb.type = 'checkbox';
        autoNextCb.id = 'ceremony-auto-next';
        autoNextCb.checked = this.autoNextGame;
        autoNextCb.addEventListener('change', function() {
          self.autoNextGame = autoNextCb.checked;
        });
        var autoNextLbl = document.createElement('label');
        autoNextLbl.htmlFor = 'ceremony-auto-next';
        autoNextLbl.textContent = T.ui.autoNextGame;
        autoNextRow.appendChild(autoNextCb);
        autoNextRow.appendChild(autoNextLbl);
        ceremonyBox.appendChild(autoNextRow);

        if (this.autoNextGame && hasMoreSeriesGames) {
          this.ceremonyTimeout = setTimeout(function() {
            if (self.gamePhase === 'CEREMONY') {
              nextSeriesBtn.click();
            }
          }, 3500);
        }
      }

      this.updateTopHudStatus();
      this.showModal(T.stats.wantedPosterHeading, ceremonyBox, 'modal-ceremony');
      // ceremony beat: the camera reaches the winner's plate, the flag goes up and the first shells burst before the
      // poster fades in (the modal is already in the DOM and focusable; Esc / Pular Cerimônia work at once)
      var introS = this.webglAvailable && !this.prefersReducedMotion() ? 2.0 / Math.max(0.5, this.animSpeed) : 0;
      if (introS > 0.2 && this.dom.modalOverlay) {
        this.dom.modalOverlay.classList.add('glt-ceremony-intro');
        this.dom.modalOverlay.style.setProperty('--glt-ceremony-delay', introS.toFixed(2) + 's');
      }
      this.announce(T.stats.congratulationsWinner(winnerCaptain) + '. ' + T.stats.finalBounty + ': ' + i18n.formatBounty(finalBounty));
    },

    skipCeremony: function() {
      this.clearTurnTimers();
      this.hideModal();
      if (this.backdrop) {
        this.backdrop.setCeremonyActive(false);
        this.backdrop.setDollsHouseLiftEnabled(this.liftScenery);
      }
      var maxWinsNeeded = Math.ceil(this.matchConfig.seriesLength / 2);
      var p0Wins = this.seriesWins[0] || 0;
      var p1Wins = this.seriesWins[1] || 0;
      if (!this.isPvpMode && this.matchConfig.seriesLength > 1 && p0Wins < maxWinsNeeded && p1Wins < maxWinsNeeded) {
        this.currentSeriesGame++;
        this.autoPlacePlayerFleet('spread');
        this.startMatchWithCoinToss(true);
        return;
      }
      this.returnToSetupPhase();
    },

    persistMatchRecord: function(won, bounty) {
      try {
        var key = 'GLT_MATCH_HISTORY';
        var history = JSON.parse(localStorage.getItem(key) || '[]');
        history.push({
          date: new Date().toISOString(),
          crew: this.matchConfig.crewId,
          rival: this.matchConfig.enemyCrewId,
          won: won,
          bounty: bounty
        });
        localStorage.setItem(key, JSON.stringify(history.slice(-20)));

        if (GLT.protocol && GLT.protocol.submitBounty && this.pvpLobbyTransport) {
          GLT.protocol.submitBounty(this.pvpLobbyTransport, {
            nickname: this.pvpNickname,
            crewId: this.matchConfig.crewId,
            bounty: bounty,
            wins: won ? 1 : 0
          });
        }
      } catch (_) {}
    },

    /**
     * =========================================================================
     * ONLINE PVP LOBBY & CROSS-TAB COMMIT-REVEAL PROTOCOL
     * =========================================================================
     */
    initPvpLobby: function() {
      var self = this;
      if (!GLT.protocol || !GLT.transport || !GLT.transport.detectTransportBackend) {
        this.pvpStatus = 'unavailable';
        this.pvpReady = Promise.resolve(null);
        return;
      }

      // Backend is chosen automatically: LAN relay > published Artifact (claude.use("db")) >
      // BroadcastChannel between tabs. In a published Artifact the db namespace arrives later
      // through a promise, so the lobby renders "conectando" first and lights up when it resolves.
      this.pvpStatus = 'connecting';
      this.pvpReady = GLT.transport.detectTransportBackend().then(function(backend) {
        self.pvpBackend = backend;
        if (!backend || backend.kind === 'none') {
          self.pvpStatus = 'unavailable';
          self.pvpUnavailableReason = (backend && backend.reason) || 'no_transport';
        } else {
          if (backend.caps && backend.caps.userId) self.pvpPlayerId = backend.caps.userId;
          self.attachPvpLobbyTransport(GLT.transport.createTransportFor(backend, self.pvpTransportOptions()));
        }
        if (!self.pvpRoomId && self.dom && self.dom.tabPvp) self.renderPvpTab();
        return backend;
      }).catch(function() {
        self.pvpStatus = 'unavailable';
        self.pvpUnavailableReason = 'no_transport';
        return null;
      });
    },

    pvpTransportOptions: function() {
      var self = this;
      return {
        onStatus: function(kind, detail) {
          var T = getT();
          if (kind === 'error') {
            var backendKind = self.pvpBackend ? self.pvpBackend.kind : '';
            self.announce(backendKind === 'peer'
              ? T.lobby.peerConnectionFailed
              : (backendKind !== 'artifactDb' ? T.lobby.lanWriteFailed : T.lobby.onlineWriteFailed));
          } else if (kind === 'reconnecting' && detail && detail.key === self.pvpRoomId) {
            self.announce(T.lobby.peerReconnecting);
          } else if (kind === 'seat_taken' && detail && detail.key === self.pvpRoomId) {
            self.announce(T.lobby.seatTakenToast(detail.key));
            self.leavePvpRoom();
          }
        }
      };
    },

    pvpIntegrityText: function(integ) {
      var T = getT();
      if (!integ) return T.lobby.integrityVerifiedBadge;
      if (integ.valid === null) return T.lobby.integrityAbsenceBadge;
      return integ.valid ? T.lobby.integrityVerifiedBadge : T.errors.cheatDetected;
    },

    pvpUnavailableText: function() {
      var T = getT();
      if (this.pvpStatus === 'connecting') return T.lobby.connectingBadge;
      if (this.pvpUnavailableReason === 'identity_unavailable') return T.lobby.pvpIdentityUnavailable;
      return this.pvpUnavailableReason === 'db_unavailable' ? T.lobby.pvpUnavailable : T.lobby.unsupportedMessage;
    },

    createPvpTransport: function() {
      if (!this.pvpBackend || this.pvpBackend.kind === 'none' || !GLT.transport.createTransportFor) return null;
      return GLT.transport.createTransportFor(this.pvpBackend, this.pvpTransportOptions());
    },

    attachPvpLobbyTransport: function(lobbyTransport) {
      var self = this;
      try {
        this.pvpLobbyTransport = lobbyTransport;
        this.pvpStatus = lobbyTransport ? 'connected' : 'unavailable';
        if (!lobbyTransport) return;

        var existingRooms = (this.pvpLobbyTransport.read('glt_open_rooms') || []).filter(function(r) {
          return r && r.id && r.type !== 'ROOM_DELETED' && r.type !== 'ROOMS_CLEARED';
        });
        this.pvpOpenRooms = existingRooms.slice(-8);
        this.pvpOpenRoomsUnsub = this.pvpLobbyTransport.subscribe('glt_open_rooms', function(ev) {
          if (!ev) return;
          if (ev.type === 'ROOM_DELETED' && ev.id) {
            self.pvpOpenRooms = self.pvpOpenRooms.filter(function(r) { return r.id !== ev.id; });
            // 'started' = both seats taken (the room just left "Partida rápida"); 'expired' = the
            // host went quiet and the room only left the list. Neither one closes the room.
            if (self.pvpRoomId === ev.id && !ev.reason) {
              self.leavePvpRoom();
              self.announce(getT().lobby.roomDeletedToast(ev.id));
            } else {
              self.renderPvpTab();
            }
            return;
          }
          if (ev.type === 'ROOMS_CLEARED') {
            self.pvpOpenRooms = [];
            if (!self.pvpRoomId) self.renderPvpTab();
            return;
          }
          if (ev.id) {
            self.pvpOpenRooms = self.pvpOpenRooms.filter(function(r) { return r.id !== ev.id; }).concat([ev]).slice(-8);
            if (!self.pvpRoomId) self.renderPvpTab();
          }
        });
      } catch (_) {
        this.pvpStatus = 'unavailable';
      }
    },

    // ---- PvP session that survives a refresh of THIS tab (sessionStorage; never shared) ----
    savePvpSession: function() {
      var c = this.pvpClient;
      if (!c || c.role !== 'player' || !this.pvpRoomId) return;
      try {
        sessionStorage.setItem('GLT_PVP_SESSION', JSON.stringify({
          roomId: this.pvpRoomId,
          playerId: c.playerId,
          playerIndex: c.playerIndex,
          hostUid: (c.transport && typeof c.transport.getRoomHost === 'function') ? c.transport.getRoomHost(this.pvpRoomId) : null,
          crewId: c.crewId,
          salt: c.salt,
          fleet: c.fleet,
          matchCfg: c.matchConfig,
          boardId: this.matchConfig.boardId
        }));
      } catch (_) {}
    },

    clearPvpSession: function() {
      try { sessionStorage.removeItem('GLT_PVP_SESSION'); } catch (_) {}
    },

    resumePvpSession: function() {
      var self = this;
      var s = null;
      try { s = JSON.parse(sessionStorage.getItem('GLT_PVP_SESSION') || 'null'); } catch (_) { s = null; }
      if (!s || !s.roomId || (s.playerIndex !== 0 && s.playerIndex !== 1) || !s.salt || !Array.isArray(s.fleet)) return null;
      var transport = this.createPvpTransport();
      if (!transport) return null;

      this.pvpRoomId = s.roomId;
      this.pvpRole = 'player';
      this.pvpSyncedShots = {};
      this.pvpLastReactionCount = 0;
      this.pvpLastTechCount = 0;
      if (s.playerId) this.pvpPlayerId = s.playerId;
      if (s.boardId) this.matchConfig.boardId = s.boardId;
      if (s.crewId) this.matchConfig.crewId = s.crewId;
      this.placedPlayerFleet = s.fleet;
      // Seat 0 stays the host this tab already played against, whatever the listing says now.
      if (s.hostUid && typeof transport.pinRoomHost === 'function') transport.pinRoomHost(s.roomId, s.hostUid);

      var load = (typeof transport.readAsync === 'function') ? transport.readAsync(s.roomId) : Promise.resolve(transport.read(s.roomId));
      return Promise.resolve(load).then(function(events) {
        if (!events || events.length === 0) {
          self.clearPvpSession();
          self.pvpRoomId = '';
          if (transport.destroy) transport.destroy();
          return null;
        }
        self.connectPvpClient(transport, s.roomId, s.playerIndex, 'player', s.matchCfg || {}, s.salt);
        if (self.gamePhase !== 'BATTLE') self.switchTab('tab-pvp');
        self.renderPvpTab();
        self.announce(getT().lobby.sessionResumedToast(s.roomId));
        return s.roomId;
      });
    },

    copyTextSafe: function(text, successMsg) {
      var self = this;
      function fallbackCopy() {
        try {
          var ta = document.createElement('textarea');
          ta.value = text;
          ta.setAttribute('readonly', '');
          ta.style.position = 'fixed';
          ta.style.opacity = '0';
          ta.style.left = '-9999px';
          document.body.appendChild(ta);
          ta.select();
          document.execCommand('copy');
          document.body.removeChild(ta);
          if (successMsg) self.announce(successMsg);
        } catch (_) {}
      }
      if (navigator.clipboard && navigator.clipboard.writeText && window.isSecureContext) {
        navigator.clipboard.writeText(text).then(function() {
          if (successMsg) self.announce(successMsg);
        }).catch(fallbackCopy);
      } else {
        fallbackCopy();
      }
    },

    getPreferredShareBaseUrl: function() {
      var lanUrls = (this.pvpLobbyTransport && this.pvpLobbyTransport.getLanUrls)
        ? this.pvpLobbyTransport.getLanUrls()
        : [];
      var host = window.location.hostname || '';
      if (lanUrls.length > 0) {
        if (host === 'localhost' || host === '127.0.0.1' || !host) {
          return lanUrls[0].replace(/\/$/, '') + '/';
        }
      }
      if (window.location.protocol === 'file:') {
        return (window.location.href || '').split('?')[0];
      }
      var origin = (window.location.origin && window.location.origin !== 'null')
        ? window.location.origin
        : (window.location.protocol + '//' + window.location.host);
      return origin + window.location.pathname;
    },

    checkUrlForRoom: function() {
      var self = this;
      return Promise.resolve(this.pvpReady).then(function() {
        if (self.pvpStatus !== 'connected') return null;
        var roomCode = null;
        try { roomCode = new URLSearchParams(window.location.search).get('room'); } catch (_) {}
        var stored = null;
        try { stored = JSON.parse(sessionStorage.getItem('GLT_PVP_SESSION') || 'null'); } catch (_) {}
        // A refresh mid-match brings back this tab's own seat (fleet + salt never left the tab).
        if (stored && stored.roomId && (!roomCode || roomCode.toUpperCase() === stored.roomId)) {
          return self.resumePvpSession();
        }
        if (roomCode && roomCode.length === 5) {
          // Opened from an invite (QR Code / link): this instance is a guest, never a host.
          self.pvpInviteCode = roomCode.toUpperCase();
          self.switchTab('tab-pvp');
          return self.joinPvpRoom(self.pvpInviteCode, 'player');
        }
        return null;
      }).catch(function(err) {
        console.warn('[GLT] PvP rejoin failed:', err);
        return null;
      });
    },

    generateQrSvg: function(text, cellSize, margin) {
      try {
        var qrFn = (typeof qrcode === 'function') ? qrcode : (window.GLT && window.GLT.qrcode);
        if (!qrFn) return null;
        var qr = qrFn(0, 'M');
        qr.addData(text);
        qr.make();
        return qr.createSvgTag(cellSize || 3, margin !== undefined ? margin : 3);
      } catch (err) {
        console.warn('QR Code generation failed:', err);
        return null;
      }
    },

    createQrCard: function(url, title, hint, idPrefix) {
      var self = this;
      var T = getT();
      var p = idPrefix || 'glt-qr';

      var container = document.createElement('div');
      container.className = 'glt-pvp-qr-section';
      container.id = p + '-section';

      var headerRow = document.createElement('div');
      headerRow.className = 'glt-qr-header-row';
      headerRow.style.display = 'flex';
      headerRow.style.alignItems = 'center';
      headerRow.style.justifyContent = 'space-between';
      headerRow.style.width = '100%';
      headerRow.style.gap = '8px';

      var labelEl = document.createElement('div');
      labelEl.className = 'glt-qr-label';
      labelEl.innerHTML = '📱 ' + (title || (T.lobby && T.lobby.qrCodeTitle) || 'QR Code');
      headerRow.appendChild(labelEl);

      var toggleBtn = document.createElement('button');
      toggleBtn.type = 'button';
      toggleBtn.className = 'glt-btn btn-sm btn-secondary';
      toggleBtn.id = p + '-toggle-btn';
      toggleBtn.style.padding = '2px 8px';
      toggleBtn.style.fontSize = '10px';
      toggleBtn.textContent = '▲ ' + ((T.lobby && T.lobby.qrCodeToggleHide) || 'Ocultar');
      headerRow.appendChild(toggleBtn);
      container.appendChild(headerRow);

      var bodyWrapper = document.createElement('div');
      bodyWrapper.className = 'glt-qr-body';
      bodyWrapper.id = p + '-body';
      bodyWrapper.style.display = 'flex';
      bodyWrapper.style.flexDirection = 'column';
      bodyWrapper.style.alignItems = 'center';
      bodyWrapper.style.gap = '6px';
      bodyWrapper.style.width = '100%';

      var qrSvg = this.generateQrSvg(url, 3, 3);
      if (qrSvg) {
        var qrBox = document.createElement('div');
        qrBox.className = 'glt-qr-code-wrapper';
        qrBox.id = p + '-wrapper';
        qrBox.setAttribute('role', 'button');
        qrBox.setAttribute('tabindex', '0');
        qrBox.setAttribute('title', (T.lobby && T.lobby.copyLinkButton) || 'Copiar Link');
        qrBox.setAttribute('aria-label', (title || 'QR Code') + ' — ' + ((T.lobby && T.lobby.copyLinkButton) || 'Copiar Link'));
        qrBox.innerHTML = qrSvg;
        qrBox.addEventListener('click', function() {
          self.copyTextSafe(url, (T.lobby && T.lobby.linkCopied) || 'Link copiado!');
        });
        qrBox.addEventListener('keydown', function(ev) {
          if (ev.key === 'Enter' || ev.key === ' ') {
            ev.preventDefault();
            self.copyTextSafe(url, (T.lobby && T.lobby.linkCopied) || 'Link copiado!');
          }
        });
        bodyWrapper.appendChild(qrBox);
      }

      if (hint) {
        var hintEl = document.createElement('p');
        hintEl.className = 'glt-qr-hint';
        hintEl.textContent = hint;
        bodyWrapper.appendChild(hintEl);
      }

      if (window.location.protocol === 'file:') {
        var warnEl = document.createElement('div');
        warnEl.className = 'glt-qr-warning-badge';
        warnEl.innerHTML = (T.lobby && T.lobby.fileProtocolQrWarning)
          ? T.lobby.fileProtocolQrWarning
          : '⚠️ Este QR Code contém um link local (file://) deste PC. Para ler com celular no Wi-Fi, abra o jogo pelo <strong>jogar-no-wifi.cmd</strong>.';
        bodyWrapper.appendChild(warnEl);
      }

      container.appendChild(bodyWrapper);

      toggleBtn.addEventListener('click', function() {
        var isHidden = bodyWrapper.style.display === 'none';
        bodyWrapper.style.display = isHidden ? 'flex' : 'none';
        toggleBtn.textContent = isHidden
          ? ('▲ ' + ((T.lobby && T.lobby.qrCodeToggleHide) || 'Ocultar'))
          : ('▼ ' + ((T.lobby && T.lobby.qrCodeToggleShow) || 'Exibir'));
      });

      return container;
    },

    createPvpRoom: function() {
      var transport = this.createPvpTransport();
      if (!transport) {
        this.announce(this.pvpUnavailableText());
        return null;
      }
      var ships = GLT.rules.getShipsForBoard(this.matchConfig.boardId, this.matchConfig.crewId);
      if (this.placedPlayerFleet.length < ships.length) {
        this.autoPlacePlayerFleet('spread');
      }

      var code = (GLT.protocol && GLT.protocol.generateRoomCode)
        ? GLT.protocol.generateRoomCode()
        : 'GLT99';

      this.pvpRoomId = code;
      this.pvpRole = 'player';
      this.pvpSyncedShots = {};
      this.pvpLastReactionCount = 0;
      this.pvpLastTechCount = 0;

      var bSize = (GLT.rules.BOARDS_MAP[this.matchConfig.boardId] || { size: 10 }).size;
      var roomCfg = {
        boardId: this.matchConfig.boardId,
        boardSize: bSize,
        mode: this.matchConfig.mode,
        sea: this.matchConfig.sea,
        allowTouch: this.matchConfig.allowTouch,
        continueOnHit: this.matchConfig.continueOnHit,
        salvo: this.matchConfig.salvo,
        turnTimer: this.matchConfig.turnTimer,
        fog: this.matchConfig.fog,
        seed: 'glt_pvp_' + code
      };

      var createdEv = GLT.protocol.createEvent('ROOM_CREATED', {
        roomId: code,
        hostId: this.pvpPlayerId,
        hostNickname: this.pvpNickname,
        crewId: this.matchConfig.crewId,
        matchConfig: roomCfg
      });
      transport.publish(code, createdEv);

      if (this.pvpLobbyTransport) {
        this.pvpLobbyTransport.publish('glt_open_rooms', {
          id: code,
          host: this.pvpNickname,
          crewId: this.matchConfig.crewId,
          format: bSize + 'x' + bSize,
          mode: this.matchConfig.mode,
          timestamp: Date.now()
        });
      }

      this.connectPvpClient(transport, code, 0, 'player', roomCfg);
      this.renderPvpTab();
      return code;
    },

    joinPvpRoom: function(code, role) {
      var self = this;
      var T = getT();
      var cleanCode = (code || '').trim().toUpperCase();
      if (cleanCode.length !== 5) {
        this.announce(T.errors.invalidRoomCode);
        return null;
      }

      var transport = this.createPvpTransport();
      if (!transport) {
        this.announce(this.pvpUnavailableText());
        return null;
      }

      var joinRole = role || 'player';
      var backendKind = transport.getBackendType ? transport.getBackendType() : '';
      this.pvpRoomId = cleanCode;
      this.pvpRole = joinRole;
      this.pvpSyncedShots = {};
      this.pvpLastReactionCount = 0;
      this.pvpLastTechCount = 0;

      function abortJoin(message) {
        if (transport && typeof transport.destroy === 'function') transport.destroy();
        self.pvpRoomId = '';
        self.pvpRole = 'player';
        self.announce(message);
        self.renderPvpTab();
        return null;
      }

      function finishJoinWithEvents(existingEvents) {
        var roomCfg = null;
        var roomExists = false;
        var otherGuest = false;
        for (var i = 0; i < existingEvents.length; i++) {
          var ev = existingEvents[i];
          if (!ev) continue;
          if (ev.type === 'ROOM_CREATED') {
            roomExists = true;
            if (!roomCfg && ev.matchConfig) roomCfg = ev.matchConfig;
          } else if (ev.type === 'ROOM_JOINED' && ev.role !== 'spectator' && ev.guestId && ev.guestId !== self.pvpPlayerId) {
            otherGuest = true;
          }
        }

        // The published-Artifact transport binds seats itself (SEAT_BIND / seat_taken); the LAN
        // relay and the cross-tab channel have no such gate, so the lobby checks before joining.
        if (backendKind !== 'artifactDb') {
          if (!roomExists) {
            return abortJoin(backendKind === 'peer'
              ? T.lobby.peerRoomNotFound(cleanCode)
              : (backendKind === 'broadcastChannel' ? T.lobby.roomNotFoundLocalPage(cleanCode) : T.lobby.roomNotFound(cleanCode)));
          }
          if (joinRole === 'player' && otherGuest) return abortJoin(T.lobby.roomFull(cleanCode));
        }

        if (roomCfg) {
          var boardChanged = !!(roomCfg.boardId && roomCfg.boardId !== self.matchConfig.boardId);
          if (boardChanged) self.matchConfig.boardId = roomCfg.boardId;
          if (roomCfg.mode) self.matchConfig.mode = roomCfg.mode;
          if (roomCfg.sea) self.matchConfig.sea = roomCfg.sea;
          if (typeof roomCfg.allowTouch === 'boolean') self.matchConfig.allowTouch = roomCfg.allowTouch;
          if (typeof roomCfg.continueOnHit === 'boolean') self.matchConfig.continueOnHit = roomCfg.continueOnHit;
          if (typeof roomCfg.salvo === 'boolean') self.matchConfig.salvo = roomCfg.salvo;
          if (typeof roomCfg.fog === 'boolean') self.matchConfig.fog = roomCfg.fog;
          if (typeof roomCfg.turnTimer === 'number') self.matchConfig.turnTimer = roomCfg.turnTimer;

          var reqShips = GLT.rules.getShipsForBoard(self.matchConfig.boardId, self.matchConfig.crewId);
          if (boardChanged || self.placedPlayerFleet.length !== reqShips.length) {
            self.autoPlacePlayerFleet('spread');
          }
          if (self.platesSystem && roomCfg.sea) {
            self.platesSystem.setEnvironment(self.seaToEnvProfile(roomCfg.sea), 800, roomCfg.sea);
          }
        } else {
          var reqShips2 = GLT.rules.getShipsForBoard(self.matchConfig.boardId, self.matchConfig.crewId);
          if (self.placedPlayerFleet.length < reqShips2.length) {
            self.autoPlacePlayerFleet('spread');
          }
        }


        var joinedEv = GLT.protocol.createEvent('ROOM_JOINED', {
          roomId: cleanCode,
          guestId: self.pvpPlayerId,
          guestNickname: self.pvpNickname,
          crewId: self.matchConfig.crewId,
          role: joinRole
        });
        transport.publish(cleanCode, joinedEv);

        var pIndex = joinRole === 'spectator' ? -1 : 1;
        self.connectPvpClient(transport, cleanCode, pIndex, joinRole, roomCfg || {
          boardId: self.matchConfig.boardId,
          mode: self.matchConfig.mode,
          seed: 'glt_pvp_' + cleanCode
        });
        self.renderPvpTab();
        return cleanCode;
      }

      if ((backendKind === 'lanRelay' || backendKind === 'artifactDb' || backendKind === 'peer') && typeof transport.readAsync === 'function') {
        if (backendKind === 'peer') this.announce(T.lobby.peerSearchingRoom(cleanCode));
        return transport.readAsync(cleanCode).then(function(evts) {
          return finishJoinWithEvents(evts || []);
        });
      }

      return finishJoinWithEvents(transport.read(cleanCode) || []);
    },

    connectPvpClient: function(transport, roomId, playerIndex, role, matchCfg, salt) {
      var self = this;
      if (this.pvpClient) {
        var oldTransport = this.pvpClient.transport;
        this.pvpClient.destroy();
        if (oldTransport && typeof oldTransport.destroy === 'function') oldTransport.destroy();
        this.pvpClient = null;
      }

      this.pvpClient = new GLT.protocol.PvpMatchClient({
        transport: transport,
        roomId: roomId,
        playerId: this.pvpPlayerId,
        playerIndex: playerIndex,
        nickname: this.pvpNickname,
        crewId: this.matchConfig.crewId,
        fleet: this.placedPlayerFleet,
        salt: salt || undefined,
        role: role || 'player',
        matchConfig: matchCfg || {}
      });

      this.pvpClient.onStateChange = function(state) {
        self.handlePvpStateChange(state);
      };
      this.savePvpSession();

      this.isPvpMode = true;
      this.handlePvpStateChange(this.pvpClient.state);
    },

    readyPvpMatch: function() {
      if (!this.pvpClient || this.pvpClient.role !== 'player') return Promise.resolve(false);
      var reqBoard = (this.pvpClient.state && this.pvpClient.state.matchConfig && this.pvpClient.state.matchConfig.boardId)
        ? this.pvpClient.state.matchConfig.boardId
        : this.matchConfig.boardId;

      if (reqBoard !== this.matchConfig.boardId) {
        this.matchConfig.boardId = reqBoard;
        this.autoPlacePlayerFleet('spread');
      } else {
        var ships = GLT.rules.getShipsForBoard(reqBoard);
        if (this.placedPlayerFleet.length < ships.length) {
          this.autoPlacePlayerFleet('spread');
        }
      }

      this.pvpClient.fleet = this.placedPlayerFleet;
      this.pvpClient.crewId = this.matchConfig.crewId;
      this.savePvpSession();
      var self = this;
      return this.pvpClient.readyUp().then(function() {
        self.renderPvpTab();
        return true;
      });
    },

    leavePvpRoom: function() {
      this.clearPvpSession();
      this.clearTurnTimers();
      if (this.pvpClient) {
        var oldTransport = this.pvpClient.transport;
        this.pvpClient.destroy();
        if (oldTransport && typeof oldTransport.destroy === 'function') oldTransport.destroy();
        this.pvpClient = null;
      }
      this.pvpRoomId = '';
      this.pvpOppJoinedRoom = '';
      this.isPvpMode = false;
      this.pvpSyncedShots = {};
      if (this.gamePhase === 'BATTLE') {
        this.setupFleetPlacementPhase();
      } else {
        this.renderPvpTab();
      }
    },

    /** Only the device that opened a room may close it (a close ends the match for both). */
    ownsPvpRoom: function(roomId) {
      var cleanId = String(roomId || '').trim().toUpperCase();
      if (!cleanId) return false;
      var lobbyT = this.pvpLobbyTransport;
      if (lobbyT && typeof lobbyT.ownsRoom === 'function') return !!lobbyT.ownsRoom(cleanId);
      return true;
    },

    /**
     * Destructive buttons ask twice: the first tap swaps the label for the question, the second
     * (within 4 s) runs the action. No blocking dialog, so it works the same on touch and keyboard.
     */
    armTwoStepButton: function(btn, confirmLabel, action) {
      var self = this;
      var idleLabel = btn.textContent;
      var idleAria = btn.getAttribute('aria-label');
      var timer = null;
      function disarm() {
        if (timer) { clearTimeout(timer); timer = null; }
        btn.removeAttribute('data-armed');
        if (idleAria) btn.setAttribute('aria-label', idleAria);
        else btn.textContent = idleLabel;
      }
      btn.addEventListener('click', function() {
        if (btn.getAttribute('data-armed') === '1') {
          disarm();
          action();
          return;
        }
        btn.setAttribute('data-armed', '1');
        if (idleAria) btn.setAttribute('aria-label', confirmLabel);
        else btn.textContent = confirmLabel;
        self.announce(confirmLabel);
        timer = setTimeout(disarm, 4000);
      });
      btn.addEventListener('blur', function() {
        if (btn.getAttribute('data-armed') === '1') disarm();
      });
    },

    deleteOpenPvpRoom: function(roomId) {
      var T = getT();
      var cleanId = String(roomId || '').trim().toUpperCase();
      if (!cleanId) return;
      if (!this.ownsPvpRoom(cleanId)) {
        this.announce(T.lobby.onlyHostDeletesRoom);
        return;
      }
      this.pvpOpenRooms = this.pvpOpenRooms.filter(function(r) { return r.id !== cleanId; });
      if (this.pvpLobbyTransport && typeof this.pvpLobbyTransport.deleteRoom === 'function') {
        this.pvpLobbyTransport.deleteRoom(cleanId);
      }
      if (this.pvpRoomId === cleanId) {
        this.leavePvpRoom();
      } else {
        this.renderPvpTab();
      }
      this.announce(T.lobby.roomDeletedToast(cleanId));
      if (this.audio) this.audio.playUiClick();
    },

    clearOpenPvpRooms: function() {
      var T = getT();
      this.pvpOpenRooms = [];
      if (this.pvpLobbyTransport && typeof this.pvpLobbyTransport.clearOpenRooms === 'function') {
        this.pvpLobbyTransport.clearOpenRooms();
      }
      this.renderPvpTab();
      this.announce(T.lobby.roomsClearedToast);
      if (this.audio) this.audio.playUiClick();
    },

    handlePvpStateChange: function(state) {
      if (!state || !this.pvpClient) return;
      var T = getT();
      var myIdx = this.pvpClient.role === 'player' ? this.pvpClient.playerIndex : 0;
      var oppIdx = 1 - myIdx;

      // Sync opponent crew visual identity
      if (state.players[oppIdx] && state.players[oppIdx].crewId && state.players[oppIdx].crewId !== this.matchConfig.enemyCrewId) {
        this.matchConfig.enemyCrewId = state.players[oppIdx].crewId;
        this.updateRivalAvatar();
      this.updateRivalTaunt('intro');
      }

      // Sync reactions feed to rival bubble, audio & logbook
      var reactions = (state.feed || []).filter(function(f) { return f.type === 'reaction'; });
      if (reactions.length > this.pvpLastReactionCount) {
        for (var ri = this.pvpLastReactionCount; ri < reactions.length; ri++) {
          var rx = reactions[ri];
          var rDef = (GLT.protocol.DEN_DEN_REACTIONS || []).find(function(d) { return d.id === rx.reactionId; });
          if (rDef) {
            var rIcon = rDef.icon || '🐌';
            var rLabel = rDef.label || rDef.text || '';
            var isMine = this.pvpClient.role === 'player' && rx.playerIndex === myIdx;
            var senderName = isMine
              ? T.ui.you
              : ((state.players[rx.playerIndex] && state.players[rx.playerIndex].nickname) || T.ui.turnIndicatorEnemyDefault);

            if (this.dom.rivalBubble) {
              this.dom.rivalBubble.textContent = isMine
                ? T.reactions.sentBubble(rIcon, rLabel)
                : T.reactions.receivedBubble(senderName, rIcon, rLabel);
            }
            var rxLogLine = T.reactions.logLine(senderName, rIcon, rLabel);
            this.appendLogBookEntry(rxLogLine);
            this.announce(rxLogLine);
          }
        }
        this.pvpLastReactionCount = reactions.length;
        if (this.audio) this.audio.playDenDenMushi();
      }

      // Transition from Ceremony / Battle -> Lobby when rematch is accepted by both players
      if (state.phase === 'lobby' && (this.gamePhase === 'CEREMONY' || this.gamePhase === 'BATTLE')) {
        this.clearTurnTimers();
        this.hideModal();
        if (this.backdrop) {
          this.backdrop.setCeremonyActive(false);
          this.backdrop.setDollsHouseLiftEnabled(this.liftScenery);
        }
        this.gamePhase = 'SETUP';
        this.pvpSyncedShots = {};
        this.pvpForfeitLogged = false;
        this.pvpLastReactionCount = 0;
        this.pvpLastTechCount = 0;
        this.playerRevealedCells = [];
        this.selectedAimCell = null;
        this.isUsingTechnique = false;
        if (this.platesSystem) {
          this.platesSystem.seaPlates.clearShotMarkers();
          this.platesSystem.seaPlates.setShipFoamCells(0, []);
          this.platesSystem.seaPlates.setShipFoamCells(1, []);
          this.platesSystem.seaPlates.hideValidityGhost();
        }
        this.autoPlacePlayerFleet('spread');
        this.syncPlayerFleetTo3d();
        this.updateTopHudStatus();
        this.renderGameplayTab();
        this.renderFleetTab();
        this.renderFloatingControls();
        this.renderHudMinimap();
        this.switchTab('tab-pvp');
        this.renderPvpTab();
        this.announce((T.lobby && T.lobby.rematchAcceptedToast) || '⚔️ Revanche iniciada! Ajuste sua frota e confirme para o combate.');
        if (this.audio && typeof this.audio.playUiClick === 'function') this.audio.playUiClick();
      }

      // Tell the host the moment a rival takes the second seat (the QR Code worked).
      var oppJoinedNow = !!(state.players[oppIdx] && state.players[oppIdx].id);
      if (this.pvpClient.role === 'player' && myIdx === 0 && oppJoinedNow && this.pvpOppJoinedRoom !== this.pvpRoomId) {
        this.pvpOppJoinedRoom = this.pvpRoomId;
        if (state.phase === 'lobby') {
          this.announce(T.lobby.rivalJoinedToast(state.players[oppIdx].nickname || T.ui.defaultCaptainName));
          if (this.audio && typeof this.audio.playDenDenMushi === 'function') this.audio.playDenDenMushi();
        }
      }

      // Transition from Lobby -> Active PvP Battle when both players committed SHA-256
      if (state.phase === 'playing' && this.gamePhase !== 'BATTLE') {
        // LAN: a started room leaves "Salas Abertas" (its log stays on the relay for refresh/resume).
        if (myIdx === 0 && this.pvpClient.role === 'player' && this.pvpLobbyTransport &&
            this.pvpLobbyTransport.getBackendType && this.pvpLobbyTransport.getBackendType() === 'lanRelay') {
          this.pvpLobbyTransport.publish('glt_open_rooms', { type: 'ROOM_DELETED', id: this.pvpRoomId, reason: 'started' });
        }
        this.clearTurnTimers();
        this.hideModal();
        this.isPvpMode = true;
        this.matchConfig.mode = state.matchConfig.mode || this.matchConfig.mode;
        this.matchConfig.boardId = state.matchConfig.boardId || this.matchConfig.boardId;
        this.matchConfig.sea = (state.matchConfig && state.matchConfig.sea) || this.matchConfig.sea || 'calm_belt';
        if (state.matchConfig && typeof state.matchConfig.allowTouch === 'boolean') this.matchConfig.allowTouch = state.matchConfig.allowTouch;
        if (state.matchConfig && typeof state.matchConfig.continueOnHit === 'boolean') this.matchConfig.continueOnHit = state.matchConfig.continueOnHit;
        if (state.matchConfig && typeof state.matchConfig.salvo === 'boolean') this.matchConfig.salvo = state.matchConfig.salvo;
        if (state.matchConfig && typeof state.matchConfig.fog === 'boolean') this.matchConfig.fog = state.matchConfig.fog;
        if (state.matchConfig && typeof state.matchConfig.turnTimer === 'number') this.matchConfig.turnTimer = state.matchConfig.turnTimer;

        if (this.platesSystem) {
          this.platesSystem.setBoardSize(state.matchConfig.boardSize || 10);
          if (this.matchConfig.sea) {
            this.platesSystem.setEnvironment(this.seaToEnvProfile(this.matchConfig.sea), 800, this.matchConfig.sea);
          }
          this.platesSystem.seaPlates.clearShotMarkers();
          // Both plates: a guest places its fleet on plate 0 in the lobby and fights on plate 1,
          // so the foam of the lobby placement would stay behind on what is now the enemy waters.
          this.platesSystem.seaPlates.setShipFoamCells(0, []);
          this.platesSystem.seaPlates.setShipFoamCells(1, []);
        }
        this.syncPlayerFleetTo3d();
        this.switchTab('tab-gameplay');
        this.launchBattlePhase();
      }

      // Sync shots onto 3D seaPlates & logbook
      if (state.phase === 'playing' || state.phase === 'game_over') {
        this.syncPvpTechFeed(state, myIdx);
        this.syncPvpBoardVisuals(state, myIdx, oppIdx);
        this.updateTopHudStatus();
        this.renderGameplayTab();
        this.renderFleetTab();
        this.renderHudMinimap(); // the radar over the 3D view when the side panel is folded
      }

      // Transition to Ceremony when PvP game concludes
      if (state.phase === 'game_over' && this.gamePhase !== 'CEREMONY') {
        if (state.gameOverReason === 'manual_forfeit' && !this.pvpForfeitLogged) {
          this.pvpForfeitLogged = true;
          var rivalPlayer = state.players[oppIdx] || {};
          var rivalName = rivalPlayer.nickname || T.ui.defaultCaptainName;
          if (state.forfeitedBy === myIdx) {
            this.appendLogBookEntry(T.forfeit.logPlayerForfeit);
          } else {
            this.appendLogBookEntry(T.forfeit.logEnemyForfeit(rivalName));
          }
        }
        this.launchCeremonyPhase();
      } else if (state.phase === 'game_over' && this.gamePhase === 'CEREMONY' && state.integrity) {
        var badgeEl = document.getElementById('pvp-ceremony-integrity');
        if (badgeEl) {
          badgeEl.textContent = this.pvpIntegrityText(state.integrity);
        }
      }

      this.renderPvpTab();
    },

    /**
     * Techniques in online play: every use lands in state.feed. Shows what happened (banner,
     * logbook line, screen-reader announcement) and, for the player's own Observação, marks
     * the revealed cell on the radar. A replay after a refresh rebuilds the marks without banners.
     */
    syncPvpTechFeed: function(state, myIdx) {
      var T = getT();
      var techFeed = (state.feed || []).filter(function(f) { return f && f.techId; });
      var seen = this.pvpLastTechCount || 0;
      if (techFeed.length <= seen) return;
      var live = techFeed.length - seen === 1;

      for (var ti = seen; ti < techFeed.length; ti++) {
        var tf = techFeed[ti];
        var tDef = (T.techniques && T.techniques[tf.techId]) || {};
        var res = tf.result || {};
        var params = tf.params || {};
        var mine = !!this.pvpClient && this.pvpClient.role === 'player' && tf.shooterIndex === myIdx;
        var detail = '';

        if (tf.techId === 'haki_do_rei' && typeof res.sonarDetected === 'boolean') {
          detail = res.sonarDetected ? tDef.sonarPositive : tDef.sonarNegative;
        } else if (tf.techId === 'room' && typeof res.rowColCount === 'number' && typeof params.index === 'number') {
          detail = params.axis === 'col'
            ? tDef.colCountMsg(String(params.index + 1), res.rowColCount)
            : tDef.rowCountMsg(String.fromCharCode(65 + params.index), res.rowColCount);
        } else if (tf.techId === 'observacao' && res.revealedCell) {
          detail = tDef.revealedMsg(GLT.rules.coordToLabel(res.revealedCell.r, res.revealedCell.c));
        }

        var body = [tDef.usedMsg, detail].filter(Boolean).join(' ');
        var who = (state.players[tf.shooterIndex] && state.players[tf.shooterIndex].nickname) || T.ui.turnIndicatorEnemyDefault;
        var line = mine ? T.ui.techniqueActivated(body) : T.ui.rivalTechniqueLine(who, body);
        this.appendLogBookEntry(line);
        this.announce(line);

        if (mine && tf.techId === 'observacao' && res.revealedCell) {
          var rev = res.revealedCell;
          var known = this.playerRevealedCells.some(function(c) { return c.r === rev.r && c.c === rev.c; });
          if (!known) this.playerRevealedCells.push({ r: rev.r, c: rev.c });
          var plates = this.getMyPlatesIndices();
          if (this.platesSystem) {
            this.platesSystem.seaPlates.addShotMarker(plates.oppPlate, rev.r, rev.c, 'revealed');
            if (live) this.platesSystem.seaPlates.setSelection(plates.oppPlate, rev.r, rev.c);
          }
          if (live) this.selectedAimCell = { r: rev.r, c: rev.c };
        }

        if (live && typeof this.showTechniqueBanner === 'function') this.showTechniqueBanner(tf.techId);
      }
      this.pvpLastTechCount = techFeed.length;
    },

    syncPvpBoardVisuals: function(state, myIdx, oppIdx) {
      var self = this;
      var T = getT();

      // 1. Shots fired by me onto enemy plate (oppIdx)
      var myShots = state.boards[myIdx].shots || {};
      Object.keys(myShots).forEach(function(key) {
        var syncKey = 'opp_' + key;
        if (self.pvpSyncedShots[syncKey]) return;
        self.pvpSyncedShots[syncKey] = true;
        var s = myShots[key];
        self.applyCellImpactVisual(oppIdx, s, true);
        var msg = s.outcome === 'water' ? T.outcomes.water :
          s.outcome === 'hit' ? T.outcomes.hit :
          s.outcome === 'sunk' ? T.outcomes.sunk(s.shipName || '') : T.outcomes.absorbed;
        var line = T.ui.shotLogLine(T.ui.you, GLT.rules.coordToLabel(s.r, s.c), msg);
        self.appendLogBookEntry(line);
        self.announce(line);
        self.startTurnTimer();
      });

      // 2. Shots fired by opponent onto my plate (myIdx)
      var oppShots = state.boards[oppIdx].shots || {};
      var freshOpp = Object.keys(oppShots).filter(function(key) { return !self.pvpSyncedShots['my_' + key]; });
      Object.keys(oppShots).forEach(function(key) {
        var syncKey = 'my_' + key;
        if (self.pvpSyncedShots[syncKey]) return;
        self.pvpSyncedShots[syncKey] = true;
        var s = oppShots[key];
        // a single live shot flies in from the rival's waters and lands with its outcome; a replay (rejoin) is instant
        if (freshOpp.length === 1 && self.fx && self.platesSystem) {
          var inFrom = self.platesSystem.seaPlates.cellToWorld(oppIdx, 3, 2);
          var inTo = self.platesSystem.seaPlates.cellToWorld(myIdx, s.r, s.c);
          if (self.audio) self.audio.playCannon();
          self.fx.fireCannonball(inFrom, inTo, s.outcome, function() {
            if (self.isPvpMode) self.applyCellImpactVisual(myIdx, s, true);
          });
        } else {
          self.applyCellImpactVisual(myIdx, s, true);
        }
        var oppName = state.players[oppIdx].nickname || T.ui.turnIndicatorEnemyDefault;
        var msg = s.outcome === 'water' ? T.outcomes.water :
          s.outcome === 'hit' ? T.outcomes.hit :
          s.outcome === 'sunk' ? T.outcomes.sunk(s.shipName || '') : T.outcomes.absorbed;
        var line = T.ui.shotLogLine(oppName, GLT.rules.coordToLabel(s.r, s.c), msg);
        self.appendLogBookEntry(line);
        self.announce(line);
        self.startTurnTimer();
      });
    },

    sendPvpReaction: function(reactionId) {
      if (!this.pvpClient) return;
      try {
        this.pvpClient.sendReaction(reactionId);
      } catch (_) {}
    },

    buildReactionsGridDom: function() {
      var self = this;
      var T = getT();
      var reactGrid = document.createElement('div');
      reactGrid.className = 'glt-reactions-grid';

      var presets = (GLT.protocol && GLT.protocol.DEN_DEN_REACTIONS) ? GLT.protocol.DEN_DEN_REACTIONS : [];
      presets.forEach(function(rObj) {
        var rIcon = rObj.icon || '🐌';
        var rLabel = rObj.label || rObj.text || rObj.id;
        var rBtn = document.createElement('button');
        rBtn.type = 'button';
        rBtn.className = 'glt-pill-btn glt-reaction-btn';
        rBtn.dataset.reactionId = rObj.id;
        rBtn.setAttribute('aria-label', T.reactions.buttonAria(rLabel));
        rBtn.title = rLabel;

        var iconSpan = document.createElement('span');
        iconSpan.className = 'reaction-icon';
        iconSpan.setAttribute('aria-hidden', 'true');
        iconSpan.textContent = rIcon;

        var labelSpan = document.createElement('span');
        labelSpan.className = 'reaction-label';
        labelSpan.textContent = rLabel;

        rBtn.appendChild(iconSpan);
        rBtn.appendChild(labelSpan);

        rBtn.addEventListener('click', function() {
          rBtn.classList.add('just-sent');
          setTimeout(function() { rBtn.classList.remove('just-sent'); }, 450);
          self.sendPvpReaction(rObj.id);
        });
        reactGrid.appendChild(rBtn);
      });
      return reactGrid;
    },

    /**
     * =========================================================================
     * UI RENDERING, SEMANTIC 2D RADAR & ACCESSIBLE TAB BUILDERS
     * =========================================================================
     */
    updateTopHudStatus: function() {
      var T = getT();

      this.dom.modeBadge.textContent = T.modes[this.matchConfig.mode].name;
      this.dom.seaBadge.textContent = T.seas[this.matchConfig.sea].name;

      if (this.dom.seriesBadge) {
        if (!this.isPvpMode && this.matchConfig.seriesLength > 1) {
          var sWins = (this.matchState && this.matchState.seriesWins) ? this.matchState.seriesWins : this.seriesWins;
          this.dom.seriesBadge.textContent = T.ui.seriesScore(sWins[0] || 0, sWins[1] || 0, this.matchConfig.seriesLength);
          this.dom.seriesBadge.style.display = 'inline-block';
        } else {
          this.dom.seriesBadge.style.display = 'none';
        }
      }

      if (this.gamePhase === 'SETUP') {
        this.dom.turnPill.textContent = T.ui.readyStatus;
        this.dom.turnPill.className = 'glt-turn-pill ready';
      } else if (this.gamePhase === 'BATTLE') {
        if (this.isPvpMode && this.pvpClient && this.pvpClient.state) {
          var myTurn = this.pvpClient.state.currentTurn === this.pvpClient.playerIndex;
          var oppIdx = 1 - (this.pvpClient.role === 'player' ? this.pvpClient.playerIndex : 0);
          var oppName = this.pvpClient.state.players[oppIdx].nickname || T.ui.turnIndicatorEnemyDefault;
          this.dom.turnPill.textContent = myTurn ? T.turns.yourTurn : T.turns.enemyTurn(oppName);
          this.dom.turnPill.className = 'glt-turn-pill ' + (myTurn ? 'your-turn' : 'enemy-turn');
        } else if (this.matchState) {
          var isPlayerTurn = this.matchState.turn === 0;
          this.dom.turnPill.textContent = isPlayerTurn ? T.turns.yourTurn : T.turns.enemyTurn(this.matchState.players[1].captain);
          this.dom.turnPill.className = 'glt-turn-pill ' + (isPlayerTurn ? 'your-turn' : 'enemy-turn');
        }
      } else if (this.gamePhase === 'CEREMONY') {
        this.dom.turnPill.textContent = T.stats.wantedPosterHeading;
        this.dom.turnPill.className = 'glt-turn-pill ready';
      }
    },

    updateRivalTaunt: function(type, forceCrewId) {
      var inSetup = this.gamePhase === 'SETUP';
      var crewId = forceCrewId || (inSetup ? this.matchConfig.crewId : this.matchConfig.enemyCrewId);
      var isAdversary = crewId !== this.matchConfig.crewId;
      this.updateDialogueBox(crewId, isAdversary, type);
    },

    showPlayerCaptainCry: function(crewId) {
      var crew = GLT.rules.CREWS_MAP[crewId] || GLT.rules.CREWS_MAP.straw_hats;
      var tauntsObj = (getT().crews[crew.id] && getT().crews[crew.id].taunts) || {};
      var cry = (tauntsObj.intro && tauntsObj.intro[0]) || 'Às armas, marujos!';

      var existing = document.getElementById('glt-player-captain-toast');
      if (existing) existing.remove();

      var toast = document.createElement('div');
      toast.id = 'glt-player-captain-toast';
      toast.className = 'glt-player-captain-toast';

      var fallbackUrl = (GLT.backdropFx && GLT.backdropFx.generateCaptainAvatarDataUrl)
        ? GLT.backdropFx.generateCaptainAvatarDataUrl(crew.id, 64)
        : '';
      var portraitUrl = (GLT.assets && GLT.assets.portraits && GLT.assets.portraits[crew.id]) || fallbackUrl;

      toast.innerHTML =
        '<img class="player-toast-thumb" src="' + portraitUrl + '" alt="' + crew.captain + '" onerror="this.onerror=null;this.src=\'' + fallbackUrl + '\'">' +
        '<div class="player-toast-meta">' +
          '<span class="player-toast-header">⛵ SUA TRIPULAÇÃO • ' + crew.captain + '</span>' +
          '<span class="player-toast-quote">"' + cry + '"</span>' +
        '</div>';

      var viewport = document.getElementById('glt-viewport-container');
      if (viewport) {
        viewport.appendChild(toast);
        setTimeout(function() {
          if (toast.parentNode) toast.parentNode.removeChild(toast);
        }, 2800);
      }
    },

    renderGameplayTab: function() {
      var self = this;
      var T = getT();
      var container = this.dom.tabGameplay;
      if (!container) return;
      container.innerHTML = '';

      if (this.gamePhase === 'SETUP') {
        var setupForm = document.createElement('div');
        setupForm.className = 'glt-setup-panel';

        // Inside a PvP room the rules are the room's: shown here, changed only by leaving.
        var rulesLocked = !!this.pvpRoomId;
        this._rulesLockShown = rulesLocked;

        var shipsList = GLT.rules.getShipsForBoard(this.matchConfig.boardId, this.matchConfig.crewId);
        var totalShips = shipsList.length;
        var allPlaced = this.placedPlayerFleet.length >= totalShips;

        // 0. Sticky Above-the-Fold Primary CTA Bar
        var ctaBar = document.createElement('div');
        ctaBar.className = 'glt-setup-cta-bar';

        var topStartBtn = document.createElement('button');
        topStartBtn.type = 'button';
        topStartBtn.id = 'btn-start-battle';
        topStartBtn.className = 'glt-btn btn-primary glt-start-battle-btn';
        topStartBtn.textContent = '⚔️ ' + T.ui.startBattleButton;
        topStartBtn.setAttribute('aria-label', T.ui.startBattleButtonAria);
        topStartBtn.disabled = !allPlaced;
        topStartBtn.addEventListener('click', function() {
          self.startMatchWithCoinToss(false);
        });
        ctaBar.appendChild(topStartBtn);

        var chartBtn = document.createElement('button');
        chartBtn.type = 'button';
        chartBtn.id = 'btn-open-nautical-chart';
        chartBtn.className = 'glt-btn btn-secondary glt-map-viewer-btn';
        chartBtn.innerHTML = '🗺️ ' + (T.ui.viewNauticalChart || 'Carta Náutica');
        chartBtn.setAttribute('aria-label', T.ui.nauticalChartAria || 'Abrir Carta Náutica da Grand Line');
        chartBtn.addEventListener('click', function() {
          self.openNauticalChartModal();
        });
        ctaBar.appendChild(chartBtn);

        setupForm.appendChild(ctaBar);

        // 1. Crew Selector (6 Accessible <button> Cards with Pixel Captain Portraits)
        var crewGroup = document.createElement('div');
        crewGroup.className = 'glt-form-group';
        var crewLabel = document.createElement('h3');
        crewLabel.className = 'glt-group-title';
        crewLabel.textContent = T.ui.selectCrewPrompt;
        crewGroup.appendChild(crewLabel);

        var crewGrid = document.createElement('div');
        crewGrid.className = 'glt-crew-grid';

        GLT.rules.CREWS.forEach(function(c) {
          var isSelected = c.id === self.matchConfig.crewId;
          var cBtn = document.createElement('button');
          cBtn.type = 'button';
          cBtn.className = 'glt-crew-card' + (isSelected ? ' selected' : '');
          cBtn.setAttribute('aria-pressed', isSelected ? 'true' : 'false');

          var fallbackUrl = (GLT.backdropFx && GLT.backdropFx.generateCaptainAvatarDataUrl)
            ? GLT.backdropFx.generateCaptainAvatarDataUrl(c.id, 64)
            : '';
          var portraitUrl = (GLT.assets && GLT.assets.portraits && GLT.assets.portraits[c.id]) || fallbackUrl;
          var sealUrl = (GLT.assets && GLT.assets.emblems && GLT.assets.emblems[c.id]) || '';

          cBtn.innerHTML =
            '<div class="crew-color-bar" style="background:' + c.colors.primary + '"></div>' +
            (portraitUrl ? '<img class="crew-portrait-thumb" src="' + portraitUrl + '" alt="' + c.captain + '" onerror="this.onerror=null;this.src=\'' + fallbackUrl + '\'">' : '') +
            '<div class="crew-meta">' +
              '<strong class="crew-name">' + c.name + '</strong>' +
              '<span class="crew-captain">' + c.captain + '</span>' +
              '<small class="crew-technique">' + T.techniques[c.technique].shortName + '</small>' +
            '</div>' +
            (sealUrl ? '<img class="crew-seal-stamp" src="' + sealUrl + '" alt="" loading="lazy">' : '');

          cBtn.addEventListener('click', function() {
            var roomClient = (self.pvpRoomId && self.pvpClient && self.pvpClient.role === 'player') ? self.pvpClient : null;
            var roomSeat = roomClient && roomClient.state && roomClient.state.players
              ? roomClient.state.players[roomClient.playerIndex]
              : null;
            if (roomSeat && roomSeat.ready) {
              // The committed fleet belongs to the crew it was committed with.
              self.announce(T.lobby.crewLockedAfterCommit);
              return;
            }
            self.matchConfig.crewId = c.id;
            if (roomClient && typeof roomClient.selectCrew === 'function') roomClient.selectCrew(c.id);
            if (self.matchConfig.enemyCrewId === c.id) {
              self.matchConfig.enemyCrewId = c.id === 'marines' ? 'straw_hats' : 'marines';
            }
            // Immediately update speech bubble & avatar to selected captain!
            self.updateDialogueBox(c.id, false, 'intro');

            // Re-generate and auto-place player fleet with the selected crew's authentic ships!
            self.autoPlacePlayerFleet('spread');

            self.renderGameplayTab();
            self.renderFleetTab();
            if (self.dom.tabPvp) self.renderPvpTab();
            if (self.audio) self.audio.playUiClick();
          });
          crewGrid.appendChild(cBtn);
        });
        crewGroup.appendChild(crewGrid);
        setupForm.appendChild(crewGroup);

        // Helper for labelled <select> columns
        function makeSelectCol(selectId, labelText, optionsArr, currentVal, onChangeFn, locked) {
          var col = document.createElement('div');
          col.className = 'glt-col';
          var lbl = document.createElement('label');
          lbl.htmlFor = selectId;
          lbl.textContent = labelText;
          var sel = document.createElement('select');
          sel.id = selectId;
          optionsArr.forEach(function(o) {
            var opt = document.createElement('option');
            opt.value = o.value;
            opt.textContent = o.label;
            opt.selected = String(o.value) === String(currentVal);
            sel.appendChild(opt);
          });
          if (locked) {
            sel.disabled = true;
            sel.title = T.lobby.rulesLockedByRoom(self.pvpRoomId);
          }
          sel.addEventListener('change', function() {
            onChangeFn(sel.value);
            self.onMatchConfigChanged();
          });
          col.appendChild(lbl);
          col.appendChild(sel);
          return col;
        }

        // 2. Rival Crew & Difficulty Row
        var rowRivalDiff = document.createElement('div');
        rowRivalDiff.className = 'glt-row-options';

        rowRivalDiff.appendChild(makeSelectCol(
          'sel-enemy-crew',
          T.ui.selectEnemyCrewPrompt,
          GLT.rules.CREWS.map(function(c) { return { value: c.id, label: c.name }; }),
          this.matchConfig.enemyCrewId,
          function(val) {
            self.matchConfig.enemyCrewId = val;
            self.updateDialogueBox(val, true, 'intro');
            if (self._enemyTauntResetTimer) clearTimeout(self._enemyTauntResetTimer);
            self._enemyTauntResetTimer = setTimeout(function() {
              if (self.gamePhase === 'SETUP') {
                self.updateDialogueBox(self.matchConfig.crewId, false, 'intro');
              }
            }, 3500);
          }
        ));

        rowRivalDiff.appendChild(makeSelectCol(
          'sel-difficulty',
          T.ui.selectDifficultyPrompt,
          ['grumete', 'marujo', 'capitao', 'yonkou'].map(function(d) {
            return { value: d, label: T.difficulties[d].name };
          }),
          this.matchConfig.difficulty,
          function(val) { self.matchConfig.difficulty = val; }
        ));
        setupForm.appendChild(rowRivalDiff);

        if (rulesLocked) {
          var lockNote = document.createElement('p');
          lockNote.id = 'glt-rules-locked-note';
          lockNote.className = 'glt-rules-locked-note';
          lockNote.textContent = '🔒 ' + T.lobby.rulesLockedByRoom(this.pvpRoomId);
          setupForm.appendChild(lockNote);
        }

        // 3. Format & Mode Row
        var rowFmtMode = document.createElement('div');
        rowFmtMode.className = 'glt-row-options';

        rowFmtMode.appendChild(makeSelectCol(
          'sel-format',
          T.ui.selectFormatPrompt,
          GLT.rules.BOARDS.map(function(b) { return { value: b.id, label: b.name }; }),
          this.matchConfig.boardId,
          function(val) {
            self.matchConfig.boardId = val;
            self.selectedCandidateShipIndex = -1;
            if (self.seriesMemory && GLT.ai && GLT.ai.createSeriesMemory) {
              self.seriesMemory = GLT.ai.createSeriesMemory();
            }
            if (self.platesSystem) {
              self.platesSystem.setBoardSize((GLT.rules.BOARDS_MAP[val] || { size: 10 }).size);
            }
            self.autoPlacePlayerFleet('spread');
          },
          rulesLocked
        ));

        rowFmtMode.appendChild(makeSelectCol(
          'sel-mode',
          T.ui.selectModePrompt,
          ['tatico', 'classico'].map(function(m) { return { value: m, label: T.modes[m].name }; }),
          this.matchConfig.mode,
          function(val) {
            self.matchConfig.mode = val;
            self.updateTopHudStatus();
          },
          rulesLocked
        ));
        setupForm.appendChild(rowFmtMode);

        // 4. Sea, Series & Turn Timer Row
        var rowSeaSeries = document.createElement('div');
        rowSeaSeries.className = 'glt-row-options';

        rowSeaSeries.appendChild(makeSelectCol(
          'sel-sea',
          T.ui.selectSeaPrompt,
          GLT.rules.SEAS.map(function(s) { return { value: s.id, label: s.name }; }),
          this.matchConfig.sea,
          function(val) {
            self.matchConfig.sea = val;
            if (self.platesSystem) {
              self.platesSystem.setEnvironment(self.seaToEnvProfile(val), 800, val);
            }
            self.updateTopHudStatus();
            self.updateSeaPreviewBox();
          },
          rulesLocked
        ));

        rowSeaSeries.appendChild(makeSelectCol(
          'sel-series',
          T.ui.selectSeriesPrompt,
          [1, 3, 5].map(function(n) {
            return { value: n, label: n === 1 ? T.series.md1 : n === 3 ? T.series.md3 : T.series.md5 };
          }),
          this.matchConfig.seriesLength,
          function(val) {
            self.matchConfig.seriesLength = parseInt(val, 10);
            self.seriesWins = [0, 0];
            self.currentSeriesGame = 1;
            self.updateTopHudStatus();
          }
        ));
        setupForm.appendChild(rowSeaSeries);

        // 4.1 Island & Sea Tactical Preview Box
        setupForm.appendChild(self.createSeaPreviewBox());

        // 5. Combat Rules Chips + Turn Timer Select
        var rulesGroup = document.createElement('div');
        rulesGroup.className = 'glt-form-group';
        var rulesHeading = document.createElement('h3');
        rulesHeading.className = 'glt-group-title';
        rulesHeading.textContent = T.ui.rulesTitle;
        rulesGroup.appendChild(rulesHeading);

        var rulesGrid = document.createElement('div');
        rulesGrid.className = 'glt-rules-grid';

        ['allowTouch', 'continueOnHit', 'salvo', 'fog'].forEach(function(ruleKey) {
          var rChip = document.createElement('button');
          rChip.type = 'button';
          rChip.className = 'glt-rule-chip';
          rChip.dataset.rule = ruleKey;
          var active = !!self.matchConfig[ruleKey];
          rChip.setAttribute('aria-pressed', active ? 'true' : 'false');
          rChip.textContent = T.rules[ruleKey].name;
          rChip.title = T.rules[ruleKey].desc;
          rChip.disabled = rulesLocked;
          rChip.addEventListener('click', function() {
            self.matchConfig[ruleKey] = !self.matchConfig[ruleKey];
            if (ruleKey === 'allowTouch' && !self.matchConfig.allowTouch) {
              self.autoPlacePlayerFleet('spread');
            } else {
              self.renderGameplayTab();
            }
            self.onMatchConfigChanged();
            if (self.audio) self.audio.playUiClick();
          });
          rulesGrid.appendChild(rChip);
        });
        rulesGroup.appendChild(rulesGrid);

        var timerRow = document.createElement('div');
        timerRow.style.marginTop = '4px';
        timerRow.appendChild(makeSelectCol(
          'sel-turn-timer',
          T.rules.turnTimer.name,
          [
            { value: 0, label: T.rules.turnTimer.off },
            { value: 20, label: T.rules.turnTimer.s20 },
            { value: 30, label: T.rules.turnTimer.s30 },
            { value: 60, label: T.rules.turnTimer.s60 }
          ],
          this.matchConfig.turnTimer,
          function(val) {
            self.matchConfig.turnTimer = parseInt(val, 10);
            if (self.dom.timerPill) {
              self.dom.timerPill.textContent = self.matchConfig.turnTimer > 0
                ? T.turns.timerSeconds(self.matchConfig.turnTimer)
                : T.rules.turnTimer.off;
            }
          },
          rulesLocked
        ));
        rulesGroup.appendChild(timerRow);
        setupForm.appendChild(rulesGroup);

        // 6. Interactive Ship Dock
        var dockHeader = document.createElement('div');
        dockHeader.className = 'glt-dock-header';
        var orientText = this.candidateHorizontal ? T.ui.orientationHorizontal : T.ui.orientationVertical;
        dockHeader.innerHTML =
          '<h3 class="glt-group-title">' + T.ui.fleetSetupTitle + ' (' + orientText + ')</h3>' +
          '<span class="glt-badge">' + T.ui.placedCount(this.placedPlayerFleet.length, totalShips) + '</span>';
        setupForm.appendChild(dockHeader);

        var shipDock = document.createElement('div');
        shipDock.className = 'glt-ship-dock';

        shipsList.forEach(function(shipDef, idx) {
          var isPlaced = self.placedPlayerFleet.some(function(ps) { return ps.id === shipDef.id; });
          var isCandidate = idx === self.selectedCandidateShipIndex;
          var itemBtn = document.createElement('button');
          itemBtn.type = 'button';
          itemBtn.className = 'glt-ship-dock-item' +
            (isCandidate ? ' active-candidate' : '') +
            (isPlaced ? ' is-placed' : '');
          itemBtn.setAttribute('aria-pressed', isCandidate ? 'true' : 'false');

          var pipsHtml = '<span class="ship-pips">';
          for (var p = 0; p < shipDef.length; p++) pipsHtml += '<span class="ship-pip"></span>';
          pipsHtml += '</span>';

          itemBtn.innerHTML =
            '<span class="ship-dock-label">' + (isPlaced ? '✓ ' : '') + shipDef.name + '</span>' +
            pipsHtml;

          itemBtn.addEventListener('click', function() {
            if (self.selectedCandidateShipIndex === idx) {
              self.selectedCandidateShipIndex = -1;
              if (self.platesSystem) self.platesSystem.seaPlates.hideValidityGhost();
            } else {
              self.selectedCandidateShipIndex = idx;
            }
            self.renderGameplayTab();
            if (self.audio) self.audio.playUiClick();
          });
          shipDock.appendChild(itemBtn);
        });
        setupForm.appendChild(shipDock);

        // Action Buttons Row (Auto, Random, Clear, Rotate)
        var actionRow = document.createElement('div');
        actionRow.className = 'glt-btn-row';

        var autoBtn = document.createElement('button');
        autoBtn.type = 'button';
        autoBtn.className = 'glt-btn btn-sm';
        autoBtn.textContent = T.ui.autoPlaceButton;
        autoBtn.addEventListener('click', function() { self.autoPlacePlayerFleet('spread'); });

        var randomBtn = document.createElement('button');
        randomBtn.type = 'button';
        randomBtn.className = 'glt-btn btn-sm';
        randomBtn.textContent = T.ui.randomPlaceButton;
        randomBtn.addEventListener('click', function() { self.autoPlacePlayerFleet('random'); });

        var clearBtn = document.createElement('button');
        clearBtn.type = 'button';
        clearBtn.className = 'glt-btn btn-sm';
        clearBtn.textContent = T.ui.clearButton;
        clearBtn.addEventListener('click', function() { self.clearPlayerFleet(); });

        var rotateBtn = document.createElement('button');
        rotateBtn.type = 'button';
        rotateBtn.className = 'glt-btn btn-sm';
        rotateBtn.textContent = T.ui.rotateButton;
        rotateBtn.addEventListener('click', function() { self.rotateCandidateShip(); });

        actionRow.appendChild(autoBtn);
        actionRow.appendChild(randomBtn);
        actionRow.appendChild(clearBtn);
        actionRow.appendChild(rotateBtn);
        setupForm.appendChild(actionRow);

        // 7. 2D Interactive Tactical Placement Grid
        if (this.show2dRadar) {
          var plates = this.getMyPlatesIndices();
          setupForm.appendChild(this.build2dRadarGrid(plates.myPlate, true, false));
        }

        container.appendChild(setupForm);

      } else if (this.gamePhase === 'BATTLE') {
        var battlePanel = document.createElement('div');
        battlePanel.className = 'glt-battle-panel';

        var canPlayerAct = this.isPvpMode
          ? (this.isMyPvpTurn() && !this.shotInFlight)
          : (this.matchState && this.matchState.turn === 0 && !this.isCpuThinking && !this.shotInFlight);

        // Live Fleet Summary Strip
        var summaryStrip = document.createElement('div');
        summaryStrip.className = 'glt-fleet-summary-strip';
        var myAlive = 0;
        var myTotal = 0;
        var oppAlive = 0;
        var oppTotal = 0;
        if (this.isPvpMode && this.pvpClient && this.pvpClient.state) {
          var pIdx = this.pvpClient.role === 'player' ? this.pvpClient.playerIndex : 0;
          myTotal = this.pvpClient.state.boards[1 - pIdx].totalShips;
          myAlive = this.pvpClient.state.boards[1 - pIdx].remainingShips;
          oppTotal = this.pvpClient.state.boards[pIdx].totalShips;
          oppAlive = this.pvpClient.state.boards[pIdx].remainingShips;
        } else if (this.matchState) {
          myTotal = this.matchState.players[0].fleet.length;
          myAlive = this.matchState.players[0].shipsRemaining;
          oppTotal = this.matchState.players[1].fleet.length;
          oppAlive = this.matchState.players[1].shipsRemaining;
        }
        summaryStrip.innerHTML =
          '<span>🎯 ' + T.ui.enemyFleetStatus + ': ' + oppAlive + '/' + oppTotal + '</span>' +
          '<span>⚓ ' + T.ui.playerFleetStatus + ': ' + myAlive + '/' + myTotal + '</span>';
        battlePanel.appendChild(summaryStrip);

        // Triggers Grid (FOGO! + Técnica + Log Pose)
        var triggersGrid = document.createElement('div');
        triggersGrid.className = 'glt-battle-triggers';

        var fireBtn = document.createElement('button');
        fireBtn.type = 'button';
        fireBtn.id = 'btn-fire-shot';
        fireBtn.className = 'glt-btn btn-fire';
        fireBtn.textContent = '🔥 ' + T.ui.fireButton;
        fireBtn.setAttribute('aria-label', T.ui.fireButtonAria);
        fireBtn.disabled = !canPlayerAct;
        fireBtn.addEventListener('click', function() {
          self.confirmFireShot();
        });
        triggersGrid.appendChild(fireBtn);

        var activeMode = this.isPvpMode && this.pvpClient && this.pvpClient.state
          ? this.pvpClient.state.matchConfig.mode
          : this.matchConfig.mode;

        if (activeMode === 'tatico') {
          var techUsed = false;
          var techKey = 'bazooka';
          if (this.isPvpMode && this.pvpClient && this.pvpClient.state) {
            var myP = this.pvpClient.role === 'player' ? this.pvpClient.playerIndex : 0;
            techUsed = this.pvpClient.state.players[myP].techniqueUsed;
            var cDef = GLT.rules.CREWS_MAP[this.matchConfig.crewId] || GLT.rules.CREWS_MAP.straw_hats;
            techKey = cDef.technique;
          } else if (this.matchState) {
            techUsed = this.matchState.players[0].techniqueUsed;
            techKey = this.matchState.players[0].technique;
          }

          var techBtn = document.createElement('button');
          techBtn.type = 'button';
          techBtn.id = 'btn-crew-technique';
          techBtn.className = 'glt-btn btn-technique' + (this.isUsingTechnique ? ' active-mode' : '');
          techBtn.textContent = techUsed
            ? T.ui.techniqueUsedBadge
            : T.ui.techniqueButton(T.techniques[techKey].shortName);
          techBtn.title = T.techniques[techKey].desc;
          techBtn.disabled = techUsed || !canPlayerAct;
          techBtn.addEventListener('click', function() {
            self.triggerSpecialTechnique();
          });
          triggersGrid.appendChild(techBtn);
        }

        if (!this.isPvpMode) {
          var hintBtn = document.createElement('button');
          hintBtn.type = 'button';
          hintBtn.id = 'btn-log-pose-hint';
          hintBtn.className = 'glt-btn btn-hint';
          hintBtn.textContent = '🧭 ' + T.ui.hintRemaining(this.hintsRemaining);
          hintBtn.disabled = this.hintsRemaining <= 0 || !canPlayerAct;
          hintBtn.addEventListener('click', function() {
            self.useLogPoseHint();
          });
          triggersGrid.appendChild(hintBtn);
        }

        battlePanel.appendChild(triggersGrid);

        // Primary 2D Tactical Radar (Enemy Waters) + Compact Defense Status Radar (My Waters)
        if (this.show2dRadar) {
          var radarPlates = this.getMyPlatesIndices();
          var radarView = this.getRadarView();

          var viewRow = document.createElement('div');
          viewRow.className = 'glt-radar-view-row';
          viewRow.setAttribute('role', 'group');
          viewRow.setAttribute('aria-label', T.ui.radarViewLabel || 'Radar');
          [['enemy', T.ui.radarViewEnemy || 'Águas Inimigas'], ['both', T.ui.radarViewBoth || 'Ambas']].forEach(function(opt) {
            var vBtn = document.createElement('button');
            vBtn.type = 'button';
            vBtn.className = 'glt-radar-view-btn' + (radarView === opt[0] ? ' active' : '');
            vBtn.dataset.radarView = opt[0];
            vBtn.setAttribute('aria-pressed', radarView === opt[0] ? 'true' : 'false');
            vBtn.textContent = opt[1];
            vBtn.addEventListener('click', function() {
              self.setRadarView(opt[0]);
            });
            viewRow.appendChild(vBtn);
          });
          battlePanel.appendChild(viewRow);

          battlePanel.appendChild(this.build2dRadarGrid(radarPlates.oppPlate, false, false));
          if (radarView === 'both') {
            battlePanel.appendChild(this.build2dRadarGrid(radarPlates.myPlate, false, true));
          }
        }

        // Quick Den Den Mushi Reactions inside active Online PvP Battle
        if (this.isPvpMode && this.pvpClient) {
          var battleReactTitle = document.createElement('h4');
          battleReactTitle.className = 'glt-group-title';
          battleReactTitle.style.marginTop = '4px';
          battleReactTitle.textContent = T.reactions.quickBarTitle;
          battlePanel.appendChild(battleReactTitle);
          battlePanel.appendChild(this.buildReactionsGridDom());
        }

        // Secondary Action Bar: Abandon Ship / Surrender (hidden for spectators)
        if (!this.isPvpMode || this.pvpRole === 'player') {
          var secBar = document.createElement('div');
          secBar.className = 'glt-battle-secondary-bar';
          var abandonBtn = document.createElement('button');
          abandonBtn.type = 'button';
          abandonBtn.id = 'btn-abandon-ship';
          abandonBtn.className = 'glt-btn btn-sm btn-danger-outline';
          abandonBtn.setAttribute('aria-label', T.forfeit.abandonButtonAria);
          abandonBtn.textContent = T.forfeit.abandonButton;
          abandonBtn.addEventListener('click', function() {
            self.showAbandonShipModal();
          });
          secBar.appendChild(abandonBtn);
          battlePanel.appendChild(secBar);
        }

        container.appendChild(battlePanel);
        this.fitBattleRadar();
      }

      this.renderFloatingControls();
      this.renderHudMinimap();
    },

    /** Phone or narrow window, upright (panel under the scene) or sideways (panel beside it). */
    isNarrowLayout: function() {
      return typeof window !== 'undefined' && typeof window.matchMedia === 'function' &&
        (window.matchMedia('(max-width: 900px)').matches || this.isCompactLandscape());
    },

    /** Phone turned sideways: short screen, scene and panel side by side (see build.js CSS). */
    isCompactLandscape: function() {
      return typeof window !== 'undefined' && typeof window.matchMedia === 'function' &&
        window.matchMedia('(orientation: landscape) and (max-height: 520px)').matches;
    },

    /** 'enemy' = only the waters being attacked; 'both' = own waters below. Phones start on 'enemy'. */
    getRadarView: function() {
      if (this.radarView !== 'enemy' && this.radarView !== 'both') {
        var saved = null;
        try { saved = localStorage.getItem('glt_radar_view'); } catch (_) {}
        this.radarView = (saved === 'enemy' || saved === 'both') ? saved : (this.isNarrowLayout() ? 'enemy' : 'both');
      }
      return this.radarView;
    },

    setRadarView: function(view) {
      this.radarView = view === 'both' ? 'both' : 'enemy';
      try { localStorage.setItem('glt_radar_view', this.radarView); } catch (_) {}
      this.renderGameplayTab();
      if (this.audio) this.audio.playUiClick();
    },

    /**
     * Stacked layout (phone, narrow window): the enemy radar is sized so that the whole grid
     * fits in the visible part of the panel, with no scrolling to reach a row.
     */
    fitBattleRadar: function() {
      var pane = this.dom && this.dom.tabGameplay;
      if (!pane || typeof pane.querySelector !== 'function') return;
      var radar = pane.querySelector('.glt-battle-panel .glt-radar-grid-wrapper:not(.glt-mini-radar)');
      if (!radar || !radar.style) return;
      radar.style.maxWidth = '';
      var wrap = pane.parentNode;
      if (!this.isNarrowLayout() || !wrap || typeof radar.getBoundingClientRect !== 'function') return;
      var width = radar.offsetWidth;
      if (!width || !wrap.clientHeight) return; // tab not on screen
      var topInContent = radar.getBoundingClientRect().top - wrap.getBoundingClientRect().top + wrap.scrollTop;
      var frame = radar.offsetHeight - width; // title and padding around the square grid
      var room = wrap.clientHeight - topInContent - 12 - frame;
      var fitted = Math.max(this.isCompactLandscape() ? 170 : 230, Math.floor(room));
      if (fitted < width) radar.style.maxWidth = fitted + 'px';
    },

    /**
     * Builds Semantic HTML <table> 2D Tactical Radar Grid
     */
    build2dRadarGrid: function(plateIdx, isPlacement, isMiniDefense) {
      var self = this;
      var T = getT();
      var boardSize = this.getActiveBoardSize();
      var plates = this.getMyPlatesIndices();
      var isMyWaters = plateIdx === plates.myPlate;

      var gridWrapper = document.createElement('div');
      gridWrapper.className = 'glt-radar-grid-wrapper' + (isMiniDefense ? ' glt-mini-radar' : '');

      var title = document.createElement('h4');
      title.className = 'glt-radar-title';
      title.textContent = isMyWaters ? T.ui.myWaters : T.ui.enemyWaters;
      gridWrapper.appendChild(title);

      var table = document.createElement('table');
      table.className = 'glt-radar-table';

      var caption = document.createElement('caption');
      caption.className = 'sr-only';
      caption.textContent = isMyWaters ? T.ui.myWaters : T.ui.enemyWaters;
      table.appendChild(caption);

      var thead = document.createElement('thead');
      var headTr = document.createElement('tr');
      var cornerTh = document.createElement('th');
      cornerTh.scope = 'col';
      cornerTh.textContent = '⚓';
      headTr.appendChild(cornerTh);

      for (var c = 0; c < boardSize; c++) {
        var colTh = document.createElement('th');
        colTh.scope = 'col';
        colTh.textContent = String(c + 1);
        headTr.appendChild(colTh);
      }
      thead.appendChild(headTr);
      table.appendChild(thead);

      // Compute candidate ghost cells for 2D placement preview
      var ghostSet = {};
      if (isPlacement && this.hoveredPlacementCell && this.selectedCandidateShipIndex !== -1) {
        var ships = GLT.rules.getShipsForBoard(this.matchConfig.boardId, this.matchConfig.crewId);
        var candTmpl = ships[this.selectedCandidateShipIndex];
        if (candTmpl) {
          for (var gi = 0; gi < candTmpl.length; gi++) {
            var gr = this.candidateHorizontal ? this.hoveredPlacementCell.r : this.hoveredPlacementCell.r + gi;
            var gc = this.candidateHorizontal ? this.hoveredPlacementCell.c + gi : this.hoveredPlacementCell.c;
            ghostSet[gr + ',' + gc] = this.placementValid ? 'ghost-valid' : 'ghost-invalid';
          }
        }
      }

      var tbody = document.createElement('tbody');

      for (var r = 0; r < boardSize; r++) {
        var tr = document.createElement('tr');
        var rowTh = document.createElement('th');
        rowTh.scope = 'row';
        rowTh.textContent = String.fromCharCode(65 + r);
        tr.appendChild(rowTh);

        for (var c2 = 0; c2 < boardSize; c2++) {
          var td = document.createElement('td');
          var cell = document.createElement('button');
          cell.type = 'button';
          cell.className = 'radar-cell';
          cell.dataset.r = r;
          cell.dataset.c = c2;
          var coordLabel = GLT.rules.coordToLabel(r, c2);
          cell.setAttribute('aria-label', coordLabel);

          var cellKey = r + ',' + c2;

          if (isPlacement) {
            var hasShip = this.placedPlayerFleet.some(function(s) {
              return s.cells && s.cells.some(function(sc) { return sc.r === r && sc.c === c2; });
            });
            if (hasShip) cell.classList.add('ship');
            if (ghostSet[cellKey]) cell.classList.add(ghostSet[cellKey]);

            (function(row, col) {
              cell.addEventListener('mouseenter', function() {
                self.hoveredPlacementCell = { r: row, c: col };
                self.handlePlacementHover(row, col);
              });
              cell.addEventListener('click', function() {
                self.handlePlacementClick(row, col);
              });
            })(r, c2);

          } else if (!isMyWaters) {
            // Enemy Waters Target Radar (oppPlate)
            var shot = null;
            if (this.isPvpMode && this.pvpClient && this.pvpClient.state) {
              var myPIdx = this.pvpClient.role === 'player' ? this.pvpClient.playerIndex : 0;
              var pvpS = this.pvpClient.state.boards[myPIdx].shots[cellKey];
              if (pvpS) shot = { result: pvpS.outcome, turn: pvpS.turn };
            } else if (this.matchState) {
              shot = this.matchState.players[1].shotsTaken[cellKey];
            }

            var isRevealed = !shot && this.playerRevealedCells.some(function(rc) { return rc.r === r && rc.c === c2; });

            if (shot) {
              var isFaded = !this.isPvpMode && this.matchState && this.matchState.fog &&
                shot.result === 'water' && GLT.rules.isShotFaded(this.matchState, shot.turn);
              if (isFaded) {
                cell.classList.add('is-fog');
                cell.textContent = '?';
                cell.setAttribute('aria-label', T.ui.fogCellAria(coordLabel));
              } else {
                cell.classList.add(shot.result);
                cell.textContent = shot.result === 'water' ? '·' : shot.result === 'hit' ? '✕' : shot.result === 'sunk' ? '☠' : '◌';
              }
            } else if (isRevealed) {
              td.classList.add('is-revealed');
              cell.classList.add('is-revealed');
              cell.textContent = '★';
              cell.setAttribute('aria-label', T.ui.revealedCellAria(coordLabel));
            }

            if (this.selectedAimCell && this.selectedAimCell.r === r && this.selectedAimCell.c === c2) {
              cell.classList.add('selected');
            }

            (function(row, col) {
              cell.addEventListener('click', function() {
                self.handleBattleCellClick(row, col);
              });
            })(r, c2);

          } else {
            // Mini Defense Status Radar (My Waters)
            cell.tabIndex = -1;
            var hasMyShip = this.placedPlayerFleet.some(function(s) {
              return s.cells && s.cells.some(function(sc) { return sc.r === r && sc.c === c2; });
            });
            if (hasMyShip) cell.classList.add('ship');

            var incomingShot = null;
            if (this.isPvpMode && this.pvpClient && this.pvpClient.state) {
              var oppPIdx = 1 - (this.pvpClient.role === 'player' ? this.pvpClient.playerIndex : 0);
              var incS = this.pvpClient.state.boards[oppPIdx].shots[cellKey];
              if (incS) incomingShot = { result: incS.outcome };
            } else if (this.matchState) {
              incomingShot = this.matchState.players[0].shotsTaken[cellKey];
            }

            if (incomingShot) {
              cell.classList.add(incomingShot.result);
              cell.textContent = incomingShot.result === 'water' ? '·' : '✕';
            }
          }

          td.appendChild(cell);
          tr.appendChild(td);
        }
        tbody.appendChild(tr);
      }

      table.appendChild(tbody);
      gridWrapper.appendChild(table);
      return gridWrapper;
    },

    // The Online tab shows the Combate options before a room exists: keep it current.
    onMatchConfigChanged: function() {
      if (!this.pvpRoomId && this.dom && this.dom.tabPvp) this.renderPvpTab();
    },

    crewPortraitUrls: function(crewId, size) {
      var fallbackUrl = (GLT.backdropFx && GLT.backdropFx.generateCaptainAvatarDataUrl)
        ? GLT.backdropFx.generateCaptainAvatarDataUrl(crewId, size || 64)
        : '';
      var url = (GLT.assets && GLT.assets.portraits && GLT.assets.portraits[crewId]) || fallbackUrl;
      return { url: url, fallback: fallbackUrl };
    },

    renderPvpTab: function() {
      var self = this;
      var T = getT();
      var i18n = getI18n();
      var container = this.dom.tabPvp;
      if (!container) return;
      container.innerHTML = '';

      // Entering or leaving a room locks or frees the rule controls of the Combate tab.
      if (!!this.pvpRoomId !== !!this._rulesLockShown && this.gamePhase === 'SETUP' && this.dom.tabGameplay) {
        this.renderGameplayTab();
      }

      var pvpBox = document.createElement('div');
      pvpBox.className = 'glt-pvp-panel';

      var backendType = (this.pvpLobbyTransport && this.pvpLobbyTransport.getBackendType)
        ? this.pvpLobbyTransport.getBackendType()
        : 'none';

      // 1. Connection Status Banner
      var statusBadge = document.createElement('div');
      statusBadge.className = 'glt-pvp-status-bar ' + (this.pvpStatus === 'connected' ? 'connected' : 'disconnected');
      statusBadge.id = 'glt-pvp-status';
      statusBadge.setAttribute('role', 'status');
      var dotClass = this.pvpStatus === 'connected' ? 'connected' : 'disconnected';
      var statusText = this.pvpStatus === 'connected'
        ? (backendType === 'lanRelay'
          ? T.lobby.lanReadyBadge
          : backendType === 'artifactDb'
            ? T.lobby.artifactDbReadyBadge
            : backendType === 'peer'
              ? T.lobby.peerReadyBadge
              : T.lobby.crossTabReadyBadge)
        : (this.pvpStatus === 'connecting' ? T.lobby.connectingBadge : this.pvpUnavailableText());

      var dotEl = document.createElement('span');
      dotEl.className = 'status-dot ' + dotClass;
      var txtEl = document.createElement('span');
      txtEl.className = 'status-text';
      txtEl.textContent = statusText;
      statusBadge.appendChild(dotEl);
      statusBadge.appendChild(txtEl);
      pvpBox.appendChild(statusBadge);

      // Host = seat 0 of the current room. Anyone else in a room (guest, spectator) and any
      // instance opened from an invite link is a guest: it never gets host-only controls.
      var isRoomHost = !!this.pvpRoomId && !!this.pvpClient && this.pvpClient.role === 'player' && this.pvpClient.playerIndex === 0;
      var isGuestInstance = (!!this.pvpRoomId && !isRoomHost) || (!this.pvpRoomId && !!this.pvpInviteCode);

      // 1B. Wi-Fi / LAN Share Card (or helpful LAN launcher hint when in single-device tab mode)
      if (backendType === 'lanRelay' && isGuestInstance) {
        // Guests are already on the server: no address, no QR Code.
      } else if (backendType === 'lanRelay') {
        var lanUrls = (this.pvpLobbyTransport && this.pvpLobbyTransport.getLanUrls)
          ? this.pvpLobbyTransport.getLanUrls()
          : [];
        var primaryLanUrl = lanUrls.length > 0 ? lanUrls[0] : window.location.origin;
        if (this.pvpRoomId) {
          primaryLanUrl = primaryLanUrl.replace(/\/$/, '') + '/?room=' + this.pvpRoomId;
        }

        var lanCard = document.createElement('div');
        lanCard.className = 'glt-lan-share-card';
        var lanLbl = document.createElement('span');
        lanLbl.textContent = '📡 ' + T.lobby.lanAddressLabel;
        lanCard.appendChild(lanLbl);

        var lanRow = document.createElement('div');
        lanRow.className = 'glt-lan-url-row';
        var lanCode = document.createElement('code');
        lanCode.className = 'glt-lan-url-code';
        lanCode.textContent = primaryLanUrl;

        var copyIpBtn = document.createElement('button');
        copyIpBtn.type = 'button';
        copyIpBtn.className = 'glt-btn btn-sm btn-secondary';
        copyIpBtn.textContent = T.lobby.lanCopyAddressButton;
        copyIpBtn.addEventListener('click', function() {
          self.copyTextSafe(primaryLanUrl, T.lobby.lanAddressCopied);
        });

        lanRow.appendChild(lanCode);
        lanRow.appendChild(copyIpBtn);
        lanCard.appendChild(lanRow);

        if (!this.pvpRoomId) {
          // No QR Code before a room exists: a code without a room opens a full copy of the
          // game on the second device. The only QR Code is the room invite, shown after "Criar Sala".
          var lanQrHint = document.createElement('p');
          lanQrHint.className = 'glt-qr-hint';
          lanQrHint.id = 'glt-qr-after-create-hint';
          lanQrHint.textContent = '📱 ' + T.lobby.qrCodeAfterCreateHint;
          lanCard.appendChild(lanQrHint);
        }

        pvpBox.appendChild(lanCard);
      } else if (window.location.protocol === 'file:') {
        var fileNotice = document.createElement('div');
        fileNotice.className = 'glt-lan-file-notice';
        fileNotice.innerHTML =
          '<strong>💡 ' + (T.lobby.fileProtocolNoticeTitle || 'Modo Arquivo Local (file://)') + '</strong>' +
          '<span>' + (T.lobby.fileProtocolNoticeDesc || 'Você abriu o jogo direto como arquivo. Este modo funciona para jogar entre duas abas neste mesmo computador.') + '</span>' +
          '<div class="glt-file-notice-steps">' +
            '<strong>' + (T.lobby.fileProtocolWifiHowToTitle || '📱 Para jogar no Celular ou Tablet pelo Wi-Fi:') + '</strong>' +
            '<ol>' +
              '<li>' + (T.lobby.fileProtocolWifiStep1 || 'Dê dois cliques no arquivo <code>jogar-no-wifi.cmd</code> na pasta do jogo (ou execute <code>npm run lan</code>).') + '</li>' +
              '<li>' + (T.lobby.fileProtocolWifiStep2 || 'O jogo abrirá no navegador com seu endereço Wi-Fi (ex: <code>http://192.168.x.x:8080</code>).') + '</li>' +
              '<li>' + (T.lobby.fileProtocolWifiStep3 || 'O QR Code e o link gerados funcionarão imediatamente na câmera de qualquer celular no mesmo Wi-Fi!') + '</li>' +
            '</ol>' +
          '</div>';
        pvpBox.appendChild(fileNotice);
      } else if (backendType === 'peer') {
        if (!this.pvpRoomId && !isGuestInstance) {
          var peerHint = document.createElement('div');
          peerHint.className = 'glt-lan-offline-hint';
          peerHint.id = 'glt-peer-howto-hint';
          peerHint.textContent = '🌐 ' + T.lobby.peerHowToHint;
          pvpBox.appendChild(peerHint);
        }
      } else if (backendType === 'broadcastChannel') {
        var lanHint = document.createElement('div');
        lanHint.className = 'glt-lan-offline-hint';
        lanHint.textContent = '💡 ' + T.lobby.lanOfflineHint;
        pvpBox.appendChild(lanHint);
      }

      // 2. Nickname Editor with explicit <label for="inp-pvp-nick">
      var nickGroup = document.createElement('div');
      nickGroup.className = 'glt-form-group';
      var nickLabel = document.createElement('label');
      nickLabel.htmlFor = 'inp-pvp-nick';
      nickLabel.textContent = T.lobby.nicknameLabel + ':';
      var nickInput = document.createElement('input');
      nickInput.type = 'text';
      nickInput.id = 'inp-pvp-nick';
      nickInput.className = 'glt-input';
      nickInput.value = this.pvpNickname;
      nickInput.maxLength = 18;
      nickInput.addEventListener('change', function() {
        self.saveStoredNickname(nickInput.value);
      });
      nickGroup.appendChild(nickLabel);
      nickGroup.appendChild(nickInput);
      pvpBox.appendChild(nickGroup);

      if (!this.pvpRoomId && this.pvpStatus !== 'connected') {
        // PvP off (capability null / no transport) or still connecting: no create/join controls.
        var offNote = document.createElement('p');
        offNote.className = 'glt-pvp-unavailable-note';
        offNote.id = 'glt-pvp-unavailable';
        offNote.textContent = this.pvpStatus === 'connecting' ? T.lobby.connectingHint : T.lobby.pvpUnavailablePvcHint;
        pvpBox.appendChild(offNote);
      } else if (!this.pvpRoomId && this.pvpInviteCode) {
        // Guest instance whose invite did not resolve (room closed, full, server restarted):
        // offer a retry, never the host controls.
        var inviteCard = document.createElement('div');
        inviteCard.className = 'glt-room-info-card';
        inviteCard.id = 'glt-pvp-invite-card';
        var inviteTitle = document.createElement('strong');
        inviteTitle.textContent = '📨 ' + T.lobby.inviteTitle(this.pvpInviteCode);
        var inviteHint = document.createElement('p');
        inviteHint.className = 'glt-qr-hint';
        inviteHint.textContent = T.lobby.inviteFailedHint;
        var inviteRow = document.createElement('div');
        inviteRow.className = 'glt-btn-row glt-room-btn-row';
        var inviteRetryBtn = document.createElement('button');
        inviteRetryBtn.type = 'button';
        inviteRetryBtn.id = 'btn-pvp-invite-retry';
        inviteRetryBtn.className = 'glt-btn btn-primary';
        inviteRetryBtn.textContent = T.lobby.inviteRetryButton;
        inviteRetryBtn.addEventListener('click', function() {
          self.joinPvpRoom(self.pvpInviteCode, 'player');
        });
        var inviteDismissBtn = document.createElement('button');
        inviteDismissBtn.type = 'button';
        inviteDismissBtn.id = 'btn-pvp-invite-dismiss';
        inviteDismissBtn.className = 'glt-btn btn-sm';
        inviteDismissBtn.textContent = T.lobby.inviteDismissButton;
        inviteDismissBtn.addEventListener('click', function() {
          self.pvpInviteCode = '';
          self.renderPvpTab();
        });
        inviteRow.appendChild(inviteRetryBtn);
        inviteRow.appendChild(inviteDismissBtn);
        inviteCard.appendChild(inviteTitle);
        inviteCard.appendChild(inviteHint);
        inviteCard.appendChild(inviteRow);
        pvpBox.appendChild(inviteCard);
      } else if (!this.pvpRoomId) {
        // Pre-Room Match Rules Summary Card
        var rulesSummaryCard = document.createElement('div');
        rulesSummaryCard.className = 'glt-pvp-rules-preview';
        var bDef = GLT.rules.BOARDS_MAP[this.matchConfig.boardId] || { name: '10x10' };
        var mDef = (T.modes && T.modes[this.matchConfig.mode]) || { name: this.matchConfig.mode === 'tatico' ? 'Modo Tático' : 'Modo Clássico' };
        var sDef = (GLT.rules.SEAS.find(function(s) { return s.id === self.matchConfig.sea; })) || { name: 'Mar Calmo' };
        var activeRulesList = [];
        if (this.matchConfig.allowTouch) activeRulesList.push('Navios Adjacentes');
        if (this.matchConfig.continueOnHit) activeRulesList.push('Continuar ao Acertar');
        if (this.matchConfig.salvo) activeRulesList.push('Disparos em Salva');
        if (this.matchConfig.fog) activeRulesList.push('Neblina de Guerra');
        var timerStr = this.matchConfig.turnTimer > 0 ? (this.matchConfig.turnTimer + 's') : 'Sem limite';

        rulesSummaryCard.innerHTML =
          '<div class="glt-pvp-rules-header">' +
            '<strong>⚙️ Regras Definidas na Aba Combate</strong>' +
            '<button type="button" class="glt-btn btn-sm btn-secondary btn-edit-rules" title="Ajustar regras na aba Combate">✏️ Ajustar</button>' +
          '</div>' +
          '<div class="glt-pvp-rules-grid">' +
            '<div class="glt-pvp-rule-item"><span>📐 Tabuleiro:</span> <strong>' + bDef.name + '</strong></div>' +
            '<div class="glt-pvp-rule-item"><span>⚔️ Formato:</span> <strong>' + mDef.name + '</strong></div>' +
            '<div class="glt-pvp-rule-item"><span>🌊 Mar:</span> <strong>' + sDef.name + '</strong></div>' +
            '<div class="glt-pvp-rule-item"><span>⏱️ Turno:</span> <strong>' + timerStr + '</strong></div>' +
          '</div>' +
          (activeRulesList.length > 0 ? ('<div class="glt-pvp-tags-row">' + activeRulesList.map(function(r) { return '<span class="glt-pvp-rule-tag">✓ ' + r + '</span>'; }).join('') + '</div>') : '');

        var editRulesBtn = rulesSummaryCard.querySelector('.btn-edit-rules');
        if (editRulesBtn) {
          editRulesBtn.addEventListener('click', function() {
            self.switchTab('tab-gameplay');
          });
        }
        pvpBox.appendChild(rulesSummaryCard);

        var createGroup = document.createElement('div');
        createGroup.className = 'glt-form-group';
        var createRoomBtn = document.createElement('button');
        createRoomBtn.type = 'button';
        createRoomBtn.id = 'btn-pvp-create';
        createRoomBtn.className = 'glt-btn btn-primary';
        createRoomBtn.style.width = '100%';
        createRoomBtn.textContent = '⚔️ ' + T.lobby.createRoomButton;
        createRoomBtn.addEventListener('click', function() {
          self.createPvpRoom();
        });
        createGroup.appendChild(createRoomBtn);
        pvpBox.appendChild(createGroup);

        var joinGroup = document.createElement('div');
        joinGroup.className = 'glt-form-group';
        var joinLabel = document.createElement('label');
        joinLabel.htmlFor = 'inp-pvp-code';
        joinLabel.textContent = T.lobby.enterCodePrompt;
        joinGroup.appendChild(joinLabel);

        var joinInputRow = document.createElement('div');
        joinInputRow.className = 'glt-btn-row glt-join-row';

        var codeInput = document.createElement('input');
        codeInput.type = 'text';
        codeInput.id = 'inp-pvp-code';
        codeInput.className = 'glt-input';
        codeInput.placeholder = T.lobby.roomCodePlaceholder;
        codeInput.maxLength = 5;
        codeInput.style.textTransform = 'uppercase';
        codeInput.style.letterSpacing = '3px';
        codeInput.style.fontWeight = 'bold';
        codeInput.style.width = '92px';
        codeInput.style.textAlign = 'center';

        var joinPlayerBtn = document.createElement('button');
        joinPlayerBtn.type = 'button';
        joinPlayerBtn.id = 'btn-pvp-join';
        joinPlayerBtn.className = 'glt-btn btn-secondary btn-sm';
        joinPlayerBtn.textContent = T.ui.joinAsPlayer;
        joinPlayerBtn.addEventListener('click', function() {
          self.joinPvpRoom(codeInput.value, 'player');
        });

        var joinSpecBtn = document.createElement('button');
        joinSpecBtn.type = 'button';
        joinSpecBtn.className = 'glt-btn btn-sm';
        joinSpecBtn.textContent = '👁️ ' + T.ui.joinAsSpectator;
        joinSpecBtn.addEventListener('click', function() {
          self.joinPvpRoom(codeInput.value, 'spectator');
        });

        joinInputRow.appendChild(codeInput);
        joinInputRow.appendChild(joinPlayerBtn);
        joinInputRow.appendChild(joinSpecBtn);
        joinGroup.appendChild(joinInputRow);
        pvpBox.appendChild(joinGroup);

        // Open Rooms List (Real Live Rooms + Delete / Clear Controls)
        // Over WebRTC there is no room directory, so the section stays out of the page.
        var roomsParent = pvpBox;
        if (backendType === 'peer') pvpBox = document.createElement('div');
        var openHeaderRow = document.createElement('div');
        openHeaderRow.className = 'glt-open-rooms-header';

        var openRoomsHeader = document.createElement('h4');
        openRoomsHeader.className = 'glt-group-title';
        openRoomsHeader.textContent = T.ui.openRoomsTitle;
        openHeaderRow.appendChild(openRoomsHeader);

        // On the Wi-Fi relay the list is shared by every device: nobody clears it for the others
        // (abandoned rooms leave by themselves). Elsewhere the list lives in this browser only.
        if (this.pvpOpenRooms.length > 0 && backendType !== 'lanRelay') {
          var clearRoomsBtn = document.createElement('button');
          clearRoomsBtn.type = 'button';
          clearRoomsBtn.id = 'btn-clear-open-rooms';
          clearRoomsBtn.className = 'glt-btn btn-sm btn-danger-ghost';
          clearRoomsBtn.textContent = T.lobby.clearRoomsButton;
          this.armTwoStepButton(clearRoomsBtn, T.lobby.clearRoomsConfirm, function() {
            self.clearOpenPvpRooms();
          });
          openHeaderRow.appendChild(clearRoomsBtn);
        }
        pvpBox.appendChild(openHeaderRow);

        var roomsList = document.createElement('div');
        roomsList.className = 'glt-open-rooms-list';

        if (this.pvpOpenRooms.length === 0) {
          var emptyNotice = document.createElement('div');
          emptyNotice.className = 'glt-empty-rooms';
          emptyNotice.textContent = T.ui.openRoomsEmpty;
          roomsList.appendChild(emptyNotice);
        } else {
          this.pvpOpenRooms.forEach(function(room) {
            var crew = GLT.rules.CREWS_MAP[room.crewId] || GLT.rules.CREWS_MAP.straw_hats;
            var card = document.createElement('div');
            card.className = 'open-room-card';

            var info = document.createElement('div');
            info.className = 'open-room-info';
            var hostStrong = document.createElement('strong');
            hostStrong.textContent = String(room.host || '') + ' (' + String(room.id || '') + ')';
            var metaSpan = document.createElement('span');
            metaSpan.style.color = 'var(--text-muted)';
            metaSpan.style.fontSize = '10px';
            var modeDef = T.modes[room.mode || 'tatico'] || T.modes.tatico;
            metaSpan.textContent = crew.name + ' • ' + String(room.format || '10x10') + ' • ' + modeDef.name;
            info.appendChild(hostStrong);
            info.appendChild(metaSpan);

            var actions = document.createElement('div');
            actions.className = 'open-room-actions';

            var joinQuickBtn = document.createElement('button');
            joinQuickBtn.type = 'button';
            joinQuickBtn.className = 'glt-btn btn-sm btn-primary';
            joinQuickBtn.textContent = T.ui.quickJoinButton;
            joinQuickBtn.addEventListener('click', function() {
              self.joinPvpRoom(room.id, 'player');
            });

            var delRoomBtn = document.createElement('button');
            delRoomBtn.type = 'button';
            delRoomBtn.className = 'glt-btn btn-sm btn-danger-ghost btn-delete-room';
            delRoomBtn.setAttribute('aria-label', T.lobby.deleteRoomAria(room.id));
            delRoomBtn.title = T.lobby.deleteRoomAria(room.id);
            var delIcon = document.createElement('span');
            delIcon.setAttribute('aria-hidden', 'true');
            delIcon.textContent = '✕';
            delRoomBtn.appendChild(delIcon);
            self.armTwoStepButton(delRoomBtn, T.lobby.deleteRoomConfirm(room.id), function() {
              self.deleteOpenPvpRoom(room.id);
            });

            actions.appendChild(joinQuickBtn);
            if (self.ownsPvpRoom(room.id)) actions.appendChild(delRoomBtn);

            card.appendChild(info);
            card.appendChild(actions);
            roomsList.appendChild(card);
          });
        }
        pvpBox.appendChild(roomsList);
        pvpBox = roomsParent;

        // Casual Bounty Board
        var bountyHeader = document.createElement('h4');
        bountyHeader.className = 'glt-group-title';
        bountyHeader.style.marginTop = '8px';
        bountyHeader.textContent = T.ui.bountyBoardCasual;
        pvpBox.appendChild(bountyHeader);

        var bountyTable = document.createElement('table');
        bountyTable.className = 'glt-bounty-table';
        bountyTable.innerHTML =
          '<thead><tr>' +
            '<th scope="col">' + T.ui.tableRank + '</th>' +
            '<th scope="col">' + T.ui.tableCaptain + '</th>' +
            '<th scope="col">' + T.ui.tableBounty + '</th>' +
            '<th scope="col">' + T.ui.tableWins + '</th>' +
          '</tr></thead>';

        var tbody = document.createElement('tbody');
        T.lobby.topPirates.forEach(function(p) {
          var tr = document.createElement('tr');
          tr.innerHTML =
            '<td><strong>' + p.rank + '</strong></td>' +
            '<td>' + p.name + '</td>' +
            '<td class="bounty-amount">' + i18n.formatBounty(p.bounty) + '</td>' +
            '<td>' + p.wins + '</td>';
          tbody.appendChild(tr);
        });
        bountyTable.appendChild(tbody);
        pvpBox.appendChild(bountyTable);

      } else {
        // --- IN-ROOM PVP VIEW ---
        var pSt = this.pvpClient ? this.pvpClient.state : null;
        var myIdx = (this.pvpClient && this.pvpClient.role === 'player') ? this.pvpClient.playerIndex : 0;
        var oppIdx = 1 - myIdx;
        var myReady = pSt && pSt.players[myIdx] ? pSt.players[myIdx].ready : false;
        var oppReady = pSt && pSt.players[oppIdx] ? pSt.players[oppIdx].ready : false;

        var roomInfo = document.createElement('div');
        roomInfo.className = 'glt-room-info-card';

        var roomMetaDiv = document.createElement('div');
        roomMetaDiv.className = 'glt-room-meta';
        var roomStrong = document.createElement('strong');
        roomStrong.textContent = T.lobby.roomCodeLabel + ': ' + this.pvpRoomId;
        var roomBr = document.createElement('br');
        var roomSmall = document.createElement('small');
        roomSmall.style.color = 'var(--text-muted)';
        roomSmall.textContent = this.pvpRole === 'spectator' ? T.lobby.roleSpectatorStatus : T.lobby.rolePlayerStatus;
        roomMetaDiv.appendChild(roomStrong);
        roomMetaDiv.appendChild(roomBr);
        roomMetaDiv.appendChild(roomSmall);

        var roomBtnRow = document.createElement('div');
        roomBtnRow.className = 'glt-btn-row glt-room-btn-row';

        var copyBtn = document.createElement('button');
        copyBtn.type = 'button';
        copyBtn.className = 'glt-btn btn-sm btn-copy';
        copyBtn.textContent = T.lobby.copyLinkButton;
        copyBtn.addEventListener('click', function() {
          var shareUrl = self.getPreferredShareBaseUrl() + '?room=' + self.pvpRoomId;
          self.copyTextSafe(shareUrl, T.lobby.linkCopied);
        });

        var leaveBtn = document.createElement('button');
        leaveBtn.type = 'button';
        leaveBtn.className = 'glt-btn btn-sm btn-leave';
        leaveBtn.textContent = T.ui.leaveRoomButton;
        leaveBtn.addEventListener('click', function() {
          self.leavePvpRoom();
        });

        var deleteActiveBtn = document.createElement('button');
        deleteActiveBtn.type = 'button';
        deleteActiveBtn.className = 'glt-btn btn-sm btn-danger-ghost btn-delete-active-room';
        deleteActiveBtn.textContent = T.lobby.deleteRoomButton;
        this.armTwoStepButton(deleteActiveBtn, T.lobby.deleteRoomConfirm(this.pvpRoomId), function() {
          self.deleteOpenPvpRoom(self.pvpRoomId);
        });

        var oppJoined = !!(pSt && pSt.players[oppIdx] && pSt.players[oppIdx].id);
        var inLobbyPhase = !pSt || pSt.phase === 'lobby';

        // Host-only controls: invite link, room deletion and the room QR Code.
        if (isRoomHost) roomBtnRow.appendChild(copyBtn);
        roomBtnRow.appendChild(leaveBtn);
        if (isRoomHost) roomBtnRow.appendChild(deleteActiveBtn);

        if (!isRoomHost && this.pvpRole === 'player') {
          var hostName = (pSt && pSt.players[0] && pSt.players[0].nickname) || T.ui.defaultCaptainName;
          var guestTitle = document.createElement('strong');
          guestTitle.id = 'glt-pvp-guest-title';
          guestTitle.textContent = T.lobby.guestInRoomTitle(hostName);
          var guestHint = document.createElement('small');
          guestHint.style.color = 'var(--text-muted)';
          guestHint.textContent = T.lobby.guestInRoomHint;
          roomMetaDiv.appendChild(document.createElement('br'));
          roomMetaDiv.appendChild(guestTitle);
          roomMetaDiv.appendChild(document.createElement('br'));
          roomMetaDiv.appendChild(guestHint);
        }

        roomInfo.appendChild(roomMetaDiv);
        roomInfo.appendChild(roomBtnRow);
        pvpBox.appendChild(roomInfo);

        // Room QR Code: only the host shows it, and only while the second seat is empty.
        if (isRoomHost && inLobbyPhase && !oppJoined) {
          var shareBase = self.getPreferredShareBaseUrl();
          var roomShareUrl = (/\.html?$/i.test(shareBase) ? shareBase : shareBase.replace(/\/$/, '') + '/') + '?room=' + self.pvpRoomId;
          var roomQrCard = self.createQrCard(
            roomShareUrl,
            ((T.lobby && T.lobby.qrCodeRoomTitle) || 'QR Code da Sala') + ' (' + self.pvpRoomId + ')',
            (T.lobby && T.lobby.qrCodeRoomHint) || 'Aponte a câmera do 2º jogador para entrar direto nesta sala!',
            'qr-room'
          );
          pvpBox.appendChild(roomQrCard);
        }

        // In-Room Match Rules Display (Canonical settings set by the Host)
        var activeCfg = (pSt && pSt.matchConfig) ? pSt.matchConfig : this.matchConfig;
        var rBDef = GLT.rules.BOARDS_MAP[activeCfg.boardId] || { name: '10x10' };
        var rMDef = (T.modes && T.modes[activeCfg.mode]) || { name: activeCfg.mode === 'tatico' ? 'Modo Tático' : 'Modo Clássico' };
        var rSDef = (GLT.rules.SEAS.find(function(s) { return s.id === activeCfg.sea; })) || { name: 'Mar Calmo' };
        var inRoomRulesList = [];
        if (activeCfg.allowTouch) inRoomRulesList.push('Navios Adjacentes');
        if (activeCfg.continueOnHit) inRoomRulesList.push('Continuar ao Acertar');
        if (activeCfg.salvo) inRoomRulesList.push('Disparos em Salva');
        if (activeCfg.fog) inRoomRulesList.push('Neblina de Guerra');
        var inRoomTimerStr = activeCfg.turnTimer > 0 ? (activeCfg.turnTimer + 's') : 'Sem limite';

        var inRoomRulesCard = document.createElement('div');
        inRoomRulesCard.className = 'glt-pvp-rules-preview in-room';
        inRoomRulesCard.innerHTML =
          '<div class="glt-pvp-rules-header">' +
            '<strong>🗺️ Regras Estabelecidas pelo Host</strong>' +
          '</div>' +
          '<div class="glt-pvp-rules-grid">' +
            '<div class="glt-pvp-rule-item"><span>📐 Tabuleiro:</span> <strong>' + rBDef.name + '</strong></div>' +
            '<div class="glt-pvp-rule-item"><span>⚔️ Formato:</span> <strong>' + rMDef.name + '</strong></div>' +
            '<div class="glt-pvp-rule-item"><span>🌊 Clima:</span> <strong>' + rSDef.name + '</strong></div>' +
            '<div class="glt-pvp-rule-item"><span>⏱️ Turno:</span> <strong>' + inRoomTimerStr + '</strong></div>' +
          '</div>' +
          (inRoomRulesList.length > 0 ? ('<div class="glt-pvp-tags-row">' + inRoomRulesList.map(function(r) { return '<span class="glt-pvp-rule-tag">✓ ' + r + '</span>'; }).join('') + '</div>') : '');
        pvpBox.appendChild(inRoomRulesCard);

        // Rematch Request Status Banner (when in game_over / reveal phase)
        if (pSt && (pSt.phase === 'game_over' || pSt.phase === 'reveal') && pSt.rematchRequested) {
          var myRematchReq = !!pSt.rematchRequested[myIdx];
          var oppRematchReq = !!pSt.rematchRequested[oppIdx];

          var rematchBanner = document.createElement('div');
          rematchBanner.className = 'glt-rematch-status-card';

          if (myRematchReq && !oppRematchReq) {
            rematchBanner.innerHTML = '<span class="status-icon">⏳</span> <div><strong>Você pediu revanche!</strong><br><small>Aguardando o adversário aceitar para reiniciar a partida...</small></div>';
          } else if (!myRematchReq && oppRematchReq) {
            rematchBanner.innerHTML = '<span class="status-icon">⚔️</span> <div><strong>O adversário quer uma revanche!</strong><br><small>Clique no botão abaixo para aceitar o desafio!</small></div>';
            var acceptBtn = document.createElement('button');
            acceptBtn.type = 'button';
            acceptBtn.className = 'glt-btn btn-sm btn-primary';
            acceptBtn.textContent = '⚔️ Aceitar Revanche';
            acceptBtn.addEventListener('click', function() {
              self.pvpClient.requestRematch();
            });
            rematchBanner.appendChild(acceptBtn);
          }
          pvpBox.appendChild(rematchBanner);
        }

        // SHA-256 Fleet Commit & Ready CTA
        if (this.pvpRole === 'player' && (!pSt || pSt.phase === 'lobby')) {
          if (!myReady) {
            var inroomCrewGroup = document.createElement('div');
            inroomCrewGroup.className = 'glt-form-group glt-inroom-crew-select';
            var inroomCrewLabel = document.createElement('label');
            inroomCrewLabel.className = 'glt-group-title';
            inroomCrewLabel.textContent = '🏴‍☠️ ' + (T.ui.selectCrewPrompt || 'Selecione sua Frota:');
            inroomCrewGroup.appendChild(inroomCrewLabel);

            var inroomCrewGrid = document.createElement('div');
            inroomCrewGrid.className = 'glt-inroom-crew-grid';

            var currentCrewId = (pSt && pSt.players[myIdx] && pSt.players[myIdx].crewId) || self.matchConfig.crewId || 'straw_hats';

            GLT.rules.CREWS.forEach(function(c) {
              var isSel = c.id === currentCrewId;
              var cBtn = document.createElement('button');
              cBtn.type = 'button';
              cBtn.className = 'glt-inroom-crew-btn' + (isSel ? ' selected' : '');
              cBtn.setAttribute('aria-pressed', isSel ? 'true' : 'false');
              var portrait = self.crewPortraitUrls(c.id, 48);
              cBtn.innerHTML =
                (portrait.url ? '<img class="inroom-thumb" src="' + portrait.url + '" alt="" onerror="this.onerror=null;this.src=\'' + portrait.fallback + '\'">' : '') +
                '<div class="inroom-meta">' +
                  '<strong>' + c.name + '</strong>' +
                  '<small>' + c.captain + '</small>' +
                '</div>';

              cBtn.addEventListener('click', function() {
                self.matchConfig.crewId = c.id;
                if (self.pvpClient && typeof self.pvpClient.selectCrew === 'function') {
                  self.pvpClient.selectCrew(c.id);
                }
                self.autoPlacePlayerFleet('spread');
                self.syncPlayerFleetTo3d();
                self.updateRivalAvatar();
                self.updateRivalTaunt('intro');
                self.renderGameplayTab();
                self.renderFleetTab();
                self.renderPvpTab();
                if (self.audio && typeof self.audio.playUiClick === 'function') self.audio.playUiClick();
              });

              inroomCrewGrid.appendChild(cBtn);
            });
            inroomCrewGroup.appendChild(inroomCrewGrid);
            pvpBox.appendChild(inroomCrewGroup);
          }

          var readyBtn = document.createElement('button');
          readyBtn.type = 'button';
          readyBtn.id = 'btn-pvp-ready';
          readyBtn.className = 'glt-btn btn-primary';
          readyBtn.style.width = '100%';
          readyBtn.disabled = myReady;
          readyBtn.textContent = myReady ? ('✓ ' + T.lobby.fleetCommittedBadge) : ('🔒 ' + T.lobby.readyFleetButton);
          readyBtn.addEventListener('click', function() {
            if (readyBtn.disabled) return;
            readyBtn.disabled = true; // one commitment per tap, even on a double tap
            self.readyPvpMatch().catch(function(err) {
              console.warn('[GLT] PvP ready failed:', err);
              self.announce(T.lobby.lanWriteFailed);
              self.renderPvpTab();
            });
          });
          pvpBox.appendChild(readyBtn);

          // Say exactly what the match is waiting for: an empty room never looks like "waiting".
          var oppStatus = document.createElement('div');
          oppStatus.className = 'glt-badge glt-pvp-opp-badge';
          oppStatus.id = 'glt-pvp-opp-status';
          oppStatus.setAttribute('role', 'status');
          var oppNick = (pSt && pSt.players[oppIdx] && pSt.players[oppIdx].nickname) || T.ui.defaultCaptainName;
          if (oppReady) {
            oppStatus.textContent = T.lobby.opponentCommittedBadge;
          } else if (oppJoined) {
            oppStatus.textContent = T.lobby.rivalInRoomBadge(oppNick);
          } else if (isRoomHost) {
            oppStatus.textContent = myReady ? T.lobby.hostCommittedNobody : T.lobby.hostWaitingNobody;
          } else {
            oppStatus.textContent = T.lobby.waitingHost;
          }
          pvpBox.appendChild(oppStatus);
        }

        // Den Den Mushi Preset Reactions (Strictly from GLT.protocol.DEN_DEN_REACTIONS)
        var reactHeader = document.createElement('h4');
        reactHeader.className = 'glt-group-title';
        reactHeader.style.marginTop = '8px';
        reactHeader.textContent = T.reactions.title;
        pvpBox.appendChild(reactHeader);
        pvpBox.appendChild(this.buildReactionsGridDom());
      }

      container.appendChild(pvpBox);
    },

    renderFleetTab: function() {
      var self = this;
      var T = getT();
      var container = this.dom.tabFleet;
      if (!container) return;
      container.innerHTML = '';

      var fleetBox = document.createElement('div');
      fleetBox.className = 'glt-fleet-panel';

      var activeCrewId = this.matchConfig.crewId || 'straw_hats';
      var activeCrew = GLT.rules.CREWS_MAP[activeCrewId] || GLT.rules.CREWS_MAP.straw_hats;
      var flagshipImg = (GLT.assets && GLT.assets.ships && GLT.assets.ships[activeCrewId]) || '';

      if (flagshipImg) {
        var flagshipCard = document.createElement('div');
        flagshipCard.className = 'glt-flagship-card';
        flagshipCard.innerHTML =
          '<img class="flagship-art" src="' + flagshipImg + '" alt="' + activeCrew.name + '">' +
          '<div class="flagship-info">' +
            '<span class="flagship-badge">⛵ Navio Capitânia</span>' +
            '<strong class="flagship-name">' + activeCrew.captain + '</strong>' +
            '<span class="flagship-crew">' + activeCrew.name + '</span>' +
          '</div>';
        fleetBox.appendChild(flagshipCard);
      }

      // Officers & First Mates Section moved directly below the Flagship Card
      if (GLT.assets && GLT.assets.officers) {
        var crewOfficers = Object.keys(GLT.assets.officers).map(function(k) {
          return GLT.assets.officers[k];
        }).filter(function(o) {
          return o.crewId === activeCrewId;
        });

        if (crewOfficers.length > 0) {
          var officersSection = document.createElement('div');
          officersSection.className = 'glt-officers-section';

          var offTitle = document.createElement('h4');
          offTitle.className = 'glt-group-title';
          offTitle.textContent = '⚓ Oficiais & Imediatos (' + activeCrew.name + ')';
          officersSection.appendChild(offTitle);

          var offGrid = document.createElement('div');
          offGrid.className = 'glt-officers-grid';

          crewOfficers.forEach(function(off) {
            var oCard = document.createElement('div');
            oCard.className = 'officer-card';
            oCard.innerHTML =
              '<img class="officer-thumb" src="' + off.image + '" alt="' + off.name + '">' +
              '<div class="officer-info">' +
                '<strong class="officer-name">' + off.name + '</strong>' +
                '<span class="officer-role">' + off.role + '</span>' +
              '</div>';
            offGrid.appendChild(oCard);
          });
          officersSection.appendChild(offGrid);
          fleetBox.appendChild(officersSection);
        }
      }

      if (this.matchState && !this.isPvpMode) {
        // 1. Enemy Fleet Status (ON TOP)
        var p1Title = document.createElement('h4');
        p1Title.className = 'glt-group-title';
        p1Title.textContent = '🎯 ' + T.ui.enemyFleetStatus;
        fleetBox.appendChild(p1Title);

        var p1List = document.createElement('div');
        p1List.className = 'glt-fleet-list';
        this.matchState.players[1].fleet.forEach(function(s) {
          var sName2 = s.name;
          var item2 = document.createElement('div');
          item2.className = 'fleet-ship-card' + (s.isSunk ? ' sunk' : '');
          item2.innerHTML =
            '<span class="ship-name">' + sName2 + ' (' + s.length + ')</span>' +
            '<span class="ship-status">' + (s.isSunk ? T.ui.shipSunk : T.ui.shipUnknown) + '</span>';
          p1List.appendChild(item2);
        });
        fleetBox.appendChild(p1List);

        // 2. Player Fleet Status (BELOW)
        var p0Title = document.createElement('h4');
        p0Title.className = 'glt-group-title';
        p0Title.style.marginTop = '12px';
        p0Title.textContent = '⚓ ' + T.ui.playerFleetStatus;
        fleetBox.appendChild(p0Title);

        var p0List = document.createElement('div');
        p0List.className = 'glt-fleet-list';
        this.matchState.players[0].fleet.forEach(function(s) {
          var item = document.createElement('div');
          item.className = 'fleet-ship-card' + (s.isSunk ? ' sunk' : '');
          item.innerHTML =
            '<span class="ship-name">' + s.name + ' (' + s.length + ')</span>' +
            '<span class="ship-status">' + (s.isSunk ? T.ui.shipSunk : s.hits > 0 ? T.ui.shipDamaged : T.ui.shipIntact) + '</span>';
          p0List.appendChild(item);
        });
        fleetBox.appendChild(p0List);

      } else if (this.isPvpMode && this.pvpClient && this.pvpClient.state &&
                 (this.pvpClient.state.phase === 'playing' || this.pvpClient.state.phase === 'game_over')) {
        // Live from the shared match state: every answered shot updates both lists.
        var pvpSt = this.pvpClient.state;
        var myP = this.pvpClient.role === 'player' ? this.pvpClient.playerIndex : 0;
        var oppP = 1 - myP;
        var myBoardView = pvpSt.boards[myP] || { shots: {}, sunkShips: [], remainingShips: 0, totalShips: 0 };  // my shots at the rival
        var rivalBoardView = pvpSt.boards[oppP] || { shots: {}, sunkShips: [], remainingShips: 0, totalShips: 0 }; // rival's shots at me

        // 1. Enemy Fleet Status (ON TOP): sunk ships are named in the answers, the rest stay unknown.
        var p1TitlePvp = document.createElement('h4');
        p1TitlePvp.className = 'glt-group-title';
        p1TitlePvp.textContent = '🎯 ' + T.ui.enemyFleetStatus + ' (' + myBoardView.remainingShips + '/' + myBoardView.totalShips + ')';
        fleetBox.appendChild(p1TitlePvp);
        fleetBox.appendChild(this.buildPvpShotTally(myBoardView.shots));

        var p1ListPvp = document.createElement('div');
        p1ListPvp.className = 'glt-fleet-list';
        var oppShips = GLT.rules.getShipsForBoard(this.matchConfig.boardId, this.matchConfig.enemyCrewId);
        var sunkLeft = (myBoardView.sunkShips || []).slice();
        oppShips.forEach(function(s) {
          var at = -1;
          for (var si = 0; si < sunkLeft.length && at < 0; si++) if (sunkLeft[si].id === s.id) at = si;
          for (var sj = 0; sj < sunkLeft.length && at < 0; sj++) if (sunkLeft[sj].name === s.name) at = sj;
          var isSunkOpp = at >= 0;
          if (isSunkOpp) sunkLeft.splice(at, 1);
          var itemOpp = document.createElement('div');
          itemOpp.className = 'fleet-ship-card' + (isSunkOpp ? ' sunk' : '');
          itemOpp.innerHTML =
            '<span class="ship-name">' + s.name + ' (' + s.length + ')</span>' +
            '<span class="ship-status">' + (isSunkOpp ? T.ui.shipSunk : T.ui.shipUnknown) + '</span>';
          p1ListPvp.appendChild(itemOpp);
        });
        fleetBox.appendChild(p1ListPvp);

        // 2. Player Fleet Status (BELOW): my ships against the rival's answered shots.
        var p0TitlePvp = document.createElement('h4');
        p0TitlePvp.className = 'glt-group-title';
        p0TitlePvp.style.marginTop = '12px';
        p0TitlePvp.textContent = '⚓ ' + T.ui.playerFleetStatus + ' (' + rivalBoardView.remainingShips + '/' + rivalBoardView.totalShips + ')';
        fleetBox.appendChild(p0TitlePvp);
        fleetBox.appendChild(this.buildPvpShotTally(rivalBoardView.shots));

        var p0ListPvp = document.createElement('div');
        p0ListPvp.className = 'glt-fleet-list';
        var incoming = rivalBoardView.shots || {};
        this.placedPlayerFleet.forEach(function(s) {
          var cells = s.cells || [];
          var hitCells = cells.filter(function(c) {
            var shot = incoming[c.r + ',' + c.c];
            return shot && (shot.outcome === 'hit' || shot.outcome === 'sunk');
          }).length;
          var isSunkMine = cells.length > 0 && hitCells >= cells.length;
          var cardMine = document.createElement('div');
          cardMine.className = 'fleet-ship-card' + (isSunkMine ? ' sunk' : '');
          cardMine.innerHTML =
            '<span class="ship-name">' + s.name + ' (' + s.length + ')</span>' +
            '<span class="ship-status">' + (isSunkMine ? T.ui.shipSunk : hitCells > 0 ? T.ui.shipDamaged : T.ui.shipIntact) + '</span>';
          p0ListPvp.appendChild(cardMine);
        });
        fleetBox.appendChild(p0ListPvp);
      } else {
        var setupListTitle = document.createElement('h4');
        setupListTitle.className = 'glt-group-title';
        setupListTitle.style.marginTop = '12px';
        setupListTitle.textContent = T.ui.playerFleetStatus;
        fleetBox.appendChild(setupListTitle);

        var setupList = document.createElement('div');
        setupList.className = 'glt-fleet-list';
        this.placedPlayerFleet.forEach(function(s) {
          var card = document.createElement('div');
          card.className = 'fleet-ship-card';
          card.innerHTML =
            '<span class="ship-name">' + s.name + ' (' + s.length + ')</span>' +
            '<span class="ship-status">' + T.ui.shipIntact + '</span>';
          setupList.appendChild(card);
        });
        fleetBox.appendChild(setupList);
      }

      container.appendChild(fleetBox);
    },

    /** One line of live numbers for a PvP shot map ('r,c' -> { outcome }): shots, hits, accuracy. */
    buildPvpShotTally: function(shots) {
      var list = Object.keys(shots || {}).map(function(k) { return shots[k]; });
      var hits = list.filter(function(s) { return s.outcome === 'hit' || s.outcome === 'sunk'; }).length;
      var acc = list.length > 0 ? Math.round((hits / list.length) * 100) : 0;
      var el = document.createElement('div');
      el.className = 'glt-fleet-summary-strip glt-fleet-tally';
      el.textContent = getT().ui.shotTally(list.length, hits, acc);
      return el;
    },

    renderLogbookTab: function() {
      var self = this;
      var T = getT();
      var container = this.dom.tabLogbook;
      if (!container) return;
      if (!container.querySelector('.glt-logbook-feed')) {
        container.innerHTML = '';

        // 1. Nautical Atlas & Blessings Action Banner
        var atlasBar = document.createElement('div');
        atlasBar.className = 'glt-logbook-atlas-bar';

        var atlasBtn = document.createElement('button');
        atlasBtn.type = 'button';
        atlasBtn.className = 'glt-btn btn-secondary glt-open-chart-btn';
        atlasBtn.innerHTML = '🗺️ ' + (T.ui.viewNauticalChart || 'Carta Náutica da Grand Line');
        atlasBtn.addEventListener('click', function() {
          self.openNauticalChartModal();
        });
        atlasBar.appendChild(atlasBtn);
        container.appendChild(atlasBar);

        // 2. Blessings & Relics Collection Grid
        if (GLT.assets && GLT.assets.blessings) {
          var blessSection = document.createElement('div');
          blessSection.className = 'glt-blessings-section';

          var bTitle = document.createElement('h4');
          bTitle.className = 'glt-group-title';
          bTitle.textContent = '📜 ' + (T.ui.blessingsTitle || 'Coleção de Bênçãos & Relíquias');
          blessSection.appendChild(bTitle);

          var bGrid = document.createElement('div');
          bGrid.className = 'glt-blessings-grid';

          var unlockedList = [];
          try {
            unlockedList = JSON.parse(localStorage.getItem('glt_unlocked_blessings') || '[]');
          } catch (e) {}

          GLT.assets.blessings.forEach(function(b) {
            var isUnlocked = unlockedList.indexOf(b.id) !== -1;
            var item = document.createElement('div');
            item.className = 'glt-blessing-card-thumb' + (isUnlocked ? ' unlocked' : ' locked');
            item.setAttribute('role', 'button');
            item.tabIndex = 0;
            item.setAttribute('aria-label', b.name + ' - ' + (isUnlocked ? T.ui.blessingUnlockedBadge : T.ui.blessingLockedBadge));

            item.innerHTML =
              '<img class="blessing-thumb-img" src="' + b.image + '" alt="' + b.name + '" loading="lazy">' +
              '<div class="blessing-thumb-meta">' +
                '<span class="blessing-badge">' + (isUnlocked ? T.ui.blessingUnlockedBadge : T.ui.blessingLockedBadge) + '</span>' +
                '<strong class="blessing-thumb-name">' + b.name + '</strong>' +
              '</div>';

            item.addEventListener('click', function() {
              self.openBlessingInspectorModal(b.id);
            });
            item.addEventListener('keydown', function(ev) {
              if (ev.key === 'Enter' || ev.key === ' ') {
                ev.preventDefault();
                self.openBlessingInspectorModal(b.id);
              }
            });
            bGrid.appendChild(item);
          });
          blessSection.appendChild(bGrid);
          container.appendChild(blessSection);
        }

        // 3. Combat Log Feed
        var feedTitle = document.createElement('h4');
        feedTitle.className = 'glt-group-title';
        feedTitle.style.marginTop = '14px';
        feedTitle.textContent = '📋 Registro Tático de Disparos';
        container.appendChild(feedTitle);

        var feed = document.createElement('div');
        feed.id = 'glt-logbook-feed';
        feed.className = 'glt-logbook-feed';
        container.appendChild(feed);
      }
    },

    appendLogBookEntry: function(text) {
      this.renderLogbookTab();
      var feed = document.getElementById('glt-logbook-feed');
      if (!feed) return;

      var entry = document.createElement('div');
      entry.className = 'log-entry';
      var timeStr = new Date().toLocaleTimeString('pt-BR', { minute: '2-digit', second: '2-digit' });
      var spanTime = document.createElement('span');
      spanTime.className = 'log-time';
      spanTime.textContent = '[' + timeStr + '] ';
      entry.appendChild(spanTime);
      entry.appendChild(document.createTextNode(text));
      feed.appendChild(entry);
      feed.scrollTop = feed.scrollHeight;
    },

    renderSettingsTab: function() {
      var self = this;
      var T = getT();
      var container = this.dom.tabSettings;
      if (!container) return;
      container.innerHTML = '';

      var settingsBox = document.createElement('div');
      settingsBox.className = 'glt-settings-panel';
      settingsBox.style.display = 'flex';
      settingsBox.style.flexDirection = 'column';
      settingsBox.style.gap = '10px';

      // 0. The game as an app: install, full screen, vibration
      var shell = GLT.appShell;
      if (shell) {
        var appGroup = document.createElement('div');
        appGroup.className = 'glt-form-group glt-app-group';
        var appTitle = document.createElement('span');
        appTitle.className = 'glt-group-title';
        appTitle.textContent = T.ui.appGroupTitle;
        appGroup.appendChild(appTitle);

        var mode = shell.installMode();
        var appNote = document.createElement('p');
        appNote.className = 'glt-app-note';
        if (mode === 'installed') {
          appNote.textContent = T.ui.appInstalled;
          appGroup.appendChild(appNote);
        } else if (mode === 'prompt') {
          var installBtn = document.createElement('button');
          installBtn.type = 'button';
          installBtn.className = 'glt-btn btn-primary btn-sm';
          installBtn.textContent = T.ui.appInstallButton;
          installBtn.addEventListener('click', function() {
            shell.promptInstall().then(function() { self.renderSettingsTab(); });
          });
          appGroup.appendChild(installBtn);
          appNote.textContent = T.ui.appInstallWhy;
          appGroup.appendChild(appNote);
        } else {
          appNote.textContent = mode === 'ios' ? T.ui.appInstallIos : T.ui.appInstallMenu;
          appGroup.appendChild(appNote);
        }

        if (shell.canFullscreen() && !shell.isStandalone()) {
          var fsRow = document.createElement('div');
          fsRow.className = 'glt-btn-row';
          var fsBtn = document.createElement('button');
          fsBtn.type = 'button';
          fsBtn.className = 'glt-btn btn-sm';
          fsBtn.textContent = shell.isFullscreen() ? T.ui.fullscreenExit : T.ui.fullscreenEnter;
          fsBtn.addEventListener('click', function() {
            shell.toggleFullscreen();
          });
          fsRow.appendChild(fsBtn);
          appGroup.appendChild(fsRow);
        }

        var appToggles = [];
        if (shell.canFullscreen() && !shell.isStandalone() && shell.isTouch()) {
          appToggles.push({ id: 'chk-auto-fullscreen', label: T.ui.autoFullscreenToggle, val: shell.autoFullscreen(), onChange: function(v) { shell.setAutoFullscreen(v); } });
        }
        if (shell.canVibrate()) {
          appToggles.push({ id: 'chk-vibrate', label: T.ui.vibrateToggle, val: shell.vibrateEnabled(), onChange: function(v) { shell.setVibrate(v); } });
        }
        appToggles.forEach(function(item) {
          var row = document.createElement('div');
          row.className = 'glt-checkbox-row';
          var cb = document.createElement('input');
          cb.type = 'checkbox';
          cb.id = item.id;
          cb.checked = item.val;
          cb.addEventListener('change', function() { item.onChange(cb.checked); });
          var lbl = document.createElement('label');
          lbl.htmlFor = item.id;
          lbl.textContent = item.label;
          row.appendChild(cb);
          row.appendChild(lbl);
          appGroup.appendChild(row);
        });

        if (shell.offlineReady()) {
          var offNote = document.createElement('p');
          offNote.className = 'glt-app-note';
          offNote.textContent = T.ui.appOfflineReady;
          appGroup.appendChild(offNote);
        }
        settingsBox.appendChild(appGroup);

        if (!this._appShellSettingsHooked) {
          this._appShellSettingsHooked = true;
          shell.onChange(function() {
            if (self.dom.tabSettings && self.dom.tabSettings.classList.contains('active')) self.renderSettingsTab();
          });
        }
      }

      // 1. Pixel Size Slider with <label for="rng-pixel-size">
      var pxGroup = document.createElement('div');
      pxGroup.className = 'glt-form-group';
      var pxLbl = document.createElement('label');
      pxLbl.htmlFor = 'rng-pixel-size';
      pxLbl.innerHTML = T.ui.pixelSizeSlider + ': <strong id="px-val">' + this.pixelSize + 'px</strong>';
      var pxSlider = document.createElement('input');
      pxSlider.type = 'range';
      pxSlider.id = 'rng-pixel-size';
      pxSlider.min = 1;
      pxSlider.max = 4;
      pxSlider.step = 1;
      pxSlider.value = this.pixelSize;
      pxSlider.addEventListener('input', function() {
        self.pixelSize = parseInt(pxSlider.value, 10);
        var vEl = document.getElementById('px-val');
        if (vEl) vEl.textContent = self.pixelSize + 'px';
        if (self.postPipeline) self.postPipeline.setPixelSize(self.pixelSize);
      });
      pxGroup.appendChild(pxLbl);
      pxGroup.appendChild(pxSlider);
      settingsBox.appendChild(pxGroup);

      // 2. Checkboxes with <label for="...">
      [
        { id: 'chk-lift', label: T.ui.liftSceneryCheckbox, val: this.liftScenery, onChange: function(v) { self.setLiftScenery(v); } },
        { id: 'chk-outlines', label: T.ui.outlinesToggle, val: this.outlines, onChange: function(v) { self.outlines = v; if (self.postPipeline) self.postPipeline.setOutlines(v); } },
        { id: 'chk-dither', label: T.ui.ditherToggle, val: this.dither, onChange: function(v) { self.dither = v; if (self.postPipeline) self.postPipeline.setDither(v); } },
        { id: 'chk-raw3d', label: T.ui.raw3dToggle, val: this.raw3d, onChange: function(v) { self.raw3d = v; if (self.postPipeline) self.postPipeline.setPaletteSnap(!v); } },
        { id: 'chk-autonext', label: T.ui.autoNextGame, val: this.autoNextGame, onChange: function(v) { self.autoNextGame = v; } }
      ].forEach(function(item) {
        var row = document.createElement('div');
        row.className = 'glt-checkbox-row';
        var cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.id = item.id;
        cb.checked = item.val;
        cb.addEventListener('change', function() { item.onChange(cb.checked); });
        var lbl = document.createElement('label');
        lbl.htmlFor = item.id;
        lbl.textContent = item.label;
        row.appendChild(cb);
        row.appendChild(lbl);
        settingsBox.appendChild(row);
      });

      // 3. Offline Controls: Pause & Animation Speed
      var offlineControlsGroup = document.createElement('div');
      offlineControlsGroup.className = 'glt-form-group';
      var offTitle = document.createElement('span');
      offTitle.className = 'glt-group-title';
      offTitle.textContent = T.ui.pauseButton + ' / ' + T.ui.speedLabel + ' ' + T.ui.offlineOnlySuffix;
      offlineControlsGroup.appendChild(offTitle);

      var pauseActionRow = document.createElement('div');
      pauseActionRow.className = 'glt-btn-row';
      var pauseSettingsBtn = document.createElement('button');
      pauseSettingsBtn.type = 'button';
      pauseSettingsBtn.className = 'glt-btn btn-sm';
      pauseSettingsBtn.textContent = self.isPaused ? ('▶️ ' + T.ui.resumeButton) : ('⏸️ ' + T.ui.pauseButton);
      pauseSettingsBtn.disabled = !!self.isPvpMode;
      pauseSettingsBtn.addEventListener('click', function() {
        self.togglePause();
        self.renderSettingsTab();
      });
      pauseActionRow.appendChild(pauseSettingsBtn);
      offlineControlsGroup.appendChild(pauseActionRow);

      var speedRow = document.createElement('div');
      speedRow.className = 'glt-btn-row';
      speedRow.style.marginTop = '4px';
      [0.5, 1.0, 2.0, 4.0].forEach(function(spd) {
        var sBtn = document.createElement('button');
        sBtn.type = 'button';
        sBtn.className = 'glt-pill-btn' + (self.animSpeed === spd ? ' active' : '');
        sBtn.textContent = spd + 'x';
        sBtn.disabled = !!self.isPvpMode;
        sBtn.addEventListener('click', function() {
          if (self.isPvpMode) return;
          self.animSpeed = spd;
          speedRow.querySelectorAll('.glt-pill-btn').forEach(function(b) { b.classList.remove('active'); });
          sBtn.classList.add('active');
        });
        speedRow.appendChild(sBtn);
      });
      offlineControlsGroup.appendChild(speedRow);
      settingsBox.appendChild(offlineControlsGroup);

      // 4. Volume Slider with <label for="rng-volume">
      if (this.audio) {
        var volGroup = document.createElement('div');
        volGroup.className = 'glt-form-group';
        var volLbl = document.createElement('label');
        volLbl.htmlFor = 'rng-volume';
        volLbl.textContent = T.ui.volumeSlider + ':';
        var volSlider = document.createElement('input');
        volSlider.type = 'range';
        volSlider.id = 'rng-volume';
        volSlider.min = 0;
        volSlider.max = 1;
        volSlider.step = 0.05;
        volSlider.value = this.audio.getVolume();
        volSlider.addEventListener('input', function() {
          self.audio.setVolume(parseFloat(volSlider.value));
        });
        volGroup.appendChild(volLbl);
        volGroup.appendChild(volSlider);
        settingsBox.appendChild(volGroup);
      }

      container.appendChild(settingsBox);
    },

    showModal: function(title, content, extraClass) {
      var self = this;
      this.lastFocusedTrigger = document.activeElement;
      this.dom.modalBox.innerHTML = '';
      this.dom.modalBox.className = 'glt-modal-box' + (extraClass ? (' ' + extraClass) : '');

      var headerRow = document.createElement('div');
      headerRow.className = 'glt-modal-header-row';

      var h = document.createElement('h2');
      h.id = 'glt-modal-heading-id';
      h.className = 'glt-modal-heading';
      h.textContent = title;
      headerRow.appendChild(h);

      if (this.gamePhase !== 'COIN_TOSS' && this.gamePhase !== 'CEREMONY') {
        var closeBtn = document.createElement('button');
        closeBtn.type = 'button';
        closeBtn.className = 'glt-modal-close-btn';
        closeBtn.setAttribute('aria-label', 'Fechar Janela');
        closeBtn.innerHTML = '✕';
        closeBtn.addEventListener('click', function() {
          self.hideModal();
        });
        headerRow.appendChild(closeBtn);
      }

      this.dom.modalBox.appendChild(headerRow);

      if (typeof content === 'string') {
        var wrapper = document.createElement('div');
        wrapper.innerHTML = content;
        this.dom.modalBox.appendChild(wrapper);
      } else if (content instanceof HTMLElement) {
        this.dom.modalBox.appendChild(content);
      }

      this.dom.modalOverlay.style.display = 'flex';
      var firstFocusable = this.dom.modalBox.querySelector('button, select, input');
      if (firstFocusable) {
        firstFocusable.focus();
      }
    },

    hideModal: function() {
      if (!this.dom.modalOverlay) return;
      this.dom.modalOverlay.style.display = 'none';
      this.dom.modalOverlay.classList.remove('glt-ceremony-intro');
      this.dom.modalBox.className = 'glt-modal-box';
      this.dom.modalBox.innerHTML = '';
      if (this.lastFocusedTrigger && typeof this.lastFocusedTrigger.focus === 'function' && document.contains(this.lastFocusedTrigger)) {
        try { this.lastFocusedTrigger.focus(); } catch (_) {}
      }
      this.lastFocusedTrigger = null;
    },

    showAbandonShipModal: function() {
      var self = this;
      var T = getT();
      var isSeries = !this.isPvpMode && this.matchConfig.seriesLength > 1;
      var currentSeriesGame = (this.seriesWins[0] || 0) + (this.seriesWins[1] || 0) + 1;

      var descText = isSeries
        ? T.forfeit.modalDescSeries(currentSeriesGame, this.matchConfig.seriesLength)
        : (this.isPvpMode ? T.forfeit.modalDescPvp : T.forfeit.modalDescSingle);

      var modalBox = document.createElement('div');
      modalBox.id = 'modal-abandon-ship';
      modalBox.className = 'glt-forfeit-modal-content';

      var desc = document.createElement('p');
      desc.className = 'glt-modal-desc';
      desc.textContent = descText;
      modalBox.appendChild(desc);

      var btnRow = document.createElement('div');
      btnRow.className = 'glt-btn-row';
      btnRow.style.justifyContent = 'center';
      btnRow.style.marginTop = '12px';

      // 1. Safe Action: Continuar lutando (autofocus per Modern Web Guidance)
      var cancelBtn = document.createElement('button');
      cancelBtn.type = 'button';
      cancelBtn.id = 'btn-cancel-abandon';
      cancelBtn.className = 'glt-btn btn-primary';
      cancelBtn.textContent = T.forfeit.cancelKeepFighting;
      cancelBtn.addEventListener('click', function() {
        self.hideModal();
      });
      btnRow.appendChild(cancelBtn);

      // 2. Confirm Forfeit
      var confirmBtn = document.createElement('button');
      confirmBtn.type = 'button';
      confirmBtn.id = 'btn-confirm-abandon';
      confirmBtn.className = 'glt-btn btn-danger-outline';
      confirmBtn.textContent = T.forfeit.confirmForfeit;
      confirmBtn.addEventListener('click', function() {
        self.hideModal();
        self.confirmAbandonShip(false);
      });
      btnRow.appendChild(confirmBtn);

      // 3. Abort whole series if applicable
      if (isSeries) {
        var abortBtn = document.createElement('button');
        abortBtn.type = 'button';
        abortBtn.id = 'btn-abort-series';
        abortBtn.className = 'glt-btn';
        abortBtn.textContent = T.forfeit.abortWholeSeries;
        abortBtn.addEventListener('click', function() {
          self.hideModal();
          self.confirmAbandonShip(true);
        });
        btnRow.appendChild(abortBtn);
      }

      modalBox.appendChild(btnRow);
      this.showModal(T.forfeit.modalTitle, modalBox);

      // Focus safe action immediately
      setTimeout(function() {
        cancelBtn.focus();
      }, 50);
    },

    confirmAbandonShip: function(abortSeries) {
      this.clearTurnTimers();
      var T = getT();

      if (abortSeries && !this.isPvpMode) {
        if (typeof this.returnToSetupPhase === 'function') {
          this.returnToSetupPhase();
        } else {
          this.gamePhase = 'SETUP';
          this.setupFleetPlacementPhase();
        }
        return;
      }

      if (this.isPvpMode && this.pvpClient) {
        if (this.pvpClient.state && this.pvpClient.state.phase === 'game_over') {
          return;
        }
        this.appendLogBookEntry(T.forfeit.logPlayerForfeit);
        try {
          this.pvpClient.forfeit();
        } catch (e) {
          console.warn('[GLT.ui] PvP forfeit safe catch:', e.message);
        }
        return;
      }

      // Offline PvC Forfeit
      if (this.matchState) {
        GLT.rules.forfeitMatch(this.matchState, 0);
        this.seriesWins = this.matchState.seriesWins.slice();
        this.appendLogBookEntry(T.forfeit.logPlayerForfeit);
        this.announce(T.forfeit.logPlayerForfeit);
        this.launchCeremonyPhase();
      }
    },


    createSeaPreviewBox: function() {
      var box = document.createElement('div');
      box.id = 'glt-sea-preview-box';
      box.className = 'glt-sea-preview-box';
      this.populateSeaPreviewBox(box, this.matchConfig.sea);
      return box;
    },

    updateSeaPreviewBox: function() {
      var box = document.getElementById('glt-sea-preview-box');
      if (box) {
        this.populateSeaPreviewBox(box, this.matchConfig.sea);
      }
    },

    populateSeaPreviewBox: function(box, seaId) {
      var self = this;
      var T = getT();
      var seaObj = GLT.rules.SEAS_MAP[seaId] || GLT.rules.SEAS[0];

      var islandKey = 'loguetown';
      if (seaId === 'grand_line') islandKey = 'alabasta';
      else if (seaId === 'novo_mundo') islandKey = 'skypiea';
      else if (seaId === 'tempestade') islandKey = 'water7';
      else if (seaId === 'marineford') islandKey = 'marineford';

      var island = (GLT.assets && GLT.assets.maps && GLT.assets.maps.islands && GLT.assets.maps.islands[islandKey]) || null;
      if (!island) return;

      box.innerHTML =
        '<div class="sea-preview-content">' +
          '<div class="sea-preview-visuals">' +
            '<img class="sea-sky-banner" src="' + island.sky + '" alt="' + island.name + '" loading="lazy">' +
            '<img class="sea-chart-thumb" src="' + island.chart + '" alt="' + island.name + '" loading="lazy">' +
          '</div>' +
          '<div class="sea-preview-meta">' +
            '<div class="sea-island-tag">' + (T.ui.islandZoneBadge || 'Zona Marítima') + ': <strong>' + island.name + '</strong> — <em>' + island.tag + '</em></div>' +
            '<p class="sea-island-desc">' + island.desc + '</p>' +
            '<div class="sea-island-stats">' +
              '<span>Multiplicador de Recompensa: <strong>' + seaObj.bountyMultiplier + 'x</strong></span>' +
              (seaObj.fog ? '<span>Nevoeiro: <strong>' + seaObj.fogDuration + ' rodadas</strong></span>' : '<span>Visibilidade: <strong>Límpida</strong></span>') +
              '<button type="button" class="btn-inspect-island-chart" aria-label="Ver Carta Náutica Detalhada">🗺️ Ampliar Carta</button>' +
            '</div>' +
          '</div>' +
        '</div>';

      var inspectBtn = box.querySelector('.btn-inspect-island-chart');
      if (inspectBtn) {
        inspectBtn.addEventListener('click', function() {
          self.openNauticalChartModal(islandKey);
        });
      }
    },

    openNauticalChartModal: function(initialIslandKey) {
      var self = this;
      var T = getT();
      var modalWrap = document.createElement('div');
      modalWrap.className = 'glt-nautical-chart-modal';

      var mapAssets = GLT.assets ? GLT.assets.maps : null;
      if (!mapAssets) return;

      var currentIslandKey = initialIslandKey || 'loguetown';

      // Coordenadas canônicas percentuais de cada ilha sobre a Carta Náutica Horizontal (1376x768)
      var ISLAND_COORDS = {
        loguetown: { x: 46.0, y: 68.0, label: 'Loguetown' },
        alabasta: { x: 45.0, y: 33.0, label: 'Alabasta' },
        skypiea: { x: 55.0, y: 22.0, label: 'Skypiea' },
        water7: { x: 68.0, y: 34.0, label: 'Water 7' },
        marineford: { x: 74.0, y: 66.0, label: 'Marineford' }
      };

      // Dossier tático rico e canônico de cada uma das 5 ilhas
      var ISLAND_DOSSIERS = {
        loguetown: {
          icon: '🧭',
          routeBadge: 'East Blue • Entrada da Grand Line',
          dangerLevel: 'Nível Moderado',
          dangerAgency: 'Capitania de Smoker',
          climateAnomaly: 'Calmaria de Mar Calmo — Vento constante & névoa marinha matinal.',
          bountyMultiplier: '1.00x ฿',
          visibility: 'Límpida (Zero Nevoeiro)',
          navigation: 'Calm Belt (Águas Plácidas)',
          patrol: 'Smoker & Tashigi (Capitania)',
          lore: 'Conhecida por todos os navegantes como a Cidade do Começo e do Fim, Loguetown é o último ancoradouro antes dos piratas encararem as correntezas verticais da Reverse Mountain. Sob a fumaça vigilante do Capitão Smoker da Marinha, todo navio deve calibrar sua artilharia se deseja cruzar para a temida Grand Line.'
        },
        alabasta: {
          icon: '🏜️',
          routeBadge: 'Primeira Metade • Paradise',
          dangerLevel: 'Nível Alto',
          dangerAgency: 'Insurgência Baroque Works',
          climateAnomaly: 'Calor Abrasador de Sandora — Tempestades de areia dourada e miragens térmicas.',
          bountyMultiplier: '1.10x ฿',
          visibility: 'Límpida (Miragens Térmicas)',
          navigation: 'Rio Sandora (Maré Rasa)',
          patrol: 'Guarda Real & Baroque Works',
          lore: 'O majestoso e impiedoso Reino Desértico banhado pelo imenso Rio Sandora e guardado pela Casa Real Nefertari. Sob um sol escaldante que desgasta os cascos das caravelas, corsários duelam pelo controle do Rio Poneglyph ancestral e segredos da mítica arma Pluton.'
        },
        skypiea: {
          icon: '⚡',
          routeBadge: 'Oceano Celeste • Mar Branco',
          dangerLevel: 'Nível Extremo',
          dangerAgency: 'Julgamento Divino de Enel',
          climateAnomaly: 'Mar Branco Rarefeito — Nuvens sólidas a 10.000m e descargas de relâmpagos estáticos.',
          bountyMultiplier: '1.15x ฿',
          visibility: 'Nevoeiro Denso (3 rodadas de névoa)',
          navigation: 'Nuvens-Cúmulo (Cega)',
          patrol: 'Exército Divino & Shandora',
          lore: 'A mítica ilha nos céus suspensa a 10.000 metros de altitude sobre o oceano convencional, acessível pela mortal corrente ascendente Knock Up Stream. Aqui, canhões disparam em densos bancos de nuvens-mar enquanto os raios punitivos do Deus Enel riscam a atmosfera.'
        },
        water7: {
          icon: '🌊',
          routeBadge: 'Metrópole Central • Paradise',
          dangerLevel: 'Calamidade Marítima',
          dangerAgency: 'Fúria da Aqua Laguna & CP9',
          climateAnomaly: 'Aqua Laguna Furiosa — Maremoto colossal e vendavais torrenciais contínuos.',
          bountyMultiplier: '1.25x ฿',
          visibility: 'Chuva e Névoa (2 rodadas de névoa)',
          navigation: 'Correntezas das Docas',
          patrol: 'Galley-La & CP9',
          lore: 'A espetacular metrópole flutuante construída sobre as águas, entrecortada por canais monumentais e pelo trem marítimo Puffing Tom. Sede dos lendários estaleiros da Galley-La Company, onde os maiores navios do mundo foram forjados.'
        },
        marineford: {
          icon: '⚓',
          routeBadge: 'Bastião Militar • Quartel Supremo',
          dangerLevel: 'Nível Supremo',
          dangerAgency: 'Almirantado & Governo Mundial',
          climateAnomaly: 'Redemoinhos da Justiça — Turbilhões gerados pelos colossais Portões da Justiça.',
          bountyMultiplier: '1.20x ฿',
          visibility: 'Límpida (Fogo Cruzado Pesado)',
          navigation: 'Correnteza Tarai dos Portões',
          patrol: 'Três Almirantes (Frota Total)',
          lore: 'A fortaleza inexpugnável em meia-lua, centro militar supremo do Governo Mundial e palco da épica Batalha dos Melhores. Guardada pelos colossais Portões da Justiça e pela temível Corrente Tarai, suas muralhas de aço já testemunharam o confronto dos seres mais fortes do planeta.'
        }
      };

      // Layout Widescreen em 2 Colunas Sem Rolagem
      var deskGrid = document.createElement('div');
      deskGrid.className = 'glt-chart-desk-grid';

      // 1. COLUNA ESQUERDA: Carta Náutica Panorâmica + POI Pin + Hotspots + Abas das 5 Ilhas
      var mapCol = document.createElement('div');
      mapCol.className = 'glt-chart-map-col';

      var mapBannerWrap = document.createElement('div');
      mapBannerWrap.className = 'glt-chart-banner-wrap';
      mapBannerWrap.innerHTML =
        '<img class="glt-chart-horizontal-img" src="' + mapAssets.grandLineHorizontal + '" alt="' + (T.ui.nauticalChartTitle || 'Carta Náutica da Grand Line') + '">' +
        '<!-- Marcador POI Dinâmico (somente ícone pulsante, sem texto) -->' +
        '<div class="glt-map-poi-marker" id="glt-map-poi-marker">' +
          '<div class="poi-pulse-ring"></div>' +
          '<div class="poi-pulse-ring poi-pulse-ring-delay"></div>' +
          '<div class="poi-pin-body">' +
            '<svg class="poi-pin-svg" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">' +
              '<circle cx="12" cy="12" r="9" fill="#1a0f00" stroke="#fef08a" stroke-width="2"/>' +
              '<polygon points="12,5 14.5,12 12,19 9.5,12" fill="#f5a623"/>' +
              '<circle cx="12" cy="12" r="2.2" fill="#fff"/>' +
            '</svg>' +
          '</div>' +
          '<div class="poi-pin-needle"></div>' +
        '</div>';

      // Hotspots clicáveis diretamente sobre o mapa
      Object.keys(ISLAND_COORDS).forEach(function(k) {
        var coord = ISLAND_COORDS[k];
        var hotspot = document.createElement('button');
        hotspot.type = 'button';
        hotspot.className = 'glt-map-hotspot hotspot-' + k;
        hotspot.dataset.island = k;
        hotspot.style.left = coord.x + '%';
        hotspot.style.top = coord.y + '%';
        hotspot.setAttribute('title', 'Navegar para ' + coord.label);
        hotspot.setAttribute('aria-label', 'Navegar para ' + coord.label);
        hotspot.addEventListener('click', function(e) {
          e.stopPropagation();
          renderIslandDetail(k);
        });
        mapBannerWrap.appendChild(hotspot);
      });

      mapCol.appendChild(mapBannerWrap);

      // Abas de Ilha alinhadas com simetria perfeita abaixo do mapa
      var tabsRow = document.createElement('div');
      tabsRow.className = 'glt-island-tabs-row';

      Object.keys(mapAssets.islands).forEach(function(key) {
        var isl = mapAssets.islands[key];
        var dossier = ISLAND_DOSSIERS[key] || {};
        var tabBtn = document.createElement('button');
        tabBtn.type = 'button';
        tabBtn.className = 'glt-island-tab-btn' + (key === currentIslandKey ? ' active' : '');
        tabBtn.dataset.island = key;
        tabBtn.setAttribute('aria-label', 'Visualizar ilha ' + isl.name);
        tabBtn.innerHTML = '<span class="tab-icon">' + (dossier.icon || '⚓') + '</span> <span class="tab-label">' + isl.name + '</span>';
        tabBtn.addEventListener('click', function() {
          renderIslandDetail(key);
        });
        tabsRow.appendChild(tabBtn);
      });

      mapCol.appendChild(tabsRow);
      deskGrid.appendChild(mapCol);

      // 2. COLUNA DIREITA: Dossiê Tático
      var dossierCol = document.createElement('div');
      dossierCol.className = 'glt-chart-dossier-col';
      deskGrid.appendChild(dossierCol);

      modalWrap.appendChild(deskGrid);

      function renderIslandDetail(key) {
        currentIslandKey = key;

        // Atualiza abas ativas
        tabsRow.querySelectorAll('.glt-island-tab-btn').forEach(function(btn) {
          btn.classList.toggle('active', btn.dataset.island === key);
        });

        // Atualiza hotspots ativos no mapa
        mapBannerWrap.querySelectorAll('.glt-map-hotspot').forEach(function(hs) {
          hs.classList.toggle('active', hs.dataset.island === key);
        });

        // Move o marcador POI (apenas ícone pulsante) para a coordenada exata da ilha
        var coord = ISLAND_COORDS[key] || { x: 50, y: 50, label: key };
        var poiMarker = mapBannerWrap.querySelector('#glt-map-poi-marker');
        if (poiMarker) {
          poiMarker.style.left = coord.x + '%';
          poiMarker.style.top = coord.y + '%';
          poiMarker.setAttribute('title', coord.label);
        }

        var isl = mapAssets.islands[key];
        if (!isl) return;
        var dossier = ISLAND_DOSSIERS[key] || {};

        dossierCol.innerHTML =
          '<div class="island-dossier-header-compact">' +
            '<div class="island-title-row">' +
              '<span class="island-header-icon">' + dossier.icon + '</span>' +
              '<h3 class="island-main-title">' + isl.name + '</h3>' +
              '<span class="island-route-pill">' + dossier.routeBadge + '</span>' +
            '</div>' +
            '<p class="island-subtitle-line"><em>' + isl.tag + '</em></p>' +
          '</div>' +
          '<div class="island-art-duo-compact">' +
            '<div class="island-art-card">' +
              '<div class="island-art-header">📍 Carta Náutica Local</div>' +
              '<div class="island-art-img-wrap">' +
                '<img class="island-tactical-chart" src="' + isl.chart + '" alt="' + isl.name + ' - Carta Náutica">' +
              '</div>' +
            '</div>' +
            '<div class="island-art-card">' +
              '<div class="island-art-header">🌤️ Bioma & Clima</div>' +
              '<div class="island-art-img-wrap">' +
                '<img class="island-sky-preview" src="' + isl.sky + '" alt="' + isl.name + ' - Bioma Celeste">' +
              '</div>' +
            '</div>' +
          '</div>' +
          '<div class="island-modifiers-grid-compact">' +
            '<div class="island-mod-card">' +
              '<span class="mod-icon">💰</span>' +
              '<div class="mod-body">' +
                '<span class="mod-title">Multiplicador</span>' +
                '<strong class="mod-val">' + dossier.bountyMultiplier + '</strong>' +
              '</div>' +
            '</div>' +
            '<div class="island-mod-card">' +
              '<span class="mod-icon">🌫️</span>' +
              '<div class="mod-body">' +
                '<span class="mod-title">Visibilidade</span>' +
                '<strong class="mod-val">' + dossier.visibility + '</strong>' +
              '</div>' +
            '</div>' +
            '<div class="island-mod-card">' +
              '<span class="mod-icon">🌊</span>' +
              '<div class="mod-body">' +
                '<span class="mod-title">Navegação</span>' +
                '<strong class="mod-val">' + dossier.navigation + '</strong>' +
              '</div>' +
            '</div>' +
            '<div class="island-mod-card">' +
              '<span class="mod-icon">⚔️</span>' +
              '<div class="mod-body">' +
                '<span class="mod-title">Patrulha</span>' +
                '<strong class="mod-val">' + dossier.patrol + '</strong>' +
              '</div>' +
            '</div>' +
          '</div>' +
          '<div class="island-hazard-seal-compact">' +
            '<div class="hazard-seal-row">' +
              '<span class="hazard-seal-icon">⚠️</span>' +
              '<div class="hazard-seal-text">' +
                '<span class="hazard-seal-title">Nível de Perigo:</span>' +
                '<strong class="hazard-seal-val danger-' + key + '">' + dossier.dangerLevel + ' — ' + dossier.dangerAgency + '</strong>' +
              '</div>' +
            '</div>' +
            '<div class="climate-seal-row">' +
              '<span class="climate-seal-icon">🌪️</span>' +
              '<div class="climate-seal-text">' +
                '<span class="climate-seal-title">Anomalia Climática:</span>' +
                '<span class="climate-seal-val">' + dossier.climateAnomaly + '</span>' +
              '</div>' +
            '</div>' +
          '</div>' +
          '<div class="island-dossier-card-compact">' +
            '<div class="island-dossier-title">📜 Dossiê Histórico & Estratégico</div>' +
            '<p class="island-lore">' + (dossier.lore || isl.desc) + '</p>' +
          '</div>' +
          '<button type="button" class="glt-btn btn-primary glt-btn-sail-here" aria-label="Zarpar para ' + isl.name + '">⛵ ' + (T.ui.sailToIslandBtn || 'Zarpar para esta Ilha (Ativar Zona)') + '</button>';

        var sailBtn = dossierCol.querySelector('.glt-btn-sail-here');
        if (sailBtn) {
          sailBtn.addEventListener('click', function() {
            self.matchConfig.sea = isl.seaId;
            if (self.platesSystem) {
              self.platesSystem.setEnvironment(self.seaToEnvProfile(isl.seaId), 800, key);
            }
            self.updateTopHudStatus();
            self.updateSeaPreviewBox();
            self.hideModal();
            self.renderGameplayTab();
          });
        }
      }

      renderIslandDetail(currentIslandKey);

      this.showModal(T.ui.nauticalChartTitle || 'Carta Náutica da Grand Line', modalWrap, 'modal-nautical-chart');
    },

    openBlessingInspectorModal: function(blessingId) {
      var self = this;
      var T = getT();
      var bList = GLT.assets ? GLT.assets.blessings : [];
      var blessing = bList.find(function(b) { return b.id === blessingId; }) || bList[0];
      if (!blessing) return;

      var unlocked = [];
      try { unlocked = JSON.parse(localStorage.getItem('glt_unlocked_blessings') || '[]'); } catch (_) {}
      var isUnlocked = unlocked.indexOf(blessing.id) !== -1;

      var old = document.getElementById('glt-blessing-lightbox');
      if (old && old.parentNode) old.parentNode.removeChild(old);
      var opener = document.activeElement;

      // Own layer above the regular modal: opening a blessing from the victory screen must not
      // replace that screen (the poster and the rematch button live there).
      var layer = document.createElement('div');
      layer.id = 'glt-blessing-lightbox';
      layer.className = 'glt-blessing-lightbox';
      layer.setAttribute('role', 'dialog');
      layer.setAttribute('aria-modal', 'true');
      layer.setAttribute('aria-labelledby', 'glt-blessing-lightbox-title');

      var wrap = document.createElement('div');
      wrap.className = 'glt-blessing-inspector-modal' + (isUnlocked ? '' : ' is-locked');
      wrap.innerHTML =
        '<div class="blessing-inspector-card">' +
          '<img class="blessing-inspector-img" src="' + blessing.image + '" alt="' + blessing.name + '">' +
          '<div class="blessing-inspector-info">' +
            '<div class="blessing-type-badge">' + (isUnlocked ? T.ui.blessingUnlockedBadge : T.ui.blessingLockedBadge) + ' · ' + blessing.badge + '</div>' +
            '<h3 class="blessing-inspector-title" id="glt-blessing-lightbox-title">' + blessing.name + '</h3>' +
            '<p class="blessing-inspector-desc">' + blessing.desc + '</p>' +
            '<p class="blessing-inspector-note">' + (isUnlocked ? T.ui.blessingCollectibleNote : T.ui.blessingLockedHint) + '</p>' +
            '<button type="button" class="glt-btn btn-secondary glt-btn-close-blessing">' + (T.ui.closeModal || 'Fechar') + '</button>' +
          '</div>' +
        '</div>';
      layer.appendChild(wrap);

      function close() {
        document.removeEventListener('keydown', onKey, true);
        if (layer.parentNode) layer.parentNode.removeChild(layer);
        if (opener && typeof opener.focus === 'function') opener.focus();
      }
      function onKey(ev) {
        if (ev.key === 'Escape') {
          ev.preventDefault();
          ev.stopPropagation();
          close();
        } else if (ev.key === 'Tab') {
          ev.preventDefault(); // one control inside: focus stays on it
          closeBtn.focus();
        }
      }
      var closeBtn = wrap.querySelector('.glt-btn-close-blessing');
      closeBtn.addEventListener('click', close);
      layer.addEventListener('click', function(ev) { if (ev.target === layer) close(); });
      document.addEventListener('keydown', onKey, true);

      (this.dom.appRoot || document.body).appendChild(layer);
      closeBtn.focus();
      if (this.audio && typeof this.audio.playUiClick === 'function') this.audio.playUiClick();
    },

    startRenderLoop: function() {
      var self = this;
      if (!this.webglAvailable) return;
      this.lastFrameTime = performance.now();

      function frame(now) {
        self.rafId = requestAnimationFrame(frame);
        var dt = Math.min(0.1, (now - self.lastFrameTime) * 0.001);
        self.lastFrameTime = now;

        if (!self.isPaused) {
          var scaledDt = dt * self.animSpeed;
          self.simTime += scaledDt;

          if (self.platesSystem && self.postPipeline) {
            self.platesSystem.update(scaledDt, self.simTime, self.postPipeline.renderTarget.height);
          }

          self.playerShipMeshes.forEach(function(sm) {
            GLT.shipsVoxel.updateShip(sm, scaledDt, self.simTime);
          });
          self.enemyGhostShipMeshes.forEach(function(gm) {
            GLT.shipsVoxel.updateShip(gm, scaledDt, self.simTime);
          });

          if (self.backdrop && self.platesSystem) {
            self.backdrop.update(self.platesSystem.camera, scaledDt, self.simTime);
          }

          if (self.fx) {
            self.fx.update(scaledDt, self.simTime);
          }
        }

        if (self.postPipeline) {
          self.postPipeline.render(self.simTime);
        }
      }

      this.rafId = requestAnimationFrame(frame);
    }
  };

  Object.defineProperty(UIController, 'seaPlates', {
    enumerable: false,
    configurable: true,
    get: function() { return UIController.platesSystem ? UIController.platesSystem.seaPlates : null; }
  });

  Object.defineProperty(UIController, 'enemyGhostShips', {
    enumerable: false,
    configurable: true,
    get: function() { return UIController.enemyGhostShipMeshes; }
  });

  GLT.ui = UIController;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = UIController;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
