# Primeira semana do Netim

Cinco dias, de zero até o primeiro PR mergeado. O plano é agressivo de propósito: um dev
sênior aprende sistema mexendo nele, não lendo sobre ele. O que ele não tem é contexto — e
contexto se transfere rápido quando alguém organiza a transferência.

**Tempo do Gabriel reservado na semana: 5h15 nos blocos de trabalho, mais 30 min do
planejamento de segunda — cerca de 6 horas.** Se a semana cair na primeira do mês, some mais
30 min da revisão do backlog. Está distribuído dia a dia abaixo. Se ele não conseguir
reservar, o plano escorrega — e é melhor saber disso na segunda do que na quinta.

---

## Antes do dia 1 — o que precisa estar pronto

Sem isto, a segunda-feira do Netim é perdida.

| Item | Quem faz | Estado |
| --- | --- | --- |
| Convite de colaborador no GitHub | Gabriel | ✅ feito — `wpfsilvaa`, permissão de escrita, sem convite pendente |
| Convite no projeto Supabase `cafkrminfnokvgjqtkle` | Gabriel | pendente (Settings → Team) |
| Convite no projeto Vercel `ickous-marketplace` | Gabriel | pendente |
| Canal do projeto no Discord | Gabriel | pendente |
| **PRs de onboarding mergeados** | Gabriel | ver abaixo |
| Variáveis de ambiente enviadas por canal privado | Gabriel | pendente — **nunca por commit** |

> **Corrigir junto:** o comentário do `.github/CODEOWNERS` (PR #11) diz que "o Netim ainda
> não é colaborador do repositório". Ele já é. Acrescentar `@wpfsilvaa` na linha `*` e apagar
> o comentário, no próprio PR #11 — senão os dois documentos chegam na mesma segunda dizendo
> coisas opostas.

**Os PRs precisam estar mergeados antes da segunda**, porque o dia 1 inteiro consiste em ler
o que está dentro deles:

| PR | O que traz | Sem ele, o Netim não tem |
| --- | --- | --- |
| #8 | `docs/onboarding/01` a `05` | o mapa do projeto |
| #9 | `06-ESTADO-ATUAL.md`, `docs/backlog/` | o que está quebrado e o que fazer |
| #11 | `CONTRIBUTING.md`, CI, hooks, templates, `npm test`, typecheck de verdade | o processo e a rede de segurança |
| #10 | limpeza da raiz | uma árvore de trabalho sem os 205 screenshots versionados |

Duas observações honestas sobre esse lote:

- **A cadeia #8 → #9 mira a `main`; a #10 / #11 mira a `develop`.** `docs/backlog/` só
  aparece na `develop` depois de um backmerge `main → develop`. Vale fazer o backmerge antes
  da segunda.
- **O PR #10 limpa a árvore de trabalho, não o clone.** Os 15,5 MB de screenshots continuam
  no histórico: `.git` tem ~33 MB e continua tendo. Quem resolve isso é a decisão de
  `INFRA-240`, ainda aberta.

Se algum PR não estiver mergeado na segunda de manhã, **mergeie primeiro** — inclusive fora
do GitFlow, se for o caso. Documentação presa em PR não documenta ninguém.

---

## Dia 1 — Entender, rodar, perguntar

**Objetivo do dia:** o app rodando na máquina dele e uma lista de perguntas boas.
**Não é para produzir código.** Nenhuma linha.

### O que ler, nesta ordem

1. `docs/onboarding/01-VISAO-GERAL.md` — especialmente *"As 10 coisas que você precisa saber
   antes de tocar em qualquer coisa"*
2. `docs/onboarding/03-SETUP-AMBIENTE.md` — **antes** de tentar rodar qualquer comando. As
   armadilhas estão todas ali, e duas delas custam meia hora cada se descobertas na marra.
   **Ressalva:** a seção 2, passo 2 daquele documento diz que "a branch `develop` ainda não
   existe no `origin`" e manda ramificar de `main`. Está vencido — a `develop` existe, é a
   branch padrão do repositório, e toda branch nova sai dela
3. `docs/onboarding/02-ARQUITETURA.md` e `04-GLOSSARIO.md` — o glossário resolve os nomes
   inventados (DataVault, shared-brain, silent-guardian, nuclear purge)
4. `docs/onboarding/06-ESTADO-ATUAL.md` — o semáforo e os 5 riscos. **Nenhuma área saiu 🟢**
5. `CONTRIBUTING.md`, seção *"A trava que não existe"* — a mais importante do documento
6. `docs/processo/` — este plano, [`METODOLOGIA.md`](METODOLOGIA.md),
   [`RITUAIS.md`](RITUAIS.md), [`DEFINITION-OF-DONE.md`](DEFINITION-OF-DONE.md)

### O que fazer

```bash
gh repo clone BielWeed/ikcous-marketplace
cd ikcous-marketplace
npm install --legacy-peer-deps
npm run dev
```

`--legacy-peer-deps` não é opcional: é o que a própria Vercel usa
(`vercel.json:4`, `"installCommand": "npm install --legacy-peer-deps"`). O `README.md` diz
`npm install` puro e está desatualizado.

Depois do merge do PR #11, o `npm install` também instala os hooks de git (script `prepare`).
Confira com:

```bash
npx lefthook validate
```

Antes do #11 mergear esse comando falha com "No config files have been found" — é esperado,
o `lefthook.yml` chega com ele.

Por fim, rodar o **prompt 6** (`docs/onboarding/PROMPTS-ONBOARDING-DEV.md`, seção *Tour
guiado*) no Claude Code, dentro do repositório. É uma conversa; dura o que ele quiser.

**As três armadilhas do dia 1**, para não perder a tarde nelas:

| Sintoma | Causa | O que fazer |
| --- | --- | --- |
| Tela vermelha "🚨 ERRO DE AMBIENTE" (ou 85% eterno, em branch antiga sem a guarda) | Um `vercel env pull` regravou `.env.production.local` com `VITE_SUPABASE_URL=""`, e no Vite ele tem precedência sobre `.env.production` | É ambiente, não código. As três linhas ficam **comentadas** de propósito — não descomente. `03-SETUP-AMBIENTE.md`, armadilha 1 |
| `npm run build` gera bundle enorme | `NODE_ENV=development` vazando do shell | `NODE_ENV=production npm run build` |
| `npm run typecheck` termina em 1 segundo | O `tsconfig.json` da raiz tem `"files": []`, então `tsc --noEmit` analisa zero arquivo | Confira se o **PR #11 já mergeou** (lá o script vira `tsc -b --force`). Enquanto não mergeou: `npx tsc -p tsconfig.app.json --noEmit` |

### O que entregar

- `docs/onboarding/PERGUNTAS-NETIM.md`, gerado pelo prompt 6: perguntas sem resposta, onde a
  documentação diverge do código, e o que mais surpreendeu
- Uma mensagem no Discord com as **três perguntas mais bloqueantes**

### Tempo do Gabriel: ~1h30 (+30 min do planejamento de ciclo às 19h)

- 30 min no começo do dia: entrega de acesso e das variáveis, e um "por onde começar" falado
- 1h no fim do dia: responder a lista. **Toda resposta que muda o que alguém vai codar vira
  comentário na issue ou ADR** — não morre no Discord
- 19h00: o [planejamento de ciclo](RITUAIS.md#1-planejamento-do-ciclo) normal. Os cartões dos
  dias 2 a 4 são escolhidos ali, não aqui

---

## Dia 2 — Primeiro cartão, começando em par

**Objetivo:** primeiro PR aberto.
**Cartão: `PEDIDO-060` — Mostrar o código de rastreio para o cliente.**

Por que esse: atravessa a fatia de dados inteira numa tacada fina — coluna do banco →
`src/lib/mappers.ts` → `src/hooks/useOrders.ts` → tela do cliente. Ensina por que existe uma
camada de mappers traduzindo o formato do banco para o formato do app, entrega valor visível
ao comprador, e é **leitura pura**: nenhuma escrita, nenhuma migration. Risco baixo,
tamanho P.

### O que ler antes

- ⧗ `docs/onboarding/05-FLUXOS-CRITICOS.md`, fluxo 4 (admin muda status → cliente recebe push)
- O cartão inteiro em ⧗ `docs/backlog/BACKLOG.md`
- ⧗ `CONTRIBUTING.md`, seção *Abrindo um PR*

### Como o dia acontece

- **Primeira hora, em par** (obrigatório pela
  [`RITUAIS.md`, §4a](RITUAIS.md#4a-sessão-de-par--marcada-até-90-min)): Gabriel compartilha a
  tela e mostra o caminho do dado, do `tracking_code` no banco até a tela. O Netim dirige e
  pergunta. É uma sessão de **transferência de contexto** — a regra de "trocam na metade" não
  se aplica: o Gabriel mostra o caminho e sai. **Não é para ele resolver o cartão.**
- **Resto do dia, sozinho:** implementa, abre o PR contra `develop`.

### O que entregar

- PR aberto contra `develop`, com o "Como testar" preenchido de forma reproduzível
- Os cinco jobs do CI verdes
- Testado no **preview do PR na Vercel**, não só no `localhost` (item 4 da
  [DoD](DEFINITION-OF-DONE.md#definition-of-done))

### Tempo do Gabriel: ~1h30

- 1h de sessão de par
- 30 min de revisão do PR no fim do dia. **Revisar no mesmo dia é o que faz esta semana caber
  em cinco dias**

> **Gabriel: nesta semana, não mexa em `src/lib/mappers.ts` nem em `src/hooks/useOrders.ts`.**
> São os arquivos do cartão do Netim, e o ROADMAP marca `mappers.ts` como conflito garantido
> quando tem mais de um dono. Isso é o "dono por ciclo" do planejamento de segunda.

---

## Dias 3 e 4 — Primeiro cartão sozinho

**Objetivo:** um PR aberto sem par, e o primeiro PR mergeado.
**Cartão: `BUSCA-010` — Normalizar acentuação nos três pontos de busca do cliente.**

Por que esse: revela que existem **três implementações independentes de busca** no cliente
(`src/hooks/useSearch.ts:22-28`, `src/components/ui/custom/SearchBar.tsx` em nove pontos
entre `:108` e `:173`, e `src/views/customer/HomeView.tsx:129-136`) e que `src/lib/utils.ts`
é onde regra repetida deveria morar. É a lição de arquitetura mais barata do projeto. E tem
valor direto em venda: quem digita "alianca" sem cedilha hoje não acha o produto, mesmo com
ele ativo e em estoque — e no teclado do celular isso é o padrão.

Tamanho `M`, risco baixo, área diferente da do dia 2 de propósito: duas áreas na primeira
semana ensinam mais que duas tarefas na mesma.

> **Sobre a sequência do ROADMAP.** Ele prevê puxar **uma** das duas para o começo:
> `PEDIDO-060` (formalmente Onda 2) **ou** `BUSCA-010` (Onda 1). Esta semana puxa as duas, de
> propósito — e é justamente `BUSCA-010` que sai se a semana apertar (ver *Se a semana der
> errado*, modo 2).

### O que ler antes

- O cartão inteiro `BUSCA-010`, incluindo o critério de aceite
- `src/hooks/useCategories.ts:121` — a normalização por NFD **já existe** ali. O cartão pede
  para extrair esse padrão para `src/lib/utils.ts`, não para inventá-lo
- ⧗ `CONTRIBUTING.md`, seção *Abrindo um PR* → "O que o revisor procura"

### Como os dois dias acontecem

- **Dia 3:** implementa. O `PEDIDO-060` do dia 2 volta com comentários de revisão — responde e
  ajusta. **Merge do primeiro PR acontece aqui.**
- **Dia 4:** fecha o `BUSCA-010`, abre o PR. Sem par. Se travar mais de 40 minutos, chama uma
  [sessão de arqueologia](RITUAIS.md#4b-sessão-de-arqueologia--imediata-20-min) — travar
  sozinho por orgulho é exatamente o que a regra existe para evitar.

### Armadilha específica deste cartão

O critério de aceite exige normalizar **os dois lados** da comparação, nos **três** arquivos.
Esquecer um lado é o erro clássico: a busca passa a funcionar num caminho e continua quebrada
nos outros dois, e ninguém percebe porque a tela parece certa. E:
`src/components/ui/custom/SearchBar.tsx:171` quebra hoje com produto de `description` nula —
isso está no aceite.

### O que entregar

- `PEDIDO-060` **mergeado**
- `BUSCA-010` com PR aberto e CI verde
- Os dois cartões com todos os itens do critério de aceite verificados um a um, com o **como**
  registrado no comentário da issue

### Tempo do Gabriel: ~1h15

- 30 min no dia 3: revisão do PR do `PEDIDO-060` e merge
- 45 min no dia 4: revisão do `BUSCA-010` e disponibilidade para desbloquear

---

## Dia 5 — Retro do onboarding

**Objetivo:** transformar o que faltou na documentação em cartão. Esta é a única chance de
capturar o olhar de quem chegou de fora — daqui a duas semanas o Netim já vai achar tudo
óbvio e a informação some.

**Esta retro substitui o [fechamento de ciclo](RITUAIS.md#3-fechamento-do-ciclo--retro) desta
sexta.** Quem conduz continua sendo o Netim, como em qualquer retro.

### O que ler antes

- O próprio `docs/onboarding/PERGUNTAS-NETIM.md` que ele gerou no dia 1
- [`docs/decisoes/0000-template.md`](../decisoes/0000-template.md) — ele vai escrever ADR

### Como acontece

1. **(20 min, em chamada)** As três perguntas do fechamento de ciclo, aplicadas ao
   onboarding: o que atrapalhou, o que funcionou, e **um** combinado. Mais o número da
   semana: quantos cartões fecharam.
2. **(40 min, o Netim escreve, com o Gabriel disponível para responder)** Cada item do
   `PERGUNTAS-NETIM.md` vira uma destas três coisas, e nada fica sem destino:

| O que era | Vira |
| --- | --- |
| A documentação não respondia | Cartão de tipo `doc`, com a pergunta no corpo |
| A documentação estava errada ou desatualizada | Cartão de tipo `doc`, prioridade `P2` — documentação errada é pior que ausente |
| Era decisão do Gabriel que nunca foi escrita | ADR em [`docs/decisoes/`](../decisoes/) |

### O que entregar

- Cartões criados no board, não uma lista no Discord
- O primeiro combinado de ciclo escrito
- O `PERGUNTAS-NETIM.md` atualizado com o destino de cada item

### Tempo do Gabriel: ~1h

- 20 min de retro
- 40 min respondendo o que virou ADR — **esta é a hora mais valiosa da semana dele**, porque
  é a que tira conhecimento da cabeça dele de forma permanente

---

## O que **não** fazer nesta semana

Não é desconfiança. É que cada item destes custa dias e o Netim não tem como saber ainda.

| Não faça | Por quê |
| --- | --- |
| `supabase db push` | É a regra 9 de `03-SETUP-AMBIENTE.md`, seção 6. Um `push` aborta na 26ª migration; as 25 que rodam antes somam **190 `DROP POLICY` contra 127 `CREATE POLICY`**, e as que reconstroem o RLS estão depois do ponto de falha — RLS desmontado pela metade, com a loja no ar |
| Escrita no banco de produção | As regras 9 a 12 são proibições; as 5 a 8 permitem escrita **depois de avisar e receber resposta**. Nesta primeira semana, trate as 5 a 8 também como "passa pelo Gabriel" — depois dela, vale a regra escrita. A regra 12 (nunca colar credencial fora do `.env` local) vale desde a primeira hora, já que você vai receber variáveis por canal privado |
| Mexer em `src/contexts/StoreContext.tsx` ou `CartContext.tsx` | São o núcleo e o pior gargalo de conflito do projeto. Ficam para a Onda 1, com trilha definida |
| Pegar cartão de tipo `decisao` | São 20, e todas dependem de resposta do Gabriel. Não são trabalho de dev |
| "Aproveitar e arrumar o lint" | 553 warnings pré-existentes (medidos no CI). Existe cartão próprio (`INFRA-250`). PR de bug com 40 arquivos reformatados é PR irrevisável |
| `npm run lint -- --fix` no repositório inteiro | Mesmo motivo. E o Biome ainda reescreveria tudo por CRLF vs LF — sem `--`, aliás, o npm come a flag e o eslint nunca a recebe |
| Commitar direto na `main` ou na `develop` | O hook recusa. E se você usar `--no-verify`, avise no Discord |

---

## Se a semana der errado

Três modos de falha prováveis, e o que fazer em cada um:

1. **Os PRs de onboarding não foram mergeados a tempo.** Nenhuma branch sozinha tem tudo, e
   trocar de branch não resolve. Leia por `git show`, sem sair da sua branch:
   ```bash
   git show 'docs/onboarding-mapa-projeto:docs/onboarding/01-VISAO-GERAL.md'
   git show 'docs/estado-e-backlog:docs/onboarding/06-ESTADO-ATUAL.md'
   git show 'docs/estado-e-backlog:docs/backlog/BACKLOG.md'
   git show 'chore/gitflow-e-ci:CONTRIBUTING.md'
   ```
   O resto escorrega um dia. Não tente compensar cortando o dia 5 — a retro é a parte que
   melhora o onboarding do próximo.
2. **O Gabriel não conseguiu reservar as ~6 horas.** Corte o segundo cartão (`BUSCA-010`),
   não a sessão de par nem a retro. Um PR mergeado com contexto vale mais que dois sem.
3. **O `PEDIDO-060` mostrou que a coluna não está no banco.** É possível: o cartão diz que
   `tracking_code` já chega mapeado, com evidência em `src/lib/mappers.ts:234` e
   `src/hooks/useOrders.ts:343`, mas ninguém confirmou contra o banco ao vivo. Se não estiver,
   **pare** — vira cartão que toca banco, com processo próprio, e o Netim troca para
   `PUSH-020`, que é do mesmo tamanho e não toca banco.

---

## Fechamento

No fim da sexta, o Netim deve conseguir responder três coisas sem consultar ninguém:

1. Onde mexer para alterar o preço de um produto
2. Por que existe um `state-worker.ts`
3. O que acontece entre clicar em "finalizar pedido" e a mensagem chegar no WhatsApp

Se alguma resposta não vier, **a falha é da documentação, não dele** — e ela vira cartão de
tipo `doc` no mesmo dia.
