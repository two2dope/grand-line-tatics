# Changelog

Todas as mudanças relevantes deste projeto são documentadas neste arquivo.
O formato baseia-se em [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/) e este projeto adota [Versionamento Semântico](https://semver.org/lang/pt-BR/).

---

## [Não lançado]

### Adicionado (celular)
- **Jogo instalável (PWA)**: manifesto, ícones e service worker. Instalado, abre pela tela inicial em tela cheia; depois da primeira visita abre e joga contra a IA sem internet. A página continua vindo da rede quando há conexão, então cada publicação aparece na próxima abertura. Ajustes ganhou a seção "Aplicativo" (instalar, tela cheia, vibração, estado offline).
- **Tela cheia**: botão na barra de cima. Celular deitado entra em tela cheia no primeiro toque; sair à mão desliga isso até a próxima vez que o celular for girado.
- **Celular deitado**: cena e painel lado a lado. Antes a cena ficava com uns 120 px de altura e o radar saía da tela; agora o radar das águas inimigas ocupa a altura do painel com FOGO, técnica e Log Pose numa coluna ao lado (testado de 667x375 a 932x430).
- **Toque**: arrastar o painel além do fim não puxa mais a página (sem recarregar a partida por "puxar para atualizar"), toques respondem sem a espera do toque duplo, toque longo no tabuleiro não abre o menu de copiar. Tela não apaga durante a batalha. Vibração curta em acertos e naufrágios (Android).
- Margens para o entalhe e a barra inferior do iPhone no app instalado.
- **Alvos de toque de 44 px**: em tela de toque, os ícones da barra de cima, as pílulas de câmera, as abas, os botões (FOGO, técnica, Log Pose, iniciar batalha) e os seletores ficam com pelo menos 44×44 px de área de toque, sem sobreposição entre vizinhos. Em computador nada muda.
- **Rodapé no celular**: o aviso de homenagem de fã, que era cortado com reticências, agora rola continuamente da direita para a esquerda (cerca de 28 px/s), em retrato e deitado. Um toque pausa e retoma. Com "reduzir movimento" ligado, o texto fica parado e quebra em linhas. No computador nada muda.
- **Movimento reduzido nos fogos da vitória**: com "reduzir movimento" ligado no sistema, os fogos não dão o clarão branco e soltam no máximo um rojão por segundo.

### Documentação
- `docs/evolution-report.md` (raio-X e plano em ondas), `docs/web-guidance-rules.md` (regras web congeladas), `release.md` (receita de publicação) e um bloco "Current contract" no topo do `ARCHITECTURE.md` com o build real e a divisão de áreas.

### Corrigido (rodada de testes em celular e computador)
- **Placar do PvP em tempo real**: a aba Esquadra mostrava a lista parada (inimigos sempre "???", seus navios sempre "Intacto"). Agora cada tiro respondido atualiza os dois aparelhos: navio inimigo afundado aparece como afundado, os seus como avariados ou afundados, contagem de navios nas duas frotas e uma linha com disparos, acertos e precisão de cada lado. O mini-radar sobre a cena (painel recolhido) também redesenha a cada tiro, e a "maior sequência de acertos" do fim da partida online é contada de verdade.
- **Assentos protegidos**: no Wi-Fi e no WebRTC, só o aparelho que ocupou um assento publica eventos por ele. O servidor Wi-Fi e o anfitrião WebRTC carimbam cada evento com o assento verdadeiro; um segundo aparelho que tenta entrar como jogador recebe "sala cheia".
- **Técnicas no PvP**: as seis técnicas mostram a faixa, o resultado (Haki do Rei, Room, Observação) no diário e no leitor de tela, para os dois jogadores. A célula revelada por Observação aparece no radar. A técnica não é mais gasta numa célula padrão quando nenhuma foi escolhida, nem disparada com uma jogada ainda sem resposta; usa a tripulação comprometida, não a da aba Combate.
- **Bênçãos**: abrir a bênção ganha na tela de vitória não apaga mais o cartaz e o botão de revanche. A janela abre por cima, fecha com Esc e devolve o foco. Cartões respondem a Enter e Espaço. Bênção bloqueada aparece como bloqueada; todas dizem que são relíquias de coleção.
- **Den Den Mushi com o painel recolhido** abre as reações sobre o tabuleiro em vez de reabrir o painel.
- **Sombra dos próprios navios nas águas inimigas** (convidado): a espuma da frota posicionada no lobby ficava na placa que vira o mar inimigo.
- **Radar no celular**: o radar das águas inimigas cabe inteiro na tela, com FOGO e técnica acima dele. Escolha entre "Águas Inimigas" e "Ambas" (lembrada no aparelho).
- **Contorno do seletor focado** não é mais cortado na borda direita do painel.
- **Celular fechando o jogo**: as 64 ilustrações somavam 47 MB e eram decodificadas em tamanho cheio (um retrato de 1024 px para um ícone de 48 px). Agora são geradas no tamanho em que aparecem (5,7 MB). A perda do contexto 3D é tratada: a cena volta e uma partida online recarrega e retoma.
- Céu de Marineford e mares sem imagem própria pediam um arquivo inexistente (404).
- Código de sala digitado numa página sem acesso às salas online agora explica por quê.

### Adicionado
- **Jogo publicado no GitHub Pages** (`.github/workflows/pages.yml`), sem servidor e sem instalação.
- **PvP entre aparelhos em qualquer rede, por WebRTC** (`PeerTransport` em `src/net/transport.js`): o aparelho que cria a sala é o centro dela, guarda o log e retransmite os eventos; o convidado entra pelo link, QR Code ou código. Anfitrião e convidado podem recarregar a página e voltar para a partida. Escolhido automaticamente em páginas https sem servidor do jogo; o Wi-Fi local e o Artifact continuam como antes.

### Corrigido
- **PvP no Wi-Fi entre aparelhos**: "Comprometer Frota" não iniciava a partida. A presença (heartbeat) entrava no log da sala e reconstruía a aba Online várias vezes por segundo, trocando o botão sob o dedo. Presença agora é só retransmitida.
- **Convidado via QR Code** abria uma instância igual à do anfitrião (QR Code, "Criar Sala", "Excluir Sala"). O QR Code só aparece para o anfitrião de uma sala com vaga; o convidado vê apenas a sala em que entrou.
- Entrar em uma sala inexistente ou cheia criava uma sala fantasma; agora é recusado com mensagem.

### Alterado
- **Salas no Wi-Fi**: só o aparelho que criou a sala pode excluí-la (prova guardada no servidor); "Limpar Salas" saiu do Wi-Fi e o servidor recusa apagar todas. Excluir pede confirmação com um segundo toque. Salas cujo anfitrião sumiu saem de "Salas Abertas" sozinhas e voltam se ele retornar.
- **Wi-Fi sem internet**: o servidor Wi-Fi entrega three.js (`tools/vendor`) e as fontes (`assets/fonts`, baixadas por `npm run fonts`) a partir do próprio computador.
- Publicações no servidor Wi-Fi são repetidas em caso de falha e avisam na tela se não chegarem.

### Testes
- `tests/lan-server-test.js` e `tests/peer-transport-test.js`: assentos (evento sem prova, assento alheio, segundo jogador, carimbo vindo do remetente).
- `tests/peer-transport-test.js`: regras do transporte WebRTC com um broker em memória.
- `tests/lan-server-test.js`: regras do servidor Wi-Fi sem navegador.
- `tests/lan-real-path-verify.js`: dois aparelhos pelo IP da rede, link do QR Code e cliques reais, com hosts externos bloqueados; roda no CI em job próprio.

## [2.0.0] - 2026-11-12

Fusão do piloto (regras, IA, interface, protocolo e áudio) com o renderer voxel próprio, PvP online real no Artifact publicado e build de arquivo único. Escopo em [docs/project/SCOPE-V2.md](docs/project/SCOPE-V2.md); auditoria em [docs/project/FINAL-REPORT.md](docs/project/FINAL-REPORT.md).

### Adicionado
- **Renderer pixel art próprio** (`src/render`, `src/world`): alvo de baixa resolução com upscale nearest, contornos por profundidade, paleta OKLab de 90 cores com dither Bayer, câmera ortográfica isométrica alinhada à grade e quatro iluminações (dia, crepúsculo, noite, tempestade).
- **Navios voxel** (`src/ships`): os 7 navios canônicos com velas, bandeiras, figuras de proa e tripulação, em tamanho legível na placa, com dano visível e afundamento.
- **Efeitos** (`src/fx`): arco do projétil, clarão do canhão, respingo, fogo, fumaça, tábuas, bolhas, fogos de vitória, clima com chuva e raios, mantendo cut-ins, tremor e onomatopeias do piloto.
- **PvP online no Artifact** (`src/net/transport.js`): transporte sobre `claude.use("db")` (salas, log de jogadas por autor, mural) e `claude.use("room")` (presença e reações), com regras de acesso que deixam cada jogador escrever só no próprio log. PvP desativa com aviso em PT-BR se a capacidade não estiver disponível.
- **Build de artefato** (`scripts/build-artifact.js`, `scripts/verify-artifact.js`): arquivo único com as 64 ilustrações recomprimidas em WebP (44,6 MB para 3,1 MB), só cdnjs e Google Fonts externos.
- **Trailer de divulgação** (`tools/trailer`): gravação quadro a quadro do próprio jogo com áudio sincronizado por amostra.
- **Repositório**: hook de pre-commit e CI contra vazamentos (`scripts/check-leaks.js`), `NOTICE.md`, `SECURITY.md`, mídia do README em `docs/media`.

### Corrigido
- Um evento com número de sequência gigante travava a partida online e impedia a vitória por ausência. O fold e o contador do cliente agora aceitam só sequências dentro de uma janela (teste 28 do protocolo).
- A câmera Mira Inimiga abria afastada demais e deixava as placas minúsculas.
- O aviso legal dizia que toda a arte era procedural; agora declara as ilustrações como arte de fã.

### Alterado
- Código da v1 (`logic`, `net`, `ui`, `audio`, `app`) movido para `legacy/` como referência.
- Documentos de processo movidos para `docs/project/`.

### Problemas conhecidos
- PvP online validado só contra o fake das regras de acesso, ainda não entre duas contas reais.
- 60 qps em celular e memória em sessão longa não medidos.
- Textos cortados em telas de celular e tablet; contraste baixo no tema claro.
- Timer de turno do PvP dispara na primeira célula livre, não numa aleatória.
- Revanche na mesma sala online não funciona.
- Campanha, bênçãos e perigos são cosméticos; adereços GLB, silhuetas dos STLs e manual ficaram fora.

## [1.0.0] - 2026-11-07

Marco inicial consolidado e auditado do **Grand Line Tactics — Batalha na Grand Line**, entregue em artefato autocontido de arquivo único (`index.html` e `grand-line-tactics.html`).

### Adicionado
- **Motor de Regras Determinístico (`src/logic/rng.js`, `src/logic/rules.js`, `src/logic/i18n.js`):**
  - PRNG `mulberry32` + hash `FNV-1a` 100% determinístico (zero chamadas `Math.random()` na lógica).
  - 3 tamanhos de tabuleiro (*Escaramuça* 8×8, *Clássica* 10×10, *Grand Line* 12×12), 7 navios canônicos e 6 tripulações com técnicas exclusivas no *Modo Tático* (*Bazooka*, *Tremor*, *Haki do Rei*, *Room*, *Vórtice* e *Haki de Observação*).
  - Regras opcionais (*Salva*, *Continuar ao acertar*, *Permitir navios encostados*, *Neblina de Guerra*), formatos Melhor de 1 / 3 / 5 e cálculo de recompensas em Berries com pôster `WANTED`.
- **Inteligência Artificial em 4 Níveis (`src/logic/ai.js`, `tests/sim-headless.js`):**
  - Dificuldades *Grumete*, *Marujo*, *Capitão* (paridade xadrez + caça direcional) e *Yonkou* (mapa de densidade de probabilidade sobre navios sobreviventes + memória de viés em séries MD3/MD5), validadas em 8.000+ partidas *headless*.
- **Cena 3D & Pós-Processamento (`src/render/*.js`):**
  - Placas oceânicas flutuantes com ondas Gerstner, cachoeiras de borda, 4 climas/horários (*Dia*, *Entardecer*, *Noite*, *Tempestade*), marcos da Grand Line (*Reverse Mountain*, *Skypiea*, *Sabaody*, *Marineford*, *Laboon*, *Reis dos Mares*, *Big Den Den Mushi*) e sistema *Doll's-house lift* em 8 setores.
  - Pós-processamento GLSL com detecção de bordas por profundidade/luminância e quantização OKLab de 90 cores.
- **Multiplayer Online, Wi-Fi Local (LAN) & Anti-Trapaça SHA-256 (`src/logic/protocol.js`, `src/net/transport.js`, `scripts/lan-server.js`):**
  - Protocolo *commit-reveal* SHA-256 (`fleet + salt`) com auditoria automática de integridade pós-jogo, reconexão, *timeout* determinístico e modo espectador.
  - Servidor zero-dependência HTTP + SSE (`scripts/lan-server.js` e atalho `jogar-no-wifi.cmd`) para partidas entre dispositivos diferentes no mesmo Wi-Fi (PC, celular e tablet).
  - Gerenciamento de salas abertas (`✕` individual, `Limpar Salas` e `Excluir Sala`) e reações em tempo real via **Den Den Mushi** (lobby e batalha ativa, com som e balões de fala).
- **Áudio Web Audio Procedural & Acessibilidade WCAG 2.2 AA (`src/audio/sfx.js`, `src/ui/ui.js`):**
  - Efeitos sintetizados (canhões, impacto, naufrágio, Den Den Mushi, moedas) e *Sea Shanty* procedural.
  - Navegação completa por teclado, radar tático 2D semântico (`<table>`), `aria-live`, temas *Escuro Abissal* e *Pergaminho Claro* e suporte a `prefers-reduced-motion`.
- **Documentação Diátaxis & Auditoria 10 Lentes (`docs/`, `reviews/audit-plan-full.md`):**
  - Guias estruturados em `tutorials/`, `how-to/`, `reference/` e `explanation/`, além de suítes automatizadas (`45/45` regras, `16/16` protocolo PvP, `30/30` E2E navegador e `10/10` E2E LAN).
