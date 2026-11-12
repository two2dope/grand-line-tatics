# Especificação de Design v2.0 — Direção Visual *Minishoot'*, Frotas Chibi por Facção, Rendição e Manual Interativo

- **Data:** 2026-11-07
- **Alvo de Versão:** `v2.0.0` (sobre o baseline versionado `v1.0.0`)
- **Artefatos Finais:** `index.html` e `grand-line-tactics.html` (paridade exata bit a bit, 100% `pt-BR`)
- **Referências Visuais:**
  - *Minishoot' Adventures* (SoulGame Studio — `https://store.steampowered.com/app/1634860/Minishoot_Adventures/`)
  - Coleção de miniaturas *One Piece Grand Ship Collection* (`references/2026-11-07_chibi-ships-reference_v1.0.webp`)

---

## 1. Intenção e Motivação (O Porquê)

O projeto atingiu no marco `v1.0.0` uma base funcional sólida (regras determinísticas, IA em 4 níveis, técnicas táticas e multiplayer online/Wi-Fi com anti-trapaça SHA-256). Agora o objetivo é **elevar drasticamente o encanto visual, a identidade temática das facções e a autonomia do jogador dentro da partida**, atuando em quatro frentes integradas:

1. **Clareza e encanto estilo *Minishoot' Adventures*:** substituir o aspecto ruidoso/quadriculado (`pixelSize = 2` + *Bayer dither* + blocos serrilhados) por um diorama isométrico *cel-shaded* ultra nítido em resolução nativa (`1x`), com contornos escuros contínuos (*ink outlines*), superfícies arredondadas de brinquedo e projéteis/impactos/miras luminosos de altíssimo contraste sobre a água.
2. **Frotas Chibi 3D exclusivas por tripulação:** fazer a escolha da tripulação transformar de verdade o estilo visual de todos os barcos em campo — com cascos bojudos e curvos, velas estufadas e carrancas expressivas inspiradas nas miniaturas chibi (`references/2026-11-07_chibi-ships-reference_v1.0.webp`) e liberdade criativa fiel ao universo de *One Piece* para completar as embarcações de cada facção.
3. **Botão "Abandonar o navio" (rendição):** permitir desistir de uma batalha em andamento com segurança contra clique acidental, encerrando de forma limpa tanto partidas contra a CPU (incluindo séries *MD3/MD5*) quanto duelos Online/Wi-Fi (sem disparar falso alerta de trapaça ou *timeout* de revelação).
4. **Janela pop-up do Manual do Jogo:** oferecer a qualquer momento (no menu ou no meio do combate) um guia completo, claro e bem diagramado em `pt-BR` cobrindo regras, modos, as 6 técnicas, configurações da partida, multiplayer Wi-Fi e ajustes.

---

## 2. Objetivos, Não-Objetivos e Anti-Objetivos

### Objetivos
- Entregar o estilo **"Cel Diorama (Minishoot')"** como padrão imediato ao abrir o jogo (`1x` nativo, *cel-shading* suave, contorno de tinta contínuo e brilho neon seletivo nos projéteis/efeitos), preservando em *Ajustes* a opção de alternar para **"Pixel Retrô"** ou **"3D Puro"** (*escolha de implementação do construtor para não remover opções existentes*).
- Esculpir proceduralmente em Three.js r128 frotas **Chibi 3D arredondadas** para todas as **6 tripulações jogáveis** (`straw_hats`, `whitebeard`, `red_haired`, `heart`, `blackbeard`, `marines`) cobrindo os **7 slots de navios** (`5, 4, 4, 3, 3, 3, 2`), tanto nos navios vivos do jogador quanto nas silhuetas fantasma reveladas ao afundar navios inimigos.
- Implementar **Abandonar o navio** com confirmação em 2 passos, suporte completo a PvC, séries *MD3/MD5* e PvP Online (`GAME_OVER` com `reason: 'manual_forfeit'` + revelação automática de frota).
- Implementar o modal **Manual do Jogo** acionável na barra superior (`#btn-open-manual` e tecla `?`/`F1`), organizado por abas acessíveis (WCAG 2.2 AA).
- Manter 100% de aprovação nas baterias existentes (`rules-test.js`, `pvp-protocol.js`, `e2e-gameplay-verify.js`, `lan-e2e-verify.js`) e expandir os testes automatizados para cobrir as 4 novidades.

### Não-Objetivos
- Não carregar modelos externos `.glb`/`.gltf` ou imagens externas via rede (o artefato deve permanecer autocontido em arquivo único).
- Não alterar a matemática de balanceamento das 6 técnicas táticas, probabilidades da IA *Yonkou* ou formato criptográfico dos compromissos SHA-256.

### Anti-Objetivos (O que configuraria falha mesmo funcionando tecnicamente)
- **Barcos quadrados com cara de *Minecraft*:** apenas pintar caixas retas com cores novas sem dar volume curvo/bojudo e carrancas expressivas falharia na referência chibi.
- **Ruído visual ou baixa legibilidade tática:** efeitos luminosos que ofusquem coordenadas, marcadores de acerto/água ou deixem o texto sem contraste.
- **Quebra de protocolo ou falso positivo de trapaça:** render-se no Online PvP jamais pode travar a sala ou acusar `cheat_detected` / `reveal_timeout`.
- **Clique acidental em rendição:** o botão *Abandonar o navio* nunca pode ficar colado ao botão `FOGO!` nem encerrar o jogo no primeiro clique sem confirmação.

---

## 3. Restrições Arquiteturais e Invariantes

1. **Pureza de `src/logic/*.js`:** Nenhum módulo em `src/logic/` pode acessar `window`, `document`, `THREE` ou `Math.random()`.
2. **Invariante de IDs Canônicos de Frota:** Os 7 IDs internos (`moby_dick`, `thousand_sunny`, `oro_jackson`, `red_force`, `polar_tang`, `baratie`, `going_merry`) e seus comprimentos (`5, 4, 4, 3, 3, 3, 2`) permanecem imutáveis nos objetos de estado e no `canonicalizeFleet()` do protocolo SHA-256. A diferenciação visual e nominal por tripulação atua como camada de apresentação sobre `(crewId, shipId)`.
3. **Zero Strings Hardcoded na UI/Render:** Todo texto visível em português deve residir exclusivamente em `src/logic/i18n.js` (`GLT.T`).
4. **Artefato Único Duplo:** `node scripts/build.js` deve continuar gerando `index.html` e `grand-line-tactics.html` idênticos byte a byte, dependendo externamente apenas de `three.min.js` (r128) e Google Fonts.
5. **Orçamento de Performance:** Manter 60 fps estáveis mesclando geometrias estáticas de cada barco em um único `BufferGeometry` com `vertexColors: true` para o casco/carranca/convés, mantendo os nós animados separados apenas para velas, canhões, lanternas e tripulantes instanciados.

---

## 4. Abordagens Consideradas e Decisão

1. **Abordagem 1 — Diorama 3D *Cel-Shaded* Curvo + Esquadras Chibi Exclusivas por Facção *(Escolhida pelo usuário)*:**
   - Renderização `1x` nítida com rampa *cel-toon*, contorno escuro contínuo e *glow* seletivo de projéteis + remodelagem procedural 3D curva/bojuda dos barcos e carrancas por facção + *Abandonar o navio* + *Manual em abas*.
   - *Por que venceu:* É a única que entrega simultaneamente a nitidez limpa de *Minishoot' Adventures*, o charme roliço das miniaturas *Grand Ship Collection* e a rotação 3D livre da câmera isométrica sem quebrar o protocolo SHA-256.
2. **Abordagem 2 — Shader *Minishoot'* + Repintura sobre Blocos Voxel Atuais *(Descartada)*:**
   - Mais simples, porém sem a pixelização `2px` os cascos de caixas retas ficariam com aspecto blocoso de *voxel*, destoando tanto de *Minishoot'* quanto da referência chibi.
3. **Abordagem 3 — Sprites/Billboards 2.5D em Canvas sobre o Tabuleiro 3D *(Descartada)*:**
   - Perderia perspectiva real ao girar a câmera em 90° (`Q`/`E`), alternar ângulos ou animar naufrágios.

---

## 5. Detalhamento Técnico das Quatro Frentes

### 5.1. Frente 1 — Pipeline Visual *Minishoot' Adventures* (`palette-shader.js`, `plates-lighting.js`, `backdrop-fx.js`, `build.js`)

1. **Novo Modo Padrão `cel_minishoot` no Pós-Processamento (`src/render/palette-shader.js`):**
   - `UIController` passa a iniciar com `visualStyle: 'cel_minishoot'`, `pixelSize: 1`, `outlines: true`, `dither: false`, `glow: true`.
   - Em `PalettePostPipeline`, quando `pixelSize === 1` e `visualStyle === 'cel_minishoot'`:
     - O `WebGLRenderTarget` opera na resolução física nítida do canvas (`width * min(dpr, 2)`, `LinearFilter`), eliminando serrilhados de baixa resolução.
     - **Sombreamento Cel-Toon Limpo (`uCelMode = 1.0`):** Em vez de quantizar bruscamente para 90 cores com matriz Bayer, o shader aplica suavização tonal *cel* em bandas macias no espaço perceptual OKLab (preservando matizes vibrantes das facções e da água turquesa/safira, com realce quente nas faces iluminadas e sombra fria azulada nas faces escuras).
     - **Contorno de Tinta Contínuo (`uOutlines = 1.0`):** Detector Sobel/cruz de 8 vizinhos combinando profundidade linearizada e luminância (`uOutlineThickness` ajustado para `1.35px` em DPI padrão), pintando bordas firmes em azul-abissal escuro (`#081121`) sem falhas pontilhadas.
     - **Halo Luminoso Seletivo de Combate (`uGlowStrength = 0.55`):** Amostragem radial suave (*bloom* leve de 8 taps em anel) aplicada apenas a pixels emissivos de alta luminância/saturação (`luma > 0.78`), fazendo bolas de canhão energizadas, ondas de choque, mira tática, fogo e faróis brilharem exatamente como os tiros arcade de *Minishoot'*.
   - **Retrocompatibilidade em *Ajustes*:** Se o jogador selecionar o estilo **"Pixel Retrô"** na aba *Ajustes* (ou `pixelSize > 1`), o pipeline reativa `NearestFilter`, quantização OKLab de 90 cores e *dither* Bayer.

2. **Suavização de Água, Espuma, Mira e Projéteis (`plates-lighting.js` e `backdrop-fx.js`):**
   - **Água e Espuma:** As células de espuma das placas (`foamMesh`) e os marcadores 3D (`water`, `hit`, `sunk`, `revealed`, `fog`) trocam cubos retos por cilindros chanfrados, anéis toroidais macios (`TorusGeometry`), esferas de fumaça/chama estilizadas e boias arredondadas. A rampa de cores da água recebe calibração vibrante estilo *Minishoot'* (azul-cobalto profundo nos vales → turquesa luminoso nas cristas → espuma branca-menta suave nas bordas).
   - **Mira e Retícula Tática:** `hoverCursor` e `selectionReticle` em `plates-lighting.js` passam a usar anéis duplos luminosos ciano/âmbar com quatro ponteiras direcionais flutuantes de leitura instantânea.
   - **Projéteis e Impactos Arcade (`backdrop-fx.js`):**
     - `fireCannonball` dispara um projétil estilo *Minishoot'*: núcleo branco-quente envolvido por esfera emissiva laranja-coral vibrante (ou ciano-elétrico em técnicas), rastro cônico luminoso suave e anel duplo de onda de choque expansivo no impacto.
     - Ilhas e marcos de fundo (`backdrop-fx.js`) ganham cúpulas de nuvens/folhagens/bolhas esféricas e chanfros complementares para harmonizar com o diorama *cel-shaded*.

3. **Refino Visual da Interface (`scripts/build.js` CSS):**
   - Painéis, cartões de tripulação, botões de ação e modais recebem bordas arredondadas limpas com contorno estilo tinta + destaque luminoso sutil, tipografia nítida e hierarquia cromática inspirada na UI limpa de *Minishoot'*, mantendo os temas *Escuro Abissal* e *Pergaminho Claro* com contraste WCAG AA.

---

### 5.2. Frente 2 — Frotas Chibi 3D Arredondadas por Tripulação (`ships-voxel.js`, `rules.js`, `i18n.js`, `ui.js`)

1. **Construtor Geométrico Chibi Curvo (`ChibiMeshBuilder` em `src/render/ships-voxel.js`):**
   - Em vez de empilhar caixas ortogonais (`addBox`), o novo construtor gera malhas orgânicas mescladas por vértice colorido (`BufferGeometry` único por casco para manter 1 *draw call* no casco):
     - **Casco Bojudo (*Plump Chibi Hull*):** Costado curvo em perfil elíptico com proa elevada, popa arredondada com cabine acolhedora, borda superior (*gunwale*) saliente em madeira/metal contrastante, vigias circulares laterais com aro dourado e quilha compacta sobre um anel oval contínuo de espuma branca na linha d'água.
     - **Velas Estufadas Curvas (`buildChibiSails`):** Planos subdivididos (`12×8`) curvados parabolicamente para frente simulando vento cheio, mastros cilíndricos torneados com cesto da gávea arredondado (`crow's nest`) e bandeirola superior no topo, mais vela latina/traseira listrada quando aplicável (fiel à referência *Going Merry*, *Baratie* e *Polar Tang*).
     - ** Texturas Vetoriais `128×128` dos Brasões (`getCrewJollyRogerTexture(crewId, shipId, sailStyle)`):** Desenhadas em Canvas2D de alta definição com traço grosso limpo para os **6 Jolly Rogers / Emblemas de Facção** (*Chapéus de Palha*, *Barba Branca*, *Ruivo*, *Heart*, *Barba Negra* e gaivota `"MARINE / 海軍"` da *Marinha*).

2. **Biblioteca de 10 Carrancas / Arquiteturas Chibi Expressivas (Esculpidas em 3D):**
   Inspiradas diretamente em `references/2026-11-07_chibi-ships-reference_v1.0.webp`:
   - `sunny_lion`: Cabeça grande de leão sorridente com juba em pétalas laranja/amarelo-sol + convés de grama verde viva.
   - `merry_sheep`: Cabeça branca fofa de carneiro na proa com chifres espirais cinzas curvos.
   - `baratie_fish`: Proa gordinha de peixe-chefe de boca aberta com lábios amarelos e barbatanas laterais.
   - `garp_dog`: Carranca de buldogue branco/marrom da Marinha com coleira de cravos/osso + listras navais azul-petróleo e vermelho (*Navy HQ 3* da referência).
   - `marine_ironclad`: Proa encouraçada branca e azul-marinho com brasão dourado da gaivota e torres duplas de canhão naval.
   - `moby_whale`: Grande proa arredondada de baleia branca/azul-celeste com olhos laterais serenos (*Moby Dick* da referência).
   - `ace_flame`: Proa adornada com crista de chamas laranja-viva e correntes laterais grossas (*Spade Pirates Ship* da referência).
   - `shanks_dragon`: Carranca curva de dragão viking carmesim com chifres dourados e palmeiras tropicais no convés (*Red Force* da referência).
   - `law_submarine`: Casco capsular amarelo-vivo de submarino com escotilhas redondas, vela dorsal preta estriada e leme caudal listrado vermelho/branco (*Polar Tang* da referência, adaptável em escala para os comprimentos da frota *Heart*).
   - `teach_lograft`: Casco escuro ladeado por toras colossais de madeira amarradas por correntes de ferro, velas negras/púrpura e carranca de crânio chifrudo (*Saber of Xebec* / jangada do Barba Negra).

3. **Matriz Completa de Esquadras por Tripulação (`6 Facções × 7 Slots Canônicos`):**
   Quando o jogador escolhe `crewId` (e para o oponente `enemyCrewId`), cada slot canônico recebe visual 3D (casco, paleta, carranca, velas, uniforme dos marujos no convés) **e** nome temático de exibição na UI (`GLT.rules.getCrewShipMeta(crewId, shipId)` em `i18n.js`), mantendo `ship.id` e `ship.length` inalterados:

   | Slot Canônico (`length`) | `straw_hats` (Chapéus de Palha) | `marines` (Marinha HQ) | `whitebeard` (Barba Branca) | `red_haired` (Cabelo Vermelho) | `heart` (Piratas do Coração) | `blackbeard` (Barba Negra) |
   | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
   | `moby_dick` (`5`) | **Grande Frota Sunny** *(carranca leão real, 3 mastros)* | **Encouraçado Buster Call** *(proa encouraçada + torres duplas)* | **Moby Dick** *(baleia branca/celeste clássica)* | **Drakkar Imperial Ruivo** *(dragão carmesim + 3 mastros)* | **Super Polar Tang** *(submarino capitânia amarelo 5 células)* | **Saber of Xebec** *(nau negra + toras gigantes e crânio)* |
   | `thousand_sunny` (`4`) | **Thousand Sunny** *(leão solar, grama verde, vela Chapéu de Palha)* | **Navio HQ-3 (Garp)** *(carranca cão buldogue da referência)* | **Moby Dick Branca II** *(baleia marfim/azul 2 mastros)* | **Red Force Capitânia** *(dragão escarlate + palmeiras)* | **Polar Tang** *(submarino amarelo clássico da referência)* | **Balsa Colossal Negra** *(jangada pesada de toras e canhões)* |
   | `oro_jackson` (`4`) | **Oro Jackson Aliado** *(galeão dourado/escarlate da Grande Frota)* | **Cruzador da Justiça** *(casco branco/azul-cobalto, velas 海軍)* | **Nau Spade (Ace)** *(crista de chamas + correntes da referência)* | **Galeão Benn Beckman** *(mogno carmesim e ouro)* | **Cruzador Cirúrgico Room** *(casco aço amarelo/preto)* | **Galeão de Impel Down** *(casco obsidiana e velas púrpura)* |
   | `red_force` (`3`) | **Mini-Sunny de Assalto** *(corveta vermelha/dourada solar)* | **Fragata Gaivota** *(proa gaivota azul/branca)* | **Fragata Fênix Azul** *(azul-celeste e chamas ciano do Marco)* | **Red Force** *(drakkar carmesim ágil)* | **Corveta Polar Bepo** *(híbrido amarelo ártico)* | **Brigue Vórtice Negro** *(madeira carbonizada e roxo)* |
   | `polar_tang` (`3`, sub) | **Shark Submerge III** *(submarino chibi tubarão azul/amarelo)* | **Submarino Tático HQ** *(submersível branco/azul da Marinha)* | **Submersível da Divisão** *(submarino baleia branco/azul)* | **Submersível Corsário** *(submarino rubro/bronze)* | **Submarino Torpedeiro Heart** *(cápsula amarela listrada)* | **Submersível Abissal** *(submarino negro/violeta)* |
   | `baratie` (`3`) | **Baratie** *(navio-peixe restaurante aliado)* | **Corveta Artilhada HQ** *(casco verde-mar/branco da referência)* | **Galeão Bisento** *(casco branco/ouro com alabarda)* | **Nau de Banquete Ruivo** *(casco rubro com barris de saquê)* | **Navio Hospital Tático** *(branco/amarelo com emblema Heart)* | **Nau Saqueadora** *(toras escuras e ferros)* |
   | `going_merry` (`2`) | **Going Merry** *(caravela branca com carneiro fofo)* | **Cúter de Patrulha** *(lancha rápida branca/azul Marinha)* | **Striker Flamejante** *(bote veloz de chamas laranja/azul)* | **Caravela Vigia do Yasopp** *(caravela carmesim compacta)* | **Cápsula Submersível** *(mini-sub amarelo de resgate)* | **Bote Caçador** *(jangada rápida de toras negras)* |

   - *Nota sobre naufrágio de submarinos:* O slot `polar_tang` mantém sua animação especial de submersão em todas as facções; na tripulação `heart`, todos os submersíveis com casco de submarino também submergem suavemente ao afundar (*decisão do construtor para máxima coesão visual*).

---

### 5.3. Frente 3 — Botão "Abandonar o Navio" (`rules.js`, `protocol.js`, `ui.js`, `i18n.js`)

1. **Lógica Pura PvC (`GLT.rules.forfeitMatch(state, playerIndex)` em `src/logic/rules.js`):**
   - Valida se `!state.gameOver` e `playerIndex === 0 || playerIndex === 1`.
   - Define `const winnerIdx = 1 - playerIndex`, marca `state.gameOver = true`, `state.winner = winnerIdx`, `state.gameOverReason = 'manual_forfeit'`.
   - Incrementa `state.seriesWins[winnerIdx] += 1` e adiciona entrada determinística em `state.history` (`type: 'forfeit'`, `player: playerIndex`, `winner: winnerIdx`, `turn: state.turnNumber`).
   - Retorna `{ valid: true, outcome: 'forfeit', winner: winnerIdx, message: T.forfeit.logPlayerForfeit(...) }`.

2. **Protocolo Online PvP (`PvpMatchClient.prototype.forfeit()` em `src/logic/protocol.js`):**
   - Valida `this.role === 'player'` e `this.state.phase === 'playing'` (espectadores não podem desistir).
   - Publica `createEvent('GAME_OVER', { seq: this.seqCounter++, turn: this.state.turnNumber, winnerIndex: 1 - this.playerIndex, forfeitedBy: this.playerIndex, reason: 'manual_forfeit' })`.
   - Em `foldMatchLog` (`case 'GAME_OVER'`), preserva `state.forfeitedBy = typeof ev.forfeitedBy === 'number' ? ev.forfeitedBy : null`.
   - Como `_handleIncomingEvent` já detecta a transição `oldPhase !== 'game_over' && this.state.phase === 'game_over'`, ambos os jogadores executam automaticamente `this.revealFleet()` e validam os compromissos SHA-256 sem qualquer falso positivo de trapaça!

3. **UX Segura em 2 Cliques e Comportamento em Séries (`src/ui/ui.js`):**
   - Durante `gamePhase === 'BATTLE'` (para jogadores ativos, oculto para `pvpRole === 'spectator'`), renderiza ao final de `.glt-battle-panel` (separado da grade de tiro e após o radar/reações) uma barra discreta com o botão `#btn-abandon-ship` (`🏳️ Abandonar o navio`, estilo `.btn-danger-outline`).
   - Clicar abre o modal de confirmação (`showAbandonShipModal()`):
     - Título: **Abandonar o navio?**
     - Texto contextual claro:
       - Em partida única PvC ou Online PvP: explica que a vitória desta partida será concedida imediatamente ao adversário.
       - Em série *MD3/MD5* PvC: explica que a batalha atual será entregue (+1 vitória na série para o rival), podendo avançar para o próximo jogo da série ou encerrá-la se for ponto de campeonato, além de oferecer um botão secundário opcional *"Encerrar série e voltar ao menu"* se o jogador quiser sair completamente (*decisão do construtor para cobrir ambos os casos de uso em MD3/MD5 sem fricção*).
     - Botões: **Continuar lutando** (foco inicial seguro por padrão + `Esc`) e **Confirmar rendição** (`#btn-confirm-abandon`).
   - Na tela de **Cerimônia (`launchCeremonyPhase`)**, quando `gameOverReason === 'manual_forfeit'`, exibe subtítulo dedicado destacando a rendição e registra a entrada no *Diário de Bordo*.

---

### 5.4. Frente 4 — Janela Pop-up "Manual do Jogo" (`ui.js`, `i18n.js`, `build.js`)

1. **Acionamento Universal sem Perda de Estado:**
   - Novo botão `#btn-open-manual` (`📖`, `aria-label="Manual do Jogo"`, com rótulo visível compacto `📖 Manual` em telas médias/grandes e ícone acessível no mobile) inserido em `#glt-top-hud .glt-quick-tools`, disponível no Setup, Lobby Online, Batalha e Cerimônia (exceto quando outro modal crítico como Cerimônia já estiver aberto — ou abrindo em camada própria / substituindo com retorno seguro).
   - Atalho de teclado global `?` ou `F1` (ignorado quando o foco estiver em `input`, `select` ou `textarea`).
   - Em batalha local PvC com cronômetro ativo, abrir o manual congela temporariamente a contagem regressiva local e a retoma ao fechar; em PvP Online, o jogo segue sincronizado em tempo real.

2. **Arquitetura de Conteúdo em 5 Abas Internas (`role="tablist"` dentro do modal):**
   Todo o conteúdo vem estruturado de `T.manual` em `src/logic/i18n.js`:
   - **Aba 1 — Como Jogar:** Objetivo da batalha naval, como posicionar e girar navios (`R`, clique/arraste, *Auto* e *Aleatório*), sorteio inicial da moeda de Berry, leitura de coordenadas (`A–L` × `1–12`), significado dos marcadores (*Água*, *Acerto*, *Afundado*, *Revelado* e *Neblina*) e comportamento especial de submersão.
   - **Aba 2 — Modos & Tripulações:** Comparativo entre **Modo Clássico** e **Modo Tático** (uso único da técnica especial por partida + 2 dicas da bússola *Log Pose* no PvC) e cartões detalhados das **6 Tripulações** mostrando capitão, identidade da frota chibi e área/efeito exato de cada técnica (*Bazooka 2×2*, *Tremor em cruz*, *Haki do Rei sonar 3×3*, *Room linha/coluna*, *Vórtice escudo* e *Haki de Observação*).
   - **Aba 3 — Partida & Regras:** Explicação dos 3 formatos de tabuleiro (*Escaramuça 8×8*, *Clássica 10×10*, *Grand Line 12×12*), séries (*MD1*, *MD3*, *MD5*), os 4 níveis de IA (*Grumete*, *Marujo*, *Capitão*, *Yonkou* com aprendizado em série), cada chave de regra opcional (*Permitir navios encostados*, *Continuar ao acertar*, *Modo Salva*, *Neblina de Guerra*, *Tempo por turno*) e como funciona a rendição (*Abandonar o navio*).
   - **Aba 4 — Online & Wi-Fi:** Passo a passo para jogar entre duas abas, como usar `jogar-no-wifi.cmd` (`node scripts/lan-server.js --open`) para jogar entre PC e celular no mesmo Wi-Fi, gerenciamento/exclusão de salas, reações *Den Den Mushi*, modo espectador e explicação acessível do sistema anti-trapaça *Commit-Reveal SHA-256*.
   - **Aba 5 — Câmera, Ajustes & Atalhos:** Presets de câmera (`1`–`4`), rotação orbital, *Erguer cenário próximo*, diferença entre estilos visuais **Cel Diorama (Minishoot')** e **Pixel Retrô**, velocidade de animação, temas *Escuro Abissal* / *Pergaminho Claro*, controles de som/*Sea Shanty*, radar 2D para leitores de tela e tabela completa de atalhos de teclado.

---

## 6. O Que Fica a Cargo do Construtor (Decisões de Implementação)

- Calibração fina dos limiares GLSL (`uDepthThreshold`, `uLumaThreshold`, pesos da rampa *cel* em OKLab e intensidade exata do *glow* por horário do dia — *Dia*, *Entardecer*, *Noite*, *Tempestade*) para garantir leitura impecável nos 4 climas.
- Proporções exatas de subdivisão de cada primitiva curva (`SphereGeometry`, `CylinderGeometry`, `TorusGeometry`, perfis extrudados) dentro de `ships-voxel.js` para manter o arquivo final enxuto (< 850 KB) e fluido a 60 fps em celulares e desktops.
- Layout responsivo da janela do Manual em viewports mobile (`375px`) vs desktop (`1440px`), usando rolagem interna suave e abas horizontais roláveis em telas pequenas.
- Criação de novos casos de teste automatizados em `tests/rules-test.js`, `tests/pvp-protocol.js` e `tests/e2e-gameplay-verify.js` validando `forfeitMatch`, `pvpClient.forfeit()`, abertura/navegação por abas do Manual, modo `cel_minishoot` e troca dinâmica da frota chibi ao mudar `crewId`.

