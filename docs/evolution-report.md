# Raio-X e Plano de Evolução — Grand Line Tactics

- **Diretório:** `grand-line-tactics/` (branch `feat/pwa-mobile-and-live-score`, commit `771238a`)
- **Trilha / Engine atual:** `game-3d` (instalável como `pwa-app`) / three.js **r128** (global `THREE` via cdnjs), sem bundler
- **Resultado de `check_project_surface.py . --offline --mobile`:** `[PASS] 0 finding(s)`

## 1. Raio-X Atual

- **Entrypoints:** `index.html` (= `grand-line-tactics.html`, arquivo único de 1,4 MB) gerado por `scripts/build.js` (4.397 linhas: concatena `src/**` e guarda todo o CSS em `getStyles()`); `sw.js` gerado a partir de `src/sw/sw.js`; `manifest.webmanifest`.
- **Áreas em `src/`:** `logic` (rules, ai, protocol, rng, i18n), `net` (transport), `ui` (ui.js, app-shell, qrcode), `render`, `world`, `sea`, `ships`, `fx`, `audio`, `pilot-render`, `sw`. Cerca de 41 mil linhas no total.
- **Arquivos maiores:** `src/ui/ui.js` com **6.929 linhas**, `src/net/transport.js` com 2.807, `src/logic/protocol.js` com 2.172.
- **Dependências:**
  - Runtime: three.js r128, PeerJS e Google Fonts, todos de CDN.
  - Desenvolvimento: só `playwright`.
  - Áudio: Web Audio procedural (`src/audio/sfx.js`).
- **PWA:**
  - Manifesto completo: `id`, `display: fullscreen`, ícones `any` e `maskable`.
  - Service Worker escrito à mão: a página é network-first; assets e CDN são cache-first com versão por deploy.
  - Wake Lock, vibração e `viewport-fit=cover`.
  - `100vh` com fallback seguido de `100dvh`.
- **Testes:**
  - Headless em Node: rules 46, pvp-protocol 29, artifact-db 21, qr 17, lan-server 32, peer-transport.
  - Playwright: e2e 50, LAN e2e 11, LAN real path 17.
  - Mais o leak check no pre-commit.
- **Ferramentas paralelas:** `tools/` (`build.js` multi-script, harness `?demo=&t=`, shot, smoke, trailer) e `legacy/` ainda são usados pelos scripts `test:legacy`, `build:demo`, `trailer`, `smoke` e `baseline`.

## 2. Achados por Pilar

### 2.1 Arquitetura e desacoplamento (`04-arquitetura-jogos.md`)

- **`src/logic/` está limpo.** Nenhuma referência a DOM ou THREE, e não usa `Math.random` (a única ocorrência fica em `rng.js`, como semente). Roda headless. **OK.**
- **`src/net/transport.js` mistura protocolo de transporte com browser.** Lê `window.__GLT_LAN_CONFIG__`, `BroadcastChannel`, `localStorage` e o evento `storage` (32 referências). Isso viola a regra 4 do próprio `ARCHITECTURE.md`, que só permite exceções em `probe()` e `shareLink()`. Os testes contornam o problema com fakes.
- **`src/ui/ui.js` virou god module.** No mesmo arquivo estão:
  - o loop de render;
  - a máquina de estados da partida PvP (`handlePvpStateChange`);
  - HUD, placar, minimapa e cerimônia;
  - lobby e QR.

  Há 65 usos de `innerHTML`. Toda correção recente (placar ao vivo, assentos) caiu nesse arquivo.
- **O contrato está desatualizado.** `ARCHITECTURE.md` descreve `tools/build.js` com um `<script>` por módulo e areas `app/`. O que vai para produção é `scripts/build.js` com `GLT.ui` como controlador. Hoje existem dois sistemas de build convivendo.
- **Loop:** `dt` limitado a 0,1 s e `rAF` (o navegador já estrangula em aba oculta). Atende ao objetivo sem acumulador de passo fixo, o que é aceitável para um jogo por turnos.

### 2.2 Saúde de engine e dependências (`01-roteamento-engines.md`)

- **three.js r128 (2021) está bem atrás da referência** (r187+, com WebGPU/TSL).
- **Migrar não é trivial.** O build global `three.min.js` deixou de existir após a r160; seria preciso ESM com importmap ou bundler e revisar materiais e geometria.
- **O ganho seria pequeno.** O visual é voxel e pixel art, sem shader pesado, então WebGPU/TSL acrescenta pouco aqui.
- **Recomendação:** manter a r128 fixa por enquanto e só avaliar na Onda 3.
- Nada de `kaboom`, nada obsoleto além da versão da three.js.

### 2.3 PWA, offline e mobile (`02` + `03`)

- **Atende:** manifesto, SW, safe-area, `dvh` com fallback, wake lock, vibração e orientação livre.
- **Alvos de toque:** não há nenhuma regra `@media (pointer: coarse)`; existem mínimos de 40 e 42 px. A referência pede 44×44 em touch, com hit area expandida por `::after`.
- **Custo de dados:** com a página network-first, cada abertura online baixa até 1,4 MB. Dá para avaliar ETag/304 no host (GitHub Pages já envia) antes de mudar a estratégia. Não é urgente.
- **Modais:** são `div` com foco gerenciado à mão; não usam `<dialog>` nem Popover. A referência recomenda `<dialog>`.
- **Polling em aba oculta:** falta verificar se o relay LAN e o PeerJS pausam o polling quando `document.hidden`. O `sfx` e o app-shell já tratam `visibilitychange`.

### 2.4 Áudio, física, rede e game feel (`05`)

- **Rede:** commit-reveal SHA-256 com P2P/relay. A própria referência cita este projeto como padrão. **OK.**
- **Áudio:** Web Audio procedural, zero download. Equivale ao ZzFX. **OK.**
- **Game feel:** vibração ao acertar e afundar já existe. Falta checar se partículas e câmera respeitam `prefers-reduced-motion`; só há 2 regras CSS, nenhuma no JS.

## 3. O que Preservar (Intocável)

- `src/logic/` inteiro: rules, ai, protocol com commit-reveal e rng, mais as suítes headless.
- Protocolo PvP e relay LAN (`scripts/lan-server.js`). Os bugs de Wi-Fi e QR das rodadas anteriores já foram corrigidos e testados.
- O build em arquivo único (`scripts/build.js`) e o deploy no GitHub Pages.
- O shell PWA recém-feito: `app-shell.js`, `sw.js`, manifesto e layout em paisagem.
- Todas as suítes Playwright (e2e, LAN, real path) e o leak check.
- Assets e estética voxel/pixel.

## 4. Roadmap Incremental de Evolução

### Onda 1 — quick wins (baixo risco, 1 sessão)

1. **Alvos de toque:** bloco `@media (pointer: coarse)` em `getStyles()` com hit area de 44×44 via `::after`. Afeta botões de HUD, chips e células do tabuleiro.
2. **Movimento reduzido:** na Fase 2 vi que o JS já respeitava a preferência via `GLT.prefs.reducedMotion()` em câmera, tiros, partículas e luz. A busca da Fase 0 só olhou o CSS. Faltavam os fogos: o clarão saiu e a salva rápida virou no máximo 1 por segundo.
3. **Polling em background:** verificado na Fase 1 e **sem mudança**. O relay LAN é push (SSE) e o PeerJS só manda keepalive. Pausar derrubaria a partida (regra R4).
4. **Contrato:** atualizar `ARCHITECTURE.md` para o build real (`scripts/build.js`, `GLT.ui`). `tools/` e `legacy/` passam a ser "ferramentas de captura e legado", sem apagar nada.

### Onda 2 — refatoração estrutural (média, 2 a 3 sessões, sempre com as suítes verdes)

1. **Fatiar `ui.js` sem mudar comportamento:**
   - `ui/match-pvp.js`: estado PvP e `handlePvpStateChange`.
   - `ui/hud.js`: placar, minimapa e esquadra.
   - `ui/lobby.js`: on-line e QR.
   - `ui/ceremony.js`.

   `GLT.ui` continua como fachada.
2. **Separar o transporte:** `net/transport.js` fica com o núcleo headless e ganha um adaptador de browser (`net/transport-browser.js`) com `window`, `localStorage` e `BroadcastChannel` injetados.
3. **`innerHTML`:** trocar os 65 usos por `textContent` ou `createElement` onde houver dado de rede (o nome do rival, por exemplo).

### Onda 3 — novas features e empacotamento (opcional)

1. Modais em `<dialog>` nativo.
2. Play Store via TWA/Bubblewrap, já que o PWA é instalável e funciona 100% na web.
3. Spike, em branch separada, de migração para three.js ESM recente, só se surgir uma necessidade visual que a r128 não atenda.
