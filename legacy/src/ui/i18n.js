/* GLT.i18n + GLT.T: the single PT-BR dictionary and formatting helpers. Area: ui. Contract: ARCHITECTURE.md §12.
 * Core implemented and dictionary seeded by the architect; owner: ui builder (adds/edits keys).
 * Pure at load time (no DOM): also loaded by tests/run.mjs. */
(function () {
  'use strict';
  const GLT = (globalThis.GLT = globalThis.GLT || {});

  const dict = {
    // ---------------- app ----------------
    'app.title': 'Grand Line Tactics',
    'app.subtitle': 'Batalha na Grand Line',
    'app.disclaimer': 'Homenagem de fã, sem fins lucrativos. One Piece e seus personagens pertencem a Eiichiro Oda, Shueisha e Toei Animation. Toda a arte deste jogo é pixel art procedural original.',
    'app.loading': 'Içando as velas…',
    'common.on': 'Ligado',
    'common.off': 'Desligado',
    'common.cpu': 'CPU',
    'common.you': 'Você',
    'common.vs': 'vs',

    // ---------------- menu ----------------
    'menu.mode': 'Modo de jogo',
    'menu.pvc': 'Contra a CPU',
    'menu.pvp': 'Online (PvP)',
    'menu.crew': 'Sua tripulação',
    'menu.rival': 'Tripulação rival',
    'menu.rivalRandom': 'Rival aleatório',
    'menu.difficulty': 'Dificuldade',
    'menu.format': 'Formato',
    'menu.series': 'Série',
    'menu.rules': 'Regras',
    'menu.sea': 'Mar',
    'menu.start': 'Zarpar!',
    'menu.settings': 'Ajustes',
    'menu.stats': 'Estatísticas',
    'menu.howTo': 'Como jogar',
    'menu.back': 'Voltar',
    'menu.close': 'Fechar',
    'menu.continue': 'Continuar',
    'menu.quit': 'Abandonar partida',
    'menu.quitConfirm': 'Abandonar a partida? Isso conta como derrota.',
    'menu.yes': 'Sim',
    'menu.no': 'Não',

    // ---------------- crews ----------------
    'crew.strawHat.name': 'Chapéus de Palha',
    'crew.strawHat.captain': 'Monkey D. Luffy',
    'crew.strawHat.officer1': 'Roronoa Zoro',
    'crew.strawHat.officer2': 'Nami',
    'crew.strawHat.officer3': 'Sanji',
    'crew.whitebeard.name': 'Barba Branca',
    'crew.whitebeard.captain': 'Edward Newgate',
    'crew.whitebeard.officer1': 'Marco',
    'crew.whitebeard.officer2': 'Portgas D. Ace',
    'crew.whitebeard.officer3': 'Jozu',
    'crew.redHair.name': 'Cabelo Vermelho',
    'crew.redHair.captain': 'Shanks',
    'crew.redHair.officer1': 'Benn Beckman',
    'crew.redHair.officer2': 'Lucky Roux',
    'crew.redHair.officer3': 'Yasopp',
    'crew.heart.name': 'Piratas do Coração',
    'crew.heart.captain': 'Trafalgar D. Water Law',
    'crew.heart.officer1': 'Bepo',
    'crew.heart.officer2': 'Penguin',
    'crew.heart.officer3': 'Shachi',
    'crew.blackbeard.name': 'Barba Negra',
    'crew.blackbeard.captain': 'Marshall D. Teach',
    'crew.blackbeard.officer1': 'Jesus Burgess',
    'crew.blackbeard.officer2': 'Van Augur',
    'crew.blackbeard.officer3': 'Laffitte',
    'crew.marine.name': 'Marinha',
    'crew.marine.captain': 'Monkey D. Garp',
    'crew.marine.officer1': 'Koby',
    'crew.marine.officer2': 'Helmeppo',
    'crew.marine.officer3': 'Bogard',
    'crew.officers': 'Oficiais',
    'crew.technique': 'Técnica',

    // ---------------- ships ----------------
    'ship.mobyDick.name': 'Moby Dick',
    'ship.thousandSunny.name': 'Thousand Sunny',
    'ship.oroJackson.name': 'Oro Jackson',
    'ship.redForce.name': 'Red Force',
    'ship.polarTang.name': 'Polar Tang',
    'ship.baratie.name': 'Baratie',
    'ship.goingMerry.name': 'Going Merry',

    // ---------------- techniques ----------------
    'tech.bazooka.name': 'Bazuca',
    'tech.bazooka.desc': 'Rajada 2×2: dispara em quatro casas de uma vez.',
    'tech.tremor.name': 'Tremor',
    'tech.tremor.desc': 'Abalo em cruz: atinge cinco casas.',
    'tech.haki.name': 'Haki do Rei',
    'tech.haki.desc': 'Sonar 3×3: diz se há navio na área (sim ou não).',
    'tech.room.name': 'Room',
    'tech.room.desc': 'Conta quantas casas de navio há em uma linha ou coluna.',
    'tech.vortex.name': 'Vórtice',
    'tech.vortex.desc': 'O próximo ataque inimigo é absorvido pela escuridão.',
    'tech.observation.name': 'Observação',
    'tech.observation.desc': 'Revela uma casa de um navio inimigo que ainda flutua.',
    'tech.use': 'Usar técnica',
    'tech.used': 'Técnica já usada nesta partida',
    'tech.costsTurn': 'Usar uma técnica gasta o turno inteiro.',
    'tech.pickTarget': 'Escolha o alvo da técnica',
    'tech.pickRow': 'Linha',
    'tech.pickCol': 'Coluna',
    'tech.cancel': 'Cancelar técnica',
    'tech.haki.found': 'Haki do Rei: há navio perto de {cell}!',
    'tech.haki.none': 'Haki do Rei: nenhum navio perto de {cell}.',
    'tech.room.result': { one: 'Room: {n} casa de navio na {line}.', other: 'Room: {n} casas de navio na {line}.' },
    'tech.room.row': 'linha {label}',
    'tech.room.col': 'coluna {label}',
    'tech.observation.result': 'Observação: há um navio em {cell}!',
    'tech.observation.none': 'Observação: nada a revelar.',
    'tech.vortex.armed': 'Vórtice armado: o próximo ataque será absorvido.',
    'tech.vortex.absorbed': 'O Vórtice absorveu o ataque!',

    // ---------------- shot results / calls ----------------
    'result.agua': 'Água!',
    'result.acerto': 'Acertou!',
    'result.acerto.big': 'Acertou em cheio!',
    'result.afundou': 'Afundou o {ship}!',
    'result.absorvido': 'Absorvido!',
    'call.shot': '{cell} — {result}',
    'call.salvo': 'Salva {i} de {n}',

    // ---------------- turns / coin ----------------
    'turn.mine': 'Sua vez, capitão!',
    'turn.theirs': 'Vez de {name}',
    'turn.cpuThinking': '{name} está mirando…',
    'turn.again': 'Acertou! Atire de novo!',
    'turn.number': 'Turno {n}',
    'turn.shotsLeft': { one: '{n} tiro restante', other: '{n} tiros restantes' },
    'turn.timeout': 'Tempo esgotado! Tiro automático em {cell}.',
    'turn.gust': 'Rajada de vento! O primeiro tiro desvia para {dir}.',
    'dir.N': 'o norte',
    'dir.S': 'o sul',
    'dir.E': 'o leste',
    'dir.W': 'o oeste',
    'coin.title': 'Moeda de Berry',
    'coin.flip': 'Jogando a moeda…',
    'coin.result': '{name} atira primeiro!',
    'coin.mine': 'Você atira primeiro!',

    // ---------------- formats / series / modes ----------------
    'format.escaramuca.name': 'Escaramuça',
    'format.escaramuca.desc': '8×8 · 4 navios',
    'format.classica.name': 'Clássica',
    'format.classica.desc': '10×10 · 5 navios',
    'format.grandline.name': 'Grand Line',
    'format.grandline.desc': '12×12 · 7 navios',
    'series.n': 'Melhor de {n}',
    'series.game': 'Partida {i} de {n}',
    'series.score': '{a} × {b}',
    'mode.classico.name': 'Modo Clássico',
    'mode.classico.desc': 'Sem técnicas e sem sorte.',
    'mode.tatico.name': 'Modo Tático',
    'mode.tatico.desc': 'Uma técnica da tripulação por partida e efeitos do mar.',

    // ---------------- seas ----------------
    'sea.calmo.name': 'Mar Calmo',
    'sea.calmo.desc': 'Águas tranquilas, sem efeitos.',
    'sea.grandline.name': 'Grand Line',
    'sea.grandline.desc': 'Bússola instável: a dica do Log Pose pode errar por uma casa.',
    'sea.novomundo.name': 'Novo Mundo',
    'sea.novomundo.desc': 'Névoa constante: as marcas de tiro somem após 2 turnos.',
    'sea.tempestade.name': 'Tempestade',
    'sea.tempestade.desc': 'Rajadas de vento podem desviar o primeiro tiro do turno.',
    'sea.visualOnly': 'No Modo Clássico o mar é só visual.',

    // ---------------- difficulties ----------------
    'difficulty.grumete.name': 'Grumete',
    'difficulty.grumete.desc': 'Atira ao acaso.',
    'difficulty.marujo.name': 'Marujo',
    'difficulty.marujo.desc': 'Caça navios e persegue cada acerto.',
    'difficulty.capitao.name': 'Capitão',
    'difficulty.capitao.desc': 'Varre o mar em xadrez e finaliza os alvos.',
    'difficulty.yonkou.name': 'Yonkou',
    'difficulty.yonkou.desc': 'Calcula probabilidades e aprende suas manias.',

    // ---------------- rules ----------------
    'rules.title': 'Regras',
    'rules.mode': 'Modo',
    'rules.touch': 'Navios podem se encostar',
    'rules.chain': 'Atirar de novo após acertar',
    'rules.salvo': 'Salva (tiros por turno = navios vivos)',
    'rules.timer': 'Tempo por turno',
    'rules.timer.off': 'Sem limite',
    'rules.timer.s': '{n} s',
    'rules.fog': 'Neblina (marcas somem após 2 turnos)',
    'rules.summary.format': '{format} {size}×{size} · {ships} navios',
    'rules.summary.series': 'Melhor de {n}',
    'rules.summary.noTouch': 'Navios não se encostam',
    'rules.summary.timer': '{n} s por turno',

    // ---------------- cameras / plates ----------------
    'camera.title': 'Câmera',
    'camera.both': 'Duas águas',
    'camera.own': 'Minhas águas',
    'camera.aim': 'Mira inimiga',
    'camera.panorama': 'Panorama da Grand Line',
    'camera.ceremony': 'Cerimônia',
    'camera.hint': 'Arraste para girar · pinça ou roda para dar zoom',
    'plate.own': 'Suas águas',
    'plate.enemy': 'Águas inimigas',
    'plate.of': 'Águas de {name}',

    // ---------------- setup ----------------
    'setup.title': 'Posicione sua frota',
    'setup.help': 'Arraste os navios para o mar. R, clique direito ou toque duplo para girar.',
    'setup.rotate': 'Girar (R)',
    'setup.auto': 'Automático',
    'setup.random': 'Aleatório',
    'setup.clear': 'Limpar',
    'setup.ready': 'Pronto!',
    'setup.waiting': 'Aguardando o rival posicionar a frota…',
    'setup.remaining': { one: 'Falta {n} navio', other: 'Faltam {n} navios' },
    'setup.invalid': 'Posição inválida',
    'setup.err.bounds': 'O navio sai do mar.',
    'setup.err.overlap': 'Já tem um navio aí.',
    'setup.err.touch': 'Nesta regra os navios não podem se encostar.',
    'setup.err.missing': 'Ainda faltam navios.',
    'setup.placed': '{ship} posicionado em {cell}.',
    'setup.shipLen': { one: '{n} casa', other: '{n} casas' },
    'setup.horizontal': 'horizontal',
    'setup.vertical': 'vertical',
    'setup.select': 'Selecionar {ship}',

    // ---------------- hud ----------------
    'hud.fire': 'FOGO!',
    'hud.fireAt': 'Disparar em {cell}',
    'hud.selectCell': 'Escolha uma casa inimiga',
    'hud.alreadyShot': 'Você já atirou aqui.',
    'hud.hint': 'Log Pose',
    'hud.hintUses': { one: '{n} uso', other: '{n} usos' },
    'hud.hintPoint': 'O Log Pose aponta para {cell}.',
    'hud.hintNone': 'O Log Pose não encontrou nada.',
    'hud.technique': 'Técnica: {tech}',
    'hud.timer': 'Tempo',
    'hud.shots': 'Tiros',
    'hud.hits': 'Acertos',
    'hud.sunk': 'Afundados',
    'hud.afloat': 'Navios vivos',
    'hud.speed': 'Velocidade',
    'hud.speedX': '{x}×',
    'hud.pause': 'Pausar',
    'hud.resume': 'Continuar',
    'hud.paused': 'Pausado',

    // ---------------- logbook ----------------
    'log.title': 'Diário de bordo',
    'log.empty': 'Nada registrado ainda. Mar calmo…',
    'log.shot': '{who} → {cell}: {result}',
    'log.tech': '{who} usou {tech}!',
    'log.coin': 'Moeda de Berry: {who} atira primeiro.',
    'log.gameStart': 'Partida {i} começou!',
    'log.gameWon': '{who} venceu a partida {i}!',
    'log.seriesWon': '{who} venceu a série por {a} × {b}!',
    'log.timeout': 'Tempo esgotado para {who}.',
    'log.forfeit': '{who} abandonou a partida.',
    'log.reaction': '{who}: {text}',

    // ---------------- stats ----------------
    'stats.title': 'Estatísticas',
    'stats.game': 'Partida {i}',
    'stats.series': 'Série',
    'stats.boxScore': 'Placar',
    'stats.shots': 'Tiros',
    'stats.hits': 'Acertos',
    'stats.misses': 'Erros',
    'stats.accuracy': 'Precisão',
    'stats.streak': 'Maior sequência',
    'stats.turns': 'Turnos',
    'stats.time': 'Tempo',
    'stats.techs': 'Técnicas',
    'stats.sunk': 'Navios afundados',
    'stats.bounty': 'Recompensa',
    'stats.next': 'Próxima partida',
    'stats.nextIn': 'Próxima partida em {n} s',
    'stats.rematch': 'Revanche',
    'stats.menu': 'Menu',
    'stats.victory': 'Vitória!',
    'stats.defeat': 'Derrota…',
    'stats.career': 'Carreira',
    'stats.played': 'Partidas',
    'stats.won': 'Vitórias',
    'stats.lost': 'Derrotas',
    'stats.best': 'Maior recompensa',
    'stats.reason.fleet': 'Frota afundada',
    'stats.reason.forfeit': 'Desistência',
    'stats.reason.timeout': 'Tempo esgotado',
    'stats.reason.cheat': 'Trapaça detectada',
    'stats.reason.absent': 'Adversário ausente',

    // ---------------- ceremony ----------------
    'ceremony.wanted': 'PROCURADO',
    'ceremony.deadOrAlive': 'VIVO OU MORTO',
    'ceremony.hero': 'HERÓI DA MARINHA',
    'ceremony.winner': '{crew} vence!',
    'ceremony.raise': '{crew} ergue sua bandeira!',
    'ceremony.bounty': 'Recompensa',
    'ceremony.skip': 'Pular cerimônia',

    // ---------------- settings ----------------
    'settings.title': 'Ajustes',
    'settings.pixel': 'Tamanho do pixel',
    'settings.pixelValue': '{n} px',
    'settings.outlines': 'Contornos',
    'settings.dither': 'Pontilhado',
    'settings.raw': '3D cru (sem filtro)',
    'settings.lift': 'Erguer cenário próximo',
    'settings.tod': 'Hora do dia',
    'settings.speed': 'Velocidade das animações',
    'settings.speedOffline': 'Só no modo offline',
    'settings.autoNext': 'Próxima partida automática',
    'settings.sound': 'Som',
    'settings.volume': 'Volume',
    'settings.mute': 'Silenciar',
    'settings.unmute': 'Ativar som',
    'settings.music': 'Música (shanty)',
    'settings.theme': 'Tema',
    'settings.motion': 'Movimento reduzido',
    'settings.grid2d': 'Grade 2D',
    'settings.camera': 'Câmera',
    'settings.reset': 'Restaurar padrões',
    'tod.auto': 'Conforme o mar',
    'tod.day': 'Dia',
    'tod.dusk': 'Entardecer',
    'tod.night': 'Noite',
    'tod.storm': 'Tempestade',
    'theme.auto': 'Automático',
    'theme.light': 'Claro',
    'theme.dark': 'Escuro',
    'motion.auto': 'Conforme o sistema',
    'motion.on': 'Ligado',
    'motion.off': 'Desligado',
    'grid2d.auto': 'Automática',
    'grid2d.on': 'Sempre',
    'grid2d.off': 'Nunca',

    // ---------------- pvp ----------------
    'pvp.title': 'Mar aberto (online)',
    'pvp.create': 'Criar sala',
    'pvp.join': 'Entrar com código',
    'pvp.quick': 'Partida rápida',
    'pvp.code': 'Código da sala',
    'pvp.codeHint': '5 letras ou números',
    'pvp.copyLink': 'Copiar link',
    'pvp.copied': 'Link copiado!',
    'pvp.share': 'Mande o código {code} ou o link para o seu rival.',
    'pvp.nick': 'Apelido',
    'pvp.reroll': 'Sortear outro',
    'pvp.waiting': 'Aguardando adversário…',
    'pvp.joined': '{name} entrou na sala!',
    'pvp.noRooms': 'Nenhuma sala aberta agora. Que tal criar uma?',
    'pvp.roomLine': '{name} · {crew} · {rules}',
    'pvp.enter': 'Entrar',
    'pvp.spectate': 'Assistir',
    'pvp.leave': 'Sair da sala',
    'pvp.rematch': 'Revanche',
    'pvp.rematchWait': 'Aguardando o rival aceitar a revanche…',
    'pvp.rematchAsk': '{name} quer revanche!',
    'pvp.online': { one: '{n} online agora', other: '{n} online agora' },
    'pvp.latency': '{n} ms',
    'pvp.status.offline': 'Sem conexão',
    'pvp.status.connecting': 'Conectando…',
    'pvp.status.online': 'Conectado',
    'pvp.status.unavailable': 'Online indisponível',
    'pvp.opponent.none': 'Sem adversário',
    'pvp.opponent.present': 'Adversário conectado',
    'pvp.opponent.away': 'Adversário reconectando…',
    'pvp.opponent.gone': 'Adversário desconectado',
    'pvp.forfeitWin': '{name} abandonou. A vitória é sua!',
    'pvp.cheat': 'Trapaça detectada',
    'pvp.cheatDetail': 'As respostas de {name} não batem com a frota revelada. A vitória é sua.',
    'pvp.verifying': 'Conferindo as frotas reveladas…',
    'pvp.verified': 'Frotas conferidas: jogo limpo!',
    'pvp.otherTab': 'Esta partida está aberta em outra aba. Aqui você só pode assistir.',
    'pvp.rejoin': 'Voltar para a partida {code}',
    'pvp.rejoined': 'Você voltou para a partida!',
    'pvp.spectating': 'Você está assistindo. As frotas só aparecem no fim.',
    'pvp.timeoutClaim': 'O tempo de {name} acabou. Tiro automático!',
    'pvp.host': 'Anfitrião',
    'pvp.guest': 'Convidado',
    'pvp.reactions': 'Reações',
    'pvp.err.not_found': 'Sala não encontrada.',
    'pvp.err.full': 'Sala cheia.',
    'pvp.err.own_room': 'Essa sala é sua!',
    'pvp.err.network': 'Falha de rede. Tentando de novo…',
    'pvp.err.quota': 'O mar está lotado. Tente mais tarde.',
    'pvp.err.denied': 'Sem permissão para jogar online aqui.',
    'pvp.err.exists': 'Esse código já existe. Gerando outro…',
    'pvp.err.unavailable': 'Serviço online indisponível no momento.',
    'pvp.err.bad_code': 'Código inválido.',
    'pvp.unavailable.no_runtime': 'O modo online só funciona dentro do artifact publicado. Jogue contra a CPU!',
    'pvp.unavailable.no_db': 'O modo online não está disponível nesta visualização. Jogue contra a CPU!',
    'pvp.unavailable.no_identity': 'Entre na sua conta para jogar online.',
    'pvp.unavailable.read_only': 'Você só pode assistir: peça acesso de Colaborador para jogar online.',
    'pvp.wanted.title': 'Mais procurados',
    'pvp.wanted.note': 'Ranking casual e não verificado.',
    'pvp.wanted.empty': 'Ninguém na lista ainda.',
    'pvp.wanted.line': '{rank}. {name} · {bounty}',

    // ---------------- reactions (presets only, no free text) ----------------
    'react.boaMira': 'Boa mira!',
    'react.prepareSe': 'Prepare-se!',
    'react.gg': 'GG, capitão!',
    'react.uau': 'Uau!',
    'react.porPouco': 'Foi por pouco!',
    'react.obrigado': 'Valeu pela partida!',

    // ---------------- nicknames (NickCode "a.n.dd") ----------------
    'nick.format': '{noun} {adj} {num}',
    'nick.noun': ['Marujo', 'Grumete', 'Corsário', 'Navegador', 'Timoneiro', 'Artilheiro', 'Cozinheiro', 'Atirador', 'Carpinteiro', 'Médico', 'Vigia', 'Bucaneiro'],
    'nick.adj': ['Corajoso', 'Destemido', 'Sorridente', 'Faminto', 'Veloz', 'Sortudo', 'Sombrio', 'Dourado', 'Risonho', 'Valente', 'Sereno', 'Trovejante'],
    'nick.fallback': 'Pirata Misterioso',

    // ---------------- Den Den Mushi boards ----------------
    'denden.live': 'AO VIVO',
    'denden.lastShot': 'Último tiro',
    'denden.hits': 'Acertos',
    'denden.sunk': 'Afundados',
    'denden.timer': 'Tempo',
    'denden.turn': 'Vez de',
    'denden.waiting': 'Aguardando…',
    'denden.victory': 'VITÓRIA!',

    // ---------------- accessibility ----------------
    'a11y.grid.own': 'Suas águas, grade de {n} por {n}',
    'a11y.grid.enemy': 'Águas inimigas, grade de {n} por {n}',
    'a11y.cell': '{cell}: {state}',
    'a11y.state.0': 'desconhecida',
    'a11y.state.1': 'água',
    'a11y.state.2': 'acerto',
    'a11y.state.3': 'navio afundado',
    'a11y.state.4': 'navio avistado',
    'a11y.state.ship': 'seu navio {ship}',
    'a11y.selected': 'selecionada',
    'a11y.keys': 'Setas movem; letras de A a L escolhem a linha; números de 1 a 0 escolhem a coluna; Enter seleciona e confirma.',
    'a11y.canvas': 'Cena 3D com as duas águas da Grand Line',
    'a11y.skip': 'Pular para a grade',

    // ---------------- errors ----------------
    'error.webgl': 'Seu navegador não suporta 3D aqui. Usando a grade 2D.',
    'error.storage': 'Não foi possível salvar o progresso neste navegador.',
    'error.generic': 'Algo deu errado no mar. Tente de novo.',
    'error.audio': 'Não foi possível iniciar o som.',

    // ---------------- CPU taunts: 'taunt.<crew>.<situation>' (variants) ----------------
    'taunt.strawHat.start': ['Eu vou ser o Rei dos Piratas!', 'Shishishi! Vamos nessa!'],
    'taunt.strawHat.cpuHit': ['Acertei! Shishishi!', 'Toma essa, Gomu Gomu!'],
    'taunt.strawHat.cpuMiss': ['Ué, errei? Tô com fome…', 'Ah, quase!'],
    'taunt.strawHat.cpuSunk': ['Afundei! Sanji, carne pra comemorar!', 'Mais um pro fundo do mar!'],
    'taunt.strawHat.playerHit': ['Ai! Essa doeu!', 'A Nami vai me matar…'],
    'taunt.strawHat.playerMiss': ['Shishishi, nem chegou perto!', 'Errou! Minha vez!'],
    'taunt.strawHat.playerSunk': ['Nããão! Meu navio!', 'Franky, conserta isso!'],
    'taunt.strawHat.cpuWin': ['Vencemos! Banquete no convés!', 'Eu disse que ia ser o Rei dos Piratas!'],
    'taunt.strawHat.cpuLose': ['Você é forte… bora de novo!', 'Tá bom, dessa vez você venceu.'],

    'taunt.whitebeard.start': ['Gurarara! Mostre seu valor, pirralho.', 'Este mar é a minha família.'],
    'taunt.whitebeard.cpuHit': ['Gurarara! Sentiu o tremor?', 'Mais um golpe da família!'],
    'taunt.whitebeard.cpuMiss': ['Hmph. O mar está agitado hoje.', 'Até um velho erra às vezes.'],
    'taunt.whitebeard.cpuSunk': ['Gurarara! Afundou como pedra!', 'Ninguém desafia o Barba Branca.'],
    'taunt.whitebeard.playerHit': ['Você tem coragem, pirralho.', 'Um arranhão no Moby Dick…'],
    'taunt.whitebeard.playerMiss': ['Gurarara! Mire melhor.', 'Isso nem molhou meu bigode.'],
    'taunt.whitebeard.playerSunk': ['Meus filhos… vocês pagarão por isso!', 'Hmph. Belo disparo.'],
    'taunt.whitebeard.cpuWin': ['Gurarara! Volte quando crescer.', 'A família vence de novo!'],
    'taunt.whitebeard.cpuLose': ['Gurarara… você é digno.', 'Uma nova era chegou.'],

    'taunt.redHair.start': ['Vamos ver do que você é capaz.', 'Que tal uma partida antes do banquete?'],
    'taunt.redHair.cpuHit': ['Hehe, acertei.', 'Benn, anota essa!'],
    'taunt.redHair.cpuMiss': ['Opa, a bebida subiu.', 'Errei de propósito, juro.'],
    'taunt.redHair.cpuSunk': ['Esse vai pro fundo. Saúde!', 'Nada pessoal, amigo.'],
    'taunt.redHair.playerHit': ['Boa! Você tem futuro.', 'Essa pegou de jeito.'],
    'taunt.redHair.playerMiss': ['Calma, respira e mira.', 'Quase, quase.'],
    'taunt.redHair.playerSunk': ['Hah! Você me lembra alguém.', 'Belo tiro, de verdade.'],
    'taunt.redHair.cpuWin': ['Foi divertido! A próxima rodada é por minha conta.', 'Volte mais forte.'],
    'taunt.redHair.cpuLose': ['Haha, perdi bonito! Vamos festejar mesmo assim.', 'Você venceu, capitão.'],

    'taunt.heart.start': ['Room… a operação vai começar.', 'Não espere piedade.'],
    'taunt.heart.cpuHit': ['Shambles. Exatamente onde previ.', 'Diagnóstico: acerto.'],
    'taunt.heart.cpuMiss': ['Hm. Margem de erro aceitável.', 'Ajustando os cálculos.'],
    'taunt.heart.cpuSunk': ['Operação concluída.', 'Paciente perdido.'],
    'taunt.heart.playerHit': ['Tsc. Bepo, submerge!', 'Dano no casco… irrelevante.'],
    'taunt.heart.playerMiss': ['Previsível.', 'Você atira sem plano.'],
    'taunt.heart.playerSunk': ['…Você é mais perigoso do que parece.', 'Tsc. Isso vai custar caro.'],
    'taunt.heart.cpuWin': ['Cirurgia bem-sucedida.', 'Eu avisei: sem piedade.'],
    'taunt.heart.cpuLose': ['Hmph. Essa foi sua.', 'Interessante… muito interessante.'],

    'taunt.blackbeard.start': ['Zehahaha! Os sonhos dos homens nunca morrem!', 'Prepare-se para a escuridão!'],
    'taunt.blackbeard.cpuHit': ['Zehahaha! Que sorte a minha!', 'A escuridão engole tudo!'],
    'taunt.blackbeard.cpuMiss': ['Ora, ora… paciência.', 'Zehaha, esse foi só o aquecimento.'],
    'taunt.blackbeard.cpuSunk': ['Zehahaha! Mais um tesouro pra mim!', 'Afundou na escuridão!'],
    'taunt.blackbeard.playerHit': ['Ai, ai, ai! Isso dói!', 'Ei, isso não foi justo!'],
    'taunt.blackbeard.playerMiss': ['Zehahaha! Errou!', 'O destino está do meu lado!'],
    'taunt.blackbeard.playerSunk': ['Maldito! Você vai pagar!', 'Meu navio! Zehaha… haha… ai.'],
    'taunt.blackbeard.cpuWin': ['Zehahaha! A era é minha!', 'Ninguém escapa da escuridão!'],
    'taunt.blackbeard.cpuLose': ['Isso não acaba aqui! Zehahaha!', 'Tsc… sorte de principiante.'],

    'taunt.marine.start': ['Em nome da Justiça, renda-se!', 'Bwahaha! Hora da disciplina!'],
    'taunt.marine.cpuHit': ['Bala de canhão com amor!', 'Justiça acertada!'],
    'taunt.marine.cpuMiss': ['Bwahaha! Errei, mas o próximo não erra.', 'Koby, recarregue!'],
    'taunt.marine.cpuSunk': ['Um pirata a menos nos mares!', 'Afundou em nome da Justiça!'],
    'taunt.marine.playerHit': ['Hmph! Atingiram um navio da Marinha!', 'Helmeppo, conserte esse casco!'],
    'taunt.marine.playerMiss': ['Bwahaha! Tente de novo, pirata.', 'A Justiça não se abala.'],
    'taunt.marine.playerSunk': ['Isso vai para o relatório!', 'Como ousa afundar um navio da Marinha?!'],
    'taunt.marine.cpuWin': ['A Justiça prevalece!', 'Para Impel Down com você!'],
    'taunt.marine.cpuLose': ['Bwahaha! Você é dos bons.', 'Na próxima eu te pego, pirata.']
  };

  // ---------------- core ----------------
  const missing = [];
  const missingSet = new Set();
  let numFmt = null;
  let pluralRules = null;

  function num(n, o) {
    if (o) return new Intl.NumberFormat('pt-BR', o).format(n);
    if (!numFmt) numFmt = new Intl.NumberFormat('pt-BR');
    return numFmt.format(n);
  }

  function berry(n) { return '฿ ' + num(Math.round(Number(n) || 0)); }

  function pct(x, digits) {
    const d = digits == null ? 0 : digits;
    return num(Number(x) || 0, { style: 'percent', minimumFractionDigits: d, maximumFractionDigits: d });
  }

  function time(ms) {
    const s = Math.max(0, Math.round((Number(ms) || 0) / 1000));
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
    const two = (v) => (v < 10 ? '0' : '') + v;
    return h ? h + ':' + two(m) + ':' + two(r) : m + ':' + two(r);
  }

  function cell(r, c) { return GLT.board ? GLT.board.label(r, c) : String(r) + ',' + String(c); }

  function list(items) {
    const arr = (items || []).map(String);
    try { return new Intl.ListFormat('pt-BR', { style: 'long', type: 'conjunction' }).format(arr); } catch (e) { /* fallback */ }
    if (arr.length <= 1) return arr.join('');
    return arr.slice(0, -1).join(', ') + ' e ' + arr[arr.length - 1];
  }

  function has(key) { return Object.prototype.hasOwnProperty.call(dict, key); }
  function variants(key) { const v = dict[key]; return Array.isArray(v) ? v.length : has(key) ? 1 : 0; }

  function fmtVar(v) {
    if (typeof v === 'number') return num(v);
    if (v && typeof v === 'object' && typeof v.key === 'string') return t(v.key, v.vars);
    return v == null ? '' : String(v);
  }

  function t(key, vars) {
    let val = dict[key];
    if (val === undefined) {
      if (!missingSet.has(key)) { missingSet.add(key); missing.push(key); }
      return String(key);
    }
    if (Array.isArray(val)) {
      const len = val.length;
      const i = vars && Number.isFinite(vars.v) ? ((Math.floor(vars.v) % len) + len) % len : 0;
      val = val[i];
    }
    if (val && typeof val === 'object') {
      const n = vars && Number.isFinite(vars.n) ? vars.n : 0;
      if (!pluralRules) pluralRules = new Intl.PluralRules('pt-BR');
      const cat = pluralRules.select(n);
      val = val[cat] != null ? val[cat] : val.other;
    }
    val = String(val);
    if (!vars) return val;
    return val.replace(/\{(\w+)\}/g, (m, name) => (Object.prototype.hasOwnProperty.call(vars, name) ? fmtVar(vars[name]) : m));
  }

  function fontsReady() {
    try {
      if (typeof document !== 'undefined' && document.fonts && document.fonts.ready) return document.fonts.ready.then(() => undefined);
    } catch (e) { /* ignore */ }
    return Promise.resolve();
  }

  GLT.i18n = { lang: 'pt-BR', dict, t, has, variants, num, berry, pct, time, cell, list, missing, fontsReady };
  GLT.T = t;
})();
