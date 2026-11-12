# Referência Técnica: Arquitetura de Módulos, Regras e Protocolo PvP

Documento factual de referência sobre o grafo de módulos `GLT.*`, especificações da frota e das tripulações, cálculo de recompensas e esquema de eventos do protocolo criptográfico PvP.

---

## 1. Mapa de Módulos e Ordem de Concatenação

Todos os módulos exportam suas APIs sob o namespace global `globalThis.GLT` (e `module.exports` quando carregados em Node.js). Os módulos em `src/logic/` são **100% puros** (zero referências a `window`, `document`, `THREE` ou `Math.random`).

| Ordem | Arquivo | Namespace | Responsabilidade |
| :---: | :--- | :--- | :--- |
| 1 | `src/logic/rng.js` | `GLT.rng` | Hash `FNV-1a` (`hashString`), gerador `mulberry32` (`createRng`), `fork` e `coinToss`. |
| 2 | `src/logic/i18n.js` | `GLT.i18n`, `GLT.T` | Dicionário único `pt-BR`, pluralização e formatação monetária Berry (`฿`). |
| 3 | `src/logic/rules.js` | `GLT.rules` | Tabuleiros, navios, validação posicional, resolução de tiros/técnicas, neblina e recompensas. |
| 4 | `src/logic/ai.js` | `GLT.ai` | Quatro níveis de IA, posicionamento tático, bússola *Log Pose* e memória de série (`createSeriesMemory`). |
| 5 | `src/net/transport.js` | `GLT.transport` | Interface `ArtifactSharedTransport` (`publish`, `subscribe`, `read`, `heartbeat`) e `InMemoryTransport`. |
| 6 | `src/logic/protocol.js` | `GLT.protocol` | `foldMatchLog`, `PvpMatchClient`, SHA-256 commit-reveal (Web Crypto + fallback puro FIPS 180-4) e `verifyMatchIntegrity`. |
| 7 | `src/render/palette-shader.js` | `GLT.paletteShader` | Pós-processamento GLSL: bordas de profundidade/normal e paleta fixa de 90 cores em OKLab + Bayer 4×4. |
| 8 | `src/render/plates-lighting.js` | `GLT.platesLighting` | Placas marítimas voxel com ondas Gerstner, espuma costeira, iluminação de 4 climas e câmera isométrica responsiva. |
| 9 | `src/render/ships-voxel.js` | `GLT.shipsVoxel` | Geometria voxel mesclada das 7 embarcações canônicas, tripulação instanciada, avarias e naufrágio. |
| 10 | `src/render/backdrop-fx.js` | `GLT.backdropFx` | Anel panorâmico de 8 setores (*Doll's-house lift*), partículas balísticas, retratos pixel-art e pôster `WANTED`. |
| 11 | `src/audio/sfx.js` | `GLT.audio` | Efeitos sonoros sintetizados via Web Audio API e loop musical *chiptune sea shanty*. |
| 12 | `src/ui/ui.js` | `GLT.ui` | Console Náutico de Comando, sincronização 2D/3D, atalhos de teclado, acessibilidade ARIA e fluxo PvC/PvP. |

---

## 2. Formatos de Tabuleiro e Esquadra Canônica

### Formatos (`GLT.rules.BOARDS`)

| ID | Nome | Dimensão | Navios Incluídos (Comprimentos) | Total de Células |
| :--- | :--- | :---: | :--- | :---: |
| `escaramuca` | Escaramuça | 8×8 | `sunny` (4), `red_force` (3), `polar_tang` (3), `going_merry` (2) | 12 |
| `classica` | Clássica | 10×10 | `moby_dick` (5), `sunny` (4), `red_force` (3), `polar_tang` (3), `going_merry` (2) | 17 |
| `grand_line` | Grand Line | 12×12 | Todos os 7 navios (`5, 4, 4, 3, 3, 3, 2`) | 24 |

### Embarcações (`GLT.rules.SHIPS`)

| ID | Embarcação | Células | Características Visuais 3D |
| :--- | :--- | :---: | :--- |
| `moby_dick` | Moby Dick | 5 | Proa de baleia branca e brasão de Barba Branca nas velas. |
| `thousand_sunny` | Thousand Sunny | 4 | Carranca de leão dourada e convés gramado. |
| `oro_jackson` | Oro Jackson | 4 | Casco nobre em madeira de Adão avermelhada e canhões duplos. |
| `red_force` | Red Force | 3 | Galeão de guerra escarlate com dragão nórdico na proa. |
| `polar_tang` | Polar Tang | 3 | Submarino amarelo metálico; submerge ao afundar deixando mancha de óleo. |
| `baratie` | Baratie | 3 | Restaurante flutuante em forma de peixe com cozinheiros no convés. |
| `going_merry` | Going Merry | 2 | Caravela clássica com carranca de carneiro. |

---

## 3. Tripulações e Técnicas Táticas (`Modo Tático`)

Cada técnica pode ser acionada **uma única vez por partida** no *Modo Tático* e consome o turno do jogador:

| ID da Tripulação | Nome | Capitão | Técnica (`techId`) | Efeito Mecânico |
| :--- | :--- | :--- | :--- | :--- |
| `straw_hats` | Chapéus de Palha | Monkey D. Luffy | `bazooka` | Dispara simultaneamente em um bloco **2×2** (`(r,c)` até `(r+1,c+1)`). |
| `whitebeard` | Piratas do Barba Branca | Edward Newgate | `tremor` | Impacto sísmico em **cruz de 5 células** (centro + 4 vizinhos ortogonais). |
| `red_haired` | Piratas do Ruivo | Shanks | `haki_do_rei` | Sonar binário (**Sim/Não**) sobre área **3×3** detectando navios não afundados. |
| `heart` | Piratas do Coração | Trafalgar Law | `room` | Conta quantas células de navios sobreviventes existem na **Linha** ou **Coluna** escolhida. |
| `blackbeard` | Piratas do Barba Negra | Marshall D. Teach | `vortice` | Ergue barreira que **absorve integralmente** o próximo disparo ou rajada inimiga. |
| `marines` | Quartel-General da Marinha | Sakazuki (Akainu) | `observacao` | Revela deterministicamente **1 célula intacta** de uma embarcação inimiga sobrevivente. |

---

## 4. Fórmula de Recompensa (`calculateBounty`)

Ao término do combate, a recompensa em Berries (`฿`) exibida no cartaz `WANTED` é calculada a partir do desempenho do capitão:

$$\text{Recompensa} = \max\left(10.000.000,\ \text{round}_{100.000}\left((\text{Base} + \text{Precisão} + \text{Sequência} + \text{Eficiência}) \times M_{\text{dif}} \times M_{\text{tab}} \times M_{\text{modo}}\right)\right)$$

- **Multiplicadores de Dificuldade ($M_{\text{dif}}$):** Grumete `0,8×`, Marujo `1,0×`, Capitão `1,35×`, Yonkou `1,85×`.
- **Multiplicadores de Tabuleiro ($M_{\text{tab}}$):** Escaramuça `0,85×`, Clássica `1,0×`, Grand Line `1,35×`.

---

## 5. Protocolo Criptográfico Online PvP (`GLT.protocol`)

O estado da sala é derivado por redução pura e determinística (`foldMatchLog`) sobre um log imutável de eventos ordenados por número de sequência (`seq`):

1. **`ROOM_CREATED` / `ROOM_JOINED`:** Registra anfitrião (`playerIndex = 0`), desafiante (`playerIndex = 1`) ou espectadores (`role = 'spectator'`), além das regras e da semente pública da partida.
2. **`READY_COMMIT`:** Cada jogador publica apenas o hash `SHA-256(JSON.stringify(canonicalFleet) + ":" + salt)` — nenhuma coordenada de navio trafega pela rede durante a partida.
3. **`SHOT_FIRE` → `SHOT_ANSWER`:** O atacante anuncia `(r, c)` com `seq` monotônico; o defensor avalia contra sua frota local e responde `'water' | 'hit' | 'sunk' | 'absorbed'`.
4. **`TECH_FIRE` → `TECH_ANSWER`:** Suporta todas as 6 técnicas (*Vórtice*, *Bazooka*, *Tremor*, *Haki do Rei*, *Room* e *Observação*).
5. **`FLEET_REVEAL` → `verifyMatchIntegrity`:** No `game_over`, ambos revelam `{ fleet, salt }`. O verificador recalcula os dois hashes SHA-256 iniciais, valida a geometria das frotas (colinearidade, limites, sobreposição e adjacência) e reexecuta todo o histórico de tiros e técnicas para detectar qualquer resposta adulterada.

