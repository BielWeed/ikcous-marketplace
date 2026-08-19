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

**O critério que substitui:** o app tem que funcionar de verdade, para qualquer loja. Defeito,
tela que promete o que o sistema não cumpre, caminho do dinheiro, painel operável por alguém
leigo — essas são razões válidas, **porque valem para toda loja**, não porque alguém pediu.

**Ao montar prompt de subagente, plano ou decisão:** se aparecer nome próprio de loja, cliente,
assinatura ou clone como *justificativa*, apagar e refazer. Este arquivo carrega sozinho em toda
sessão deste projeto justamente porque a versão anterior desta regra morava numa memória que
precisava ser aberta, e em 18/08/2026 uma decisão inteira foi montada em cima de uma lojista
com a regra escrita e não lida.

O rumo que fica, palavras dele em 18/08/2026: *"tudo deve ser desenvolvido como se esse app
fosse para funcionar de verdade em uma loja"* — nada de recurso desligado por conveniência.

---

## Como esta sessão trabalha — o processo NÃO mora aqui

**Quem decide modelo, esforço, delegação, revisão, paralelismo, custo e segurança é
`~/.claude/CLAUDE.md`**, que carrega em toda sessão de todo projeto. Este arquivo declara
**terreno**: o que dói neste repositório e em nenhum outro.

> Até 19/08/2026 esta seção redefinia o processo aqui — e ficou para trás. A tabela de equipe
> conhecia dois subagentes; a configuração global já tem dez, incluindo o `implementador-denso`,
> que é **obrigatório** para dinheiro, autenticação, permissão, dado de cliente e migração — ou
> seja, quase toda a superfície deste repositório. Processo duplicado num projeto não fica
> igual: fica velho. Para **regra escrita**, se algo aqui contradisser a configuração global, a
> global ganha, e eu aviso o Gabriel em vez de obedecer em silêncio.

### ⚠️ Exceção que NÃO segue essa regra: `implementador` e `revisor` são sombreados aqui

Para **resolução de subagente por nome** a precedência é a oposta. A documentação oficial define
que, com nomes iguais, vence a localização de maior prioridade — e `.claude/agents/` do **projeto**
tem prioridade sobre `~/.claude/agents/` do usuário.

Este repositório tem [.claude/agents/implementador.md](.claude/agents/implementador.md) e
[.claude/agents/revisor.md](.claude/agents/revisor.md) próprios. **Chamar esses dois nomes aqui roda
a definição local, não a global**, e a local está uma geração atrás. Não dá para saber isso pela
chamada: nada avisa.

| | local | global |
|---|---|---|
| `implementador` | sem `effort`, sem a skill `executar-tarefa` | `effort: medium` + a skill |
| `revisor` | sem `effort` | `effort: high` |

- **Todos os outros oito nomes** — `implementador-denso`, `executor-rapido`, `diretor`, `socio`,
  `auditor`, `investigador`, `triador`, `manutentor` — não têm cópia local e usam a global.
- Enquanto as cópias existirem, tratá-las como a fonte da verdade para esses dois nomes — inclusive
  ao ler instrução de segurança dentro delas, que pode estar vencida pelo mesmo motivo.

As regras de produto, PWA, Supabase e MCP continuam em [AGENTS.md](AGENTS.md); as de
contribuição, em [CONTRIBUTING.md](CONTRIBUTING.md). Não duplique conteúdo aqui.

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

## A superfície de risco DESTE repositório

A configuração global manda: o que toca dinheiro, autenticação, permissão, dado de cliente,
migração ou contrato entre módulos se escreve com `implementador-denso` e se revisa com **Opus**,
independente do tamanho do diff. **Aqui está o mapa de quais caminhos são esses**, que é a parte
que só este repositório sabe:

| Caminho / assunto | Por que dói |
|---|---|
| `supabase/migrations/` | grava em produção; backup diário e **sem PITR** |
| RLS, `SECURITY DEFINER` | quem enxerga dado de quem |
| `supabase/functions/` | `criar-pagamento`, `webhook-mercadopago`, `reconciliar-pagamentos`, OTP |
| checkout e caminho do pagamento | **move dinheiro de verdade** — ver *Onde o risco realmente mora* |
| auth / OTP | um deploy sem `--no-verify-jwt` derruba o login |
| service worker | PWA servindo versão velha para todo mundo |
| qualquer assinatura consumida por outro módulo | quebra silenciosa fora do diff |

Fora dessa lista — UI, cópia, estilo, util puro já coberto por teste, `scripts/`, documentação —
vale o degrau normal e revisão em Sonnet.

**Neste repositório os erros mais caros foram triviais de escrever**, e é por isso que tamanho de
diff não decide nada aqui: `BEGIN`/`COMMIT` numa migration (duas palavras, gravou em produção),
deploy sem `--no-verify-jwt` (uma flag, derrubou o OTP), remetente do Resend em sandbox (uma
linha, e nenhum e-mail chega a cliente).

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

### 🔴 Leia isto antes de finalizar um pedido pela tela

**A cobrança pelo site está LIGADA — o checkout cobra dinheiro de verdade.** Lastro versionado,
no [CHANGELOG.md](CHANGELOG.md), release 1.4.0: `VITE_PAGAMENTO_ONLINE` passou a existir em
Production em 17/08/2026 junto com `VITE_MP_PUBLIC_KEY`, e o Gabriel confirmou em 18/08/2026 que
o PIX via Mercado Pago está ativo no app. A 1.3.0 subiu com o caminho **inerte**; a partir da
1.4.0, não.

Consequência prática, e ela contraria um runbook deste próprio repositório: o
[DEPLOYMENT.md](DEPLOYMENT.md) manda "conclua o pagamento de teste" citando esta seção como
tranquilizante. **Concluir aquele PIX gera cobrança real.** Mexer em checkout, `criar-pagamento`,
`webhook-mercadopago` ou `reconciliar-pagamentos` deixou de ser mudança em caminho morto.

⚠️ **E não dá para conferir olhando o segredo:** na Orders API, credencial de teste e de produção
começam as duas com `APP_USR` — o prefixo **não** indica ambiente (`DEPLOYMENT.md`).

*O estado das variáveis vive na Vercel e no Supabase, fora do repositório. O que está versionado é
o CHANGELOG acima; se passar muito tempo, reconfirmar em vez de supor que desligou.*

### O resto do risco

**Este repositório é o app de desenvolvimento — o molde, não uma loja.** Quando uma assinatura
é vendida, os arquivos são clonados e a loja do cliente é montada separada. O Supabase ligado
aqui é de desenvolvimento: medido em 10/08/2026, tem 64 pedidos em 5 meses com **um único
e-mail de cliente distinto** (57 deles cancelados) e 22 produtos. Não há negócio rodando nele.

Isso **desloca** o risco, não o remove — e a direção importa, porque a versão anterior desta
seção apontava para o lado errado e cobrava um preço que não existia:

- **Escrever neste banco é barato — catálogo, produto, CMS, massa de teste.** Não suja catálogo
  de cliente nenhum; suja massa de desenvolvimento que você mesmo montou. Higiene (produto de
  teste com nome óbvio, limpar depois) continua boa prática — não é contenção de incidente.
  **A exceção é o checkout**, pelo motivo do bloco vermelho acima: ali o "pedido de teste pela
  tela" custa dinheiro de verdade.
- **E todo defeito daqui é replicado em cada loja vendida.** Este repositório é o molde: o app do
  cliente é clone deste e recebe daqui toda atualização, para sempre. O rigor é sobre o que se
  replica **e** sobre o que já move dinheiro aqui — os dois, não um ou outro.

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

## Armadilhas conhecidas — cada uma já custou tempo aqui

O item de maior valor deste arquivo. Uma linha cada, com o que ela custou.

**Deploy e ambiente**

- **Merge NÃO é estar no ar.** A Vercel sobe sozinha no merge; o Supabase **só sobe à mão**. Em
  16/08/2026 a edge function no ar estava **duas entregas velha**, e um teste teria morrido no
  fantasma errado. Comparar `UPDATED_AT` da function com o `git log` da pasta **antes** de testar.
- **`functions download` devolve transpilado.** O diff contra o repo acusa remoções que não
  existem, e o número de versão sobe sozinho em rebuild de plataforma. Olhar `UPDATED_AT`, nunca
  `VERSION`.
- **O `verify_jwt` É versionado desde 07/08/2026** — em [supabase/config.toml](supabase/config.toml),
  pela #162. A precedência está **medida no CLI** e escrita lá; não suponha outra:
  `--no-verify-jwt` (flag) **>** `verify_jwt` do `config.toml` **>** preserva o que já está no
  servidor. Duas consequências que o próprio arquivo declara: função **sem entrada** ali não é
  revertida (o CLI omite o campo e a API preserva) — o custo de omitir é o repositório voltar a
  mentir sobre ela; e **o arquivo não protege contra a flag**, então quem digitar
  `--no-verify-jwt` na função errada continua ganhando de tudo que está escrito.
- ⚠️ **Hoje o `config.toml` e o servidor divergem, de propósito.** A `calculate-shipping` foi
  publicada à mão em 18/08/2026 preservando `verify_jwt: false`, que era o estado no ar, enquanto
  o `config.toml` declara `true` — para não mudar trava de segurança de carona numa correção de
  frete ([CHANGELOG.md](CHANGELOG.md), 1.4.0). **Quem deployar essa função sem a flag aplica o
  `true` do arquivo.**
- **O seletor interativo do Supabase oferece outro projeto ANTES deste**, e dar Enter direto publica
  no lugar errado **sem erro nenhum**. Sempre fixar o destino: `--project-ref cafkrminfnokvgjqtkle`.
  O `project_id` do `config.toml` é identificador **local** e não escolhe destino de deploy.
  ⚠️ As duas fontes do repositório discordam sobre o que é o outro projeto — o `config.toml` o
  chama de sandbox, o `DEPLOYMENT.md` o identifica como `ikcous-mkt-priemira-cliente`. Enquanto
  isso não for resolvido, trate como se pudesse ser banco de cliente.

**Migrations**

- **`db-apply` pula verificação em silêncio.** Migration sem entrada no mapa `VERIFICACOES` é
  pulada **e ainda imprime "Tudo aplicado e verificado"**. Reescrever função já guardada por uma
  migration nova desliga a guarda dela sem avisar.

**Mercado Pago**

- **A doc e o SDK erram metade cada um.** A doc erra a unidade do `ts`; o SDK erra o casing do
  `data.id`. Custou **100% dos PIX da Orders API recusados com 401**. A correção aceita as duas
  grafias — não "consertar" para uma só.
- **A assinatura do webhook é por APLICAÇÃO.** Trocar de aplicação no MP invalida o
  `MP_WEBHOOK_SECRET` e dá 401 em 100% dos avisos.
- **O simulador do painel do MP PASSA e esconde o defeito.** Com `data.id` **numérico** as duas
  grafias produzem HMAC **idêntico** — por isso o simulador nunca detectou a divergência. Elas só
  divergem para o **ULID** (`ORD…`) da Orders API, que é exatamente o caso que quebrou em
  produção. **Simulador verde não prova nada sobre a assinatura real** (ver o comentário em
  [supabase/functions/_shared/mercadopago.ts](supabase/functions/_shared/mercadopago.ts)).

**E-mail**

- **Existem DOIS caminhos de e-mail, e só um está quebrado.** Confundi-los manda quem depura para
  o subsistema errado:
  - **Pela edge function** ([send-otp-email](supabase/functions/send-otp-email/index.ts)): fala com
    o Resend com remetente `onboarding@resend.dev`, que **só entrega ao dono da conta** (#161). É o
    código de verificação do rastreio de pedido — esse **não chega a cliente**.
  - **Pelo Supabase Auth:** recuperar senha e confirmar cadastro **saem normalmente, pelo Gmail** —
    medido no painel em 13/08/2026 ([CHANGELOG.md](CHANGELOG.md)). Não é o Resend, e não está no
    repositório.
- **O aviso de pedido novo NÃO é e-mail.** A [notify-new-order](supabase/functions/notify-new-order/index.ts)
  é Web Push, e o cabeçalho dela diz em voz alta que não manda e-mail (#106) e não grava em
  `notificacoes` (#107). Lojista sem aviso é problema de push, não de Resend.
- **Não existe SMTP neste repositório** — a saída da edge function é HTTP para a API do Resend.
  Procurar `nodemailer`/`smtp`/porta 465 ou 587 não acha nada, e não é omissão. O Gmail que já
  funciona é o do Auth, configurado fora daqui; o que **não** migrou é o caminho da edge function.
