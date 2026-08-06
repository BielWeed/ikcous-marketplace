# IKCOUS Marketplace — como esta sessão trabalha

Este arquivo diz **quem faz o quê**. As regras de produto, PWA, Supabase e MCP continuam em
[AGENTS.md](AGENTS.md); as de contribuição, em [CONTRIBUTING.md](CONTRIBUTING.md). Não duplique
conteúdo aqui.

> Correção sobre o AGENTS.md: a ferramenta `auto_orchestrate_skills` descrita lá **não existe
> mais** nesta sessão. O orquestrador de skills atual é o MCP `skill-router`
> (`buscar_skill` → `carregar_skill` → `ler_recurso_skill`), com 245 skills indexadas.

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

- **`eslint` tem 553 warnings pré-existentes e 0 erro.** Warning não reprova; **erro novo
  reprova**, porque o teto do `.lint-baseline.json` está em 0.
- **`lint:ratchet` acusa Biome acima do teto no Windows por causa de CRLF.** Não é dívida — o
  próprio script avisa que Biome só é cobrado no CI (Linux).

## Perigos deste repositório

Fatos medidos, não hipóteses. Valem para a sessão e para todo subagente:

- **`npm run dev` aponta para o Supabase de PRODUÇÃO** e já vem logado como admin. Testar
  cadastro ou pedido pela tela suja o catálogo real.
- **Nunca `supabase db push`**: 42 migrations locais nunca aplicadas, 28 versões no banco sem
  arquivo.
- **Migration não leva `BEGIN`/`COMMIT`** — com eles, o `ROLLBACK` do script de prova vira no-op
  e a mudança fica gravada em produção.
- **Backup é diário e não há PITR.** Reverter migration custa até 24 h de pedidos.
- **Nunca `--no-verify` no commit.** O hook de `secretlint` é a única trava contra credencial
  vazada — o histórico deste repo já teve `service_role` e senha de banco commitadas.
- **Finalizar branch por Pull Request**, não por merge direto na `main` local.
