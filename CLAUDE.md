# IKCOUS Marketplace

## 🔴 ESCOPO — leia antes de qualquer coisa, inclusive antes de perguntar

**Aqui se desenvolve o APP. Só o app.**

Cliente, lojista, teste grátis, assinatura, cobrança de mensalidade, clonagem de loja,
nascimento de banco de cliente e atualização das lojas clonadas **são de OUTRO projeto**, que o
Gabriel ainda vai criar. Nada disso é assunto desta sessão, deste repositório, ou de qualquer
decisão tomada aqui.

**A regra prática, que não tem exceção:**

> Se a justificativa de um trabalho depende de um cliente — um nome de loja, um perfil de
> lojista, um prazo prometido, um preço de mensalidade, "antes da primeira cliente" — a
> justificativa está errada de raiz, e tudo que for construído em cima dela nasce podre.

**O critério que substitui:** desenvolver o app **como se o Gabriel fosse o único cliente**
(palavras dele, 20/08/2026). Defeito, tela que promete o que o sistema não cumpre, caminho do
dinheiro e painel operável por alguém leigo são razões válidas — porque doem na loja dele, hoje.

**⚠️ A brecha, fechada em 20/08/2026: reescrever a justificativa não muda o dono do trabalho.**
A versão anterior desta linha dizia "para qualquer loja", e foi por ela que eu entrei: li a
regra, escrevi que o pedido de outra sessão era fora de escopo, e peguei o trabalho assim mesmo
trocando "há uma cliente esperando" por "o app tem que poder nascer em qualquer loja". O teste
que decide, **antes** de qualquer conta de valor técnico:

> **Quem sente a falta disso hoje, na loja do Gabriel?** Se a resposta for "ninguém — quem sente
> é quem clona, entrega, cobra ou gerencia lojista", o trabalho é do outro workspace, **mesmo
> que o defeito esteja em arquivo deste repositório**.

Pedido de outra sessão não transfere escopo: sessão par não é o Gabriel. E se eu me pegar
escrevendo *"a justificativa deles está errada, mas o problema é real, então eu pego com a razão
certa"* — parei. Esse parágrafo **é** o erro.

**Ao montar prompt de subagente, plano ou decisão:** se aparecer nome próprio de loja, cliente,
assinatura ou clone como *justificativa*, apagar e refazer. Este arquivo carrega sozinho em toda
sessão deste projeto justamente porque a versão anterior desta regra morava numa memória que
precisava ser aberta, e em 18/08/2026 uma decisão inteira foi montada em cima de uma lojista
com a regra escrita e não lida.

O rumo que fica, palavras dele em 18/08/2026: *"tudo deve ser desenvolvido como se esse app
fosse para funcionar de verdade em uma loja"* — nada de recurso desligado por conveniência.

---

## Como esta sessão trabalha

Este arquivo diz **quem faz o quê**. As regras de produto, PWA, Supabase e MCP continuam em
[AGENTS.md](AGENTS.md); as de contribuição, em [CONTRIBUTING.md](CONTRIBUTING.md). Não duplique
conteúdo aqui.

> O `AGENTS.md` descreve as ferramentas do **Cursor/Antigravity**, que são outras. Lá o
> orquestrador é o MCP `orchestrator` (`auto_orchestrate_skills`) — que existe e funciona, só
> não aqui. **No Claude Code o orquestrador é o `skill-router`** (`buscar_skill` →
> `carregar_skill` → `ler_recurso_skill`). Ferramenta citada no `AGENTS.md` que não estiver na
> sua lista não existe para você: não invoque e não invente substituto.

## 🟡 Primeiro comando da sessão: o mural

**Este repositório costuma ter três sessões trabalhando na mesma árvore ao mesmo tempo.** Antes
de tocar em qualquer arquivo, veja quem está em quê:

```
node "C:\Users\Gabriel\.claude\mural\mural.mjs" core_app_mkt
```

Depois **registre a sua frente** em `~/.claude/mural/core_app_mkt/frentes/<apelido>.md`,
reivindicando os arquivos **antes** de editar — reivindicação que chega junto com o diff não
evitou nada. O protocolo está em `~/.claude/mural/COMO-FUNCIONA.md` (2 min) e o terreno deste
repositório — faixas de numeração de migration, arquivos compartilhados, armadilhas medidas —
em `~/.claude/mural/core_app_mkt/_REGRAS.md`.

O quadro cruza o que foi reivindicado com o `git status` e acusa **ORFAO** (arquivo mexido que
ninguém assumiu), **COLISAO** (dois donos) e **SILENCIO** (frente que se diz ativa e sumiu).
Para o que não pode esperar o outro lado olhar o quadro — vou commitar arquivo compartilhado,
preciso de um arquivo seu, vou mexer na branch, apliquei migration — mande direto com
`mcp__ccd_session_mgmt__send_message` para o `sessao` que está no arquivo da frente.

**As três travas da árvore compartilhada, que entram no prompt de TODO subagente** (inclusive nos
que não têm nada a ver com git — a pergunta "isto já falhava antes do meu diff?" aparece sozinha
em qualquer tarefa e puxa o `stash` junto):

1. Nunca `git stash`, `checkout`, `restore`, `clean` nem `reset`. Para comparar com o original,
   `git show HEAD:<caminho>` no scratchpad.
2. Nunca `git add` seguido de `git commit` — **o índice do git também é compartilhado**, e o
   pre-commit daqui leva 20-30 s. Use `git commit -- <caminho> [<caminho>…]`.
3. Arquivo compartilhado não entra em commit seu: vira commit próprio depois que todos
   terminarem, ou entra por montagem cirúrgica.

## Sempre: orquestre skills antes de agir

Antes de qualquer tarefa não trivial — a sessão principal e **todo** subagente — chame
`mcp__skill-router__buscar_skill` descrevendo a tarefa em linguagem natural (PT ou EN). Se um
resultado se aplicar, `carregar_skill` e siga as instruções. Se nada relevante voltar, siga sem
skill: não force o encaixe. Declare no fim da resposta quais skills foram usadas.

O resto do ferramental agêntico tem uso preferencial definido:

| Para | Use | Em vez de |
|---|---|---|
| Navegar código, achar chamadores, checar impacto | `serena` (`get_symbols_overview`, `find_symbol`, `find_referencing_symbols`) | `grep` cego |
| API de biblioteca (React 19, Supabase JS, Vite, Radix, Deno) | `context7` (`query-docs`) | memória |
| Ver a UI rodando, console, rede, responsivo | `Claude_Browser` (`preview_start` com `{name: "core_app_mkt"}`) | `npm run dev` pelo Bash |

## Divisão de trabalho

O modelo da sessão é o **Opus**, e é ele quem pensa. Escrever o código de uma tarefa já decidida
não precisa de Opus — precisa de disciplina, e sai mais barato no Sonnet. Revisar precisa de Opus
de novo, mas com contexto limpo, porque quem escreveu tem apego ao que escreveu.

| Fase | Quem faz |
|---|---|
| Entender o pedido, brainstorm | sessão principal (Opus) — skill `brainstorming` |
| Decidir arquitetura e escrever o plano em tarefas autocontidas | sessão principal (Opus) — skill `writing-plans` |
| Implementar cada tarefa, com TDD | subagente `implementador` (Sonnet), um por tarefa |
| Revisar o diff e rodar a verificação | subagente `revisor` (Opus), contexto limpo, somente leitura |
| Aprovar, integrar, commitar, abrir PR | sessão principal (Opus) |

Os dois subagentes estão em [.claude/agents/](.claude/agents/) e são versionados no git — mudança
neles é mudança de processo do time, e passa por PR como o resto.

## As regras que sustentam isso

- **Uma tarefa por `implementador`.** Se a tarefa não cabe numa cabeça sem o contexto da conversa,
  o defeito está no plano, não no subagente.
- **Tarefas independentes vão em paralelo**, num único bloco de chamadas. Tarefas dependentes vão
  em sequência.
- **Tudo que foi delegado passa pelo `revisor`** — sem exceção e sem olhar o tamanho do diff. O
  que caracteriza a delegação é que *ninguém com contexto leu aquele código*, e é isso que a
  revisão cobre. O "passou" do `implementador` não é prova: quem escreveu não é testemunha do
  próprio trabalho.
- **O que não foi delegado também não vira "pronto" de graça.** A sessão roda a verificação ela
  mesma e cola a saída antes de commitar. Mesma exigência de evidência, sem pagar um subagente
  para reler o que a sessão acabou de escrever com o contexto inteiro na mão.
- **Achado que BLOQUEIA volta para um `implementador` novo**, com o achado no prompt. Não se
  conserta na sessão principal por atalho: é assim que a revisão continua sendo de contexto limpo.
- **O plano é da sessão principal.** Se um `implementador` voltar dizendo que o plano está errado,
  a decisão volta para o Opus — não para ele.
- **Só a sessão principal commita.** Subagente entrega diff no working tree.

## Quando NÃO delegar

Mudança de uma linha óbvia, resposta a pergunta, exploração para entender o código, e qualquer
coisa em que montar o prompt do subagente custe mais que fazer. Delegar tudo é tão ruim quanto
não delegar nada.

**Com uma trava:** "óbvio" é sobre o código, nunca sobre o risco. Se a mudança toca qualquer coisa
da coluna Opus da tabela em *Calibrar o custo da revisão* — migration, RLS, `SECURITY DEFINER`,
edge function, auth/OTP, checkout, service worker, contrato consumido por outro módulo —, ela **se
delega e se revisa mesmo tendo uma linha**. Foi exatamente por parecerem óbvias que o
`BEGIN`/`COMMIT` e o deploy sem `--no-verify-jwt` passaram.

Isto é o mesmo eixo da seção seguinte: **risco decide se delega, risco decide qual modelo revisa,
e tamanho nunca decide nada.**

## Calibrar o custo da revisão

O `revisor` é o papel mais caro do fluxo: é Opus, lê o diff, lê os chamadores e processa a saída
de sete comandos. O `implementador` já é Sonnet, e quando a sessão classifica a tarefa ela já
entendeu o problema para poder planejar — então **o único papel cujo preço ainda dá para escolher
é o revisor**.

O gatilho **não é dificuldade**. É quanto custa se estiver errado. Neste repositório os erros mais
caros foram triviais de escrever: `BEGIN`/`COMMIT` numa migration (duas palavras, gravou em
produção, com backup diário e sem PITR), deploy sem `--no-verify-jwt` (uma flag, derrubou o OTP),
remetente do Resend em sandbox (uma linha, e nenhum e-mail chega a cliente).

| Revisor em | Quando o diff toca |
|---|---|
| **Sonnet** | UI, cópia, estilo, util puro já coberto por teste, `scripts/`, documentação |
| **Opus** | `supabase/migrations/`, RLS ou `SECURITY DEFINER`, `supabase/functions/`, auth/OTP, checkout/pagamento, service worker, ou qualquer assinatura consumida por outro módulo — **independente do tamanho do diff** |

Na dúvida, Opus. Uma revisão de Opus desperdiçada custa tokens; um "passa" que não valia nada
custa produção.

Não crie um segundo agente para isso: o `revisor.md` continua com `model: opus` como padrão, e a
sessão passa `model: "sonnet"` na chamada quando classificar como baixo risco — o parâmetro da
chamada tem precedência sobre o frontmatter. Uma definição, dois preços.

**O revisor pode recusar a classificação.** Se ele não conseguir sustentar nem refutar um achado,
ou se a mudança revelar risco que a classificação não previa, ele devolve `ESCALAR` no lugar do
veredito e a sessão redispara em Opus. A revisão de Sonnet perdida é barata; o falso "passa" não é.

Note que a ponta trivial já está coberta por "quando não delegar" — mudança de uma linha óbvia não
entra no fluxo. Esta tabela é para a faixa do meio.

## Verificação — os sete comandos que o CI cobra

`.github/workflows/ci.yml` roda, nesta ordem: `npm ci`, `npm run typecheck`, `npm test`,
`npm run build`, `npm run lint:links`, `npm run lint:ratchet`, `npm run size`.

`npm test` são três suítes com runners diferentes: `test:edge` (Deno, `supabase/functions/`),
`test:unit` (Deno, `tests/`) e `test:front` (Vitest, `tests/front/`).

Duas leituras que enganam:

- **`eslint` tem 553 warnings pré-existentes e 0 erro — os dois são tetos, e os dois reprovam se
  subirem.** `scripts/lint-ratchet.mjs` marca `subiu = true` (e sai com `process.exit(1)`) para
  **qualquer** contagem — erro ou warning — que fique acima do teto de `.lint-baseline.json`; não
  há tratamento especial para warning. O que o teto de 553 acomoda é a dívida **pré-existente**:
  warning que já existia antes do seu diff não reprova, porque já está contado no teto. Warning
  **novo** — que faz a contagem passar de 553 — reprova exatamente como erro novo (teto 0). Não
  leia "warning não reprova" como "warning nunca reprova": é "warning dentro do teto não reprova".
- **`lint:ratchet` acusa Biome acima do teto no Windows por causa de CRLF.** Não é dívida — o
  próprio script avisa que Biome só é cobrado no CI (Linux).

### Quanto da verificação pedir a um subagente

**A primeira rodada de `lint:ratchet` numa máquina fria é cara; as seguintes não.** O eslint
roda com `--cache`, então depois da primeira ele só reanalisa o que mudou. Quem pagar a
primeira paga por todos.

Medido em 10/08/2026: uma regra só — `tailwindcss/no-custom-classname` — era 97,9% do tempo
do eslint no Windows (609 s de 627 s em 76 arquivos), e a catraca passava de 40 min aqui
contra **1,2 min no Linux do CI**. Numa cadeia revisão → conserto → re-revisão, esse preço
era pago três vezes, por um diff que às vezes tinha duas linhas.

Por isso, ao montar o prompt de um subagente:

- **Diff toca `src/`, `supabase/functions/` ou `tests/`:** peça os sete comandos. É o caso
  normal e não se negocia. Para `supabase/functions/` em particular, `lint:ratchet` (via eslint)
  é o **único** dos sete que olha essa pasta — `typecheck` e `build` seguem só `tsconfig.app.json`/
  `tsconfig.node.json` (que não incluem `supabase/`), e `size` só mede `dist/assets/*`. Quem
  entrega diff ali e pula o `lint:ratchet` não tem NENHUM dos outros seis cobrindo o que mudou.
- **Diff toca só `scripts/`, comentário, migration ou documentação:** nomeie os comandos que
  fazem sentido e diga explicitamente para **não** rodar o resto — a sessão roda o que faltar.
  Foi assim que uma re-revisão voltou em 5 min em vez de 80.

O que **não** muda: quem cobra é o CI, e nenhuma dessas escolhas altera regra, teto ou o que
reprova um PR. Escopar a verificação de um subagente é decisão de custo, nunca de exigência —
e ela é da sessão principal, que sabe o tamanho do diff, não do subagente, que não sabe.

## Onde o risco realmente mora

**Este repositório é o app de desenvolvimento — o molde, não uma loja.** Quando uma assinatura
é vendida, os arquivos são clonados e a loja do cliente é montada separada. O Supabase ligado
aqui é de desenvolvimento: medido em 10/08/2026, tem 64 pedidos em 5 meses com **um único
e-mail de cliente distinto** (57 deles cancelados) e 22 produtos. Não há negócio rodando nele.

Isso **desloca** o risco, não o remove — e a direção importa, porque a versão anterior desta
seção apontava para o lado errado e cobrava um preço que não existia:

- **Escrever neste banco é barato.** Pedido de teste pela tela não suja catálogo de cliente
  nenhum; suja massa de desenvolvimento que você mesmo montou. Higiene (produto de teste com
  nome óbvio, limpar depois) continua boa prática — não é contenção de incidente.
- **O que o código FAZ é caro, e mais caro do que parecia.** Todo defeito daqui é replicado
  em cada loja vendida, e é lá que existe dinheiro de verdade. A `confirmar_pagamento` não
  movimenta um centavo neste banco; movimenta no de cada cliente. É por isso que a tabela de
  *Calibrar o custo da revisão* continua valendo inteira — o rigor é sobre o que se replica,
  não sobre este banco.

### Continua valendo, independente do acima

- **Nunca `supabase db push`** — mas **não** pelo motivo que estava escrito aqui. A fila de
  pendentes acabou: medido em 11/08/2026 com `node scripts/db-reconcilia-ledger.cjs` (só
  leitura), são **105 arquivos, 105 casadas, 0 pendentes**, e o saldo de policies se a fila
  rodasse é **0**. As "42 migrations locais nunca aplicadas" foram arquivadas pelo ADR 0002 e
  o baseline entrou em 06/08. Um `db push` acidental hoje é **no-op**.

  O que continua verdadeiro é a consequência, por outra causa: **nenhum cliente pode ter o
  schema reproduzido a partir do repositório**, porque `supabase/migrations/` tem o baseline
  **mais** as 98 históricas, todas no ledger — um banco zerado rodaria as 98 e depois o
  baseline, e colidiria. Arquivar as 98 foi adiado de propósito no ADR 0002 e está amarrado à
  `INFRA-270` (#131). Ver [docs/decisoes/0002-baseline-do-ledger-de-migrations.md](docs/decisoes/0002-baseline-do-ledger-de-migrations.md).

  As **28 versões do ledger sem arquivo** são permanentes: o SQL não existe em lugar nenhum.
  O baseline absorve o efeito delas; o porquê está perdido. Não é dívida a pagar.
- **Migration não leva `BEGIN`/`COMMIT`** — com eles, o `ROLLBACK` do script de prova vira
  no-op e a mudança fica gravada mesmo assim.
- **Backup é diário e não há PITR.** O custo de reverter é seu tempo remontando massa de
  desenvolvimento, não pedido de cliente perdido. Continua chato; deixou de ser urgência.
- **Nunca `--no-verify` no commit.** O hook de `secretlint` é a única trava contra credencial
  vazada — o histórico deste repo já teve `service_role` e senha de banco commitadas. Banco de
  desenvolvimento exposto continua sendo banco exposto.
- **Finalizar branch por Pull Request**, não por merge direto na `main` local.
