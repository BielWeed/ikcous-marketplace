# IKCOUS Marketplace — como esta sessão trabalha

Este arquivo diz **quem faz o quê**. As regras de produto, PWA, Supabase e MCP continuam em
[AGENTS.md](AGENTS.md); as de contribuição, em [CONTRIBUTING.md](CONTRIBUTING.md). Não duplique
conteúdo aqui.

> O `AGENTS.md` descreve as ferramentas do **Cursor/Antigravity**, que são outras. Lá o
> orquestrador é o MCP `orchestrator` (`auto_orchestrate_skills`) — que existe e funciona, só
> não aqui. **No Claude Code o orquestrador é o `skill-router`** (`buscar_skill` →
> `carregar_skill` → `ler_recurso_skill`). Ferramenta citada no `AGENTS.md` que não estiver na
> sua lista não existe para você: não invoque e não invente substituto.

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
