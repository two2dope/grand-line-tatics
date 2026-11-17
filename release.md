# Receita de Release — Grand Line Tactics

> Compatível com a skill `release-app`. Seguir estritamente na ordem: Pré-voo → Evidência → Gate → Publicação → Pós-publicação.
> Alvo: GitHub Pages (`.github/workflows/pages.yml`, dispara em push na `main`) → https://two2dope.github.io/grand-line-tatics/
> Wrapper mobile: nenhum (PWA instalável). Sem artefato empacotado, então sem SHA-256.

## Pré-voo
- `git fetch origin` e confirmar que a branch contém `origin/main` (`git merge-base --is-ancestor origin/main HEAD`); worktree limpo, exceto `reviews/`, que não é versionada.
- `npm run test:unit`: rules 46, pvp-protocol 29, artifact-db 21, qr 17, lan-server 32, peer-transport 43.
  - Se `pvp-protocol` falhar nos testes 27/28 enquanto browsers rodam em paralelo, rode a suíte sozinha. Ela é sensível a carga.
- `python ~/.claude/skills/game-over/scripts/check_project_surface.py . --offline --mobile` sem achados.
- `npm run build`, depois `npm run test:e2e`, `npm run test:lan` e `npm run test:lan:real` sem falhas novas.
- `npm run check:leaks` passa. O hook de pre-commit também roda.

## Evidência
- Capturas Playwright em desktop (`1280x720`) e celular (`390x844` retrato e `844x390` paisagem), com toque (`hasTouch`, `isMobile`).
  - Use `Page.captureScreenshot` via CDP, porque o `page.screenshot` trava esperando as fontes.
  - Nenhum controle visível abaixo de 44×44 em toque. As células do radar estão isentas (ver `docs/web-guidance-rules.md` R1).
- Zero `console.error`/`pageerror`. As suítes e2e já falham nesse caso.
- PWA: depois da primeira visita, recarregar offline abre o jogo e a partida contra a IA. Conferir `sw.js` gerado com a `VERSION` nova.
- No celular físico, depois do deploy:
  1. instalar pela tela inicial;
  2. tela cheia deitado;
  3. PvP entre dois aparelhos com placar ao vivo;
  4. tocar nos ícones do topo, nas pílulas da câmera e nas abas.

## Gate
- Mostrar um resumo de 1 tela: versão, o que entra, testes e evidência.
- Aguardar frase explícita do operador: `Publicar vX.Y.Z`. Para build de teste sem tag, basta um pedido explícito de publicar.

## Publicação
- A partir de worktree limpo:
  1. PR da branch para `main`;
  2. merge, que dispara o workflow `Pages`;
  3. acompanhar com `gh run watch` até concluir;
  4. abrir a URL e conferir que o `sw.js` mudou de `VERSION`.
- Release versionada: `git tag vX.Y.Z` na `main` depois do merge, e mover o bloco `[Não lançado]` do `CHANGELOG.md` para `[X.Y.Z] - AAAA-MM-DD`.

## Pós-publicação
- Atualizar o `CHANGELOG.md` se algo mudou depois do PR.
- Anotar uma linha no cofre (`Raw/Notas/`): data, commit e o que foi testado no aparelho.
