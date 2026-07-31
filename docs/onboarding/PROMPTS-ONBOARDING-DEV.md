# Prompts de Onboarding — IKCOUS Marketplace

**Criado em:** 30/07/2026
**Pra quê:** entrada de um segundo dev (Netim) no projeto, com organização de tasks, metodologia e versionamento padronizado.
**Como rodar:** Claude Code, modo **ultracode**, modelo **Opus 5**, um prompt por vez.

---

## O que cada prompt resolve

O Netim levantou quatro coisas no WhatsApp. Cada uma tem um prompt (ou dois) dedicado:

| O que ele falou | Prompt |
| --- | --- |
| *"preciso entender o projeto"* | **1** — Mapa do Projeto |
| *"eu não consigo entender o que falta"* | **2** — Estado Real & Backlog |
| *"quadro kanban pra organizar as tasks"* | **5** — Kanban duplo (GitHub Projects + Notion) |
| *"termos uma metodologia, por exemplo extreme programming"* | **4** — Metodologia XP |
| *"padronizar o versionamento / não comitar na principal"* | **3** — Versionamento GitFlow |
| — (extra) primeiro dia dele no projeto | **6** — Tour guiado, rodado pelo próprio Netim |

---

## Ordem de execução

Os prompts têm dependência real entre si. Rodar fora de ordem gera trabalho jogado fora.

```text
1. Mapa do Projeto ───────────┐
                              ├──> 5. Kanban (precisa do backlog do 2)
2. Estado Real & Backlog ─────┘
                                        ↓
3. Versionamento GitFlow ──> 4. Metodologia XP
                                        ↓
                              6. Tour guiado (o Netim roda)
```

- **1 e 2 podem rodar em paralelo** (sessões diferentes) — não se tocam.
- **3 antes de 4**: a metodologia referencia o fluxo de branches como fato consumado.
- **5 depois de 2**: o Kanban importa as tasks que o prompt 2 gera.
- **6 por último**, e é o Netim quem roda, na máquina dele.

**Tempo estimado:** prompts 1 e 2 são pesados (30–60 min cada em ultracode). 3, 4 e 5 são mais rápidos (15–30 min). O 6 é uma conversa, dura o que ele quiser.

---

## Pré-requisitos antes de começar

### 1. Escopo do token do GitHub CLI

O `gh` está autenticado como `BielWeed`, mas com escopos `gist, read:org, repo`. **Falta `project`** — sem ele o prompt 5 não consegue criar o board. Roda antes:

```bash
gh auth refresh -s project,read:project
```

### 2. Acessos pro Netim (fazer manualmente, não é coisa de prompt)

- **GitHub**: convidar como colaborador em `BielWeed/ikcous-marketplace`. O repositório virou **privado** em 30/07/2026, então sem convite ele não consegue nem ler o código. Repositório de conta pessoal só tem dois níveis — dono e colaborador (write); não existe `maintain` aqui.
- **Supabase**: convidar no projeto `cafkrminfnokvgjqtkle` (Settings → Team). Você escolheu dar acesso à produção — o prompt 1 vai gerar as regras de segurança pra isso não virar problema.
- **Vercel**: convidar no projeto `ickous-marketplace` pra ele ver os preview deploys.
- **Discord**: canal do projeto, que virou o lugar de organização.

### 3. Antes de rodar o prompt 3

O prompt 3 mexe em configuração de repositório (branch protection, CI, hooks). Garanta que a árvore está limpa e que não tem nada em andamento em branch local.

---

## Bloco de Contexto Base

**Cole este bloco no início de qualquer prompt de 1 a 5.** Ele existe porque cada sessão do Claude começa do zero, e sem esses fatos o agente reaprende (caro) ou erra (pior).

````text
=== CONTEXTO BASE — IKCOUS MARKETPLACE ===

REPOSITÓRIO
- github.com/BielWeed/ikcous-marketplace, branch principal `main`
- Caminho local: C:\Users\Gabriel\Documents\software Gerenciador ecossistema ikcous\projects\core_app_mkt
- Marketplace de produtos com estoque imediato em Monte Carmelo/MG. Checkout finaliza no WhatsApp.
- Deploy: Vercel, domínio `ickous-marketplace.vercel.app`

STACK
- Frontend: Vite 7 + React 19.2 + TypeScript 5.9 + Tailwind 3.4 + Radix UI + Framer Motion + Zod
- PWA: vite-plugin-pwa, Service Worker com injectManifest, offline-first
- Backend: Supabase (Postgres + Auth + Realtime + Storage), projeto `cafkrminfnokvgjqtkle`
- Edge Functions: Deno — `calculate-shipping`, `send-otp-email`, `send-push`
- ~176 arquivos TS/TSX em src/, ~72.600 linhas

ESTRUTURA
- src/views/customer (14 telas), src/views/admin (17 telas), src/views/shared (1)
- src/contexts (6): Auth, Cart, Favorites, Notification, NotificationCore, Store
- src/hooks (35), src/components, src/lib, src/utils, src/sw, src/types, src/config
- src/shared-brain.ts, src/state-worker.ts, src/pwa-sentinel.ts — infra própria de estado/PWA
- supabase/migrations, supabase/functions, supabase/tests, supabase/setup
- docs/superpowers/{specs,plans} — specs e planos de trabalhos anteriores

FONTE DE VERDADE SOBRE PROBLEMAS CONHECIDOS
- `AUDITORIA_2026-07-29.md` na raiz (322 KB, untracked). Auditoria multi-agente de 29/07/2026:
  76 achados confirmados (8 críticos, 27 altos, 39 médios, 2 baixos) + 9 achados de runtime (R1–R9).
  Cada achado tem arquivo:linha, passo de reprodução, evidência e correção proposta.
- Os 8 críticos colapsam em 5 causas-raiz (A–E). A, B, C, D, E, R1, R2, R3 e R5 já foram
  CORRIGIDOS e verificados em 29/07. NÃO assuma que continuam quebrados — verifique no código.
- Ressalva do próprio relatório: taxa de refutação foi baixa (2 de 78), então os verificadores
  foram mais confirmatórios do que o ideal. Trate cada achado como forte indício, não sentença.

REGRAS INVIOLÁVEIS (violar qualquer uma destas causa dano real)

1. NUNCA rodar `supabase db push`.
   O histórico de migrations diverge muito do banco de produção: ~50 migrations locais nunca
   foram aplicadas e ~25 migrations existem em produção sem arquivo local. Um `db push` tentaria
   replayar 50 migrations (incluindo reescritas de RLS e GRANT/REVOKE) num banco divergente,
   numa loja no ar. Para alterar o banco: uma migration por vez, conferindo antes se o corpo
   da função ao vivo bate com o arquivo-base, via
   `SELECT pg_get_functiondef(p.oid) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname='public' AND p.proname='<funcao>';`

2. A migration `supabase/migrations/20260729000002_shipping_quote_validation_v23.sql` está
   VALIDADA (14/14 em transação com ROLLBACK) mas AINDA NÃO APLICADA em produção. Não assuma
   que a RPC `create_marketplace_order_v23` está no banco. Rollback pronto na raiz do repo.

3. `.env.production.local` tem `VITE_SUPABASE_URL=""` e `VITE_SUPABASE_ANON_KEY=""` (gerado por
   `vercel env pull`). No Vite esse arquivo tem precedência sobre `.env.production`, então todo
   build local sai sem chaves → tela branca travada em 85%. Isso é ambiente, não código.

4. `NODE_ENV=development` está setado no shell desta máquina. `npm run build` sem override gera
   bundle de DESENVOLVIMENTO. Para medir bundle: `NODE_ENV=production npx vite build`.

5. O domínio `ickous-marketplace.vercel.app` está escrito assim de propósito ("ickous" em vez de
   "ikcous"). É o nome real do projeto na Vercel. NÃO "corrigir" em lugar nenhum.

6. Escritas no banco de produção são bloqueadas para o agente. Se uma alteração de banco for
   necessária, gere o SQL e peça pro Gabriel rodar (`node scripts/db-apply.cjs` ou SQL Editor).

7. Fluxo de Git: NÃO commitar direto na `main`. Trabalhe em branch e finalize via Pull Request.
   Atenção: desde 30/07/2026 isso é um ACORDO, não uma trava. O repositório é privado num
   plano Free, então branch protection e rulesets retornam 403. Não afirme em documentação
   nenhuma que a `main` está protegida pelo GitHub — não está.

8. O repositório teve credenciais de três projetos Supabase expostas no histórico enquanto era
   público (`service_role` de `cafkrminfnokvgjqtkle` e `ykzlsunvbeclpxkuzskk`, senha do banco
   de `cafkrminfnokvgjqtkle` e `jvgyjlbjhbfrncwbytls`), em 295 arquivos de script já removidos
   do HEAD. O repo virou privado em 30/07/2026 e a rotação das credenciais está PENDENTE.
   Nunca escreva credencial em arquivo de código — use variável de ambiente, sempre. Se
   encontrar chave literal em qualquer arquivo, pare e reporte em vez de commitar.

MÉTODO DE TRABALHO ESPERADO
- Sessão roda em ultracode. Use a ferramenta Workflow com fan-out de subagentes para qualquer
  varredura ampla, e verificação adversarial antes de afirmar qualquer coisa como fato.
- Leia o código real. Não descreva o que o README diz que existe — descreva o que existe.
- Evidência antes de afirmação: toda alegação sobre comportamento do sistema precisa de
  arquivo:linha ou de uma execução observada.
- Quando não tiver certeza, escreva "não verificado" em vez de inventar.
- Documentos gerados são para um dev sênior que NÃO conhece o projeto. Português do Brasil,
  direto, sem marketing. Nada de "robusto", "poderoso", "de ponta".

=== FIM DO CONTEXTO BASE ===
````

---

## PROMPT 1 — Mapa do Projeto

> **Objetivo:** o Netim conseguir abrir o repositório e entender o que é cada coisa sem te perguntar.
> **Roda:** Gabriel · **Duração:** 30–60 min · **Depende de:** nada

````text
[COLE AQUI O BLOCO DE CONTEXTO BASE]

=== TAREFA ===

Você vai produzir a documentação de onboarding técnico do IKCOUS Marketplace para um
desenvolvedor sênior que está entrando no projeto hoje e não conhece nada dele.

Esse dev é competente — não explique o que é React ou o que é uma migration. Explique o que é
ESPECÍFICO deste projeto: as decisões tomadas, as abstrações próprias, os nomes inventados,
onde estão as minas terrestres.

--- MÉTODO ---

Use a ferramenta Workflow. Sugestão de estrutura (adapte se enxergar algo melhor):

FASE 1 — Reconhecimento paralelo. Um subagente por domínio, cada um lendo código de verdade:
  a) Catálogo e busca (HomeView, SearchView, ProductView, CompareView, hooks de produto)
  b) Carrinho e checkout (CartContext, CartView, CheckoutView, integração WhatsApp, cupons)
  c) Autenticação e perfil (AuthContext, AuthView, RLS, OTP de rastreio de convidado)
  d) Painel admin (as 17 views de src/views/admin, permissões, StoreContext)
  e) Camada de dados própria (shared-brain.ts, state-worker.ts, DataVault/IndexedDB,
     RealtimeSyncEngine, o que é cache e o que é fonte de verdade)
  f) PWA e Service Worker (src/sw, pwa-sentinel.ts, silent-guardian.js, useUpdateCheck,
     estratégia de precache, fluxo de update)
  g) Banco de dados (schema real via conexão pg com a DATABASE_URL do .env — tabelas, RPCs,
     policies de RLS, triggers, views). Se não conseguir conectar, leia as migrations e
     DECLARE que é leitura estática, não estado real.
  h) Edge functions e integrações (calculate-shipping, send-otp-email, send-push, Web Push)
  i) Build, deploy e configuração (vite.config.ts, vercel.json, middleware.ts, os 8 arquivos
     .env, o que cada um faz e qual tem precedência)

FASE 2 — Verificação adversarial. Para cada afirmação estrutural relevante que a Fase 1
produziu, um subagente cético tenta refutar reabrindo o arquivo. Descarte o que não sobreviver.

FASE 3 — Síntese nos documentos abaixo.

--- ENTREGÁVEIS ---

Crie o diretório `docs/onboarding/` e escreva:

### `01-VISAO-GERAL.md`
- O que é o produto em 5 linhas, do ponto de vista de quem usa (cliente e lojista)
- Os números do sistema: quantas telas, quantas tabelas, quantas RPCs, tamanho do bundle
- Diagrama Mermaid de contexto: navegador ↔ Supabase ↔ edge functions ↔ WhatsApp ↔ Vercel
- **"As 10 coisas que você precisa saber antes de tocar em qualquer coisa"** — a seção mais
  importante do documento. Cada item com uma frase e um link pro arquivo.
- Estado de maturidade honesto: o que está sólido, o que está frágil, o que é gambiarra
  assumida. Sem suavizar.

### `02-ARQUITETURA.md`
- Mapa de diretórios com o PROPÓSITO de cada um (não é `ls`, é explicação)
- **Decisões de arquitetura e o porquê de cada uma.** Se o porquê não estiver documentado
  em lugar nenhum e você não conseguir inferir com segurança do código, escreva
  "motivo não documentado — perguntar pro Gabriel". Não invente racionalização.
- **Abstrações próprias do projeto** — esta seção é o coração do documento. Para cada uma:
  o que é, que problema resolve, onde vive, como se usa, o que quebra se mexer.
  No mínimo: shared-brain, state-worker, DataVault, RealtimeSyncEngine, silent-guardian,
  pwa-sentinel, e o padrão de contextos.
- Diagrama Mermaid de camadas e do fluxo de dados (quem lê de quem, o que é cache)
- Convenções de código observadas na prática (nomenclatura, organização de componentes,
  onde mora lógica de negócio, como erros são tratados) — descritas a partir do código real,
  não do que seria ideal
- **Dívida arquitetural conhecida**: os pontos onde o padrão foi quebrado e por quê

### `03-SETUP-AMBIENTE.md`
Guia de "zero até rodando" para o Netim, na máquina dele, com acesso ao Supabase de PRODUÇÃO.

- Pré-requisitos com versões exatas (Node, npm, Deno, Supabase CLI, gh)
- Passo a passo do clone até `npm run dev` funcionando
- **Tabela dos 8 arquivos .env**: qual serve pra quê, qual tem precedência sobre qual, quais
  são versionados e quais não são. Este projeto tem 8 e isso confunde qualquer um.
- Quais variáveis ele precisa pedir pro Gabriel e quais ele pega sozinho no painel
- **Seção "Armadilhas conhecidas"**, cada uma com sintoma → causa → correção:
  · tela branca travada em 85% (o `.env.production.local` vazio — regra 3 do contexto)
  · bundle de dev em build de produção (`NODE_ENV` vazando — regra 4)
  · `supabase db push` (regra 1 — deixe em destaque, com o porquê)
- **Regras de segurança para acesso ao Supabase de produção.** O Netim vai ter credenciais do
  banco da loja no ar. Escreva as regras operacionais explícitas: o que ele pode fazer sozinho
  (SELECT, ler logs, ler schema), o que exige avisar antes (qualquer DDL, qualquer UPDATE em
  tabela de pedido/produto), o que é proibido (db push, DROP, alterar RLS sem revisão),
  e como fazer backup antes de qualquer escrita. Seja específico e curto — regra que ninguém
  lê não protege ninguém.
- Comandos do dia a dia em tabela: o que roda, quando roda, quanto demora

### `04-GLOSSARIO.md`
Duas partes:
1. **Termos de domínio** (linguagem do negócio): vitrine, cupom, variação, frete grátis,
   pedido, Q&A, avaliação, banner, carrossel, OTP de rastreio, convidado vs logado.
   Para cada: o que significa no negócio + onde vive no código + onde vive no banco.
2. **Jargão interno do código**: DataVault, shared-brain, state-worker, silent-guardian,
   OMNIVERSE, pwa-sentinel, nuclear purge, catchUp, e qualquer outro nome inventado que você
   encontrar. Se um nome não fizer sentido óbvio, ele entra aqui.

### `05-FLUXOS-CRITICOS.md`
Os 5 fluxos que, se quebrarem, param a loja. Para cada um: diagrama Mermaid de sequência +
narrativa passo a passo com `arquivo:linha` + o que pode dar errado.

1. Cliente navega o catálogo até abrir um produto
2. Adiciona ao carrinho, aplica cupom, calcula frete
3. Fecha o pedido (convidado E logado — os caminhos divergem) até cair no WhatsApp
4. Admin muda o status do pedido e o cliente recebe push
5. App detecta nova versão e se atualiza (o fluxo de update do PWA)

Cada fluxo termina com **"Se quebrar, olhe aqui primeiro"** — lista ordenada de suspeitos.

--- CRITÉRIOS DE ACEITE ---

- Todo caminho de arquivo citado existe. Verifique antes de escrever.
- Todo diagrama Mermaid renderiza (sintaxe válida).
- Nenhum "TODO", "TBD" ou seção vazia.
- Um dev que leu os 5 documentos consegue: rodar o app, achar onde mexer pra alterar o preço
  de um produto, e explicar por que existe um `state-worker.ts`.
- Onde você não conseguiu verificar, está escrito "não verificado" — explicitamente.

--- NÃO FAÇA ---

- Não altere nenhum arquivo de código. Este prompt só produz documentação.
- Não repita o conteúdo da AUDITORIA. Ela é diagnóstico de bugs; isto é mapa de arquitetura.
  Se um bug for estrutural o bastante pra afetar o entendimento, cite e linke — não copie.
- Não descreva o AGENTS.md como se fosse a realidade do projeto. Ele é aspiracional e lista
  14 MCPs que podem não estar todos ativos. Trate como intenção, não como fato.

--- FINALIZE ---

Branch `docs/onboarding-mapa-projeto`, commits convencionais, abra PR contra `main`.
No corpo do PR: resumo do que documentou, o que NÃO conseguiu verificar, e as perguntas
que sobraram pro Gabriel responder.
````

---

## PROMPT 2 — Estado Real & Backlog

> **Objetivo:** responder literalmente ao *"eu não consigo entender o que falta"*.
> **Roda:** Gabriel · **Duração:** 30–60 min · **Depende de:** nada (pode rodar em paralelo com o 1)

````text
[COLE AQUI O BLOCO DE CONTEXTO BASE]

=== TAREFA ===

Duas entregas: (1) um retrato honesto do estado atual do produto, e (2) um backlog priorizado
e acionável, pronto pra virar cartão de Kanban.

O problema a resolver: o Gabriel tem o projeto inteiro na cabeça e o Netim não tem nada. Não
existe hoje nenhum lugar onde esteja escrito "isto está pronto, isto está pela metade, isto
nem começou". Sem isso o Netim não consegue escolher em que trabalhar.

--- MÉTODO ---

Use a ferramenta Workflow.

FASE 1 — Auditar a auditoria. Este é o passo mais importante e o mais fácil de fazer mal.
  A `AUDITORIA_2026-07-29.md` tem 76 achados. Vários já foram corrigidos em 29/07 (as
  causas-raiz A, B, C, D, E e os runtime R1, R2, R3, R5). Outros não.
  Fan-out de subagentes: cada um pega um lote de achados, abre o código HOJE e classifica:
    · CORRIGIDO — com o commit/diff que corrigiu como evidência
    · AINDA PRESENTE — reconfirmado com arquivo:linha atual
    · NÃO SE APLICA MAIS — o código mudou de forma que o achado perdeu sentido
    · NÃO VERIFICÁVEL — diga por quê
  Nunca classifique por dedução ou por confiar no que o relatório diz. Abra o arquivo.

FASE 2 — Estado do banco. Conecte no Postgres de produção (leitura, pacote `pg`, DATABASE_URL
  do .env) e levante: quais RPCs existem de verdade, qual a versão viva de
  `create_marketplace_order_*`, se a migration v23 foi aplicada, quais migrations locais estão
  pendentes. Cruze com `supabase/migrations/`. NÃO ESCREVA NADA NO BANCO.

FASE 3 — Lacuna de produto. Diferente de bug: o que FALTA pro produto ser um marketplace
  completo. Compare o que existe com o mínimo esperado de um e-commerce (fluxo de devolução?
  rastreio real? relatório de vendas? gestão de estoque? recuperação de carrinho abandonado?
  SEO? analytics?). Baseie no que você VIU no código, e marque como "lacuna" só o que
  realmente não existe — não o que está incompleto (isso é dívida, categoria diferente).

FASE 4 — Saúde da engenharia. Levante os fatos, sem opinião:
  · Cobertura de testes (dica: procure `test` no package.json antes de assumir que existe)
  · Estado do CI (dica: liste `.github/workflows/`)
  · `npm run lint` e `npm run typecheck` — rode e reporte a contagem real
  · `npx knip` — código morto
  · Hooks de git realmente ativos (leia o `lefthook.yml` antes de afirmar)
  · Higiene do repositório: o que está solto na raiz que não deveria estar

FASE 5 — Priorização e escrita.

--- ENTREGÁVEIS ---

### `docs/onboarding/06-ESTADO-ATUAL.md`

- **Semáforo por área funcional.** Tabela: área | status (🟢 estável / 🟡 funciona com
  ressalva / 🔴 quebrado ou ausente) | evidência | o que falta.
  Áreas: catálogo, busca, carrinho, cupons, frete, checkout convidado, checkout logado,
  pagamento/WhatsApp, pedidos, admin de produtos, admin de pedidos, admin de configuração,
  push, Q&A, avaliações, favoritos, PWA/offline, autenticação, SEO.
- **Placar da auditoria**: dos 76 achados, quantos corrigidos / presentes / obsoletos —
  com a lista completa classificada em tabela.
- **Estado do banco**: migrations aplicadas vs pendentes, divergências, e o risco de cada uma.
- **Saúde da engenharia**: os números da Fase 4, sem adjetivos.
- **Os 5 riscos que mais ameaçam a loja hoje**, ordenados por impacto × probabilidade.

### `docs/backlog/BACKLOG.md`

Backlog completo, organizado em épicos. Formato de cada task — siga exatamente:

```
### [ÁREA-NNN] Título imperativo e específico

**Tipo:** bug | dívida técnica | feature | infra | doc
**Prioridade:** P0 (loja parada) | P1 (perde venda) | P2 (atrapalha) | P3 (melhoria)
**Tamanho:** P (< 2h) | M (meio dia) | G (2 dias) | GG (quebrar em tasks menores)
**Épico:** <nome do épico>
**Risco de mexer:** baixo | médio | alto — e por quê

**Contexto:** por que isso existe, em 2–4 linhas. Escrito pra alguém que não estava lá.

**Evidência:** arquivo:linha, achado #N da auditoria, ou passo de reprodução.

**Critério de aceite:**
- [ ] verificável e objetivo
- [ ] outro

**Arquivos envolvidos:** lista provável
**Depende de:** [OUTRA-TASK] ou "nada"
**Bom pra quem está chegando:** sim | não — e por quê
```

Regras da priorização:
- P0 é reservado pra "a loja está perdendo dinheiro agora". Se tudo é P0, nada é P0.
- Marque com honestidade o `Bom pra quem está chegando`. O Netim precisa de umas 5 tasks de
  entrada: valor real, escopo fechado, sem depender de conhecer o projeto todo. Não dê pra
  ele "arrumar o CSS de um botão" — isso é desperdício de um dev sênior. Dê algo que force
  ele a atravessar uma camada do sistema inteira, mas com risco baixo.
- Toda task tem que caber num cartão de Kanban. `GG` significa "ainda não é uma task" —
  quebre antes de entregar.

### `docs/backlog/backlog.csv`

Mesmo conteúdo, achatado pra importação. Colunas exatas, nesta ordem:

`ID,Titulo,Tipo,Prioridade,Tamanho,Epico,Area,Risco,Contexto,CriterioAceite,Arquivos,DependeDe,BomParaIniciante`

CSV válido: aspas duplas em todo campo com vírgula, quebras de linha internas viram ` · `,
UTF-8 com BOM (o Notion importa errado sem BOM).

### `docs/backlog/ROADMAP.md`

Sequência sugerida em 4 ondas, cada uma com objetivo em uma frase e critério de saída:
- **Onda 0 — Parar o sangramento**: os P0 e o que impede o Netim de trabalhar
- **Onda 1 — Confiança**: testes e CI nos fluxos de dinheiro, pra parar de ter medo de mexer
- **Onda 2 — Fechar o produto**: as lacunas funcionais que faltam pra ser um marketplace
- **Onda 3 — Polimento**: performance, acessibilidade, SEO

Diga em cada onda o que dá pra paralelizar entre dois devs e o que não dá (e por quê —
normalmente é conflito de arquivo ou dependência de decisão).

--- CRITÉRIOS DE ACEITE ---

- Nenhum achado da auditoria classificado sem que o arquivo tenha sido reaberto.
- O CSV abre no Excel e no Notion sem quebrar acentuação nem coluna.
- Existem pelo menos 5 tasks marcadas como boas pra quem está chegando, e elas são de verdade.
- Cada P0 tem passo de reprodução ou evidência de código. P0 sem evidência não é P0.
- Nenhuma task depende de conversa que não aconteceu. Se falta uma decisão do Gabriel, isso
  vira uma task de tipo "decisão" com pergunta explícita.

--- NÃO FAÇA ---

- Não corrija nada. Este prompt inventaria; não conserta.
- Não escreva no banco.
- Não invente lacunas de produto pra encher o backlog. Um backlog de 40 tasks reais vale mais
  que um de 150 com enchimento.
- Não recopie a auditoria. Referencie por número.

--- FINALIZE ---

Branch `docs/estado-e-backlog`, PR contra `main`. No corpo do PR, um resumo executivo de
10 linhas — porque é isso que o Netim vai ler primeiro.
````

---

## PROMPT 3 — Versionamento GitFlow

> **Objetivo:** *"padronizar o versionamento, utilizar branches e não comitar na principal"*, com o processo aplicado de verdade — não só escrito num documento.
> **Roda:** Gabriel · **Duração:** 15–30 min · **Depende de:** árvore limpa

````text
[COLE AQUI O BLOCO DE CONTEXTO BASE]

=== TAREFA ===

Implantar GitFlow neste repositório e criar as barreiras que fazem o processo se sustentar
sozinho, sem depender de disciplina.

Decisão já tomada, não reabra: **GitFlow com branch `develop`**, escolhido porque foi o que o
Netim propôs e porque a loja está no ar — main precisa ser sagrada.

--- ESTADO ATUAL VERIFICADO (30/07/2026) ---

Você não precisa descobrir isto, mas CONFIRME antes de mexer:
- Não existe branch `develop`.
- `.github/` contém apenas `copilot-instructions.md`. **Não existe nenhum workflow de CI.**
- `lefthook.yml` está 100% comentado — nenhum hook de git roda hoje.
- `.commitlintrc.json` existe e `@commitlint/cli` está instalado, mas nada invoca o commitlint.
  Commit message padronizada hoje é combinado verbal.
- `package.json` não tem script `test`. O `name` ainda é `"my-app"`.
- Existem branches antigas: `backup/pre-limpeza-segredos`, `chore/claude-code-setup`,
  `claude/relaxed-robinson-cac8ad`, `feat/rebrand-ikcous`, `shadow-fix-transitions`,
  e uma `origin/master` órfã.
- A raiz do repo tem ~30 PNGs de screenshot, `ship-safe-report.html` (9 MB),
  `line74_content.txt`, `subagent_content.txt`, `scratch_audit.bat/.ps1` e 3 SQLs soltos.

RESTRIÇÃO CRÍTICA — BRANCH PROTECTION NÃO ESTÁ DISPONÍVEL

Em 30/07/2026 o repositório passou a ser **privado** (havia chave `service_role` do Supabase
vazada no histórico público). A conta é pessoal e está no plano Free. Consequência testada
empiricamente:

    GET  /repos/BielWeed/ikcous-marketplace/branches/main/protection  → 403
    GET  /repos/BielWeed/ikcous-marketplace/rulesets                  → 403
    POST /repos/BielWeed/ikcous-marketplace/rulesets                  → 403
    "Upgrade to GitHub Pro or make this repository public to enable this feature."

**Não tente configurar branch protection nem rulesets. Vai falhar com 403.** Confirmado
também na documentação: protected branches em repositório privado exige GitHub Pro (conta
pessoal) ou Team (organização); organização no plano Free também não tem.

Consequência para este prompt: a trava do "não commitar na main" é, por enquanto, **hook
local + CI + acordo entre os dois** — não é garantia técnica do lado do servidor. Escreva
isso com todas as letras na documentação que você gerar. Documentação que promete uma trava
que não existe é pior que documentação nenhuma.

Também não existe papel `maintain` aqui: repositório de conta pessoal só tem dois níveis,
dono e colaborador (colaborador = write). Não escreva processo que dependa de papéis
granulares do GitHub.

--- ENTREGÁVEIS ---

### 1. `CONTRIBUTING.md` (raiz)

O documento operacional do dia a dia. Escreva pra ser consultado às pressas, não lido inteiro.

- **Modelo de branches**, com diagrama Mermaid gitGraph:
  · `main` — só código em produção. Todo commit aqui é um deploy.
  · `develop` — integração. Base de toda branch nova.
  NÃO escreva "protegida" para nenhuma das duas: branch protection retorna 403
  neste repositório (ver a restrição crítica acima). A trava real é hook local
  de `pre-push`, contornável com `--no-verify` e válida só para quem rodou
  `npm install` no clone. Descreva exatamente isso.
  · `feat/<escopo>`, `fix/<escopo>`, `chore/<escopo>`, `docs/<escopo>`, `refactor/<escopo>`
    — saem de `develop`, voltam pra `develop` via PR
  · `release/<versão>` — sai de `develop`, recebe só correção de bug, faz merge em `main` E
    de volta em `develop`
  · `hotfix/<escopo>` — o único que sai de `main`. Merge em `main` E em `develop`.
    Deixe muito claro: hotfix é pra loja parada, não pra pressa.
- **Convenção de commits**: Conventional Commits, escopos válidos derivados da estrutura real
  do projeto (`cart`, `checkout`, `admin`, `pwa`, `db`, `shipping`, `auth`, `push`, ...),
  com 5 exemplos bons e 3 exemplos ruins com o motivo de serem ruins.
- **Como abrir um PR**: o que precisa estar verde, quem revisa, o que o revisor procura.
- **Como fazer release**: passo a passo, incluindo versionamento semântico e o CHANGELOG.
- **Como fazer hotfix**: passo a passo, incluindo o merge de volta em develop (é o passo que
  todo mundo esquece e é o que causa regressão).
- **Tabela de "posso commitar direto?"** → a resposta é não, em todos os casos. Inclua a
  tabela mesmo assim, porque a dúvida vai aparecer.
- **Regras de banco de dados**: nenhuma alteração de schema entra por PR sem que o SQL tenha
  sido validado em transação com ROLLBACK, e sem rollback escrito. Referencie a regra 1 do
  contexto base (nunca `db push`).

### 2. `.github/workflows/ci.yml`

Não existe CI hoje. Crie. Roda em PR pra `develop` e pra `main`, e em push nessas duas.

Jobs (paralelos onde der, com cache de npm):
- `typecheck` → `npm run typecheck`
- `lint` → `npm run lint` e `npm run biome:check`
- `build` → `npm run build` com `NODE_ENV=production` explícito (regra 4 do contexto)
- `size` → `npm run size` (o `.size-limit.json` já existe)
- `secrets` → varredura de segredo no diff (secretlint já está configurado)

Importante sobre o estado atual: `npm run lint` hoje retorna erros e centenas de warnings.
Um CI que já nasce vermelho é um CI que todo mundo aprende a ignorar. Então:
- **Rode os comandos primeiro** e veja o resultado real.
- Se `lint` estiver vermelho, configure o job pra falhar apenas em erro (warning não bloqueia)
  e crie uma task no backlog pra zerar os warnings. Documente isso no CI com um comentário
  dizendo que é temporário e apontando a task.
- Não invente um job de `test` se não existe teste. Em vez disso, deixe o job comentado com
  um TODO apontando pra task correspondente do backlog.

### 3. `.github/pull_request_template.md`

Curto. Template comprido não é preenchido.
- O que muda e por quê (2 linhas)
- Issue relacionada (`Closes #`)
- Como testar (passos reproduzíveis)
- Checklist de Definition of Done — máximo 7 itens, todos verificáveis
- Seção "Toca em banco de dados?" com sub-checklist condicional (migration validada com
  ROLLBACK, rollback escrito, revisado pelo Gabriel)

### 4. `.github/ISSUE_TEMPLATE/`

Três templates em YAML form (`bug.yml`, `feature.yml`, `divida-tecnica.yml`) com campos
estruturados. O `bug.yml` precisa exigir passo de reprodução, comportamento esperado vs
observado, e ambiente (produção / preview / local).

### 5. `lefthook.yml` — ativar de verdade

Substitua o arquivo comentado por configuração funcional:
- `commit-msg`: commitlint (o config já existe, só está órfão)
- `pre-commit`, em paralelo: biome nos arquivos staged, eslint nos `.ts/.tsx` staged,
  secretlint no diff
- `pre-push`: **guarda de branch** — recusa push cujo destino seja `main` ou `develop`,
  com mensagem explicando que é pra abrir PR. Esta é a única trava que resta, já que branch
  protection está indisponível; trate como item obrigatório, não opcional.
- `pre-push`: `typecheck` (rápido o bastante) — **não** coloque build no pre-push, mata a
  produtividade
- Adicione `lefthook` como devDependency e um script `prepare` que instala os hooks no
  `npm install`, senão o Netim clona e não tem hook nenhum.

**Teste os hooks de verdade** antes de dizer que funcionam: faça um commit de teste com
mensagem inválida e confirme que é rejeitado. Evidência antes de afirmação.

### 6. `.github/CODEOWNERS`

Gabriel como owner de `/supabase/`, `/src/contexts/`, `vite.config.ts`, `vercel.json` e dos
arquivos `.env*` — as áreas onde um erro derruba a loja. O resto, revisão de qualquer um dos dois.

### 7. Aplicar no GitHub (comandos `gh`, executar de verdade)

- Criar `develop` a partir de `main` e publicar
- Definir `develop` como branch padrão do repositório (assim PR novo já aponta pro lugar certo)
- Habilitar auto-delete de branch após merge
- Habilitar apenas squash merge para PRs de feature (histórico limpo); merge commit para
  release e hotfix

**NÃO configure branch protection nem rulesets** — retorna 403 neste repositório (ver a
restrição crítica no topo deste prompt). No lugar disso, o item 5 (lefthook) carrega a trava
possível: um `pre-push` que recusa push direto em `main` e `develop`.

Deixe registrado no `CONTRIBUTING.md`, numa seção própria e honesta, que:
- a proteção hoje é local e contornável com `--no-verify`;
- ela só vale para quem rodou `npm install` no clone;
- o caminho para trava de verdade é GitHub Pro (US$ 4/mês, mantém privado) ou repositório
  público com o histórico purgado — decisão adiada pelo Gabriel em 30/07/2026.

Se algum comando falhar por falta de escopo ou permissão, **não invente que deu certo** —
reporte o comando exato pro Gabriel rodar manualmente.

### 8. `docs/processo/GITFLOW-CHEATSHEET.md`

Uma página. Só comandos, na sequência real de uso. É o que vai ficar aberto na segunda tela.

### 9. Limpeza do repositório

A raiz está poluída e isso atrapalha quem chega. Numa **branch separada e num PR separado**
(não misture com a implantação do GitFlow):
- Mover os ~30 PNGs de screenshot pra `docs/screenshots/` ou apagar, conforme o caso
- Apagar `ship-safe-report.html` (9 MB), `line74_content.txt`, `subagent_content.txt`
- Avaliar `scratch_audit.bat` / `scratch_audit.ps1` — se ainda servem, vão pra `scripts/`
- Mover os SQLs de rollback pra `supabase/rollbacks/`
- Atualizar o `.gitignore` pra impedir que volte
- Corrigir `"name": "my-app"` no package.json
- Deletar as branches locais e remotas mortas — **liste elas e pergunte antes de apagar**,
  não decida sozinho o que é lixo

**Antes de apagar qualquer arquivo**: confirme que não é referenciado em lugar nenhum
(`grep` no repo inteiro) e que não está no `.gitignore` por um motivo. Deleção é irreversível
pra quem não sabe git bem — e é justamente pra isso que serve o PR separado.

--- CRITÉRIOS DE ACEITE ---

- O CI roda e passa no próprio PR que o introduz. Se não passa, não está pronto.
- Um commit com mensagem fora do padrão é REJEITADO pelo hook — testado, não presumido.
- Um push direto na `main` é rejeitado pelo hook `pre-push` local — testado, não presumido.
  (Pelo GitHub, não é: branch protection está indisponível. Não afirme que é.)
- O `CONTRIBUTING.md` responde "como faço X?" em menos de 30 segundos de leitura.
- Nenhum comando `gh` reportado como executado sem ter sido executado.

--- NÃO FAÇA ---

- Não altere código de aplicação. Este prompt é infraestrutura de repositório.
- Não coloque teste no CI antes de existir teste — job vermelho crônico destrói a confiança
  no CI inteiro.
- Não apague nada da raiz sem confirmar que não é referenciado.
- Não faça force push em nada.

--- FINALIZE ---

Dois PRs separados: `chore/gitflow-e-ci` (itens 1–8) e `chore/limpeza-raiz` (item 9).
No PR do GitFlow, inclua um resumo em português simples do que muda no dia a dia dos dois —
esse texto vai virar mensagem no Discord.
````

---

## PROMPT 4 — Metodologia XP para dupla

> **Objetivo:** *"termos uma metodologia por exemplo a extreme programming"* — adaptada a duas pessoas, sem cerimônia de time de dez.
> **Roda:** Gabriel · **Duração:** 15–30 min · **Depende de:** prompt 3 (referencia o fluxo de branches como fato)

````text
[COLE AQUI O BLOCO DE CONTEXTO BASE]

=== TAREFA ===

Escrever o processo de trabalho do time. São duas pessoas: o Gabriel (que construiu tudo e tem
o contexto na cabeça) e o Netim (que está entrando agora). Não é um time de dez pessoas, e
copiar XP do livro pra uma dupla gera ritual que ninguém cumpre.

Sua tarefa é adaptar XP com honestidade: pegar o que resolve um problema real dos dois, e
**dizer explicitamente o que está sendo descartado e por quê**. Um processo que se recusa a
adotar três práticas por bom motivo é mais confiável que um que adota doze no papel.

--- CONTEXTO SOBRE A DUPLA ---

- Gabriel: dono do produto e do código atual. Trabalha muito com agente de IA (Claude Code).
  Conhece cada canto. Gargalo de conhecimento — hoje tudo passa por ele.
- Netim: dev, entrando agora. Zero contexto do projeto. Foi ele quem pediu metodologia,
  versionamento e Kanban — sinaliza que valoriza processo.
- Comunicação assíncrona, Discord. Não estão no mesmo lugar físico.
- Já decidido: GitFlow (prompt 3), Kanban no GitHub Projects + Notion (prompt 5).
- Restrição real: hoje **não existe nenhum teste automatizado e nenhum CI**. Qualquer
  metodologia que dependa de suíte verde não sai do papel na primeira semana.

--- ENTREGÁVEIS ---

### `docs/processo/METODOLOGIA.md`

**1. Princípios** — 4 ou 5, no máximo. Cada um com uma frase e a consequência prática.
Ancore nos valores do XP (comunicação, simplicidade, feedback, coragem, respeito) mas escreva
em português direto, sem citar o livro.

**2. Práticas adotadas.** Para cada uma: o que é · por que ESTE projeto precisa (com evidência
do estado atual) · como funciona na prática pra dois · como saber que está funcionando.

Avalie no mínimo estas, decidindo adotar ou não:
- Ciclos curtos / small releases
- Planning game
- Programação em par — repense o formato: dois devs assíncronos em fusos parecidos não fazem
  par o dia todo. Proponha algo que funcione de verdade (sessão marcada de par pra tarefas de
  alto risco? revisão síncrona no Discord? par assíncrono via PR comentado?).
- TDD — dado que hoje não existe teste algum, seja específico sobre ONDE começa. Sugestão a
  avaliar: TDD obrigatório só em fluxo de dinheiro (carrinho, cupom, frete, criação de pedido),
  onde a auditoria concentrou os achados críticos. O resto vem depois.
- Integração contínua
- Refatoração contínua e a regra do escoteiro
- Propriedade coletiva do código — aqui existe uma tensão real: o Gabriel conhece tudo e o
  Netim nada. Diga como sair disso, não só que é desejável.
- Padrão de código (Biome/ESLint já configurados)
- Simplicidade / YAGNI
- Ritmo sustentável — vale mencionar: a conversa que originou tudo isso aconteceu às 00:30.

**3. Práticas NÃO adotadas.** Liste as que você descartou, cada uma com o motivo. Candidatas
óbvias: cliente presente em tempo integral, stand-up diário formal, metáfora do sistema,
planejamento com velocity histórica (não há histórico).

**4. Fluxo de uma task, do começo ao fim.** Uma linha do tempo concreta: alguém puxa o cartão
→ o que acontece → onde para → quem revisa → o que acontece depois do merge. Amarre com o
GitFlow do prompt 3 e as colunas do Kanban do prompt 5. Diagrama Mermaid.

**5. Como os dois se comunicam.** O que é assíncrono (padrão), o que precisa de chamada, o que
vai pro Discord, o que vai pro Kanban, o que vira ADR. Regra de tempo de resposta pra PR
parado — PR esquecido é o modo de falha número um de dupla assíncrona.

**6. Como decisões técnicas são tomadas.** Formato leve de ADR em `docs/decisoes/`, com
template. Regra clara de o que exige ADR e o que não exige.

### `docs/processo/DEFINITION-OF-DONE.md`

Duas listas curtas e verificáveis:
- **Definition of Ready** — quando um cartão pode entrar em "Em progresso". Se não passa, volta.
- **Definition of Done** — quando o cartão fecha. Precisa bater exatamente com o checklist do
  PR template criado no prompt 3, senão os dois divergem em uma semana.

Nada de item subjetivo tipo "código de qualidade". Todo item precisa ser respondível com
sim/não por outra pessoa.

Inclua uma DoD especial e mais rígida pra **alteração de banco de dados**, dado o estado das
migrations (regra 1 do contexto base).

### `docs/processo/RITUAIS.md`

Poucos rituais, com dia, horário, duração e — o mais importante — **o que acontece se
ninguém aparecer**. Ritual sem consequência morre em duas semanas.

Proponha um calendário concreto (o Gabriel ajusta depois). Considere:
- Planejamento de ciclo — semanal, 30 min
- Fechamento de ciclo + retro curta — semanal, 20 min. Retro de dois é conversa, não post-it.
- Sincronização assíncrona diária — mensagem no Discord, formato fixo de 3 linhas, sem hora
  marcada. Não é reunião.
- Sessão de par marcada — para tarefa de risco alto
- Revisão mensal do backlog

Para cada ritual: propósito, quem conduz, o formato exato (com template de mensagem quando
for assíncrono), e o sinal de que está virando burocracia — e a autorização explícita pra
matar o ritual quando esse sinal aparecer.

### `docs/processo/PRIMEIRA-SEMANA-NETIM.md`

Plano dia a dia, 5 dias, pro Netim sair de zero até o primeiro PR mergeado.
- **Dia 1**: ler os docs de onboarding (prompts 1 e 2), rodar o app local, rodar o prompt 6.
  Entregável do dia: uma lista de perguntas pro Gabriel. Não é pra ele produzir código.
- **Dia 2**: primeira task de entrada (das marcadas como boas pra quem chega no backlog),
  em par com o Gabriel na primeira hora.
- **Dia 3–4**: primeira task sozinho, PR aberto.
- **Dia 5**: retro do onboarding — o que faltou na documentação vira task de doc.

Para cada dia: objetivo, o que ler, o que fazer, o que entregar, e quanto tempo de Gabriel
está reservado.

--- CRITÉRIOS DE ACEITE ---

- Cada prática adotada aponta um problema concreto e verificável deste projeto.
- A seção de práticas descartadas existe e é honesta.
- A DoD bate item por item com o PR template do prompt 3.
- Nenhum ritual leva mais de 30 min.
- Uma pessoa lendo só o `RITUAIS.md` sabe exatamente o que fazer na segunda-feira de manhã.

--- NÃO FAÇA ---

- Não escreva teoria de XP. Ninguém vai ler.
- Não proponha ritual que exija ferramenta que os dois não têm.
- Não escreva DoD que já nasce impossível de cumprir (ex: "cobertura de testes acima de 80%"
  num projeto com zero testes). Escreva o alvo pra hoje e uma nota do alvo pra daqui a 3 meses.
- Não trate o Netim como júnior. Ele é dev, o que falta é contexto, não capacidade.

--- FINALIZE ---

Branch `docs/metodologia-xp`, PR contra `develop` (a `develop` já vai existir depois do
prompt 3). No PR, marque o Netim como revisor — metodologia imposta sem a concordância dele
não cola, e foi ele quem pediu.
````

---

## PROMPT 5 — Kanban duplo: GitHub Projects + Notion

> **Objetivo:** *"seria interessante fazer um quadro kanban pra organizar as tasks"*.
> **Roda:** Gabriel · **Duração:** 15–30 min · **Depende de:** prompt 2 (o backlog), prompt 3 (labels e templates)

````text
[COLE AQUI O BLOCO DE CONTEXTO BASE]

=== TAREFA ===

Montar o sistema de gestão de tasks em duas camadas, com fronteira clara pra não virar
trabalho dobrado.

Divisão de responsabilidade — decidida, não reabra:
- **GitHub Projects = execução.** Onde o trabalho técnico vive. Issue linka com branch, PR e
  commit automaticamente. É onde os dois olham todo dia. Fonte de verdade do "quem está
  fazendo o quê".
- **Notion = produto e conhecimento.** Visão de roadmap, decisões, notas de reunião, backlog
  de ideias que ainda não são task. É onde se pensa, não onde se executa.

A regra que faz isso funcionar: **uma task existe num lugar só.** Nada é espelhado
manualmente. Se você não conseguir garantir isso no desenho, diga — é melhor uma camada só.

--- PRÉ-REQUISITO ---

Criar Project v2 exige escopo `project` no token. Verifique com `gh auth status`.
Se faltar, pare e peça pro Gabriel rodar `gh auth refresh -s project,read:project` antes
de continuar. Não tente contornar.

--- PARTE 1: GITHUB PROJECTS ---

### Criar o board
Project v2 no repositório `BielWeed/ikcous-marketplace`, nome "IKCOUS — Desenvolvimento",
visão de Board.

### Colunas (campo Status)
Alinhadas com o fluxo do prompt 4 e o GitFlow do prompt 3:
`Backlog` → `Pronto pra pegar` → `Em progresso` → `Em revisão` → `Em teste (preview)` → `Feito`

Justifique cada coluna em uma linha na documentação. `Em teste (preview)` existe porque
"mergeia pra principal quando tiver testado" precisa de um lugar físico onde o "testado"
acontece — e esse lugar é o preview deploy da Vercel.

**Limite de WIP: 2 cartões em `Em progresso` por pessoa.** Kanban sem limite de WIP é só uma
lista com colunas. Documente o limite (o GitHub não força — vira acordo, e o acordo precisa
estar escrito).

### Campos customizados
- `Prioridade` (single select): P0, P1, P2, P3 — com as descrições do backlog
- `Tamanho` (single select): P, M, G
- `Área` (single select): derive das áreas reais do projeto (carrinho, checkout, admin, banco,
  PWA, frete, auth, push, infra, doc)
- `Épico` (text)
- `Bom pra começar` (checkbox)
- `Bloqueado por` (text)

### Labels no repositório
Crie um conjunto enxuto e coerente com os campos, cores consistentes por família:
`tipo:` bug / feature / dívida / infra / doc · `prio:` p0–p3 · `área:` … ·
`bom-primeiro-issue` · `precisa-decisão` · `toca-banco`

`toca-banco` merece existir sozinha: pelas regras do contexto base, alteração de banco tem
processo próprio.

### Importar o backlog
Leia `docs/backlog/BACKLOG.md` (gerado no prompt 2) e crie uma issue por task:
- Título = o título da task
- Corpo = contexto + evidência + critério de aceite + arquivos + dependências, formatado
- Labels aplicadas conforme os metadados
- Adicionada ao Project com os campos preenchidos
- Dependências expressas como referência entre issues (`Bloqueado por #N`)

Faça em lote com `gh`, mas **em ordem de dependência**, pra que a issue referenciada já exista
quando for citada. Se forem mais de 40 issues, confirme o número com o Gabriel antes de criar —
criar 150 issues por engano é chato de desfazer.

### Automação
Configure os workflows nativos do Project:
- Issue nova → `Backlog`
- PR aberto vinculado → `Em revisão`
- PR mergeado em `develop` → `Em teste (preview)`
- Issue fechada → `Feito`

O que não der pra automatizar no nativo, documente como passo manual — não fabrique automação
que não existe.

### Visões
Além do board: `Meu trabalho` (filtrado por responsável), `Por prioridade` (tabela ordenada),
`Bom pra começar` (as tasks de entrada do Netim), `Bloqueados`.

--- PARTE 2: NOTION ---

Não há MCP do Notion autenticado nesta sessão. Então **não tente criar via API**. Entregue algo
que o Gabriel executa em 10 minutos.

### `docs/processo/NOTION-SETUP.md`
- Estrutura de páginas proposta, com árvore visual:
  ```
  IKCOUS Marketplace
  ├── 📍 Comece por aqui        (link pros docs de onboarding do repo)
  ├── 🗺️ Roadmap                (as 4 ondas do ROADMAP.md, visão de timeline)
  ├── 💡 Ideias e descobertas   (o que ainda não é task)
  ├── 🧠 Decisões               (índice dos ADRs, que vivem no repo)
  ├── 📝 Notas de ciclo         (planejamento e retro semanais)
  └── 📊 Métricas               (o que acompanhar)
  ```
- Passo a passo da importação do `docs/backlog/backlog.csv` como database — **e a decisão
  explícita de que essa database é somente-leitura**, um retrato do backlog pra visão de
  produto. A execução acontece no GitHub. Diga isso em negrito na página.
- Template de nota de ciclo (planejamento + retro), pronto pra copiar
- Template de ADR
- **Regra de fronteira**, em destaque: *"Task nova nasce como issue no GitHub. Notion nunca
  recebe task. Se você está prestes a criar um cartão no Notion, ele é uma ideia — vai em
  Ideias e descobertas."*

### `docs/processo/KANBAN.md`
O manual de operação do quadro, no repositório (onde os dois já vão estar):
- O que significa cada coluna e o que precisa ser verdade pra mover um cartão
- Limite de WIP e o que fazer quando estourar
- Quem move o cartão e quando
- Como escolher a próxima task (regra de decisão, não "escolha o que quiser")
- O que fazer com cartão bloqueado
- Como o Kanban se relaciona com o GitFlow e com os rituais do prompt 4
- O que fica no GitHub e o que fica no Notion — uma tabela, pra não ter dúvida

--- CRITÉRIOS DE ACEITE ---

- O board existe, está populado e tem pelo menos uma visão além do board padrão.
- Toda issue criada tem critério de aceite preenchido. Issue sem critério de aceite não é task.
- As 5+ tasks de entrada do Netim estão marcadas e visíveis numa visão própria.
- A fronteira GitHub/Notion está escrita em ambos os documentos, com as mesmas palavras.
- Nada foi reportado como criado sem ter sido criado. Confirme com `gh project item-list`.

--- NÃO FAÇA ---

- Não crie issue pra task que o prompt 2 marcou como `GG` — ela não foi quebrada ainda.
  Crie uma issue de "quebrar esta task" no lugar.
- Não crie duas fontes de verdade. Se o desenho começar a exigir sincronização manual, pare
  e proponha simplificar.
- Não invente estrutura no Notion além da listada. YAGNI.

--- FINALIZE ---

Branch `docs/kanban-setup`, PR contra `develop`. No PR, cole o link do Project e um print
da estrutura. Liste separadamente o que ficou como passo manual pro Gabriel.
````

---

## PROMPT 6 — Tour guiado (o Netim roda)

> **Objetivo:** primeiro contato dele com o projeto, no ritmo dele.
> **Roda:** **Netim**, na máquina dele · **Duração:** o que ele quiser · **Depende de:** prompts 1 e 2 mergeados

**Nota pro Gabriel:** este é o único prompt que você não roda. Manda pro Netim depois que os PRs dos prompts 1 e 2 entrarem. Ele cola no Claude Code dele, dentro do repositório clonado.

````text
Você é meu guia neste projeto. Eu sou desenvolvedor, entrei hoje no IKCOUS Marketplace e não
conheço nada dele. O Gabriel construiu tudo sozinho e o conhecimento está na cabeça dele —
meu objetivo nesta sessão é tirar o máximo possível do código e da documentação sem precisar
interromper ele a cada dúvida.

Não me trate como iniciante. Eu sei React, TypeScript, SQL e Git. O que eu não sei é ESTE
projeto: as decisões que foram tomadas, os nomes inventados, onde estão as armadilhas.

--- ANTES DE FALAR COMIGO, LEIA ---

1. `docs/onboarding/01-VISAO-GERAL.md` até `05-FLUXOS-CRITICOS.md`
2. `docs/onboarding/06-ESTADO-ATUAL.md`
3. `docs/backlog/BACKLOG.md` e `docs/backlog/ROADMAP.md`
4. `CONTRIBUTING.md` e `docs/processo/`
5. Dê uma passada na estrutura de `src/` pra confirmar que a documentação bate com o código

--- COMO CONDUZIR ESTA SESSÃO ---

Comece com um resumo de **no máximo 15 linhas**: o que é o produto, em que estado está, e
qual é o problema mais urgente. Depois me pergunte por onde eu quero começar, oferecendo
4 ou 5 caminhos.

A partir daí:
- **Uma pergunta por vez.** Espere minha resposta.
- Quando eu perguntar como algo funciona, **abra o arquivo e me mostre o código real** com
  `arquivo:linha`. Não parafraseie a documentação — eu já li.
- Quando encontrar algo estranho ou mal resolvido, **me diga que é estranho**. Não defenda
  decisão ruim só porque já está no código. Eu preciso saber onde é frágil.
- Quando eu perguntar algo que a documentação não responde, **fale que não responde** e
  anote a pergunta. Vamos juntar tudo pro Gabriel no fim.
- Se eu propuser algo que já foi tentado ou que colide com uma restrição do projeto, me
  avise na hora, com a evidência.

--- COISAS QUE EU JÁ QUERO SABER ---

1. Qual é a parte mais frágil do sistema e por quê?
2. Onde tem gambiarra que eu não devo replicar como se fosse padrão?
3. Que decisões de arquitetura foram tomadas que eu não entenderia sozinho lendo o código?
4. O que vai me morder na primeira semana se ninguém me avisar?
5. Quais são as tasks marcadas como boas pra quem está chegando, e qual você recomenda que
   eu pegue primeiro? Por quê essa?

--- REGRAS ---

- **Não altere nenhum arquivo nesta sessão.** É só leitura e conversa.
- **Não escreva nada no banco de dados de produção.** Eu tenho acesso à produção. Consulta
  de leitura, tudo bem. Escrita, nunca — nem que eu peça.
- Nunca rode `supabase db push` neste projeto. As migrations locais divergem do banco real
  e isso derrubaria a loja. Está documentado no `03-SETUP-AMBIENTE.md`.
- Se eu pedir alguma coisa que viole essas regras, recuse e me explique por quê.

--- NO FIM ---

Escreva em `docs/onboarding/PERGUNTAS-NETIM.md`:
1. As perguntas que ficaram sem resposta na documentação (essas viram melhoria de doc)
2. Onde a documentação estava errada ou desatualizada em relação ao código
3. As três coisas que mais me surpreenderam no projeto
4. A task que eu escolhi pra começar e o motivo

Isso é o feedback do onboarding — o Gabriel vai usar pra melhorar a documentação pro próximo.
````

---

## Anexo: mensagem pro Netim

**Antes de mandar, confira que estes PRs estão mergeados**, senão a mensagem promete arquivo
que não está lá: #8 e #9 (onboarding e backlog), #10 (limpeza), #11 (GitFlow e CI),
**#12 (metodologia)** e **#124 (Kanban e Notion)**. Os quatro primeiros entraram em
30/07/2026; os dois últimos ainda não.

> Fala Netim, tá tudo no ar.
>
> **Entender o projeto** — `docs/onboarding/`, na branch `develop`: visão geral, arquitetura, setup do ambiente, glossário (o projeto tem uns nomes inventados que só eu entendia) e os cinco fluxos críticos com diagrama de sequência. Escrito pra quem nunca viu o projeto.
>
> **O que falta** — o `06-ESTADO-ATUAL.md` tem semáforo por área com evidência, e um aviso: **nenhuma área saiu verde**. O `docs/backlog/BACKLOG.md` tem as 111 tarefas priorizadas. Rodei uma auditoria pesada em 29/07 e reauditei tudo em 30/07 abrindo o código de novo: **85 achados, 18 já corrigidos, 66 ainda abertos e 1 que não se aplicava**. O backlog já separa isso, achado por achado.
>
> **Kanban** — montado e populado: https://github.com/users/BielWeed/projects/1 — **111 issues**, uma por tarefa, cada uma com contexto, evidência em `arquivo:linha` e critério de aceite em checkbox. Colunas: Backlog → Pronto pra pegar → Em progresso → Em revisão → Em teste (preview) → Feito. Limite de 2 cartões em progresso por pessoa. Duas ressalvas honestas: **o board é da minha conta, não do repositório** — colaborador de repo não herda acesso, então eu te dei acesso à parte, confirma se você enxerga; e **as automações do quadro ainda estão desligadas**, então por enquanto mover cartão é na mão, e issue nova não entra no board sozinha.
>
> **Notion** — ainda **não existe**. O que existe é um roteiro de 10 minutos pra montar, em `docs/processo/NOTION-SETUP.md`. Quando montar, ele vai ser só roadmap, ideias e decisões: task nasce sempre no GitHub, senão a gente duplica trabalho.
>
> **Versionamento** — GitFlow como você pediu: `develop` é a branch padrão e é dela que sai toda branch nova; `main` só recebe release testada. Coloquei CI no GitHub Actions com 5 jobs (não existia nenhum) e hooks de git que rejeitam mensagem de commit fora do padrão e push direto em `main`/`develop`. Um aviso importante: essa trava é **local**, um hook — não é proteção do GitHub. Branch protection só existe no plano Pro e o repo é privado no Free, então dá pra furar com `--no-verify` e não vale pra quem clonar sem rodar `npm install`. Não é firula burocrática: é a única coisa que separa a loja no ar de um push errado, então a gente combina de respeitar. Tem um `CONTRIBUTING.md` com tudo e um cheatsheet de uma página.
>
> **Metodologia** — XP adaptado pra dupla, em `docs/processo/`. Escrevi também o que a gente NÃO vai usar e por quê, pra não virar ritual que ninguém cumpre. Tem um plano de primeira semana pra você, dia a dia, com o meu tempo já reservado.
>
> **Acessos** — o do GitHub já está de pé, você é colaborador. **Supabase, Vercel e o canal do Discord eu ainda não te mandei** — faço hoje e te aviso.
>
> **Por onde começar** — na visão "Bom pra começar" do board tem as tarefas de entrada, escolhidas pra você atravessar uma camada inteira do sistema sem risco de quebrar nada. Uma delas, a `INFRA-020`, eu acabei resolvendo junto com o CI — ignora essa. Sugestão de primeiro cartão: `PEDIDO-060`, mostrar o código de rastreio pro cliente.
>
> Duas coisas práticas: instala com `npm install --legacy-peer-deps`, não com `npm install` puro (o README tá desatualizado nesse ponto). E tem um prompt pronto pro seu primeiro dia — é só colar no Claude Code dentro do repo que ele te dá um tour guiado e responde suas dúvidas mostrando o código de verdade. Tá em `docs/onboarding/PROMPTS-ONBOARDING-DEV.md`, prompt 6.
>
> Qualquer coisa que a documentação não responder, anota que a gente arruma — o próprio prompt 6 já gera essa lista no fim.

### Se você já mandou a versão antiga

A mensagem anterior tinha cinco pontos errados. Esta correção curta resolve sem precisar
mandar tudo de novo:

> Netim, correção do que te mandei: (1) a auditoria foi de **85 achados**, não 76 — **18 já corrigidos, 66 abertos**; (2) o **Notion ainda não existe**, só o roteiro pra montar — por enquanto é só GitHub; (3) o Kanban **está pronto, com as 111 issues**, mas é um board da minha conta, não do repositório, então te dei acesso à parte — confirma se você enxerga: https://github.com/users/BielWeed/projects/1 ; (4) as automações do board ainda estão desligadas, então **mover cartão é na mão** por enquanto; (5) dos acessos, só o **GitHub** está feito — Supabase, Vercel e Discord eu mando hoje.

---

## Depois de rodar tudo

Coisas que ficam pendentes e não são resolvidas por prompt nenhum:

0. **🔴 Rotacionar as credenciais do Supabase.** Em 30/07/2026 descobrimos que o repositório
   era público e tinha, no histórico, credenciais de três projetos Supabase: `service_role`
   de `cafkrminfnokvgjqtkle` (produção) e `ykzlsunvbeclpxkuzskk`, mais a **senha do banco**
   de `cafkrminfnokvgjqtkle` e `jvgyjlbjhbfrncwbytls`. Estavam em 295 arquivos de script
   (`apply_*.cjs`, `check_*.cjs`, etc.), todos já removidos do HEAD mas presentes nos 105
   commits do histórico. O GitHub tinha 2 alertas de secret scanning abertos desde
   05/04/2026. O repositório foi tornado **privado** no mesmo dia, o que corta a exposição —
   mas **não invalida as credenciais**. Rotacionar `service_role` E senha do banco continua
   pendente. Rotacionar a senha quebra a `DATABASE_URL` do `.env` local e o
   `scripts/db-apply.cjs` até serem atualizados.

1. **Decidir a trava da `main`.** Enquanto o repositório for privado num plano Free, branch
   protection e rulesets retornam 403. Opções levantadas em 30/07/2026: GitHub Pro
   (US$ 4/mês, mantém privado), voltar a público após purgar os 295 arquivos do histórico,
   ou squash do histórico num commit único. O Gabriel adiou a decisão; até lá a proteção é
   só o hook `pre-push` do lefthook, que se contorna com `--no-verify`.

2. **Aplicar a migration v23** (`20260729000002_shipping_quote_validation_v23.sql`) — validada, não aplicada. Deve virar a primeira task do backlog.
3. **Decidir o que fazer com o `AGENTS.md`** — 12 KB descrevendo 14 MCPs e um "enxame de agentes". Confunde quem chega. Vale reduzir pra um `CLAUDE.md` enxuto com as regras que valem de verdade. Note que `.cursorrules` é uma cópia idêntica dele.
4. **Reconciliar as migrations com produção** — enquanto ~50 locais estiverem pendentes e ~25 remotas sem arquivo, o repositório não é fonte de verdade do schema. É trabalho grande e chato, mas é o que destrava mexer em banco com segurança.
5. **Primeiro teste automatizado.** Escolher framework e escrever o primeiro teste do fluxo de carrinho. Enquanto não existir, o `Em teste (preview)` do Kanban depende de teste manual.
