# Definition of Ready e Definition of Done

Três listas. Todo item é respondível com **sim ou não por outra pessoa** — se precisar de
interpretação, o item está mal escrito e deve ser corrigido num PR.

- **Definition of Ready** — quando um cartão pode sair de `Backlog` e entrar em
  `Pronto pra pegar`. É conferida no planejamento de segunda, não na hora de puxar.
- **Definition of Done** — quando o cartão fecha.
- **DoD de banco de dados** e **DoD de cartão `decisao` / `doc`** — os dois casos em que a
  lista principal não serve.

> **Os itens 1 a 7 da DoD são a lista do
> ⧗ [`.github/pull_request_template.md`](../../.github/pull_request_template.md), palavra por
> palavra** — e o mesmo vale para B1 a B4 contra a seção "Toca em banco de dados?" do
> template. Isso é proposital: duas listas parecidas divergem em uma semana. **Mudou uma,
> muda a outra no mesmo PR** — a tabela de rastreio no fim deste documento existe para
> conferir isso em dez segundos.
>
> **⧗ O template ainda vive no PR #11**, aberto em 30/07/2026 (`chore/gitflow-e-ci` →
> `develop`). Até ele mergear, o link acima não resolve e **nenhum** dos comandos citados
> abaixo existe na `develop`: não há script `test`, `npm run typecheck` ainda é
> `tsc --noEmit` (que analisa zero arquivo) e não há `.github/workflows/`. Leia esta lista
> como "a partir do merge do PR #11".

---

## Definition of Ready

Um cartão entra em `Pronto pra pegar` quando as **sete** respostas são sim:

- [ ] **1.** O título diz o que fazer, no imperativo, e é específico o bastante para caber
      numa mensagem de commit
- [ ] **2.** Tem contexto de 2 a 4 linhas escrito para alguém que não estava na conversa
- [ ] **3.** Tem evidência: `arquivo:linha`, número do achado da auditoria, ou passo de
      reprodução que outra pessoa consegue repetir
- [ ] **4.** Tem critério de aceite verificável — cada item respondível com sim/não por quem
      não fez o trabalho
- [ ] **5.** O tamanho é `P`, `M` ou `G`. **`GG` não entra**: significa "ainda não é uma
      tarefa" e precisa ser quebrado antes
- [ ] **6.** Não depende de decisão pendente. Se depende, o ADR correspondente entra primeiro
      (ver [`docs/decisoes/`](../decisoes/))
- [ ] **7.** Todo cartão listado em `Depende de` está em `Feito`

E mais duas condicionais:

- [ ] **8.** *Se toca banco:* existe comentário do Gabriel na issue confirmando que o cartão
      pode entrar, e uma ideia escrita de como reverter
- [ ] **9.** *Se toca carrinho, cupom, frete ou criação de pedido:* está escrito onde o
      teste vai morar (arquivo), mesmo que ele ainda não exista

**Regra de puxar**, que é outra coisa e vale no momento de mover para `Em progresso`:
quem puxa precisa ter **menos de 2 cartões** em `Em progresso`. Não é item de DoR porque não
se verifica na segunda — na segunda ninguém puxou nada ainda.

**Se um cartão reprovar aqui, ele fica no `Backlog` com um comentário dizendo qual item
faltou.** Reprovar cartão não é rejeição do trabalho de ninguém — todos os 111 cartões do
backlog foram escritos antes de existir processo, e vários vão reprovar. Corrigir o cartão é
trabalho válido e conta como trabalho.

---

## Definition of Done

O cartão fecha quando as **dez** respostas são sim. As **sete primeiras** são a lista do
template de PR, verbatim:

- [ ] **1.** `npm run typecheck` passa localmente
- [ ] **2.** `npm test` passa localmente
- [ ] **3.** O CI está verde nos cinco jobs
- [ ] **4.** Testei no preview deploy da Vercel, não só no localhost
- [ ] **5.** A mensagem de commit segue Conventional Commits e o escopo está em
      `.commitlintrc.json`
- [ ] **6.** Não sobrou credencial, `console.log` de depuração nem código comentado
- [ ] **7.** Se mudei comportamento documentado, atualizei o documento junto

Mais **três** que o template de PR não tem como cobrir, porque acontecem fora do PR:

- [ ] **8.** Cada item do critério de aceite tem, no comentário da issue, **como** foi
      verificado — comando, passo ou print
- [ ] **9.** A issue fechou (pelo `Closes #N` do PR) e o cartão está em `Feito`
- [ ] **10.** O que você descobriu e não estava no cartão virou cartão novo, não comentário
      solto

Sobre cada item, o que é fácil errar:

**1. `npm run typecheck`** — a partir do PR #11 ele é `tsc -b --force`. O comando de hoje na
`develop` é `tsc --noEmit`, que analisa **zero arquivo** e passa em 0,78 s porque o
`tsconfig.json` da raiz tem `"files": []`. Se o seu typecheck termina em menos de 5 segundos,
ele não checou nada: **confira se o PR #11 já mergeou**; enquanto não tiver mergeado, use
`npx tsc -p tsconfig.app.json --noEmit` (~16 s, 911 arquivos), que é o que o
⧗ [`03-SETUP-AMBIENTE.md`](../onboarding/03-SETUP-AMBIENTE.md) já manda.

**2. `npm test`** — a partir do PR #11 são **12 testes**, todos em
`supabase/functions/calculate-shipping/index_test.ts`, cobrindo três funções puras de frete.
Precisa do Deno instalado. Passar aqui **não** significa que carrinho, cupom, checkout ou o
front estão testados: eles têm zero cobertura. Este item vira forte de verdade quando
`INFRA-150` mergear.

**3. Os cinco jobs** — `Tipos`, `Testes (Deno)`, `Build e tamanho`, `Varredura de segredo`,
`Catraca de lint`. Nenhum tem `continue-on-error`. Se a `Catraca de lint` reprovar, ela diz
**qual número subiu**: é dívida que este PR introduziu, não a antiga.
**"Bloqueia" aqui é acordo entre os dois, não trava do GitHub** — branch protection retorna
403 neste plano (ver ⧗ [A trava que não existe](../../CONTRIBUTING.md#a-trava-que-não-existe)).

**4. Preview da Vercel** — é o preview **do PR**, antes de pedir revisão. Não confundir com a
coluna `Em teste (preview)` do Kanban, que é o deploy da `develop` **depois** do merge (ver
[`METODOLOGIA.md`, §4](METODOLOGIA.md#4-fluxo-de-uma-task-do-começo-ao-fim)).
Por que o `localhost` não basta: qualquer `vercel env pull` regrava
`.env.production.local` com `VITE_SUPABASE_URL=""`, e no Vite esse arquivo tem precedência
sobre o `.env.production` — o build local sai sem banco e a guarda de ambiente
(`src/lib/env.ts:79-80`) pinta a tela vermelha "🚨 ERRO DE AMBIENTE". **No repositório hoje
essas três linhas estão comentadas de propósito — não descomente.**

**6. Credencial** — o job `Varredura de segredo` roda o secretlint só sobre o **diff**, e o
hook `pre-commit` só sobre os arquivos staged. Nenhum dos dois lê o que você não commitou, e
nenhum dos dois enxerga `console.log` nem código comentado. A conferência visual continua
sendo sua. O histórico deste repositório já teve `service_role` e senha de banco commitadas —
não é hipótese.

**7. Documento junto** — se você mudou um fluxo descrito em
⧗ [`05-FLUXOS-CRITICOS.md`](../onboarding/05-FLUXOS-CRITICOS.md), uma armadilha de
⧗ [`03-SETUP-AMBIENTE.md`](../onboarding/03-SETUP-AMBIENTE.md) ou uma regra do
`CONTRIBUTING.md`, a atualização vai **no mesmo PR**. Documentação corrigida depois é
documentação corrigida nunca.

---

## Definition of Done — alteração de banco de dados

Mais rígida, e por um motivo medido: o ledger de migrations
(`supabase_migrations.schema_migrations`) não descreve o banco. São **42 arquivos locais
(41 versões) sem linha no ledger** — dos quais 24 já estão aplicados sob outro timestamp — e
**28 versões no ledger sem arquivo local**. Nesse cenário, uma migration errada não falha
limpo: ela aplica metade.

**Vale para qualquer PR que toque `supabase/migrations/`, uma RPC, uma policy de RLS, um
trigger ou um `GRANT`.** B1 a B4 são a seção "Toca em banco de dados?" do template de PR,
verbatim; B5 a B7 não têm contraparte lá porque acontecem fora do PR.

- [ ] **B1.** O SQL foi validado em `BEGIN; ... ROLLBACK;` contra produção e o resultado está
      colado abaixo
- [ ] **B2.** O arquivo de rollback existe e está neste PR
- [ ] **B3.** Conferi que o corpo da função ao vivo bate com o arquivo-base antes de alterar
      (`SELECT pg_get_functiondef(...)` — ver regra 1 do `CONTRIBUTING.md`)
- [ ] **B4.** O Gabriel revisou (só ele aplica alteração em produção)
- [ ] **B5.** A migration foi aplicada uma a uma, **nunca** por `supabase db push`
- [ ] **B6.** Depois de aplicada, o comportamento foi conferido no banco com uma consulta de
      leitura, e o resultado está no PR
- [ ] **B7.** A issue tem a label `toca-banco`

**Quem executa o B1 e em quanto tempo.** O autor do cartão prepara o SQL; **quem roda a
transação de validação contra produção é o Gabriel**, a pedido do autor — pelas regras 5 a 8
de `03-SETUP-AMBIENTE.md` o Netim avisa e espera resposta antes de qualquer escrita, e pelo
B4 só o Gabriel aplica. Prazo: **as mesmas 48h da revisão de PR.** Sem isso, um cartão de
banco puxado pelo Netim tem um item que ele não pode marcar sozinho e que não tem dono — que
é a definição de cartão travado.

O **primeiro** checkbox da seção do template — `Não toca — pode ignorar o resto desta
seção` — não tem contraparte aqui porque é navegação, não critério.

> **Uma ambiguidade herdada do template, para arrumar nos dois arquivos ao mesmo tempo:** o
> B3 manda "ver regra 1 do `CONTRIBUTING.md`", mas lá a "regra 1" é *nunca rode
> `supabase db push`*; o `pg_get_functiondef` é o **item 3** da seção *Banco de dados*. Como
> o texto do B3 é verbatim, corrigir aqui sem corrigir o template quebraria o pareamento —
> os dois mudam no mesmo PR.

**Três coisas que reprovam na hora, sem discussão:**

1. `supabase db push` — em qualquer circunstância. Um `push` abortaria na **26ª** migration,
   e as **25 que rodam antes** somam **190 `DROP POLICY` contra 127 `CREATE POLICY`**
   (saldo −63); as migrations que reconstroem as policies estão **depois** do ponto de falha
   e nunca rodam. Resultado: RLS desmontado pela metade, com a loja no ar.
2. `DROP` de qualquer objeto, ou `TRUNCATE` de qualquer tabela.
3. Alterar policy de RLS, `GRANT` / `REVOKE` ou `ALTER ... OWNER` sem revisão em PR.

As regras completas de acesso ao banco de produção são as **12 regras numeradas** de
⧗ [`03-SETUP-AMBIENTE.md`](../onboarding/03-SETUP-AMBIENTE.md), seção 6 — **aquela é a lista
oficial**, e nela `supabase db push` é a **regra 9**. (O `CONTRIBUTING.md` chama a mesma
proibição de "regra 1"; as duas numerações convivem, a oficial é a do setup.)

> Pendência conhecida, que não é DoD de ninguém mas atrapalha todo mundo: a migration
> `supabase/migrations/20260729000002_shipping_quote_validation_v23.sql` está validada
> (14/14 em transação com `ROLLBACK`) e **ainda não aplicada** em produção. Não assuma que a
> RPC `create_marketplace_order_v23` existe no banco.

---

## Definition of Done — cartão de `decisao` ou `doc`

20 dos 111 cartões do backlog são de tipo `decisao`, e o dia 5 da
[`PRIMEIRA-SEMANA-NETIM.md`](PRIMEIRA-SEMANA-NETIM.md) foi desenhado para gerar um lote de
cartões `doc`. Para esses, os itens 1 a 4 da DoD são ruído — o item 4 é literalmente sem
sentido, porque não há o que ver em preview.

- [ ] **D1.** O documento (ADR ou `.md`) está mergeado
- [ ] **D2.** *Se for ADR:* o estado mudou de `Proposta` para `Aceito` e a linha foi
      acrescentada no índice de [`docs/decisoes/README.md`](../decisoes/README.md)
- [ ] **D3.** Os cartões que estavam bloqueados por esta decisão foram desbloqueados — cada
      um com um comentário dizendo o que a decisão mudou neles
- [ ] **D4.** A mensagem de commit segue Conventional Commits (item 5 da DoD principal)
- [ ] **D5.** A issue fechou e o cartão está em `Feito`

Os itens 6 e 7 da DoD principal continuam valendo: nada de credencial no texto, e se o
documento contradiz outro documento, os dois mudam no mesmo PR.

---

## Rastreio: DoD ↔ template de PR

Confira esta tabela sempre que mexer em qualquer uma das duas listas. A coluna
**Texto idêntico?** é o mecanismo: se qualquer linha virar "não", os dois documentos
divergiram e um dos dois está errado.

| # | Texto do item, literal | No template? | Texto idêntico? | Quem verifica |
| --- | --- | --- | --- | --- |
| 1 | `npm run typecheck` passa localmente | Sim | Sim | Autor + job `Tipos` |
| 2 | `npm test` passa localmente | Sim | Sim | Autor + job `Testes (Deno)` |
| 3 | O CI está verde nos cinco jobs | Sim | Sim | GitHub Actions |
| 4 | Testei no preview deploy da Vercel, não só no localhost | Sim | Sim | Autor; o revisor confere no "Como testar" |
| 5 | A mensagem de commit segue Conventional Commits e o escopo está em `.commitlintrc.json` | Sim | Sim | Hook `commit-msg` |
| 6 | Não sobrou credencial, `console.log` de depuração nem código comentado | Sim | Sim | Autor (o job `Varredura de segredo` cobre só a credencial, e só no diff) |
| 7 | Se mudei comportamento documentado, atualizei o documento junto | Sim | Sim | Revisor |
| 8 | Cada item do critério de aceite tem, no comentário da issue, como foi verificado | **Não** — vive na issue | — | Revisor |
| 9 | A issue fechou e o cartão está em `Feito` | **Não** — vive no Kanban | — | Autor |
| 10 | O que você descobriu e não estava no cartão virou cartão novo | **Não** — vive no Kanban | — | Autor |
| B1 | O SQL foi validado em `BEGIN; ... ROLLBACK;` contra produção e o resultado está colado abaixo | Sim, seção "Toca em banco de dados?" | Sim | Gabriel |
| B2 | O arquivo de rollback existe e está neste PR | Sim, seção "Toca em banco de dados?" | Sim | Gabriel |
| B3 | Conferi que o corpo da função ao vivo bate com o arquivo-base antes de alterar (`SELECT pg_get_functiondef(...)` — ver regra 1 do `CONTRIBUTING.md`) | Sim, seção "Toca em banco de dados?" | Sim | Gabriel |
| B4 | O Gabriel revisou (só ele aplica alteração em produção) | Sim, seção "Toca em banco de dados?" | Sim | Gabriel |
| B5 | Aplicada uma a uma, sem `db push` | **Não** — acontece depois do merge | — | Gabriel |
| B6 | Comportamento conferido no banco depois de aplicar | **Não** — acontece depois do merge | — | Gabriel |
| B7 | Label `toca-banco` na issue | **Não** — vive no Kanban | — | Autor |
| — | `Não toca` — checkbox de escape da seção de banco | Sim | n/a | É navegação, não critério |

---

## O que estas listas **não** exigem hoje, e quando vão exigir

Escrever alvo impossível é a forma mais rápida de fazer as listas serem ignoradas. Nenhum
destes itens está na DoD **hoje**:

| Item ausente | Por que hoje não | Quando volta a ser avaliado |
| --- | --- | --- |
| Percentual de cobertura de testes | O projeto tem 12 testes cobrindo 3 funções puras. Qualquer meta percentual viraria teste escrito para subir número | Depois de `INFRA-150`, e mesmo assim como cobertura **dos fluxos críticos**, não como percentual |
| Teste automatizado em todo cartão | Não existe runner no front. Regra impossível ensina a ignorar regra | A partir do merge de `INFRA-150`, obrigatório nas quatro áreas de dinheiro ([`METODOLOGIA.md`, §2.4](METODOLOGIA.md#24-tdd-só-no-fluxo-de-dinheiro--e-é-aqui-que-começa)) |
| Zero warning de lint | São 553 warnings de eslint pré-existentes (medidos no CI). A catraca impede piorar; zerar é trabalho próprio | `INFRA-250` zera os 553 warnings. Os **7 erros de eslint e os 31 do Biome não têm cartão** — abrir dois |
| Aprovação obrigatória de revisor no GitHub | Branch protection retorna 403 no plano Free. O GitHub não consegue exigir | Depende de uma decisão que **não tem cartão**: GitHub Pro (mantém privado) vs. repositório público com histórico purgado. `INFRA-240` decide só a reescrita do histórico, não o plano — abrir cartão próprio |
| Teste de acessibilidade e performance | Não há ferramenta instalada nem baseline medido | Onda 3 do ⧗ [`ROADMAP.md`](../backlog/ROADMAP.md) |

Alvo a revisar em **30/10/2026**, três meses após a criação deste documento.
