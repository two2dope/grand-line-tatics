# PORT-NOTES — etapa 1 (Port): piloto vira a base

Data: 2026-11-11. Ver SCOPE-V2.md. O piloto (`../grand-line-shot`) foi lido, nunca alterado (`git status` identico ao de antes: 4 arquivos modificados + assets nao rastreados).

## Layout resultante

| Pasta | Conteudo |
|---|---|
| `src/logic, src/net, src/ui, src/audio` | do piloto (arvore de trabalho, inclui as mudancas glTF nao commitadas) + itens do branch feat (abaixo) |
| `src/pilot-render/` | render do piloto (`ships-voxel`, `plates-lighting`, `backdrop-fx`, `palette-shader`, `three-gltf-loader`). Entradas estaveis: `GLT.shipsVoxel`, `GLT.platesLighting`, `GLT.backdropFx`, `GLT.paletteShader`. As etapas 2 a 4 trocam o que esta atras delas |
| `src/render, src/world, src/ships, src/fx` | nosso render voxel, intocado (ainda nao ligado ao jogo) |
| `legacy/src/{logic,net,ui,audio,app}`, `legacy/tests` | nosso codigo antigo + testes (92/92 com `npm run test:legacy`) |
| `scripts/, tests/, docs/, README.md, CHANGELOG.md, jogar-no-wifi.cmd` | do piloto |
| `assets/` | so os 74 arquivos referenciados pelo codigo (47 MB) + `models/ships/Textures`. Nada de `assets/3D`, `flow-assets`, zips, `images (n).jpeg`, `swashy.png`, scratch |
| `tools/, ref/, shots/` | nossos. Novo: `tools/baseline.mjs` |

Mudancas em relacao a copia do piloto (todas dentro deste projeto):
- `scripts/build.js`: modulos de `src/pilot-render/`, inclui `src/ui/qrcode.js`, remove a tag extra do GLTFLoader no jsdelivr (o loader ja vai inline em `three-gltf-loader.js`; runtime externo agora so three r128 no cdnjs + Google Fonts). `index.html` e `grand-line-tactics.html` ficam na raiz porque os assets sao relativos. NAO grava `dist/grand-line-tactics.html`: uma copia em `dist/` ficaria sem os assets (81 requisicoes falhas); isso so volta na etapa 6, com imagens embutidas.
- Erros de console em `file://` (rodada 2): `ships-voxel.js#loadShipGLTF` nao faz mais o XHR dos `.glb` quando `location.protocol === 'file:'` (Chrome bloqueia por CORS, origin `null`: 16 erros ao abrir o `index.html` de verdade). Em `file://` o jogo usa os navios voxel; servido por http (`jogar-no-wifi.cmd`, LAN server) os `.glb` carregam. `window.GLT_FORCE_GLB = true` reativa o carregamento (usado so por `tools/baseline.mjs`, que roda com `--allow-file-access-from-files`, para fotografar o visual servido por http). `verify-index.js`, `e2e-gameplay-verify.js` e `lan-e2e-verify.js` agora habilitam `Log` e `Network` no CDP e contam `Log.entryAdded` nivel error e `Network.loadingFailed` como erro (antes so viam `Runtime.*`, entao CORS/404 passavam batido). Verificado em negativo: forcando os `.glb` em `file://` o `verify:index` falha com os erros de CORS. O check E2E de transicao PvP para BATTLE esperava 4,5 s e oscilava sob carga; agora ate ~15 s. `scripts/scene-preview.html` ganhou `<base href="../">` (portraits/emblemas relativos): zero `ERR_FILE_NOT_FOUND` no harness de cena.
- Capturas so neste projeto: `capture-scene.js` e `verify-index.js` gravam em `shots/captures/` (antes `references/captures`); `verify-3d-ships.js` e `verify-marine-fleet.js` gravavam numa pasta pessoal fora do projeto e agora gravam em `shots/captures/`. `scene-preview.html` aponta para `src/pilot-render/`.
- Finais de linha: tudo normalizado para LF (a arvore de trabalho do piloto vem em CRLF).
- `package.json`: campos e scripts do piloto; `build:demo`, `smoke`, `test:legacy`, `test:ui` (novo `tests/qr-test.js`) e `baseline` adicionados; `devDependencies.playwright` mantido.
- `tools/build.js --legacy` / `GLT_LEGACY=1` constroi as demos antigas com a logica de `legacy/src` (`npm run build:demo`).

## Branch `feat/v2.0-minishoot-chibi` x `main` (leitura via `git -C <piloto>`)

Os dois divergiram de `d7806d9`: main tem 12 commits (frotas tematicas, biomas/ceus Flow, cut-ins, shake, onomatopeias, navios glTF, carta nautica, cartaz, Rei do Mar), feat tem 24 (cel-diorama, campanha v2.5, bencaos v2.5, manual, musica, QR, tablet, revanche, transparencia de regras, rendicao). Metodo: merge de 3 vias em area de rascunho (`git merge-file`, base = `3ff6cbc`, topo da v2.5 antes dos commits de UX) para os 5 commits finais de UX; `ui.js` deu 20 conflitos resolvidos a mao; `protocol.js`, `i18n.js` limpos.

### Trazido (merged)

| Item | De onde | Onde |
|---|---|---|
| Acoes on-screen para tablet: barra flutuante (Fogo, Tecnica, Dica/Den Den, Girar, Auto, Limpar, Render-se, Painel), painel lateral recolhivel, badge de mira reposicionado, mini-mapa HUD clicavel | 70494c2..1b13d06 | `ui.js` (`renderFloatingControls`, `renderHudMinimap`, `toggleSidePanelCollapse`) + CSS |
| Reset de revanche no PvP: os dois pedem, estado canonico volta a `lobby` (tiros, afundados, prontidao, escudos zerados; cliente limpa `hitsTaken/fleet/salt`) + cartao de status de revanche | 1b13d06 | `protocol.js`, `ui.js`, teste PvP 18 |
| Transparencia de regras: cartao de regras na pre-sala e "Regras estabelecidas pelo Host" na sala; convidado recebe board, modo, mar, salva, continuar ao acertar, neblina, toque, timer | 1b13d06/c901770 | `ui.js` |
| Selecao de tripulacao do convidado na sala (`CREW_SELECTED`/`selectCrew`), modelo Host -> Convidado sem espelho (`getMyPlatesIndices`, camera e tiros na orientacao certa), Vortice limpa escudo ao absorver, `GAME_OVER` idempotente | c901770 | `protocol.js`, `ui.js`, teste PvP 17 |
| QR Code zero-dependencia para entrar na sala/LAN pelo celular | 70494c2 | `src/ui/qrcode.js`, `ui.js` |
| Rendicao ("Abandonar o navio"): `rules.forfeitMatch`, `client.forfeit()`, modal de confirmacao, subtitulo na cerimonia, log. A barra flutuante do feat chamava `openForfeitModal`, que nao existe la; liguei em `showAbandonShipModal` | 3cda476 | `rules.js`, `protocol.js`, `i18n.js` (`T.forfeit`), `ui.js`, testes (regras 46, PvP 16) |
| Estilos para tudo acima (94 regras novas + 7 da rendicao, extraidas por seletor para nao sobrescrever o CSS do main) | feat | `scripts/build.js` |
| Testes: `tests/qr-test.js` (16 casos de UI com DOM falso: QR, tablet, revanche, regras, guest) adaptado ao dialogo do main; retries do `lan-e2e-verify` | feat | `tests/` |

Ajustes de compatibilidade feitos na fusao: `renderFleetTab` ganhou `var self`; `updateRivalTaunt(type, forceCrewId)` respeita a fase (SETUP mostra o capitao do jogador); nomes de navios vem de `getShipsForBoard(board, crewId)` do main (o feat usava `getCrewShipMeta`, que nao existe no main); radar mantem os dois tabuleiros do main (inimigo em cima, o meu compacto embaixo) usando os indices de placa do guest.

### Nao trazido (skipped) e por que

| Item | Motivo |
|---|---|
| Campanha "Jornada pela Grand Line" (`campaign.js`) e bencaos v2.5 (`blessings.js`), obstaculos de iceberg | Concorre com a carta nautica/ilhas/bencaos que o main ja tem em `ui.js`; so um dos dois modelos pode ficar. Main-only preservado. Candidato a decisao no design (nao ha campanha em arquivo proprio no main: SCOPE-V2 a lista como existente, na verdade so existe no feat) |
| Manual ilustrado de 6 abas, atalhos `?`/F1 | ~1000 linhas de UI + CSS ligadas ao painel antigo do feat; nao conflita, so e grande. Candidato a proxima passada pelo mesmo metodo (base `d7806d9`) |
| Musica chiptune e canais de volume duplos (`sfx.js`, +1000 linhas) | `sfx.js` divergiu nas duas linhas e o audio nao e desta etapa; main ja tem musica basica. Candidato |
| Seletor de 5 mapas no PvP (`mapId`, `validateMatchConfig`, teste 17 do feat) | Modelo diferente: o main escolhe mar + ilha pela carta nautica (`seaId`). Removi `mapId` do UI trazido e o badge do mapa |
| Seletor Inimigo/Minhas/Ambas do radar | O main ja empilha os dois radares; o seletor esconderia o meu por padrao |
| CORS aberto e remocao de `X-Frame-Options` no `lan-server.js` | Regressao de seguranca para um servidor de LAN; o QR e a LAN same-origin nao precisam |
| Cel-diorama "Minishoot", navios chibi voxel, cascos do feat (`src/render/*` do feat) | O main (arvore de trabalho) usa glTF e todo esse render sera substituido por `src/render` nas etapas 2 a 4 |
| Frotas/metadados por tripulacao do feat (`getCrewShipMeta`) | Equivalente ja existe no main (frotas tematicas) |

## Suites aqui (todas verdes)

| Suite | Resultado |
|---|---|
| `npm run test:rules` | 46/46 (piloto: 45; +1 `forfeitMatch`) |
| `npm run test:pvp` | 19/19 (piloto: 16; +forfeit, +selecao de tripulacao, +revanche; teste de mapas do feat descartado) |
| `npm run test:ui` (`qr-test.js`) | 16/16 (novo) |
| `npm run test:sim` | 200.000 partidas, todas as faixas aprovadas (ver `tests/sim-report.md`) |
| `npm run test:e2e` | 35 aprovados, 0 falhas |
| `npm run test:lan` | 10 aprovados, 0 falhas |
| `npm run verify:index` | zero erros de console, incluindo CORS/rede via CDP Log+Network (desktop, 375 px sem overflow, batalha, cerimonia, PvP) |
| `npm run test:legacy` | 92/92 (nossa logica antiga) |
| `node tools/smoke.mjs` | OK |

## Baseline visual (`shots/baseline/`, `node tools/baseline.mjs`)

`setup-desktop`, `battle-hits-sunk-day` (+ `-mira`), `battle-night`, `battle-storm`, `ceremony-wanted`, `phone-setup`, `phone-battle`, `tablet-battle`, `tablet-battle-panel-collapsed`, e do harness de cena do piloto `scene-day|night|storm|ceremony` (clima fixo, sem UI). `_report.json` lista erros de console e `requestfailed` por cena (zero em todas, harness de cena incluso; as capturas forcam os `.glb`, ver acima). Observacao: no jogo, noite (`novo_mundo`) e tempestade quase nao mudam o visual; so o harness mostra o clima de verdade. Os fleets sao sorteados por execucao (semente com `Date.now`), entao o conteudo das capturas varia, a composicao nao.

## Em aberto

- Itens "candidato" acima (manual, musica, decisao campanha).
- Chrome headless deste PC e o do Playwright rodam com SwiftShader; `verify-index`/E2E/LAN usam o Chrome instalado em `C:\Program Files\Google\Chrome`.
- `index.html`/`grand-line-tactics.html` pesam ~1,1 MB sem imagens; o artefato de arquivo unico com imagens embutidas e a etapa 6.
