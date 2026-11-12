# Segurança

## Relatar uma falha

Abra um [aviso de segurança privado](../../security/advisories/new) no GitHub. Não publique detalhes em issues abertas antes da correção.

Interessam em especial:

- formas de trapacear no PvP online: ver a frota do rival antes do fim, forjar respostas, travar a partida ou ganhar sem jogar;
- escrita no `db` do Artifact fora do próprio log de jogadas;
- qualquer dado pessoal exposto pelo jogo.

## Como o PvP se protege

- A frota nunca sai do aparelho do dono durante a partida. Cada jogador publica só um compromisso SHA-256 da frota com um sal aleatório.
- No fim, as duas frotas são reveladas e cada cliente confere o compromisso e todas as respostas registradas. Qualquer divergência dá "Trapaça detectada" e a vitória ao outro jogador.
- O log de jogadas é append-only, com número de sequência limitado a uma janela, e cada evento é conferido contra o assento do autor autenticado.
- As regras de acesso do `db` deixam cada jogador escrever só no próprio log. A declaração e os riscos conhecidos estão em [docs/project/PUBLISH-NOTES.md](docs/project/PUBLISH-NOTES.md).

## Repositório

- O hook `.githooks/pre-commit`, ativado pelo `npm install`, bloqueia commits com chaves, tokens, caminhos pessoais, e-mails, pastas locais e arquivos grandes. O CI repete a checagem a cada push.
- Para rodar à mão: `npm run check:leaks`.
