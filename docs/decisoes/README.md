# Decisões (ADR)

Uma decisão por arquivo, numerada. O formato está em [`0000-template.md`](0000-template.md);
a regra de quando um ADR é obrigatório está na
[`METODOLOGIA.md`](../processo/METODOLOGIA.md#6-como-decisões-técnicas-são-tomadas).

**Um ADR aceito não se edita, com uma exceção: o campo `Estado`, quando um ADR novo o
substitui.** Corpo, contexto, opções e decisão nunca mudam. O índice abaixo e esse campo são
as únicas coisas deste diretório que se alteram depois.

Isto não é cerimônia importada de time grande. É a resposta ao problema medido deste projeto:
**o Gabriel escreveu 100% do código e 20 tarefas do backlog não podem avançar sem uma resposta
que só ele tem.** Enquanto essas respostas viverem no Discord, o gargalo continua onde está.

> O aviso que ficava aqui dizia que `docs/backlog/` ainda vivia no PR #9 e que os links desta
> página não resolviam. **O #9 mergeou em 31/07/2026** e os arquivos estão na `develop` — os links
> abaixo funcionam. Os marcadores `⧗` que sobraram no resto do documento têm a mesma origem e podem
> ser removidos junto de uma revisão dele.

---

## Índice

| ADR | Título | Estado | Data |
| --- | --- | --- | --- |
| [0001](0001-preview-da-vercel-aponta-para-producao.md) | Apontar o ambiente Preview da Vercel para o banco de produção | Aceito | 04/08/2026 |
| [0002](0002-baseline-do-ledger-de-migrations.md) | Reconciliar o ledger de migrations por baseline do schema vivo | Aceito | 05/08/2026 |

Ao mergear um ADR, acrescente a linha aqui.

---

## Fila — as 20 decisões pendentes

Cada cartão de tipo `decisao` do ⧗ [`BACKLOG.md`](../backlog/BACKLOG.md) vira um ADR quando
for respondido. Elas estão aqui em ordem de quanto trabalho travam, não de importância
abstrata.

### Travam a Onda 0 — 10 cartões, 8 conversas

Dois pares são a mesma conversa e o ⧗ [`ROADMAP.md`](../backlog/ROADMAP.md) manda tratá-los
juntos, num PR só: `BANCO-030` + `BANCO-050` (a primeira é a forma executável da segunda) e
`PEDIDO-050` + `AUTH-020` (uma conversa, um documento). Logo: 10 cartões, **8 ADRs**.

> O ⧗ `ROADMAP.md` ainda fala em "9 decisões" para este mesmo conjunto. A aritmética correta
> é 8 — reconciliar no PR #9.

| Cartão | Prio | Decisão | Por que trava |
| --- | --- | --- | --- |
| `CHECKOUT-010` | P0 | A loja vai cobrar dentro do site ou a cobrança continua fora? | Define se `CHECKOUT-040` e `CHECKOUT-050` são trabalho de admin ou de webhook. É a decisão de maior alcance do backlog |
| `BANCO-040` | P1 | Qual política de backup e PITR está ativa no plano Supabase? | **Caminho crítico da onda.** Nada de banco avança sem saber se dá para voltar |
| `BANCO-050` | P1 | O que fazer com as 42 migrations pendentes e as 28 versões do ledger sem arquivo? | Enquanto não decidir, o repositório não é fonte de verdade do schema |
| `BANCO-030` | P1 | Estratégia de reconciliação do ledger de migrations | Forma executável da anterior — mesmo ADR |
| `AUTH-020` | P1 | Por que o OTP depende de um SEGUNDO projeto Supabase e quem tem acesso? | O envio do OTP de convidado está quebrado e ninguém sabe de quem é o projeto |
| `PEDIDO-050` | P1 | Destino do segundo projeto Supabase que envia o OTP | Mesma conversa da anterior — mesmo ADR |
| `PUSH-030` | P1 | As chaves VAPID estão configuradas no ambiente do `send-push`? | Sem isso, não dá para saber se push nunca funcionou ou parou de funcionar |
| `INFRA-060` | P1 | Qual é a fonte de verdade das variáveis de produção, e qual `DATABASE_URL` ficou viva depois da troca de 30/07? | São 11 arquivos `.env`. Dois devs mexendo sem essa resposta é erro garantido |
| `CATALOGO-020` | P1 | Por que o catálogo está travado em 200 produtos? | Trava `CATALOGO-070` e `BUSCA-020` |
| `FRETE-010` | P1 | Qual provedor de frete está ativo em produção: `flat_fee`, Melhor Envio ou Frenet? | Frete é a área com mais correção recente e ninguém sabe qual caminho está vivo |

### Travam as Ondas 1 e 2 — 5 cartões

O ROADMAP conta **quatro** aqui; a lista abaixo tem cinco. A diferença é `ADMIN-120`, que ele
classifica na Onda 2 como dívida e não como bloqueio. Reconciliar quando alguém puxar o
primeiro dos dois.

| Cartão | Prio | Decisão |
| --- | --- | --- |
| `ADMIN-020` | P1 | As colunas de vitrines e de banner completo entram no banco ou saem do código? |
| `FRETE-030` | P2 | Frete grátis só para logado é decisão de produto ou efeito colateral? |
| `PEDIDO-130` | P2 | Qual é a política de devolução e troca da loja? |
| `CHECKOUT-060` | P2 | A loja vai emitir nota fiscal? O CPF passa a ser obrigatório no checkout? |
| `ADMIN-120` | P2 | O que fazer com o `AdminBannersView.tsx`, que tem 5.385 linhas num componente? |

### Sem urgência — 5 cartões

| Cartão | Prio | Decisão |
| --- | --- | --- |
| `CATALOGO-100` | P2 | Os hard-codes de produto no `mappers.ts` podem sair? |
| `FRETE-040` | P3 | Por que R$ 15 é o fallback de frete e por que a tolerância é R$ 0,05? |
| `PWA-030` | P3 | Por que existem 13 ramos de `manualChunks` no `vite.config.ts`? |
| `SEO-020` | P3 | Vale investir em SSR ou prerender para o preview de link de produto? |
| `INFRA-240` | P3 | Vamos reescrever o histórico do git para tirar os 15,5 MB de screenshots? |

---

## Decisão sem cartão: a trava da `main`

Branch protection retorna **403** enquanto o repositório for privado num plano Free —
verificado na API: *"Upgrade to GitHub Pro or make this repository public to enable this
feature."* As saídas levantadas em 30/07/2026 são **GitHub Pro** (US$ 4/mês, mantém privado)
ou **repositório público com o histórico purgado**. Enquanto não houver decisão, a única
proteção é o hook `pre-push` local, contornável com `--no-verify`.

**Esta decisão não tem cartão no backlog.** O `INFRA-240` decide só se o histórico do git vai
ser reescrito — nenhum dos seus critérios de aceite menciona plano ou visibilidade do
repositório. As duas coisas se tocam (repositório público exige histórico purgado) mas não são
a mesma pergunta. **Abrir um cartão `decisao` próprio** e referenciá-lo aqui.

---

## Decisões já tomadas que ainda não têm ADR

Estas foram decididas e estão espalhadas em documento ou em commit. Escrever o ADR delas é
trabalho de baixa prioridade, mas some da memória rápido:

| Decisão | Onde está registrada hoje |
| --- | --- |
| GitFlow com `develop`, em vez de trunk-based | ⧗ [`CONTRIBUTING.md`](../../CONTRIBUTING.md) |
| Catraca de lint em vez de `continue-on-error` ou lint cru no CI | ⧗ comentário do job `lint` em `.github/workflows/ci.yml` (chega no PR #11) |
| Biome roda no CI e não no hook, por causa de CRLF vs LF | ⧗ comentário no `lefthook.yml` (chega no PR #11) |
| GitHub Projects = execução; Notion = produto e conhecimento | `docs/onboarding/PROMPTS-ONBOARDING-DEV.md` |
| TDD restrito ao fluxo de dinheiro | [`METODOLOGIA.md`](../processo/METODOLOGIA.md#24-tdd-só-no-fluxo-de-dinheiro--e-é-aqui-que-começa) |
| Adiar a trava da `main` em 30/07/2026 | ⧗ [`CONTRIBUTING.md`](../../CONTRIBUTING.md#a-trava-que-não-existe) |
