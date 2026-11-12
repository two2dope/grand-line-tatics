# Explicação: Direção Visual OKLab, Determinismo e Inteligência Artificial

Este documento detalha as decisões arquiteturais e estéticas que sustentam a identidade visual pixel-art 3D, o enquadramento isométrico responsivo e a progressão algorítmica da IA em **Grand Line Tactics**.

---

## 1. Pipeline Pixel-Art 3D Inspirado em *Sea of Stars*

Diferentemente de cenas Three.js convencionais que dependem de texturas bitmap de alta resolução e *anti-aliasing* MSAA, **Grand Line Tactics** constrói toda a sua estética por meio de geometria voxel mesclada e um *post-pass* dedicado em GLSL (`src/render/palette-shader.js`):

1. **Renderização em Baixa Resolução (`WebGLRenderTarget` com Textura de Profundidade):**
   - A cena é renderizada em uma fração da resolução nativa controlada pelo seletor *Escala de Pixel 3D* (padrão `2px`) e ampliada com `THREE.NearestFilter`, garantindo pixels perfeitamente nítidos.
   - O controlador ortográfico (`IsometricCameraController`) alinha a posição da câmera à grade de sub-pixels a cada quadro, eliminando a cintilação (*pixel swimming*) típica de câmeras isométricas em movimento suave.
2. **Quantização Perceptual em OKLab + Matriz de Bayer 4×4:**
   - Comparar cores diretamente em RGB produz transições acinzentadas e desvios de matiz nas sombras da água. Por isso, o *fragment shader* converte cada pixel iluminado para o espaço perceptual **OKLab**, aplica um leve deslocamento ordenado via matriz de **Bayer 4×4** e seleciona a cor mais próxima dentre **90 cores curadas** (18 rampas de 5 tons).
   - As rampas oceânicas combinam safira abissal (`#061326`), cerúleo de lagoa (`#178ca8`), turquesa cristalino (`#38c6b0`) e espuma costeira suave (`#bcf9ff`), preservando a separação visual imediata contra navios de madeira e marcadores de tiro sem estourar para branco puro sob sol direto.
3. **Contornos de Profundidade e *Doll's-House Lift*:**
   - Um operador Sobel sobre o `DepthTexture` desenha contornos escuros nos degraus de silhueta (cascos, velas, penhascos e cachoeiras).
   - O anel panorâmico externo (Red Line, Marineford, Sabaody, Skypiea) é fatiado em **8 setores angulares**: os setores posicionados entre a câmera e as placas oceânicas erguem-se suavemente e ficam ocultos quando a opção *Erguer cenário próximo* está ativa, enquanto o setor sudeste mantém um canal aberto de recifes baixos para não obstruir a vista panorâmica durante a cerimônia.

---

## 2. Enquadramento Isométrico Consciente da Proporção (`minWorldWidth`)

Como o jogo divide a tela entre o *viewport* 3D à esquerda e o Console Náutico de Comando (`420px`) à direita, a janela 3D frequentemente assume proporções quase quadradas (`aspect ≈ 1.1`). Uma câmera ortográfica com altura fixa (`baseFrustumSize`) cortaria as extremidades laterais das duas ilhas flutuantes.

Para resolver isso de forma matematicamente exata, cada predefinição de câmera define tanto `frustumSize` (altura mínima no mundo) quanto `minWorldWidth` (largura mínima garantida no mundo — ex.: `60m` em *Duas Águas* e `96m` em *Panorama*). Quando `frustumSize * aspect < minWorldWidth`, o controlador expande automaticamente o *frustum* para `minWorldWidth / aspect`, mantendo ambas as placas marítimas e o telão do **Big Den Den Mushi** integralmente enquadrados em qualquer monitor ou celular.

---

## 3. Determinismo Estrito (`mulberry32`)

Nenhuma regra de jogo, sorteio de moeda, posicionamento automático ou decisão da IA utiliza `Math.random()`. Toda aleatoriedade deriva de uma semente de partida processada por hash `FNV-1a` de 32 bits e alimentada no gerador **`mulberry32`** (`src/logic/rng.js`).

O método `.fork(label)` cria sub-fluxos determinísticos independentes para cada turno e subsistema (ex.: posicionamento da frota inimiga, escolha da IA, coordenada revelada pelo *Haki de Observação*). Isso garante:
- Reprodutibilidade exata de qualquer partida em testes automatizados;
- Consenso determinístico no sorteio inicial e nos *timeouts* do modo Online PvP.

---

## 4. Arquitetura dos 4 Níveis de IA e Memória de Série

O módulo `src/logic/ai.js` modela uma curva real de maestria tática:

1. **Grumete:** Dispara uniformemente sobre coordenadas não tentadas e posiciona sua frota de modo aleatório.
2. **Marujo (Caça & Alvo):** Alterna imediatamente do modo de busca para uma fila ortogonal de caça assim que obtém um acerto, afundando embarcações feridas antes de retomar a patrulha.
3. **Capitão (Paridade Dinâmica + Alinhamento Colinear):** Restringe a patrulha às casas de paridade compatíveis com o menor navio inimigo sobrevivente (`(r + c) % minLen === 0`) e prioriza o eixo colinear assim que dois acertos consecutivos revelam a orientação do casco.
4. **Yonkou (Densidade de Probabilidade + Aprendizado em Série):**
   - A cada turno, enumera todas as colocações válidas possíveis de todos os navios inimigos ainda não afundados que sejam consistentes com o mapa atual de acertos e erros, somando uma matriz de densidade de probabilidade exata sobre o tabuleiro.
   - Em séries **Melhor de 3 (MD3)** ou **Melhor de 5 (MD5)**, `recordOpponentPlacement` acumula um mapa de calor das regiões onde o jogador humano costuma esconder sua esquadra (cantos, bordas ou centro) e pondera a densidade de busca das partidas subsequentes para punir padrões repetitivos.

