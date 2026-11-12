# SCOPE-V2 — fusão do piloto `grand-line-shot` com `grand-line-tactics`

Data: 2026-11-11. Complementa SPEC.md (que continua valendo). Em conflito, este arquivo vence.

## Diagnóstico

| Área | Piloto (`../grand-line-shot`) | Nosso (`grand-line-tactics`) | Decisão |
|---|---|---|---|
| Regras, IA, protocolo PvP, transporte | Completos, testados (45/45 regras, 16/16 PvP, sim 10.400 jogos nas faixas) | rules-core pronto (92 testes), IA/net stubs | **Base = piloto** |
| UI, i18n, lobby, áudio, a11y | Completos e polidos (5k linhas ui.js) | stubs | **Base = piloto** |
| Campanha, bênçãos, perigos, frotas temáticas, manual, rendição, LAN Wi-Fi, cut-ins, shake, onomatopeias | Existem | Não existem | **Entram no escopo** |
| Cena 3D (navios, placas, água, FX, pós-processo) | Fraca: navios minúsculos, água ruidosa, poluída | Forte: navios voxel reconhecíveis, FX, paleta/dither | **Nosso render substitui o do piloto** |
| PvP no artefato publicado | Transporte adivinha APIs inexistentes (`window.artifactState`, `window.sharedState`) | — | **Reescrever sobre `claude.use("db")` + `claude.use("room")`** |
| Arquivo único | HTML 996 KB + 56 MB de imagens externas referenciadas | — | **Build de artefato embute versões comprimidas ≤ 12 MB** |

## Regras de trabalho

- NUNCA modificar `../grand-line-shot` (somente leitura). Copiar para dentro de `grand-line-tactics`.
- Usar a árvore de trabalho do piloto (inclui mudanças não commitadas de navios glTF) e conferir o branch `feat/v2.0-minishoot-chibi`: ele tem 24 commits fora do `main` (ações em tablet, rematch PvP, transparência de regras). Trazer o que for melhor e não regredir.
- O jogo precisa continuar jogável e com as suítes verdes ao fim de cada etapa.
- Nosso código antigo de `src/logic`, `src/net`, `src/ui`, `src/audio`, `src/app` vai para `legacy/` (referência). `src/render`, `src/world`, `src/ships`, `src/fx` permanecem e passam a alimentar o jogo.

## Etapas

1. **Port**: piloto vira a base em `grand-line-tactics` (src, scripts, tests, docs, assets usados). Suítes do piloto verdes aqui.
2. **Navios**: `GLT.shipsVoxel.createShipMesh / createGhostShipMesh / updateShip / setShipDamage / startShipSinking` passam a usar nossos modelos voxel (`src/ships`), com tamanho legível na placa. Frotas temáticas por tripulação preservadas.
3. **Mar e cenário**: placas, água, iluminação, pós-processo (paleta OKLab + dither + contornos) e anel de fundo com a qualidade do nosso `src/render` + `src/world`. Menos ruído, mais legibilidade.
4. **FX**: tiro, respingo, fogo, afundamento, fogos, cerimônia com nosso `src/fx`, mantendo cut-ins, shake e onomatopeias do piloto.
5. **Online no artefato**: transporte real sobre `db` (log de jogadas append-only, salas, commit-reveal) + `room` (presença, reações). Manter LAN/BroadcastChannel como alternativas. PvP desabilita com mensagem PT-BR se a capability for `null`.
6. **Build de artefato**: `dist/grand-line-tactics.html` único, imagens recomprimidas e embutidas, total ≤ 12 MB, só cdnjs (three r128) + Google Fonts externos.
7. **Auditoria final**: SPEC.md + SCOPE-V2.md item a item, matriz de screenshots, relatório.

## Assets 3D novos do piloto (`../grand-line-shot/assets/3D`, somente leitura)

Adicionados pelo usuário depois do último commit. Uso decidido:

- **STLs de navios da série** (`NoAMS(almost)_stls.zip` = Thousand Sunny, `[锤子]极地潜水号-P1S_stls.zip` = Polar Tang, `海上餐厅-单色部分_stls.zip` = Baratie, `莫比迪克_stls.zip` = Moby Dick): modelos de impressão 3D, 6 a 217 MB, licença desconhecida. **Não embutir nem converter para o jogo.** Etapa 2 (navios): extrair para uma pasta temporária fora do repositório do piloto, renderizar vistas (lateral, 3/4, topo) e usar só como **referência de silhueta e proporção** para corrigir nossos modelos voxel desses quatro navios. O critic da etapa 2 compara nossos voxels com essas vistas.
- **GLBs low-poly genéricos** (Quaternius, Kenney, Poly by Google, Braden Brunk, Krzysztof Gryzka) e os de `assets/models/ships` (wreck, ghost, rowboats, barrel, cannon, rocks): usar como **embarcações e adereços de ambiente** na etapa 3 (frota da Marinha em Marineford, naufrágios, botes, barris, rochas). Nunca como navios jogáveis.
  - **Sem loader glTF em runtime.** Converter em tempo de build para geometria mesclada com cor por vértice (JSON/typed arrays compactos) que passa pelo nosso shader de paleta. Orçamento: ≤ 400 KB somados no arquivo final.
  - **Licenças:** conferir cada autor antes de usar. Quaternius e Kenney são CC0. Poly by Google costuma ser CC-BY (exige crédito). Se a licença de um modelo não for confirmável, não usar. Créditos vão para uma seção "Créditos" no manual do jogo e no README.

## Ilustrações

Decisão do usuário (2026-11-11): manter as ilustrações de personagens do piloto, com o aviso de tributo de fã no rodapé.

## Barra de qualidade

- Suítes: regras, protocolo PvP, sim headless nas faixas, E2E PvC/PvP, verify-index com zero erro de console.
- Visual: cada etapa visual precisa vencer, em comparação cega, o screenshot do piloto no mesmo estado; Sea of Stars (`ref/sea-of-stars/`) é a aspiração, não o critério de saída.
- Arte de personagens: as ilustrações do piloto retratam personagens de One Piece. Tributo de fã, sem assets oficiais; manter aviso legal no rodapé.
