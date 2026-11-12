# PUBLISH-NOTES — PvP online no Artifact publicado

Contrato de runtime: artifact-capabilities **0.2.96** (`claude.d.ts`, `db.d.ts`, `room.d.ts`, `user.d.ts`).
Código: `src/net/transport.js` (`ArtifactDbTransport`, `ARTIFACT_CAPABILITIES`, `detectTransportBackend`, `createTransportFor`).
A mesma declaração está exportada como `ARTIFACT_CAPABILITIES`, e o fake de teste (`tests/fakes/claude-fake.js`) aplica exatamente essas regras nas suítes Node e no E2E.

## 1. Declaração exata de `capabilities`

Passar no primeiro publish e em todo publish que mude o conjunto. Num redeploy, omitir o campo mantém a declaração guardada.

```json
{
  "db": {
    "rules": [
      { "path": "",             "read": "view", "write": "admin" },
      { "path": "rooms",        "read": "view", "write": "interact" },
      { "path": "bounties",     "read": "view", "write": "interact" },
      { "path": "moves",        "read": "view", "write": "owner" },
      { "path": "moves/{self}", "read": "view", "write": "interact" }
    ]
  },
  "room": { "topics": { "reaction": "interact" } },
  "user": {}
}
```

| Capability | Uso | Se `use()` resolver `null` |
|---|---|---|
| `db` | `rooms/{CÓDIGO}`: anúncio e descoberta da sala (`by` = anfitrião, `guest` = quem pediu a vaga). `moves/{uid}/{CÓDIGO}/cNNNN`: as jogadas **daquele autor** naquela partida, 64 eventos por doc. `moves/{uid}`: índice das partidas do autor, usado para a limpeza. `bounties/{playerId}`: mural casual | A aba Online mostra "Duelo online indisponível…" sem botões de criar/entrar. PvC intacto |
| `room` | `join("glt-<código>")`: presença como heartbeat e o tópico `reaction` para as reações predefinidas. Os dois são aceitos só quando o `by` carimbado pela plataforma é o uid do assento. Nada disso é gravado | Sem indicador de presença: o rival fica "aguardando" e não há reivindicação de ausência. As reações caem no log do próprio autor |
| `user` | `id()` é o autor: o segmento `{self}` de `moves/{self}` só aceita esse id | PvP fica **indisponível** ("não foi possível identificar sua conta…"), porque sem id ninguém consegue assinar jogadas. PvC intacto |

## 2. Regras do `db`: níveis e por quê

Fatos da plataforma (db.d.ts):
- `view` (Viewer, Commenter e **todo visitante logado de fora da organização**) nunca escreve, nem com regra.
- `interact` = Contributor (pessoa ou acesso geral) e membro da organização que chega por link público. `admin` = Editor e quem recebeu Owner. `owner` = só o dono do artifact.
- `{self}` vale sob qualquer prefixo, como último segmento, e cobre os docs abaixo dele. Na subárvore de outra pessoa vale só a regra do prefixo. A regra no prefixo de um `{self}` precisa declarar `read` **e** `write`.

Decisões:
1. **Raiz `write: admin`.** Ninguém abaixo de Editor cria coleções fora das três previstas.
2. **`moves` `write: owner` + `moves/{self}` `write: interact`.** Cada jogador só escreve em `moves/<seu id>/…`, e é a plataforma que garante isso. O caminho **é** o autor: o transporte carimba `_seat` a partir dele, nunca a partir do corpo, e o fold do protocolo (`isAuthorConsistent`) descarta qualquer evento que fale por outro assento. Um segundo `READY_COMMIT` por assento é ignorado, assim como um segundo `FLEET_REVEAL`. `TURN_TIMEOUT` vindo de autor autenticado também é ignorado. Um `GAME_OVER` só vale se for desistência do próprio autor ou reivindicação de ausência (item 6). `owner` no prefixo deixa só o dono moderar; com `admin`, qualquer Editor poderia reescrever logs alheios.
3. **Assentos.** O assento 0 é o `by` do anúncio, lido uma vez e depois **fixado** na sessão da aba (`hostUid` no `sessionStorage`; após o refresh, `pinRoomHost`). O assento 1 é o uid que o anfitrião grava num evento `SEAT_BIND` **no próprio log**. O anúncio `rooms/{CÓDIGO}` aceita escrita de qualquer pessoa em `interact`, então só serve para descoberta. Reescrevê-lo no meio da partida não muda ninguém de assento (teste 23 do protocolo, B10 da suíte db). Quem pede uma vaga já ocupada recebe "A sala … já tem dois capitães".
4. **`rooms` e `bounties` `write: interact`.** Criar o anúncio, pedir a vaga (`guest`), marcar `status: playing/closed`. O mural já é rotulado "Casual / Não verificado".
5. **`read: view` em tudo.** Espectadores, inclusive visitantes de fora da organização, assistem. Isso é seguro porque a frota e o salt **nunca** vão para o `db` antes do `FLEET_REVEAL` (varredura do store no teste 19 do protocolo e na seção 6B do E2E).
6. **Ausência.** Depois de 60 s sem presença, o jogador pode gravar `GAME_OVER {reason: "forfeit", seq: N}`. A reivindicação é anulada se o acusado tiver qualquer evento com `seq ≥ N`. Um cliente vivo responde sozinho com `PRESENCE {seq: N}` (teste 24). Vitória por ausência **não revela frotas**: se o rival estava vivo, a partida continua, e a frota precisa continuar secreta. O selo mostra "Vitória por ausência… sem auditoria". O fold só aceita a reivindicação se `seq` for inteiro ≥ 0 e no máximo o próximo seq do log (maior seq dos outros eventos + 1), e só durante a fase `playing`. Sem `seq`, com `seq` texto/fracionário/nulo ou apontando para depois do log, ela é descartada em qualquer transporte, então não existe reivindicação irrefutável (testes 26 e 27). O fold não confere os 60 s (os timestamps são escritos pelo cliente). O que protege o jogador vivo é a refutação automática.

**Requisito de compartilhamento para "todos os logados podem criar/entrar e jogar":** o acesso geral do artifact precisa ser **Contributor** para a organização, ou cada pessoa precisa ser convidada como Contributor. **Não é possível** dar escrita a visitantes de fora da organização: eles têm `view`, então assistem, mas a primeira escrita falha, e a UI avisa com "Não foi possível gravar a jogada online…". Com o acesso geral em Viewer, todo mundo vira espectador.

## 3. Garantias do transporte (testadas offline, com as regras acima aplicadas pelo fake)

- **Uma escrita por vez por doc**, inclusive entre transportes da mesma página (`withDocLock`). Cada escrita regrava o chunk inteiro com um superconjunto dos mesmos eventos, então repetir é idempotente mesmo quando o ack se perde. O fake contou 0 escritas sobrepostas e 0 escritas negadas para clientes honestos.
- **Leitura.** Um `onSnapshot` por anúncio e por autor, varrendo o conjunto inteiro a cada entrega, com deduplicação por `(assento, eventId)`. Um id igual vindo de outro autor nunca encobre o evento verdadeiro. Listener encerrado com `unavailable` reabre com backoff de 1 s a 30 s. Erros terminais aparecem na UI. O carregamento desiste em 10 s.
- **Refresh no meio da partida.** A aba guarda `{sala, índice, hostUid, frota, salt}` no `sessionStorage`. Antes da primeira escrita, faz um `get()` do próprio log e junta o que já estava lá, para que um chunk nunca seja regravado com menos eventos. Depois responde o tiro pendente ou revela, se devia isso.
- **Orçamento de docs (cota de 25.000).** Por partida: 1 anúncio + 1 a 4 chunks por jogador (cerca de 5 docs), mais 1 índice por jogador, reaproveitado. Ao começar uma partida, cada jogador apaga as próprias partidas com mais de 24 h, os chunks e, se foi anfitrião, o anúncio (teste B9).
- **Lobby.** `where("timestamp","<=",agora+5 min).orderBy("timestamp","desc").limit(50)`, renovada a cada 2,5 min e filtrada no cliente (`status == open`, até 6 h no passado e 5 min no futuro). Salas com data no futuro não ocupam a janela (teste B5). Salas abandonadas nunca tiram uma sala nova da janela (teste B5). A sala sai de "Partida rápida" quando o anfitrião fixa o rival (`status: playing`), sem expulsar os dois jogadores.
- Commit-reveal e auditoria de fim de partida continuam com o mesmo desenho.

## 4. O que NÃO foi possível verificar offline

1. **Se o servidor aceita as regras no publish**, em especial `moves/{self}` com `moves` declarando os dois níveis, e o prefixo raiz `""`. Plano B se `{self}` for recusado: não existe um que preserve a autoria. Nesse caso o PvP online não deve ser publicado.
2. **Se `user.id()` é exatamente o valor que o `{self}` reconhece**, e se nunca é `null` para um Contributor logado. O fake supõe que sim, como o db.d.ts descreve.
3. **Níveis reais.** Conferir depois do publish (§6) que um Viewer lê e não escreve, e que um Contributor escreve só em `moves/<seu id>`.
4. **Carimbo `by` do `room`.** O fake o preenche com o id do usuário. Na plataforma ele vem do servidor, e a doc diz que é infalsificável. Presença e reações dependem disso.
5. **Latência e entrega reais.** Se o stream cair para o refresh periódico (~30 s), cada tiro pode levar até 30 s. O fake simula 2–60 ms, perdas e duplicatas.
6. **`fromCache`, prompts de consentimento, rate limits (`resource_exhausted`)** e o limite de 64 assinaturas sob uso real. Uma partida usa 3 a 4 assinaturas por aba.
7. **`sessionStorage` dentro do iframe do viewer.** Se não persistir, um refresh perde o assento (fica em modo espectador), mas a partida continua para o rival.
8. **Abas em segundo plano.** O E2E desliga o throttling de timers do Chrome porque as duas abas de teste jogam no mesmo navegador. Com ele ligado, a aba escondida atrasava as escritas por segundos. Num aparelho real, cada jogador está com a própria aba em primeiro plano. Se um jogador esconder a aba, as jogadas dele chegam atrasadas, mas a partida não fica errada.

## 5. Riscos conhecidos (não resolvidos)

- **Duas abas da mesma conta no mesmo assento** escrevem nos mesmos chunks, e vale a última escrita. Isso não é suportado. Um evento pode sumir do store, embora o rival já o tenha recebido.
- **Reivindicação de ausência contra quem realmente não consegue escrever** (sem rede por mais de 60 s) vale sem auditoria. É o mesmo comportamento de antes, agora limitado a quem está de fato calado.
- **Inundação do lobby com datas atuais.** Salas com data no futuro são cortadas, mas quem grava 50+ salas abertas com a hora certa ainda empurra as reais para fora da janela enquanto elas tiverem menos de 6 h. Entrar por código continua funcionando.
- **Sequestro do anúncio antes de o rival entrar.** Quem reescreve `rooms/{CÓDIGO}.by` redireciona um rival **novo** para outra pessoa, com o mesmo efeito de passar o código errado. Partidas em andamento não são afetadas, porque os assentos estão fixados.
- **Jogadores que nunca voltam** não limpam as próprias partidas: são cerca de 5 docs cada. A cota acaba depois de ~5.000 partidas desse tipo. O dono pode apagar `moves/*` e `rooms/*` antigos com `ArtifactData`.
- O dono do artifact (e quem puder publicar outra versão com regras mais frouxas) pode alterar logs. A plataforma não avisa ninguém disso.
- **Revanche na mesma sala** não funciona no fold desde o piloto: as revanches são aplicadas depois de todas as ações. Isso não muda nesta etapa.

## 6. Checagem pós-publish (uma passada)

1. `ArtifactData list` em `rooms`, `bounties` e `moves`: vazio no início está ok.
2. Repetir como `as_level: "view"`: a leitura funciona e uma escrita falha.
3. Abrir em duas sessões de Contributor, criar sala, entrar, trocar 2 tiros e recarregar uma aba. Depois:
   - `ArtifactData list` em `moves/<uid>/<código>`: nenhum evento com `"fleet"` antes do `FLEET_REVEAL`.
   - Da sessão do convidado, tentar escrever em `moves/<uid do anfitrião>/<código>/c0999`: deve falhar com `invalid_argument`.
