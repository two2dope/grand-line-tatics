# FINAL-REPORT — Auditoria final (etapa 7 do SCOPE-V2)

Data: 2026-11-12. Auditor com contexto novo, somente leitura no código do jogo. Nada foi corrigido.
O piloto `../grand-line-shot` não foi tocado: o `git status` dele continua igual ao registrado em PORT-NOTES (4 arquivos modificados e os mesmos não rastreados).

## Veredito

O jogo está **jogável e com todas as suítes verdes**. O artefato de arquivo único (`dist/grand-line-tactics.html`, 5,39 MB) passa no verify e no E2E completo. Antes de publicar, porém, faltam quatro coisas:

1. A câmera **Mira Inimiga** abre afastada demais. É a vista padrão da batalha, então o jogador passa a partida olhando para placas minúsculas (regressão desde a etapa 3).
2. Há **textos PT-BR cortados** no celular e no tablet (pílula de turno, carta náutica, aviso legal, cabeçalho do tablet).
3. O **PvP online nunca rodou na plataforma real**: tudo foi validado só com o fake (PUBLISH-NOTES §4).
4. Itens do escopo continuam **ausentes**: adereços GLB com créditos, referência de silhueta pelos STLs e manual. A performance em celular também nunca foi medida.

Contagem da auditoria (100 itens: 22 do SCOPE-V2 e 78 do SPEC): **PASS 78 · PARTIAL 17 · MISSING 5**.

## 1. Build e suítes (rodadas nesta auditoria)

| Comando | Resultado |
|---|---|
| `node scripts/build.js` | OK: `index.html` e `grand-line-tactics.html` com 1311,3 KB |
| `node scripts/build-artifact.js` | OK: 64 imagens, de 44,6 MB para 3,08 MB (WebP), `dist/grand-line-tactics.html` com 5,39 MB (limite 12 MB) |
| `npm run test:rules` | **46/46** |
| `npm run test:pvp` | **28/28** |
| `npm run test:artifact` (db/room fake) | **17/17** |
| `npm run test:ui` (qr-test) | **16/16** |
| `npm run test:sim` | **200.000 partidas** (8.000 de calibração + 96 combinações × 2.000), 780 s, todas as faixas aprovadas, determinismo 100 %, posicionamentos 100 % válidos, P1 49,1 % × P2 50,9 % |
| `npm run verify:index` | 0 erros de console (desktop, 375 px sem overflow, batalha, cerimônia, lobby) |
| `npm run test:e2e` (index.html) | **50/50** |
| E2E sobre o artefato (`GLT_ARTIFACT_DIR` = pasta isolada só com o arquivo) | **49/49** (o item que falta é a comparação byte a byte index × espelho, que não se aplica) |
| `npm run test:lan` | **10/10** |
| `npm run verify:artifact` | todos os PASS: desktop e 375 px, hosts só cdnjs + Google Fonts, 0 requisições falhas, 0 erros |
| `npm run test:picking` | OK: 0 células erradas em desktop, tablet e telefone, nas 4 câmeras |
| `npm run test:legacy` | 92/92 |
| `node tools/smoke.mjs` | SMOKE OK |
| Matriz de screenshots (`shots/final/`) | 34 capturas + 2 de evidência, **0 erros de console** em 12 sessões |

Calibração da IA (10×10, 2.000 jogos cada): Grumete 95,38 (faixa 85–98) · Marujo **56,12** (faixa 55–70, a 1,1 tiro do piso) · Capitão 47,78 · Yonkou 42,34 (faixa 40–55).

Observação: `npm test` não roda sim, verify-index, verify-artifact nem picking. Esses só rodam à mão.

## 2. Matriz de screenshots (`shots/final/`)

Driver: `node <scratchpad>/final-shots.mjs <projeto>`. Chromium headless com SwiftShader, three r128 local, `index.html` por `file://`. Relatório por sessão, com varredura de texto cortado: `shots/final/_report.json`.

| Arquivo | Estado |
|---|---|
| `01-desktop-setup` | Preparação 1280×720 |
| `02-day-duas-aguas-lift-on` / `03-…-lift-off` | Dia, Duas Águas, lift ligado e desligado (desligado: o Rei do Mar cobre a placa inimiga, ou seja, o lift funciona) |
| `04-day-az{120,210,300}-lift-{on,off}` | Três azimutes, lift ligado e desligado |
| `05-day-minhas-aguas`, `06-day-mira-inimiga`, `07-day-panorama` | Câmeras |
| `08-dusk-*`, `08-night-*`, `08-storm-*` | Entardecer, noite e tempestade (Duas Águas, Minhas Águas, Mira e Panorama) |
| `09-grandline12-*` | 12×12 com os 7 navios |
| `10-ceremony-poster`, `-later`, `-scene` | Cerimônia: cartaz e cena 3D (Jolly Roger erguido e fogos) |
| `11-campaign-chart` | Carta náutica |
| `12-lobby-desktop` | Aba Online |
| `13-theme-light-setup` | Tema claro |
| `20-phone-setup`, `21-phone-lobby`, `22-phone-battle`, `23-phone-chart`, `24-phone-ceremony` | 375×812 |
| `25-tablet-battle` | 1024×768 |
| `30-probe-mira-inimiga-8s` | Evidência: Mira Inimiga 8 s depois da troca (enquadramento final) |
| `31-ref-stage3-mira-inimiga` | Referência: a mesma câmera na etapa 3 (`shots/stage3-sea/`), enquadrada certo |

## 3. Auditoria SCOPE-V2 (vence o SPEC em conflito)

| # | Item | Status | Evidência |
|---|---|---|---|
| V1 | Etapa 1, Port: piloto como base, suítes do piloto verdes aqui | PASS | Seção 1; PORT-NOTES |
| V2 | Piloto nunca modificado | PASS | `git -C ../grand-line-shot status` igual ao do PORT-NOTES |
| V3 | Código antigo em `legacy/`; `src/render|world|ships|fx` alimentando o jogo | PASS | `scripts/build.js:24-73`; `test:legacy` 92/92 |
| V4 | Itens do branch `feat` trazidos sem regressão | PARTIAL | Vieram tablet, revanche, transparência de regras, QR e rendição. Ficaram de fora manual de 6 abas, música chiptune e `campaign.js` (PORT-NOTES, "Não trazido") |
| V5 | Etapa 2: `GLT.shipsVoxel.*` com nossos voxels, legíveis, frotas temáticas | PASS | `src/ships/pilot-api.js:718`; blind4 e blind5 com 9/9 para "ours" |
| V6 | STLs como referência de silhueta (Sunny, Polar Tang, Baratie, Moby Dick) | **MISSING** | Nenhuma vista renderizada nem critic de silhueta em `shots/` ou `tests/critic/` |
| V7 | Etapa 3: placas, água, luz, pós-processo e anel com nosso render | PASS | `src/sea/bridge.js:1-17, 459-462`; shots 02–08 |
| V8 | GLBs low-poly convertidos no build (≤ 400 KB) como adereços (frota da Marinha, naufrágios, botes, barris, rochas), licenças conferidas | **MISSING** | Nenhuma conversão ou uso (grep sem resultado por `.glb`, Quaternius ou Kenney em `src/` e `scripts/`). A frota da Marinha do panorama é voxel próprio |
| V9 | Seção "Créditos" no manual e no README | **MISSING** | Não existe (só passa a valer se V8 for feito, mas o manual também falta) |
| V10 | Etapa 4: FX com `src/fx`, mantendo cut-ins, shake e onomatopeias | PASS | `src/sea/fx-bridge.js`; `shots/critic/s4-*`; shots 02 e 10-scene |
| V11 | Etapa 5: transporte `db` (log append-only, salas, commit-reveal) + `room` (presença, reações) | PARTIAL | Implementado e testado com o fake (17/17, E2E seção db). **Nunca validado na plataforma** (PUBLISH-NOTES §4, itens 1–8) |
| V12 | LAN e BroadcastChannel mantidos | PASS | `test:lan` 10/10; E2E com 2 abas |
| V13 | PvP desabilitado com mensagem PT-BR se a capability vier `null` | PASS | E2E: `use("db") null -> … "indisponível"` e PvC segue jogável |
| V14 | Etapa 6: arquivo único ≤ 12 MB, imagens embutidas, só cdnjs + Google Fonts | PASS | 5,39 MB; `verify:artifact` |
| V15 | Campanha | PARTIAL | Carta náutica com 5 ilhas que escolhem mar e bioma. Não há progressão de campanha (`campaign.js` do feat não veio) |
| V16 | Bênçãos | PARTIAL | Só cosméticas: sorteio na vitória e coleção em localStorage (`ui.js:3016-3047`). Nenhum efeito de jogo |
| V17 | Perigos | PARTIAL | Só imagem e texto na carta (`backdrop-fx.js:536-541`). Nenhum efeito |
| V18 | Frotas temáticas, rendição, LAN Wi-Fi, cut-ins, shake, onomatopeias | PASS | `rules.forfeitMatch` (teste 46); `test:lan`; fx-bridge |
| V19 | Manual do jogo | **MISSING** | Nenhuma ocorrência de "manual" em `i18n.js` |
| V20 | Ilustrações do piloto mantidas, com aviso de tributo no rodapé | PARTIAL | Mantidas, com rodapé. Mas o texto do aviso diz que tudo é "procedural" e que "nenhum asset… ilustração… foi reproduzido", o que contradiz as 64 ilustrações raster (`i18n.js:52`; o README diz o mesmo). No celular o aviso cabe em uma linha e fica cortado (`p.glt-disclaimer` com 1259 px em 359 px) |
| V21 | Barra de qualidade: suítes e verify-index com 0 erro | PASS | Seção 1 |
| V22 | Barra visual: cada etapa vence o piloto em comparação cega | PARTIAL | Etapas 2 e 3: blind4 e blind5 com 9/9. Etapa 4: os mapeamentos existem (`shots/critic/blind-s4*`), mas as escolhas não foram gravadas |

## 4. Auditoria SPEC.md, item a item

### Idioma

| # | Item | Status | Evidência |
|---|---|---|---|
| L1 | `<html lang="pt-BR">` | PASS | `scripts/build.js:3862` |
| L2 | Todo texto num dicionário T, com plurais; nada fixo fora dele | PARTIAL | `ui.js` tem cerca de 33 literais PT fixos (por exemplo `ui.js:440, 456, 837, 859, 909, 932`) e 14 fallbacks `T.x \|\| '…'`. Os nomes de perigos e adereços ficam em `backdrop-fx.js` |
| L3 | Fontes Latin-Extended; ç ã õ é renderizam | PASS | `build.js:3872` (`subset=latin,latin-ext`); "Águas", "Bênção" e "Sanji" corretos nos shots |
| L4 | `Intl.NumberFormat('pt-BR')` e ฿ | PASS | `ui.js:20`; shots mostram "฿ 1.500.000.000" |
| L5 | Tom pirata ("Água!", "Sua vez, capitão!") | PASS | `i18n.js`; shots |
| L6 | Arte original procedural, sem assets oficiais, aviso no rodapé | PARTIAL | Ver V20 (exceção decidida pelo usuário, mas o texto do aviso ficou falso) |

### Visual

| # | Item | Status | Evidência |
|---|---|---|---|
| K1 | Alvo de baixa resolução, slider de pixel (padrão 2), upscale nearest | PASS | `ui.js:98`; `T.ui.pixelSizeSlider` |
| K2 | Contornos por profundidade, 90 cores em OKLab, Bayer | PASS | `src/render/palette.js:1-78` (assert de 90 cores) |
| K3 | Câmera ortográfica isométrica (azimute, elevação, zoom) presa à grade de pixels | PASS | `src/render/camera.js:45-46, 130-150` |
| K4 | Sombra a cada frame; dia, entardecer, noite e tempestade | PASS | Shots 02 e 08-* |
| K5 | Noite: lanternas, boias de tocha, facho do farol | PASS | `src/world/props.js:1-6`; `08-night-*` (lanternas e tochas visíveis; o facho quase não aparece no panorama) |
| K6 | Duas placas "Suas águas" e "Águas inimigas" com aro A–J / 1–10 | PASS | `05-day-minhas-aguas`, `06-day-mira-inimiga` |
| K7 | Ondas animadas e espuma onde há navio | PASS | `src/world/ocean.js` |
| K8 | Aros em terraços, estratos, vinhas, algas, quedas de pedra, pedaços flutuantes, cachoeiras | PASS | `src/world/plates.js`; shots 02 e 09 |
| K9 | Canal da Reverse Mountain subindo até a ilha do céu | PASS | `07-day-panorama` |
| K10 | Anel de fundo: Red Line, Skypiea com sino, Sabaody com bolhas, Marineford com navios em formação, Reis do Mar, Laboon, boia do Log Pose, Den Den Mushi grande e pequeno | PASS | `07-day-panorama`, `08-night-panorama`; `bridge.js:407-421` |
| K11 | Torcida instanciada no cais que comemora | PASS | `src/world/crowd.js`; `bridge.js:422-424` |
| K12 | Fogos na vitória | PASS | `10-ceremony-scene` |
| K13 | Lift: 8 setores, 90 m, 0,85 s, sem sombra e oculto, checkbox, desligado na cerimônia e no panorama | PASS | `sea/consts.js:30-37`; `world/backdrop.js:14-19, 721-763`; `ui.js:5602`; shots 02/03/04 |

### Navios e FX

| # | Item | Status | Evidência |
|---|---|---|---|
| N1 | Navios da série em voxel, mesclados por material, com bandeiras e figuras de proa | PASS | `src/ships/models.js`; lineups em `shots/critic/lineup-r2` |
| N2 | Dono indicado por friso, flâmula e borda da placa, sem mudar a identidade | PASS | `pilot-api.js:10, 312`; borda vermelha nos shots |
| N3 | Balanço, velas tremulando, esteira, recuo dos canhões, tripulação instanciada | PASS | `pilot-api.js:12-14, 445-585` |
| N4 | Frota da SPEC (7 navios e tamanhos) | PASS | `09-grandline12-*` (7/7); frotas temáticas por tripulação, conforme o SCOPE |
| N5 | Polar Tang mergulha e deixa mancha de óleo | PASS | `ships/fleet3d.js:236`; `pilot-api.js:672` |
| N6 | Tiro com arco, rastro e clarão; anel de respingo; fogo, fumaça e tábuas | PASS | `src/fx/shots.js`; shot 02 |
| N7 | Afundamento inclinando, bolhas, bandeira boiando, contorno revelado, dano visível | PASS | `pilot-api.js:455`; `models.js:1005`; `10-ceremony-scene` |
| N8 | Cerimônia: Jolly Roger erguido; cartaz WANTED procedural em pixel com capitão, nome e recompensa subindo | PARTIAL | Bandeira e fogos OK. O cartaz é a ilustração raster do piloto, não pixel procedural. Em 1280×720 o modal abre rolado e corta o rosto do capitão (`10-ceremony-poster`) |
| N9 | Recompensa = f(precisão, tiros, velocidade, sequências, dificuldade, regras) | PASS | `rules.js`; sim "Recompensas finitas e consistentes" |

### Jogo e CPU

| # | Item | Status | Evidência |
|---|---|---|---|
| G1 | 6 tripulações com capitão, 3 oficiais, cores e técnica | PASS | `01-desktop-setup` |
| G2 | Tabuleiros 8×8/4, 10×10/5, 12×12/7; séries MD1/3/5 | PASS | `rules.js:198-208`; `09-grandline12-*` |
| G3 | Posicionar arrastando em 3D ou 2D; girar com R, botão direito ou toque duplo; fantasma verde/vermelho; auto, aleatório, limpar | PASS | E2E; `test:picking`; dica no HUD |
| G4 | Opções: encostar, continuar ao acertar, salva, timer off/20/30/60, neblina de 2 turnos | PASS | `test:rules` |
| G5 | Modo Tático com 6 técnicas que custam o turno | PASS | `test:rules`; E2E "Técnicas" |
| G6 | Modo Clássico sem técnicas | PASS | `test:rules` |
| G7 | Moeda de Berry derivada da semente compartilhada | PASS | `test:pvp`; E2E |
| G8 | Mares visuais (efeito semeado opcional no Tático) | PASS | Só visual (o efeito era opcional) |
| G9 | mulberry32; sem `Math.random` nas regras | PASS | Grep: `Math.random` só em `audio/sfx.js:166,174` (ruído de áudio) |
| G10 | Água! / Acertou! / Afundou o … e vitória | PASS | `test:rules` |
| G11 | Tela de estatísticas: tiros, acertos, precisão, sequência, turnos, **tempo**, recompensa | PARTIAL | O tempo não aparece: `T.battleDuration` existe (`i18n.js:873`) e não é usado em `ui.js` |
| G12 | CPU Grumete, Marujo, Capitão, Yonkou (com aprendizado na série) | PASS | Calibração aprovada. Alerta de ajuste: Marujo em 56,12, quase no piso de 55 |
| G13 | Frota da CPU aleatória, nas bordas ou espalhada, por dificuldade | PASS | `ai.js:313-477` |
| G14 | Provocações PT-BR por tripulação rival | PASS | `i18n.js`; balões nos shots |
| G15 | Atraso de "pensando" de 400–1200 ms | PASS | `ui.js:2409` (420–1000 ms em 1x) |

### Controles, câmeras e opções

| # | Item | Status | Evidência |
|---|---|---|---|
| C1 | Seletores de tripulação, dificuldade e regras | PASS | `01-desktop-setup` |
| C2 | Destaque ao passar o mouse; selecionar e confirmar no FOGO! | PASS | E2E |
| C3 | Teclado: setas + Enter, saltos 1–0 / A–J | PASS | `T.ui.keyboardShortcuts`; E2E |
| C4 | Dica do Log Pose (usos limitados) | PASS | `verify-index` (dica) |
| C5 | Diário de bordo, placar, contador de turno | PASS | Shots |
| C6 | Leitor de tela, `aria-live` | PASS | Regiões `sr-only` vivas encontradas na varredura |
| C7 | 4 câmeras (Duas Águas, Minhas Águas, Mira Inimiga, Panorama) | PARTIAL | **A Mira Inimiga enquadra errado**: meia-altura de 80 m contra 57 m da Duas Águas (sonda: `top 80.32` × `56.87`), placas minúsculas (`06`, `08-storm-mira`, `22`, `25`, `30-probe`). Causa provável: `src/sea/bridge.js:265` passa `plate: 'own'` em todo modo, e o `fitWanted` (`src/render/camera.js:123`) enquadra a placa própria centrado na inimiga. `ui.js:1898` liga essa câmera no início de toda batalha |
| C8 | Velocidade de ½x a 4x e pausa, só offline | PASS | `i18n.js:602-604`; `ui.js:1952` (o timer de turno também acelera: em 4x, 30 s viram 7,5 s reais) |
| C9 | Pular cerimônia, próxima partida automática | PASS | `ui.js:3112-3121`; shot 10 |
| C10 | Áudio Web Audio (canhão, respingo, acerto, afundamento, sea shanty, mudo e volume) | PASS | `src/audio/sfx.js` (música básica do main; a chiptune do feat não veio) |
| C11 | Opções de contornos, dither e 3D cru | PASS | `i18n.js:595-597` |
| C12 | Tema claro e escuro | PARTIAL | O tema claro tem abas e textos do painel com contraste muito baixo (`13-theme-light-setup`) |
| C13 | `prefers-reduced-motion` | PASS | `ui.js:1175`; `camera.js:48` |
| C14 | Celular: arrastar para girar, pinça para zoom, grade 2D | PARTIAL | Os gestos existem (`ui.js:1389, 1431, 1466`) e não há rolagem horizontal. Mas há textos cortados (ver Q6) e as placas ficam minúsculas na vista padrão (C7) |
| C15 | Estatísticas em localStorage com try/catch | PASS | `ui.js:3022-3028` |

### Online (PvP)

| # | Item | Status | Evidência |
|---|---|---|---|
| P1 | Capabilities declaradas exatamente; interface Transport; fake em memória | PASS | `PUBLISH-NOTES.md §1`; `net/transport.js`; `tests/fakes/claude-fake.js` |
| P2 | Sem capability: PvP desabilitado em PT-BR, PvC intacto | PASS | E2E |
| P3 | Lobby: criar (código de 5 + link), entrar com código, partida rápida, apelido, id aleatório, reações predefinidas | PASS | `12-lobby-desktop`, `21-phone-lobby`; `artifact-db-test` B5/B6 |
| P4 | Botão de revanche | PARTIAL | O botão existe e o reset é testado (PvP 18). PUBLISH-NOTES §5: "Revanche na mesma sala não funciona no fold" |
| P5 | Log append-only numerado, fold, escritas idempotentes, posse do turno | PASS | `test:pvp` 28/28 |
| P6 | Commit SHA-256, resposta automática, revelação, verificação, "Trapaça detectada", técnicas verificadas | PASS | `protocol.js:188-191`; testes de adulteração no PvP e no E2E |
| P7 | Batimento a cada 3 s, "reconectando" aos 10 s, W.O. aos 60 s | PASS | `protocol.js:1970-2012` |
| P8 | Timer de turno imposto pelos dois clientes; o estouro dispara numa célula **aleatória** ainda não tentada | PARTIAL | `ui.js:1976-1985` dispara na primeira célula livre em ordem de leitura (A1, A2… é visível nos shots), não no `getDeterministicAutoShot`. No artefato, `TURN_TIMEOUT` de autor autenticado é descartado (`protocol.js:642`), então só o próprio jogador atrasado aplica o timer. Um cliente parado mas presente pode travar a partida |
| P9 | Estado da conexão, ping, "online agora" | PASS | `i18n.js:789-793` |
| P10 | Aba fechada, refresh no meio da partida, offline | PASS | E2E: "Tab B reloaded mid-match and rejoined" |
| P11 | Espectadores sem ver frota antes da revelação | PASS | E2E: "Store scan: no fleet or salt…" |
| P12 | Mural "Mais procurados", casual e não verificado | PASS | `i18n.js:640` |

### Barra de qualidade

| # | Item | Status | Evidência |
|---|---|---|---|
| Q1 | Zero erro de console | PASS | `verify-index`, E2E ×2, `verify-artifact`, `final-shots` |
| Q2 | Sim headless (≥ 2.000 por combinação), terminação, validade, pontuação, reprodutibilidade, tiros por dificuldade, P1 × P2 | PASS | `tests/sim-report.md` |
| Q3 | Protocolo com latência, perdas, duplicatas, fora de ordem, refresh, desconexão, timeout, clique duplo, adulteração | PASS | `test:pvp` 28/28 + `test:artifact` 17/17 |
| Q4 | Malhas mescladas e instanciadas | PASS | `pilot-api.js:12-14`; `fleet3d.js:8` |
| Q5 | 60 fps em celular médio com pixel 2; memória em sessão de 30 min | **MISSING** | Nunca medido. Só há Chromium headless com SwiftShader, que não serve de medida |
| Q6 | Todo texto PT-BR cabe no seu container | PARTIAL | Cortados: pílula de turno ("Sua vez, …", "Frota pos…"; no celular, 12 px de largura), selects ("Marinha (Sakazuki (Akainu", "Melhor de 1 (Partida Únic"), dica "Clique ou arraste nas Suas …", carta no celular ("Logue…", "Marine…", "MULTIPLICAD…", "Límpida (Z…", "Calm Belt (…", "Smoker & …"), aviso legal no celular, cabeçalho no tablet 1024 ("o Tático", "฿ 1.500.000."), balão de provocação cortado no celular. Detalhe em `shots/final/_report.json` |
| Q7 | Navios não atravessam uns aos outros nem o aro | PASS | `09-grandline12-minhas-aguas`; `shots/critic/ghost-fit/_ghosts.json` (etapa 2) |
| Q8 | Screenshots em vários ângulos, noite, tempestade, lift ligado e desligado, cerimônia, celular | PASS | Seção 2 |

## 5. Problemas conhecidos, por gravidade

1. **Alta: Mira Inimiga mal enquadrada, e é a vista padrão da batalha** (C7). Em toda partida, no desktop, no tablet e no celular, as placas ocupam cerca de 20 % do canvas. É uma regressão: a etapa 3 enquadrava certo (`31-ref-stage3-mira-inimiga` × `30-probe-mira-inimiga-8s`). A causa provável está em `bridge.js:265` + `camera.js:123`. Nenhuma suíte pega isso: o `picking` só confere se o clique cai na célula certa.
2. **Alta: PvP online sem validação na plataforma** (V11). Regras `moves/{self}`, `user.id()`, carimbo `by` do `room`, latência real e `sessionStorage` no iframe estão todos sem verificação (PUBLISH-NOTES §4). Se o `{self}` for recusado, o próprio documento diz que o PvP online não deve ser publicado.
3. **Média: textos PT-BR cortados** (Q6), sobretudo no celular (carta náutica, pílula de turno, aviso legal) e no cabeçalho do tablet 1024 px.
4. **Média: aviso legal impreciso** (V20/L6). Afirma arte 100 % procedural e nenhuma ilustração reproduzida, mas o jogo embute 64 ilustrações raster de personagens. É risco legal e de reputação ao publicar, e o README repete a afirmação.
5. **Média: timer de turno do PvP** (P8). Dispara em ordem de leitura, não aleatória; no artefato só o jogador atrasado o aplica, e um cliente presente e parado trava a partida.
6. **Média: itens do escopo ausentes**: adereços GLB com créditos (V8/V9), silhuetas pelos STLs (V6), manual (V19). Campanha, bênçãos e perigos são só cosméticos (V15–V17).
7. **Média: revanche na mesma sala não funciona no PvP** (P4, PUBLISH-NOTES §5).
8. **Baixa: tela de estatísticas sem o tempo** (G11). O cartaz da cerimônia abre rolado e corta o capitão em 720 px (N8).
9. **Baixa: tema claro com contraste insuficiente** nas abas e no painel (C12).
10. **Baixa: legibilidade da cena durante a batalha.** Tábuas e fumaça acumulam sobre a própria placa (shots 02 e 04) e escondem os navios depois de alguns acertos.
11. **Baixa: Marujo a 1,1 tiro do piso da faixa** (56,12 em 55–70).
12. **Baixa: higiene do repositório.** O projeto não é repositório git. `package.json` repete as chaves `build:artifact` e `verify:artifact`. O README ainda descreve a árvore do piloto (`grand-line-shot/`, `reviews/`, `progress.html`) e números antigos (45 regras, 16 PvP). O CHANGELOG para na 1.0.0 com `version` 2.0.0-port. `npm test` não inclui sim, verify-index, verify-artifact nem picking.
13. **Baixa: strings fixas fora do T** (L2), cerca de 47 ocorrências em `ui.js`.

## 6. O que falta antes de publicar

Obrigatório:
1. Corrigir o enquadramento da Mira Inimiga (item 1) e acrescentar uma checagem automática de enquadramento: área da placa na tela por câmera, em desktop e no celular.
2. Corrigir os textos cortados (item 3) e reescrever o aviso legal para refletir as ilustrações mantidas (item 4), legível também no celular. Alinhar o README.
3. Publicar uma versão de teste privada com a declaração de `capabilities` do PUBLISH-NOTES §1 e executar a checagem pós-publish §6 inteira: Viewer lê e não escreve, Contributor escreve só em `moves/<id>`, partida completa entre duas contas, refresh no meio e varredura do store antes do `FLEET_REVEAL`. Se o `{self}` for recusado, publicar com PvP online desligado.
4. Medir desempenho e memória num celular real (60 fps com pixel 2; 30 min de sessão), ou declarar a meta como não atendida.
5. Decidir e registrar o que fica fora da v2: GLBs com créditos, STLs, manual, progressão de campanha e efeitos de bênçãos e perigos. Implementar ou retirar do escopo por escrito.

Recomendado:
6. Timer de turno no PvP: usar `getDeterministicAutoShot` e definir quem aplica o timer no artefato.
7. Revanche na mesma sala (fold).
8. Mostrar a "Duração da Batalha" nas estatísticas; abrir o modal da cerimônia no topo.
9. Contraste do tema claro.
10. Pôr o projeto sob git, limpar o `package.json`, atualizar README e CHANGELOG, e criar um `npm run test:all` com todas as suítes.
