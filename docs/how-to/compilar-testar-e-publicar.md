# Guia Prático: Como Compilar, Testar e Publicar o Artefato

Este guia orienta desenvolvedores e mantenedores na geração dos artefatos de arquivo único, execução das baterias de testes *headless*, captura automatizada de screenshots via Chrome DevTools Protocol (CDP) e publicação do aplicativo.

---

## Pré-requisitos

- **Node.js 18+** (nenhum pacote `npm` ou `node_modules` é necessário).
- **Google Chrome** ou **Microsoft Edge** instalado localmente (utilizado apenas pelos scripts de captura visual e verificação E2E *headless*).

---

## 1. Como Recompilar os Artefatos de Arquivo Único

Sempre que editar qualquer módulo em `src/` ou estilos em `scripts/build.js`, execute:

```powershell
node scripts/build.js
```

O script valida a presença dos 12 módulos-fonte na ordem estrita de dependência e gera dois arquivos idênticos bit a bit na raiz:

- `index.html` — Ponto de entrada principal para hospedagem estática (GitHub Pages, Vercel, Netlify, Cloudflare Pages).
- `grand-line-tactics.html` — Artefato nomeado para publicação como Artifact (PvP online via `claude.use("db")` + `claude.use("room")`; ver `PUBLISH-NOTES.md`).

---

## 2. Como Executar as Baterias de Testes

### 2.1. Regras Puras, PRNG e Internacionalização PT-BR

Verifica determinismo do `mulberry32`, dicionário `GLT.T`, validação geométrica de navios, modos Salva / Continuar ao acertar / Neblina, fórmula de recompensas em Berries e todas as 6 técnicas táticas:

```powershell
node tests/rules-test.js
```

### 2.2. Simulação Estatística da IA (8.000+ Partidas Headless)

Executa milhares de jogos *headless* por combinação de dificuldade (*Grumete*, *Marujo*, *Capitão*, *Yonkou*) e valida que a distribuição média de tiros até a vitória respeita estritamente os degraus de habilidade e o aprendizado em série:

```powershell
node tests/sim-headless.js
```

### 2.3. Protocolo Online PvP & Injeção de Falhas / Trapaças

Valida convergência com perda/duplicação/reordenação de eventos, reconexão após recarregamento, *timeout* de turno, visão de espectador sem vazamento de coordenadas e detecção de adulteração criptográfica SHA-256:

```powershell
node tests/pvp-protocol.js
node tests/artifact-db-test.js
```

Os testes 19–21 do protocolo e `artifact-db-test.js` rodam o `ArtifactDbTransport` sobre o dublê `tests/fakes/claude-fake.js` (db/room/user) com latência, gravações perdidas, confirmações perdidas, snapshots duplicados e recarregamento no meio da partida.

### 2.4. Verificação End-to-End no Navegador (Headless Chrome)

Sobe um servidor HTTP estático local efêmero, conecta duas abas reais do Chrome via WebSocket CDP e valida:
1. Paridade de bytes, `<html lang="pt-BR">`, `color-scheme`, ausência de bloqueio de zoom e pureza de `src/logic/*.js`.
2. Controles de preparação, retratos procedurais, seletores acessíveis com `<label for>` e doca interativa.
3. Partida completa Jogador vs CPU até a cerimônia com pôster `WANTED` sem congelamentos.
4. Sincronização 3D e 2D das técnicas *Bazooka*, *Tremor*, *Observação* e *Vórtice*.
5. Persistência do placar em séries Melhor de 3 (`MD3`).
6. Duelo Online PvP real entre duas abas independentes (`Criar Sala` → `Entrar` → `Comprometer SHA-256` → `Tiro e Resposta Sincronizados`).
6B. O mesmo duelo como artefato publicado: o dublê de `window.claude` é injetado antes dos scripts, com falhas e recarga de uma aba no meio da partida; mais uma aba onde `use("db")` resolve `null` (PvP indisponível, PvC jogável).

```powershell
node tests/e2e-gameplay-verify.js
```

---

## 3. Como Atualizar as Capturas Visuais de Referência

Para regerar as 10 capturas oficiais (`references/captures/01-*.png` a `10-*.png`) usando perfis temporários isolados em `os.tmpdir()`:

```powershell
node scripts/capture-scene.js
node scripts/verify-index.js
```

---

## 4. Como Publicar em Produção

Como `index.html` contém todo o CSS, shaders GLSL, lógica, áudio procedural e interface concatenados (dependendo externamente apenas de `three.min.js` r128 via `cdnjs` e `Google Fonts`):

1. Execute `node scripts/build.js` e confirme `0` falhas em `node tests/e2e-gameplay-verify.js`.
2. Publique o diretório raiz (ou apenas `index.html`) em qualquer serviço de hospedagem estática HTTPS.
3. Publicado como Artifact (declaração de `capabilities` e regras em `PUBLISH-NOTES.md`), o PvP usa `ArtifactDbTransport` sobre `claude.use("db")` + `claude.use("room")`; se `use("db")` resolver `null`, a aba Online mostra "Duelo online indisponível" e o PvC segue normal. Em hospedagem estática comum, o PvC funciona 100% offline e o PvP opera entre abas via `BroadcastChannel` / `localStorage` ou pelo servidor Wi-Fi/LAN.

