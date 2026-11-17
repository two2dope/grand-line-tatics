/**
 * Grand Line Tactics — PT-BR Localization & Dictionary Module (`GLT.i18n` & `GLT.T`)
 * Pure-JS module containing all game strings, aria-labels, tooltips, logs, pirate taunts,
 * formatted bounties (Berry sign ฿), and Brazilian Portuguese pluralization.
 * Zero hard-coded text elsewhere in the application.
 */

(function(root) {
  'use strict';

  /**
   * Formats a number according to pt-BR locale conventions (e.g. 1.500.000).
   * @param {number} n
   * @returns {string}
   */
  function formatNumber(n) {
    if (typeof n !== 'number' || Number.isNaN(n)) return '0';
    return new Intl.NumberFormat('pt-BR').format(n);
  }

  /**
   * Formats a Berry bounty with the canonical symbol (e.g. ฿ 1.500.000.000).
   * @param {number} n
   * @returns {string}
   */
  function formatBounty(n) {
    if (typeof n !== 'number' || Number.isNaN(n)) n = 0;
    return '฿ ' + formatNumber(Math.round(n));
  }

  /**
   * Pluralization helper for pt-BR.
   * @param {number} count
   * @param {string} singular
   * @param {string} pluralForm
   * @returns {string} e.g. "1 navio", "5 navios"
   */
  function plural(count, singular, pluralForm) {
    const c = typeof count === 'number' && !Number.isNaN(count) ? count : 0;
    const word = Math.abs(c) === 1 ? singular : pluralForm;
    return `${formatNumber(c)} ${word}`;
  }

  /**
   * Master PT-BR Dictionary `T`
   */
  const T = {
    meta: {
      title: 'Grand Line Tactics',
      subtitle: 'Batalha na Grand Line',
      tagline: 'Guerra Naval Estratégica em Pixel Art 3D nos Mares do Novo Mundo',
      disclaimer: 'Grand Line Tactics é uma homenagem não oficial de fãs ao universo de One Piece criado por Eiichiro Oda / Shueisha / Toei Animation. A cena 3D em pixel e o código são originais e procedurais. As ilustrações de personagens são arte de fã, sem vínculo com os detentores dos direitos. Nenhum asset ou logotipo oficial foi extraído. Projeto sem fins lucrativos.'
    },

    modes: {
      classico: {
        name: 'Modo Clássico',
        desc: 'Batalha naval pura e tradicional, sem técnicas especiais e sem sorte extra. Apenas você, seus canhões e sua intuição.'
      },
      tatico: {
        name: 'Modo Tático',
        desc: 'Modo estratégico com uma técnica secreta por partida para cada capitão e efeitos atmosféricos dos oceanos da Grand Line.'
      }
    },

    boards: {
      escaramuca: {
        name: 'Escaramuça',
        label: 'Escaramuça (8x8)',
        sizeDesc: 'Grade 8x8 • 4 Navios',
        desc: 'Partidas dinâmicas e velozes num quadrante oceânico estreito com 4 embarcações (tamanhos 4, 3, 3, 2).'
      },
      classica: {
        name: 'Clássica',
        label: 'Clássica (10x10)',
        sizeDesc: 'Grade 10x10 • 5 Navios',
        desc: 'O formato clássico e balanceado de guerra naval com a frota lendária padrão de 5 navios (tamanhos 5, 4, 3, 3, 2).'
      },
      grand_line: {
        name: 'Grand Line',
        label: 'Grand Line (12x12)',
        sizeDesc: 'Grade 12x12 • 7 Navios',
        desc: 'Batalha campal épica em mar aberto com a frota completa de 7 navios canônicos (tamanhos 5, 4, 4, 3, 3, 3, 2).'
      }
    },

    series: {
      md1: 'Partida Única',
      md3: 'Melhor de 3',
      md5: 'Melhor de 5',
      shortMd1: 'MD1',
      shortMd3: 'MD3',
      shortMd5: 'MD5',
      scoreFormat: (p0, p1) => `${p0} × ${p1}`
    },

    seas: {
      mar_calmo: {
        name: 'Mar Calmo (Calm Belt)',
        desc: 'Águas cristalinas e sem vento onde os Reis dos Mares adormecem. Visibilidade impecável.',
        effectDesc: 'Sem perturbações visuais ou climáticas.'
      },
      grand_line: {
        name: 'Grand Line',
        desc: 'Correntes misteriosas e ventos oceânicos que exigem o leme firme de marinheiros experientes.',
        effectDesc: 'Nuvens passageiras e marés oceânicas moderadas.'
      },
      novo_mundo: {
        name: 'Novo Mundo',
        desc: 'Águas bravias e céus carregados com a fúria da última metade da Grand Line.',
        effectDesc: 'Águas agitadas e crepúsculo atmosférico com iluminação dramática.'
      },
      tempestade: {
        name: 'Tempestade Tropical',
        desc: 'Chuva torrencial, relâmpagos distantes e ondas agitadas que testam a coragem da tripulação.',
        effectDesc: 'Nevoeiro costeiro que desvanece o rastro dos tiros anteriores após 2 turnos.'
      },
      marineford: {
        name: 'Marineford (Quartel General)',
        desc: 'Águas fortificadas sob os Portões da Justiça. O epicentro da Marinha onde os mais fortes colidem.',
        effectDesc: 'Atmosfera de Guerra Suprema e visibilidade fortificada com águas de baía.'
      }
    },

    difficulties: {
      grumete: {
        name: 'Grumete',
        title: 'Grumete dos Mares',
        desc: 'IA iniciante que dispara a esmo pelas águas sem rastrear padrões ou proximidade.'
      },
      marujo: {
        name: 'Marujo',
        title: 'Marujo Experiente',
        desc: 'IA intermediária que adota protocolo sistemático de caça e aniquilação ao acertar um tiro.'
      },
      capitao: {
        name: 'Capitão',
        title: 'Capitão Veterano',
        desc: 'IA avançada com busca otimizada por paridade em xadrez e foco eficiente em alvos danificados.'
      },
      yonkou: {
        name: 'Yonkou',
        title: 'Soberano Yonkou',
        desc: 'Mestre tático que calcula a densidade de probabilidade da frota restante e aprende viés de posicionamento entre partidas.'
      }
    },

    ships: {
      moby_dick: {
        id: 'moby_dick',
        name: 'Moby Dick',
        crew: 'Barba Branca',
        length: 5,
        desc: 'Navio capitânia colossal com proa em forma de baleia branca e velas com o bigode crescente de Edward Newgate.'
      },
      thousand_sunny: {
        id: 'thousand_sunny',
        name: 'Thousand Sunny',
        crew: 'Chapéus de Palha',
        length: 4,
        desc: 'O navio dos sonhos construído por Franky com Madeira de Adão, carranca radiante de leão e convés gramado.'
      },
      oro_jackson: {
        id: 'oro_jackson',
        name: 'Oro Jackson',
        crew: 'Piratas do Roger',
        length: 4,
        desc: 'A lendária embarcação forjada por Tom que navegou por todos os mares do mundo até Laugh Tale.'
      },
      red_force: {
        id: 'red_force',
        name: 'Red Force',
        crew: 'Cabelo Vermelho',
        length: 3,
        desc: 'Elegante e temido galeão dos mares comandado por Shanks, com acabamento carmesim e proa esculpida.'
      },
      polar_tang: {
        id: 'polar_tang',
        name: 'Polar Tang',
        crew: 'Piratas do Coração',
        length: 3,
        desc: 'Submarino amarelo equipado com tecnologia médica avançada e motores elétricos submersíveis.'
      },
      baratie: {
        id: 'baratie',
        name: 'Baratie',
        crew: 'Chefs dos Mares',
        length: 3,
        desc: 'Navio-restaurante flutuante em formato de peixe, ancorado nas águas de East Blue com cozinha de combate.'
      },
      going_merry: {
        id: 'going_merry',
        name: 'Going Merry',
        crew: 'Chapéus de Palha',
        length: 2,
        desc: 'A saudosa caravela original com a carranca de carneiro que abrigava a alma protetora do Klabautermann.'
      }
    },

    crews: {
      straw_hats: {
        id: 'straw_hats',
        name: 'Chapéus de Palha',
        captain: 'Monkey D. Luffy',
        officers: ['Roronoa Zoro', 'Nami', 'Sanji'],
        techniqueName: 'Gomu Gomu no Bazooka',
        techniqueDesc: 'Disparo elástico em salva concêntrica cobrindo uma área de 2x2 células no mar inimigo.',
        taunts: {
          intro: [
            'Eu serei o Rei dos Piratas!',
            'Vamos nessa, pessoal! Não deixem ninguém recuar!',
            'Primeiro a vitória naval, depois o banquete com muita carne!'
          ],
          hit: [
            'Gomu Gomu no... Acerto direto no convés!',
            'Sentiu o impacto dos nossos canhões?!',
            'Na mosca! Nami, mire o próximo canhão!'
          ],
          miss: [
            'Opa! O vento levou a bola de ferro pra água!',
            'Errei o alvo, mas na próxima não escapa!',
            'Só espirrou água salgada na proa deles!'
          ],
          sink: [
            'Mandamos a embarcação inimiga pro fundo do mar!',
            'Menos um obstáculo no nosso caminho até o One Piece!',
            'Afundou bonito! Boa mira, pessoal!'
          ],
          victory: [
            'Ganhamos! Que comece a festa dos piratas!',
            'Hahaha! Ninguém vence a tripulação dos Chapéus de Palha!',
            'Ergam a bandeira! Próximo destino: Laugh Tale!'
          ],
          defeat: [
            'Eu ainda... não terminei minha jornada...',
            'Minha tripulação nunca desiste... vamos voltar mais fortes!',
            'Ugh... que tiro certeiro... desculpem, pessoal...'
          ]
        }
      },
      whitebeard: {
        id: 'whitebeard',
        name: 'Barba Branca',
        captain: 'Edward Newgate',
        officers: ['Marco', 'Portgas D. Ace', 'Jozu'],
        techniqueName: 'Gurarara Tremor',
        techniqueDesc: 'Impacto sísmico devastador em formato de cruz de 5 células (célula central e as 4 ortogonais adjacentes).',
        taunts: {
          intro: [
            'Gurararara! Sejam bem-vindos aos meus mares, pirralhos!',
            'Nenhum marujo toca nos filhos que navegam sob minha proteção!',
            'Mostrem o peso da determinação dos seus canhões!'
          ],
          hit: [
            'O oceano racha sob a força dos meus disparos!',
            'Gurarara! Sentiram o tremor estremecer o leme?!',
            'Um tiro vigoroso, digno dos guerreiros do Novo Mundo!'
          ],
          miss: [
            'As ondas revoltas engoliram nossa munição...',
            'O mar concedeu um momento de trégua a vocês.',
            'Firmem as pernas no convés, o próximo canhão não hesitará!'
          ],
          sink: [
            'Mais uma carcaça repousará para sempre no leito marinho!',
            'Uma bela embarcação que sucumbiu à bravura dos meus filhos!',
            'Que as profundezas acolham a memória dessa nau!'
          ],
          victory: [
            'Gurararara! Os mares ainda tremem com o nome de Barba Branca!',
            'Um brinde farto de saquê para todos os meus valorosos filhos!',
            'Ninguém desafia esta família impunemente!'
          ],
          defeat: [
            'Mesmo sucumbindo... meu corpo permanece altivo e de pé!',
            'O One Piece... REALMENTE EXISTE!',
            'A chama dos corajosos nunca se apagará nestes mares...'
          ]
        }
      },
      red_haired: {
        id: 'red_haired',
        name: 'Cabelo Vermelho',
        captain: 'Shanks',
        officers: ['Benn Beckman', 'Lucky Roux', 'Yasopp'],
        techniqueName: 'Haki do Rei',
        techniqueDesc: 'Onda avassaladora de presença dominante que atua como sonar sim/não em uma área de 3x3 células.',
        taunts: {
          intro: [
            'Vim aqui para colocar um ponto final nesta batalha!',
            'Canhões existem para disparar na hora certa, não para blefar.',
            'Um bom duelo no mar sempre merece um brinde leal ao final!'
          ],
          hit: [
            'Tiro milimétrico do Yasopp! Sem chance de fuga.',
            'Direto no casco! Sem hesitação.',
            'A calma e o foco guiam cada projétil nosso.'
          ],
          miss: [
            'Água salgada... apenas um tiro de saudação aos companheiros.',
            'O vento oceânico sopra livremente por enquanto.',
            'Respiração tranquila, marinheiros. O mar recompensa a paciência.'
          ],
          sink: [
            'O navio deles partiu a espinha dorsal nas águas!',
            'Lutaram com fibra, mas o mar exige respeito total.',
            'Adeus ao leme inimigo! O mar levou a melhor.'
          ],
          victory: [
            'Vocês foram adversários de honra! Levantemos as taças!',
            'A Nova Era brilha com a coragem demonstrada hoje!',
            'Ventos favoráveis àqueles que amam a liberdade dos mares!'
          ],
          defeat: [
            'Apostei minha fé na Nova Era... e ela provou sua força.',
            'Excelente disparo... vocês mereceram esta conquista com louvor.',
            'Recolham as âncoras, foi um duelo memorável.'
          ]
        }
      },
      heart: {
        id: 'heart',
        name: 'Piratas do Coração',
        captain: 'Trafalgar Law',
        officers: ['Bepo', 'Shachi', 'Penguin'],
        techniqueName: 'Room Cirúrgico',
        techniqueDesc: 'Esfera operacional que disseca e contabiliza o número exato de células ocupadas por navios em uma linha ou coluna.',
        taunts: {
          intro: [
            'Dentro da minha Room, tudo se move sob o fio da minha vontade.',
            'Os fracos não escolhem a forma de seu naufrágio.',
            'Bepo, mantenha os manômetros de imersão equilibrados.'
          ],
          hit: [
            'Incisão precisa na estrutura do navio adversário.',
            'Cálculo vetorial milimétrico. Sem desvios.',
            'A anatomia da sua frota foi exposta diante de nós.'
          ],
          miss: [
            'Variável atmosférica imprevista. Ajustando coordenadas.',
            'Quadrante vazio. O diagnóstico prossegue na próxima coordenada.',
            'Pequena margem de erro eliminada na próxima iteração.'
          ],
          sink: [
            'Navio seccionado e irrecuperável. Diagnóstico: afundamento total.',
            'Menos uma embarcação flutuando no tabuleiro.',
            'Estrutura desmantelada. Prossigamos com a operação.'
          ],
          victory: [
            'A engrenagem do destino agora gira sob os nossos termos.',
            'Operação tática concluída sem perdas críticas em nossa frota.',
            'A cirurgia naval foi um sucesso absoluto.'
          ],
          defeat: [
            'A vontade dos D. não termina com uma simples derrota...',
            'Bepo... acionar manobra de imersão rápida... recuar...',
            'Subestimei as variáveis da frota rival... lamentável...'
          ]
        }
      },
      blackbeard: {
        id: 'blackbeard',
        name: 'Barba Negra',
        captain: 'Marshall D. Teach',
        officers: ['Shiryu', 'Van Augur', 'Jesus Burgess'],
        techniqueName: 'Vórtice da Escuridão',
        techniqueDesc: 'Barreira de gravidade densa que absorve e anula integralmente o próximo disparo inimigo direcionado à sua frota.',
        taunts: {
          intro: [
            'Zehahahahaha! O sonho dos homens no mar nunca morrerá!',
            'A escuridão engole tudo: a luz, a esperança e os seus navios!',
            'O destino traçou este mar exatamente para a nossa ascensão!'
          ],
          hit: [
            'Zehahaha! Que estrondo maravilhoso de madeira se partindo!',
            'A força da nossa pólvora atinge o coração da sua frota!',
            'Destruição sublime! Sintam o peso da nossa ambição!'
          ],
          miss: [
            'Zehaha... o mar bebeu a pólvora por enquanto, que bobagem!',
            'Errar um tiro faz parte do grande espetáculo do destino!',
            'Podem rir agora, mas o próximo tiro vai engolir vocês!'
          ],
          sink: [
            'Engolido pelo abismo negro! Zehahahahahaha!',
            'Menos um casco no mundo! Desceu direto pras trevas!',
            'Descansem no fundo escuro do mar com os seus sonhos fracos!'
          ],
          victory: [
            'Zehahahahaha! A partir de hoje, esta era pertence a Barba Negra!',
            'O oceano inteiro se curvará diante da nossa bandeira!',
            'Viram só?! O destino sempre sorri para quem tem coragem sem escrúpulos!'
          ],
          defeat: [
            'Malditos sejam... isso não fazia parte dos meus cálculos!',
            'Não pensem que acabou aqui... a escuridão sempre ressurge!',
            'Ugh... Zeha... um revés temporário em nossa glória...'
          ]
        }
      },
      marines: {
        id: 'marines',
        name: 'Marinha',
        captain: 'Sakazuki (Akainu)',
        officers: ['Borsalino (Kizaru)', 'Monkey D. Garp', 'Smoker'],
        techniqueName: 'Haki de Observação',
        techniqueDesc: 'Vigilância tática implacável do Quartel-General que localiza e revela uma célula intacta de um navio inimigo sobrevivente.',
        taunts: {
          intro: [
            'A Justiça Absoluta não tolera a insolência pirata nestas águas!',
            'Por decreto da sede de Marineford, ordenamos rendição incondicional!',
            'Nenhuma embarcação criminosa escapará ao rigor da lei marítima!'
          ],
          hit: [
            'Alvo interceptado com precisão cirúrgica militar!',
            'A artilharia pesada da Marinha impõe a ordem nos mares!',
            'Disparo disciplinado sobre a frota infratora!'
          ],
          miss: [
            'Recalibrar ângulos de elevação da bateria frontal!',
            'Apenas um aviso tático. O próximo disparo será impiedoso.',
            'Água salgada. Recarregar canhões com projéteis perfurantes!'
          ],
          sink: [
            'Embarcação clandestina neutralizada em nome da Justiça!',
            'Mais uma ameaça à ordem global submersa com rigor!',
            'O dever militar foi cumprido com disciplina exemplar!'
          ],
          victory: [
            'A Justiça Absoluta prevalece soberana sobre todos os oceanos!',
            'A ordem foi restaurada e a paz civil assegurada com sucesso!',
            'Registrem o relatório de vitória nos arquivos do Quartel-General!'
          ],
          defeat: [
            'Inadmissível... Solicitar apoio de reforços imediatamente ao QG!',
            'O mal triunfou momentaneamente... mas a Justiça jamais cessará!',
            'Reagrupar a esquadra sobrevivente... o dever nos chama de volta...'
          ]
        }
      }
    },

    techniques: {
      bazooka: {
        name: 'Gomu Gomu no Bazooka',
        shortName: 'Bazooka',
        crew: 'Chapéus de Palha',
        desc: 'Disparo elástico em salva concêntrica cobrindo uma área de 2x2 células no mar inimigo.',
        readyMsg: 'Bazooka carregado e pronto para disparar na grade 2x2!',
        usedMsg: 'Monkey D. Luffy disparou o Gomu Gomu no Bazooka em 4 quadrantes!'
      },
      tremor: {
        name: 'Gurarara Tremor',
        shortName: 'Tremor',
        crew: 'Barba Branca',
        desc: 'Impacto sísmico devastador em cruz de 5 células (célula alvo e as quatro vizinhas ortogonais).',
        readyMsg: 'Força sísmica do tremor acumulada no punho do Barba Branca!',
        usedMsg: 'Edward Newgate rachou o próprio oceano com um Tremor em cruz!'
      },
      haki_do_rei: {
        name: 'Haki do Rei',
        shortName: 'Haki do Rei',
        crew: 'Cabelo Vermelho',
        desc: 'Onda dominadora de presença que detecta se há navios presentes em um setor de 3x3 células.',
        readyMsg: 'Presença dominante pronta para vasculhar o setor 3x3.',
        usedMsg: 'Shanks liberou uma rajada avassaladora de Haki do Rei!',
        sonarPositive: 'Haki do Rei revelou: PRESENÇA DETECTADA no setor!',
        sonarNegative: 'Haki do Rei revelou: Nenhuma embarcação no setor!'
      },
      room: {
        name: 'Room Cirúrgico',
        shortName: 'Room',
        crew: 'Piratas do Coração',
        desc: 'Esfera operacional que conta o total de células ocupadas por navios em uma linha ou coluna.',
        readyMsg: 'Room pronto para escanear a linha ou coluna selecionada.',
        usedMsg: 'Trafalgar Law ativou sua Room de diagnóstico cirúrgico!',
        rowCountMsg: (rowLabel, count) => `Room detectou ${plural(count, 'célula de navio', 'células de navios')} na Linha ${rowLabel}.`,
        colCountMsg: (colLabel, count) => `Room detectou ${plural(count, 'célula de navio', 'células de navios')} na Coluna ${colLabel}.`
      },
      vortice: {
        name: 'Vórtice da Escuridão',
        shortName: 'Vórtice',
        crew: 'Barba Negra',
        desc: 'Barreira gravitacional que anula e absorve integralmente o próximo disparo direcionado à sua frota.',
        readyMsg: 'Gravidade negra pronta para erguer o escudo de absorção.',
        usedMsg: 'Marshall D. Teach invocou o Vórtice da Escuridão! Próximo tiro será absorvido!',
        absorbedMsg: 'O Vórtice da Escuridão engoliu completamente a bola de ferro! Tiro anulado!'
      },
      observacao: {
        name: 'Haki de Observação',
        shortName: 'Observação',
        crew: 'Marinha',
        desc: 'Vigilância naval de precisão que expõe uma célula intacta de uma embarcação inimiga sobrevivente.',
        readyMsg: 'Radares e Haki prontos para revelar uma coordenada inimiga.',
        usedMsg: 'A Marinha coordenou o Haki de Observação e interceptou uma coordenada!',
        revealedMsg: (label) => `Haki de Observação expôs a coordenada ${label} da frota inimiga!`
      }
    },

    outcomes: {
      water: 'Água!',
      waterDesc: 'O canhão atingiu apenas as ondas do oceano.',
      hit: 'Acertou em cheio!',
      hitDesc: 'Fogo a bordo! Um navio inimigo sofreu danos diretos.',
      sunk: (shipName) => `Afundou o ${shipName}!`,
      sunkDesc: (shipName) => `A lendária embarcação ${shipName} sucumbiu e afundou no mar!`,
      absorbed: 'Tiro Absorvido!',
      absorbedDesc: 'A barreira de escuridão absorveu completamente o ataque.',
      alreadyShot: 'Coordenada já bombardeada!',
      alreadyShotDesc: 'Seus canhões já dispararam nesta posição do oceano.',
      outOfBounds: 'Coordenada fora do mapa de navegação!'
    },

    turns: {
      yourTurn: 'Sua vez, capitão!',
      enemyTurn: (captainName) => `Vez de ${captainName}...`,
      waitingOpponent: 'Aguardando o disparo adversário...',
      shotsRemaining: (count) => `${plural(count, 'disparo restante', 'disparos restantes')}`,
      timerSeconds: (s) => `${s}s`,
      timeExpiring: 'Tempo se esgotando! Fogo iminente!'
    },

    rules: {
      allowTouch: {
        name: 'Permitir navios adjacentes',
        desc: 'Permite que embarcações sejam posicionadas coladas umas nas outras (inclusive em diagonais).'
      },
      continueOnHit: {
        name: 'Continuar ao acertar',
        desc: 'Se o tiro acertar ou afundar um navio, o jogador ganha imediatamente outro disparo consecutivo.'
      },
      salvo: {
        name: 'Disparos em salva',
        desc: 'Cada jogador dispara por turno um número de projéteis igual ao total de navios sobreviventes na sua frota.'
      },
      turnTimer: {
        name: 'Temporizador de turno',
        desc: 'Tempo máximo para cada jogada (Desligado, 20s, 30s ou 60s). Se esgotar, um disparo aleatório é disparado automaticamente.',
        off: 'Desligado',
        s20: '20 segundos',
        s30: '30 segundos',
        s60: '60 segundos'
      },
      fog: {
        name: 'Neblina de guerra',
        desc: 'O marcador do último tiro desvanece após 2 turnos, exigindo memória tática do capitão.'
      }
    },

    ui: {
      fireButton: 'FOGO!',
      fireButtonAria: 'Confirmar e disparar canhão nas coordenadas selecionadas',
      rotateButton: 'Girar Navio (R)',
      rotateButtonAria: 'Alternar orientação do navio entre horizontal e vertical',
      autoPlaceButton: 'Auto-posicionar',
      autoPlaceButtonAria: 'Distribuir automaticamente todos os navios na placa oceânica',
      randomPlaceButton: 'Embaralhar',
      clearButton: 'Limpar Tabuleiro',
      clearButtonAria: 'Remover todos os navios do tabuleiro e reiniciar posicionamento',
      readyButton: 'Tripulação Pronta!',
      readyButtonAria: 'Confirmar frota e iniciar a batalha naval',
      hintButton: 'Log Pose (Dica)',
      hintButtonAria: 'Usar bússola Log Pose para apontar o quadrante mais denso de navios inimigos',
      hintRemaining: (uses) => `Log Pose: ${uses} ${uses === 1 ? 'uso' : 'usos'}`,
      hintResult: (direction, sector) => `A agulha do Log Pose aponta para o setor ${direction} (${sector})!`,
      compassDirections: {
        Norte: 'Norte',
        Nordeste: 'Nordeste',
        Leste: 'Leste',
        Sudeste: 'Sudeste',
        Sul: 'Sul',
        Sudoeste: 'Sudoeste',
        Oeste: 'Oeste',
        Noroeste: 'Noroeste',
        Centro: 'Centro'
      },
      hintSectorLabel: (direction, fromCoord, toCoord) => `Setor ${direction} (${fromCoord}–${toCoord})`,
      hintMessage: (direction, targetCoord) => `O Log Pose vibra apontando para o ${direction}! Alta concentração de embarcações detectada próximo a ${targetCoord}.`,
      techniqueButton: (techName) => `Técnica: ${techName}`,
      techniqueUsedBadge: 'Técnica Esgotada',
      readyStatus: 'Frota posicionada e pronta para o combate',
      notReadyStatus: 'Posicione todos os navios para prosseguir',
      shipsAfloatCount: (afloat, total) => `${afloat} / ${total} navios à tona`,
      shotTally: (shots, hits, acc) => `${shots} ${shots === 1 ? 'disparo' : 'disparos'} · ${hits} ${hits === 1 ? 'acerto' : 'acertos'} · ${acc}% de precisão`,
      myWaters: 'Suas Águas',
      enemyWaters: 'Águas Inimigas',
      logPoseCompass: 'Bússola Log Pose',
      logBookTitle: 'Diário de Bordo',
      scoreboardTitle: 'Placar de Guerra',
      statsTitle: 'Balanço da Batalha',
      rematchButton: 'Jogar Novamente',
      nextGameButton: 'Próxima Partida da Série',
      skipCeremonyButton: 'Pular Cerimônia',
      backToLobbyButton: 'Retornar ao Quartel',
      liftSceneryCheckbox: 'Erguer cenário próximo (visão livre)',
      pixelSizeSlider: 'Escala de Pixel 3D',
      outlinesToggle: 'Bordas de Profundidade',
      ditherToggle: 'Dithering OKLab (90 Cores)',
      soundToggle: 'Efeitos Sonoros Web Audio',
      volumeSlider: 'Volume dos Canhões',
      startBattleButton: 'Iniciar Batalha!',
      startBattleButtonAria: 'Confirmar frota e iniciar a batalha naval na Grand Line',
      speedButton: (s) => `Velocidade: ${s}x`,
      speedLabel: 'Velocidade da Animação',
      pauseButton: 'Pausar',
      resumeButton: 'Retomar',
      isPaused: 'Batalha Pausada',
      autoNextToggle: 'Avançar Série Automaticamente',
      shantyToggle: 'Canção Pirata (Chiptune Shanty)',
      raw3dToggle: '3D Puro (Sem Shader)',
      themeToggle: 'Alternar Tema Claro / Escuro',
      themeDark: 'Tema Escuro',
      themeLight: 'Tema Claro',
      twoDViewToggle: 'Radar 2D Tático',
      twoDViewOn: 'Exibindo Radar 2D',
      twoDViewOff: 'Ocultando Radar 2D',
      twoDFallbackNotice: 'Modo tático 2D ativo para maior agilidade',
      defaultCaptainPrefix: 'Capitão-',
      defaultCaptainName: 'Capitão dos Mares',
      viewportAriaLabel: 'Cenário 3D da Batalha Naval',
      shipPlacedAt: (name, coord) => `${name} posicionado em ${coord}`,
      battleStarted: (title, subtitle) => `${title} — ${subtitle} iniciada!`,
      you: 'Você',
      shotLogLine: (actor, coord, msg) => `${actor} disparou em ${coord}: ${msg}`,
      techniqueActivated: (msg) => `Você ativou a técnica: ${msg}`,
      rivalTechniqueLine: (name, msg) => `${name} usou uma técnica: ${msg}`,
      axisLabel: 'Eixo:',
      coordLabel: 'Coordenada:',
      rowPrefix: 'Linha ',
      colPrefix: 'Coluna ',
      selectSeriesPrompt: 'Duração da Série:',
      seriesScore: (p0, p1, len) => `Série: ${p0} - ${p1} (MD${len})`,
      pauseButton: 'Pausar',
      resumeButton: 'Continuar',
      skipCeremony: 'Pular Cerimônia',
      autoNextGame: 'Avançar partida automaticamente',
      joinAsPlayer: 'Entrar como Jogador',
      joinAsSpectator: 'Assistir (Espectador)',
      openRoomsTitle: 'Salas Abertas (Partida Rápida)',
      openRoomsEmpty: 'Nenhuma sala pública aberta no momento.',
      quickJoinButton: 'Entrar Rápido',
      bountyBoardCasual: 'Mais Procurados (Casual / Não verificado)',
      pvpRematchButton: 'Revanche',
      tableRank: '#',
      tableCaptain: 'Capitão',
      tableBounty: 'Recompensa',
      tableWins: 'Vitórias',
      leaveRoomButton: 'Sair da Sala',
      tabs: {
        pvc: 'Batalha vs CPU',
        pvp: 'Duelo Online (PvP)',
        settings: 'Ajustes & Câmera'
      },
      tabsCompact: {
        combat: 'Combate',
        pvp: 'Online',
        fleet: 'Esquadra',
        logbook: 'Diário',
        settings: 'Ajustes'
      },
      selectCrewPrompt: 'Selecione sua Tripulação:',
      selectEnemyCrewPrompt: 'Tripulação Adversária:',
      selectFormatPrompt: 'Formato de Batalha:',
      selectModePrompt: 'Modo de Guerra:',
      selectSeaPrompt: 'Mar & Clima:',
      selectDifficultyPrompt: 'Dificuldade da IA:',
      rulesTitle: 'Regras de Combate:',
      viewNauticalChart: 'Carta Náutica',
      nauticalChartTitle: 'Carta Náutica da Grand Line',
      nauticalChartSubtitle: 'Atlas Marítimo da Grand Line & Rotas de Navegação',
      sailToIslandBtn: 'Zarpar para esta Ilha',
      islandZoneBadge: 'Zona Marítima',
      blessingsTitle: 'Coleção de Bênçãos & Relíquias',
      blessingsSubtitle: 'Dádivas Marítimas e Tesouros Conquistados em Batalha',
      blessingUnlockedBadge: '✓ Conquistada',
      blessingLockedBadge: '🔒 A Desbloquear',
      graphicsLost: 'O aparelho liberou a memória gráfica do jogo. Recuperando a cena...',
      graphicsRestored: 'Cena 3D recuperada.',
      fullscreenEnter: 'Tela cheia',
      fullscreenExit: 'Sair da tela cheia',
      appGroupTitle: 'Aplicativo',
      appInstalled: 'Instalado: o jogo abre pela tela inicial, sem as barras do navegador.',
      appInstallButton: 'Instalar o jogo',
      appInstallWhy: 'Abre pela tela inicial, em tela cheia, e joga contra a IA sem internet.',
      appInstallIos: 'No iPhone: toque em Compartilhar e depois em "Adicionar à Tela de Início". O jogo passa a abrir sem as barras do Safari.',
      appInstallMenu: 'Para instalar: menu do navegador, "Instalar app" ou "Adicionar à tela inicial".',
      autoFullscreenToggle: 'Tela cheia ao deitar o celular',
      vibrateToggle: 'Vibrar em acertos e naufrágios',
      appOfflineReady: 'Pronto para jogar sem internet contra a IA (o online precisa de conexão).',
      blessingCollectibleNote: 'Relíquia de coleção: não altera a batalha nesta versão.',
      blessingLockedHint: 'Ainda bloqueada. Vença uma partida para ganhar uma bênção da coleção.',
      blessingRewardTitle: '🎁 Bênção Lendária Concedida!',
      fleetSetupTitle: 'Doca da Esquadra:',
      setupCanvasHint: 'Clique ou arraste nas Suas Águas para posicionar • R ou botão direito gira',
      orientationHorizontal: 'Horizontal',
      orientationVertical: 'Vertical',
      shipPlacedBadge: 'Pronto',
      shipPendingBadge: 'Posicionar',
      techniqueTargetingPrompt: (techName) => `Modo ${techName}: clique na coordenada alvo ou confirme!`,
      cancelTechniqueButton: 'Cancelar Técnica',
      revealedCellAria: (coord) => `Coordenada ${coord}: embarcação revelada por Observação`,
      fogCellAria: (coord) => `Coordenada ${coord}: marcador encoberto pela neblina`,
      seriesChampionBanner: (name, p0, p1) => `Campeão da Série (${p0} × ${p1}): ${name}!`,
      webglFallbackNotice: 'Modo Radar Tático 2D ativo (aceleração 3D indisponível neste dispositivo).',
      placedCount: (placed, total) => `${placed} de ${total} navios posicionados`,
      coinTossTitle: 'Sorteio da Moeda de Berry',
      coinTossFlipping: 'Girando a moeda de Berry...',
      coinTossPlayerWon: 'Coroa dourada! Seus canhões abrem fogo primeiro!',
      coinTossEnemyWon: 'Cara marcada! O rival assume a primeira salva de tiros!',
      targetSelected: (coord) => `Alvo selecionado: ${coord}`,
      noTargetSelected: 'Selecione uma coordenada no mar inimigo',
      roomSelectTitle: 'Cirurgia da Room (Trafalgar Law)',
      roomSelectDesc: 'Escolha dissecar uma Linha ou uma Coluna inteira:',
      roomRow: 'Linha',
      roomCol: 'Coluna',
      roomExecute: 'Dissecar Setor',
      cancel: 'Cancelar',
      close: 'Fechar',
      spectatorBadge: 'Modo Espectador',
      spectatorToggle: 'Entrar como Espectador',
      bountyBoardTitle: 'Mais Procurados da Grand Line',
      bountyBoardEmpty: 'Nenhuma recompensa registrada ainda.',
      bountyBoardDisclaimer: 'Registros de duelos casuais (não oficiais).',
      boxScoreTitle: 'Esquadra & Estatísticas',
      enemyFleetStatus: 'Frota Inimiga',
      playerFleetStatus: 'Sua Frota',
      accuracy: 'Precisão',
      streak: 'Sequência',
      hits: 'Acertos',
      misses: 'Água',
      shots: 'Tiros',
      shipsSunk: 'Afundados',
      shipsAlive: 'À Tona',
      shipIntact: 'Intacto',
      shipDamaged: 'Avariado',
      shipSunk: 'Afundado',
      shipUnknown: '???',
      offlineOnlySuffix: '(Offline)',
      turnIndicatorPlayer: 'Sua vez, capitão!',
      turnIndicatorEnemy: (name) => `Turno de ${name}`,
      turnIndicatorEnemyDefault: 'Turno do Inimigo',
      rivalTauntLabel: 'Comunicação do Rival:',
      rematchPending: 'Aguardando resposta de revanche...',
      onlineNowCount: (n) => `${n} marujos online`,
      keyboardShortcuts: 'Atalhos: Setas = Mover mira | Enter/Espaço = Fogo | A-L, 1-12 = Coordenada | R = Girar navio | H = Dica | T = Técnica | 1-4 = Câmeras | M = Mudo',
      touchControlsHint: 'Toque: Arrastar gira a câmera | Pinça ajusta zoom | Toque duplo gira o navio'
    },

    cameras: {
      duas_aguas: {
        name: 'Duas Águas',
        desc: 'Visão isométrica equilibrada mostrando simultaneamente a sua frota e a frota inimiga.'
      },
      minhas_aguas: {
        name: 'Minhas Águas',
        desc: 'Foco aproximado sobre a sua própria placa oceânica para inspecionar avarias nos navios.'
      },
      mira_inimiga: {
        name: 'Mira Inimiga',
        desc: 'Câmera tática superior inclinada sobre o mar adversário para facilitar a pontaria.'
      },
      panorama: {
        name: 'Panorama da Grand Line',
        desc: 'Visão panorâmica cinematográfica com a Red Line, ilha celestial Skypiea e a frota da Marinha.'
      }
    },

    reactions: {
      title: 'Reações Den Den Mushi',
      quickBarTitle: 'Den Den Mushi (Emotes Rápidos)',
      buttonAria: (label) => `Enviar reação Den Den Mushi: ${label}`,
      sentBubble: (icon, label) => `🐌 Você: ${icon} ${label}`,
      receivedBubble: (sender, icon, label) => `🐌 ${sender}: ${icon} ${label}`,
      logLine: (sender, icon, label) => `🐌 Den Den Mushi (${sender}): ${icon} ${label}`,
      opt_boa_mira: 'Boa mira!',
      opt_prepare_se: 'Prepare-se!',
      opt_aguarde: 'Aguarde seu fim!',
      opt_gg_capitao: 'GG, capitão!',
      opt_que_sorte: 'Que sorte absurda!',
      opt_mar_bravo: 'O mar está bravo hoje!',
      opt_den_den_ringing: 'Puru puru puru...',
      opt_na_mosca: 'Na mosca!',
      opt_isso_nao_fica_assim: 'Isso não vai ficar assim!',
      opt_impressionante: 'Impressionante!',
      opt_argh: 'Argh!',
      opt_ouch: 'Essa doeu!',
      opt_venha_com_tudo: 'Venha com tudo!'
    },

    lobby: {
      title: 'Lobby dos Mares (PvP Online)',
      createRoomButton: 'Criar Sala',
      joinRoomButton: 'Entrar com Código',
      enterCodePrompt: 'Entrar com Código da Sala (5 caracteres):',
      quickMatchButton: 'Partida Rápida',
      roomCodeLabel: 'Código da Sala (5 caracteres)',
      roomCodePlaceholder: 'ABCDE',
      rolePlayerStatus: 'Modo: Jogador',
      roleSpectatorStatus: 'Modo: Espectador (Somente Leitura)',
      shareLinkLabel: 'Link de Compartilhamento',
      copyLinkButton: 'Copiar Link',
      linkCopied: 'Link copiado com sucesso!',
      nicknameLabel: 'Seu Codinome Pirata',
      nicknamePlaceholder: 'Capitão Sem Nome',
      connectedStatus: 'Conectado aos servidores da Grand Line',
      reconnectingStatus: 'Adversário reconectando... aguardando 10s',
      disconnectedStatus: 'Conexão perdida com o alto mar',
      opponentDisconnected: 'Adversário desconectou-se. Vitória por abandono!',
      latencyMs: (ms) => `Ping: ${ms} ms`,
      onlineNowBadge: 'Online agora',
      waitingHost: 'Aguardando o capitão anfitrião iniciar a peleja...',
      waitingGuest: 'Aguardando um rival adentrar a sala de combate...',
      crossTabReadyBadge: 'Sincronização entre abas ativa (mesmo aparelho)',
      peerReadyBadge: 'Online pela internet: conexão direta entre os aparelhos',
      peerHowToHint: 'Crie uma sala e envie o link ou o QR Code. O outro aparelho pode estar em qualquer rede; a sala fica aberta enquanto esta aba estiver aberta.',
      peerRoomNotFound: (code) => `Sala ${code} não encontrada. O anfitrião precisa estar com a sala aberta; confira o código ou peça um novo link.`,
      peerSearchingRoom: (code) => `Procurando a sala ${code}...`,
      peerConnectionFailed: 'Falha na conexão direta com o outro aparelho. Confira a internet dos dois lados.',
      peerReconnecting: 'Conexão com o anfitrião caiu. Tentando reconectar...',
      lanReadyBadge: 'Servidor Wi-Fi / Rede Local ativo — dispositivos sincronizados!',
      lanAddressLabel: 'Abra este endereço no celular / outro PC no mesmo Wi-Fi:',
      lanCopyAddressButton: 'Copiar IP',
      lanAddressCopied: 'Endereço Wi-Fi copiado!',
      lanOfflineHint: 'Para jogar entre celular e PC no mesmo Wi-Fi, inicie jogar-no-wifi.cmd (ou node scripts/lan-server.js).',
      fileProtocolNoticeTitle: 'Modo Arquivo Local (file://)',
      fileProtocolNoticeDesc: 'Você abriu o jogo direto como arquivo. Este modo funciona para jogar entre duas abas neste mesmo computador.',
      fileProtocolWifiHowToTitle: '📱 Como jogar no Celular ou Tablet pelo Wi-Fi:',
      fileProtocolWifiStep1: 'Dê dois cliques no arquivo "jogar-no-wifi.cmd" na pasta do jogo (ou execute "npm run lan").',
      fileProtocolWifiStep2: 'O jogo abrirá no navegador com seu endereço Wi-Fi (ex: http://192.168.x.x:8080).',
      fileProtocolWifiStep3: 'O QR Code e o link gerados funcionarão imediatamente na câmera de qualquer celular conectado ao mesmo Wi-Fi!',
      fileProtocolQrWarning: '⚠️ Este QR Code contém um link local (file://) deste PC. Para ler com celular no Wi-Fi, abra o jogo pelo "jogar-no-wifi.cmd".',
      qrCodeButton: 'QR Code',
      qrCodeTitle: 'QR Code de Acesso Rápido',
      qrCodeRoomTitle: 'QR Code da Sala',
      qrCodeRoomHint: 'Aponte a câmera do 2º jogador para entrar direto nesta sala!',
      qrCodeLanHint: 'Aponte a câmera do celular para conectar ao servidor Wi-Fi!',
      qrCodeAfterCreateHint: 'Crie a sala abaixo: o QR Code de convite aparece em seguida, já apontando para ela.',
      guestInRoomTitle: (host) => `Você entrou na sala de ${host}`,
      guestInRoomHint: 'Você é o convidado desta sala. Escolha sua frota e comprometa quando estiver pronto.',
      hostWaitingNobody: 'Ninguém entrou na sala ainda. Mostre o QR Code acima ao seu rival.',
      hostCommittedNobody: 'Frota comprometida, mas a sala ainda está vazia: a partida só começa quando o rival ler o QR Code e comprometer a dele.',
      rivalInRoomBadge: (name) => `${name} está na sala. Falta comprometer a frota.`,
      rivalJoinedToast: (name) => `${name} entrou na sala!`,
      roomNotFound: (code) => `Sala ${code} não encontrada neste servidor. Confira o código ou peça um novo QR Code ao anfitrião.`,
      roomNotFoundLocalPage: (code) => `Sala ${code} não encontrada. Esta página só enxerga salas deste aparelho ou deste Wi-Fi; uma sala online abre pelo link ou QR Code do anfitrião.`,
      radarViewLabel: 'Radar',
      radarViewEnemy: 'Águas Inimigas',
      radarViewBoth: 'Ambas',
      reactionsPopoverAria: 'Reações Den Den Mushi',
      roomFull: (code) => `A sala ${code} já tem dois capitães. Você pode entrar como espectador.`,
      inviteTitle: (code) => `Convite para a sala ${code}`,
      inviteFailedHint: 'Não foi possível entrar ainda. Peça ao anfitrião para manter a sala aberta e tente de novo.',
      inviteRetryButton: 'Tentar entrar de novo',
      inviteDismissButton: 'Ignorar convite',
      lanWriteFailed: 'Sem resposta do servidor Wi-Fi: sua última ação não chegou ao rival. Verifique a conexão e tente de novo.',
      qrCodeToggleHide: 'Ocultar QR Code',
      qrCodeToggleShow: 'Exibir QR Code',
      deleteRoomButton: 'Excluir Sala',
      deleteRoomAria: (code) => `Excluir sala ${code}`,
      clearRoomsButton: 'Limpar Salas',
      deleteRoomConfirm: (code) => `Excluir a sala ${code} e encerrar a partida? Toque de novo para confirmar`,
      clearRoomsConfirm: 'Remover as salas abertas? Toque de novo para confirmar',
      onlyHostDeletesRoom: 'Só quem criou a sala pode excluí-la.',
      rulesLockedByRoom: (code) => `Regras travadas pela sala ${code}. Saia da sala para alterar.`,
      crewLockedAfterCommit: 'Frota já comprometida: a tripulação não muda mais nesta partida.',
      roomDeletedToast: (code) => `Sala ${code} excluída.`,
      roomsClearedToast: 'Todas as salas abertas foram removidas.',
      artifactDbReadyBadge: 'Salas online ativas — jogadas salvas no armazenamento do artefato',
      connectingBadge: 'Conectando às salas online…',
      connectingHint: 'Procurando o serviço de salas online. Enquanto isso, o modo Jogador vs CPU já está liberado.',
      pvpUnavailable: 'Duelo online indisponível: esta visualização do artefato não liberou o armazenamento compartilhado de salas.',
      pvpIdentityUnavailable: 'Duelo online indisponível: não foi possível identificar sua conta nesta visualização do artefato (as jogadas são assinadas pela conta de quem joga).',
      seatTakenToast: (code) => `A sala ${code} já tem dois capitães: outra pessoa ocupou a vaga de rival.`,
      integrityAbsenceBadge: 'Vitória por ausência do rival: frotas não reveladas, sem auditoria.',
      pvpUnavailablePvcHint: 'O modo Jogador vs CPU continua 100% disponível na aba Combate.',
      onlineWriteFailed: 'Não foi possível gravar a jogada online (limite de armazenamento ou acesso revogado). A partida pode ficar dessincronizada.',
      sessionResumedToast: (code) => `Reconectado à sala ${code}: sua frota e o histórico da partida foram restaurados.`,
      readyFleetButton: 'Comprometer Frota (SHA-256) e Zarpar!',
      fleetCommittedBadge: 'Frota comprometida! Aguardando confirmação do rival...',
      opponentCommittedBadge: 'Rival pronto para o duelo!',
      integrityVerifiedBadge: 'Integridade criptográfica SHA-256 verificada — Jogo Limpo!',
      unsupportedMessage: 'Duelo online indisponível neste navegador (sem canal de sincronização). O modo Jogador vs CPU continua 100% operacional!',
      sampleRooms: [
        { id: 'GLT01', host: 'Capitão Luffy', crewId: 'straw_hats', format: '10x10', mode: 'tatico' },
        { id: 'GLT02', host: 'Almirante Smoker', crewId: 'marines', format: '10x10', mode: 'classico' },
        { id: 'GLT03', host: 'Cirurgião Law', crewId: 'heart', format: '8x8', mode: 'tatico' }
      ],
      topPirates: [
        { rank: 1, name: 'Monkey D. Luffy', crewId: 'straw_hats', bounty: 3000000000, wins: 42 },
        { rank: 2, name: 'Trafalgar D. Water Law', crewId: 'heart', bounty: 3000000000, wins: 38 },
        { rank: 3, name: 'Eustass Captain Kid', crewId: 'kid', bounty: 3000000000, wins: 35 },
        { rank: 4, name: 'Roronoa Zoro', crewId: 'straw_hats', bounty: 1111000000, wins: 29 },
        { rank: 5, name: 'Sir Crocodile', crewId: 'baroque', bounty: 1965000000, wins: 26 },
        { rank: 6, name: 'Buggy, o Palhaço Estrela', crewId: 'buggy', bounty: 3189000000, wins: 19 }
      ]
    },

    forfeit: {
      abandonButton: '🏳️ Abandonar o navio',
      abandonButtonAria: 'Abandonar o navio e admitir derrota nesta partida',
      modalTitle: 'Abandonar o navio?',
      modalDescSingle: 'Tem certeza de que deseja abandonar a batalha naval? A vitória desta partida será concedida imediatamente ao adversário.',
      modalDescPvp: 'Tem certeza de que deseja se render? A vitória deste duelo online será concedida imediatamente ao adversário, e ambas as frotas serão reveladas.',
      modalDescSeries: (gameNum, seriesLen) => `Tem certeza de que deseja abandonar o Jogo ${gameNum} da série ${seriesLen}? O rival receberá +1 vitória nesta batalha.`,
      cancelKeepFighting: 'Continuar lutando',
      confirmForfeit: 'Confirmar rendição',
      abortWholeSeries: 'Encerrar série e voltar ao menu',
      ceremonyPlayerForfeit: 'Você içou a bandeira branca e abandonou o navio.',
      ceremonyEnemyForfeit: (name) => `${name} içou a bandeira branca e abandonou a peleja!`,
      logPlayerForfeit: 'Você içou a bandeira branca e abandonou a peleja naval.',
      logEnemyForfeit: (name) => `${name} içou a bandeira branca e abandonou o navio!`
    },

    stats: {
      shotsFired: 'Disparos Efetuados',
      directHits: 'Tiros Certeiros',
      accuracyPercentage: 'Precisão de Tiro',
      longestStreak: 'Maior Sequência de Acertos',
      turnsTaken: 'Turnos Disputados',
      battleDuration: 'Duração da Batalha',
      finalBounty: 'Recompensa Concedida',
      wantedPosterHeading: 'WANTED',
      wantedDeadOrAlive: 'DEAD OR ALIVE',
      congratulationsWinner: (name) => `Vitória Gloriosa de ${name}!`,
      matchDraw: 'Empate nos Mares!',
      bountyEarnedExplanation: 'Cálculo de Recompensa: Base + Precisão + Sequência + Dificuldade + Formato de Frota.'
    },

    errors: {
      placementOutOfBounds: 'Navio extrapola os limites da placa marítima!',
      placementOverlap: 'Navios não podem ocupar a mesma célula oceânica!',
      placementTouching: 'Embarcações não podem se tocar quando a regra de adjacência está desativada!',
      placementIncomplete: 'Todos os navios da frota devem ser posicionados antes do combate!',
      notYourTurn: 'Não é o seu turno de disparar os canhões!',
      techniqueAlreadyUsed: 'Esta tripulação já utilizou sua técnica secreta nesta partida!',
      techniqueInClassicMode: 'Técnicas especiais são exclusivas do Modo Tático!',
      techniqueNeedsTarget: 'Escolha uma célula nas águas inimigas antes de usar a técnica.',
      techniqueBusy: 'Aguarde a resposta da jogada anterior antes de usar a técnica.',
      cheatDetected: 'Trapaça detectada! Inconsistência grave nos registros criptográficos da frota inimiga. Vitória concedida ao jogador lesado!',
      invalidCommitment: 'Trapaça detectada! O hash SHA-256 revelado não coincide com o compromisso inicial.',
      invalidShotResponse: 'Trapaça detectada! Resposta de tiro inconsistente com a posição real da frota.',
      invalidRoomCode: 'Código de sala inválido. Forneça 5 caracteres alfanuméricos.'
    }
  };

  const i18nModule = {
    T,
    formatNumber,
    formatBounty,
    plural
  };

  // Global export (zero browser-specific identifiers)
  root.GLT = root.GLT || {};
  root.GLT.i18n = i18nModule;
  root.GLT.T = T;

  // Node.js CommonJS export
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
      T,
      formatNumber,
      formatBounty,
      plural,
      i18n: i18nModule
    };
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
