# IKCOUS Marketplace — Manual do agente

> **Fonte única de instruções deste repositório (projeto ZCode-only, 02/09/2026 — Missão 05).**
> O [CLAUDE.md](CLAUDE.md) é só um aviso apontando para cá. Regras GLOBAIS de comportamento
> (custo zero, travas, paralelismo, revisão por risco) moram em `~/.zcode/AGENTS.md` — este
> arquivo declara apenas o **terreno daqui**. O conteúdo de ferramentas Cursor/Antigravity
> que existia aqui foi removido nessa reescrita; a cópia `.cursorrules`, que ficou
> DESATUALIZADA, foi removida em 12/09/2026 (decisão do dono).

---

## 🔴 ESCOPO — leia antes de qualquer coisa, inclusive antes de perguntar

**Aqui se desenvolve o APP. Só o app.** Cliente, lojista, teste grátis, assinatura,
cobrança de mensalidade, clonagem/entrega de loja e banco de cliente são de OUTRO
projeto. A regra prática, sem exceção:

> **Quem sente a falta disso hoje, na loja do Gabriel?** Se a resposta for "ninguém —
> quem sente é quem clona, entrega, cobra ou gerencia lojista", o trabalho é do outro
> workspace, **mesmo que o defeito esteja em arquivo deste repositório**.

- Reescrever a justificativa não muda o dono do trabalho; sessão par não é o Gabriel.
- Ao montar prompt de subagente, plano ou decisão: se aparecer nome de loja, cliente,
  assinatura ou clone como *justificativa*, apagar e refazer.
- O rumo: *"tudo deve ser desenvolvido como se esse app fosse para funcionar de
  verdade em uma loja"* — nada de recurso desligado por conveniência.

## Papéis (posturas de trabalho)

1. **Coordenação & Arquitetura PWA** — tarefas complexas, arquitetura offline-first e de
   Service Worker, deploy e logs.
2. **Frontend & PWA** — React 19, TypeScript, Tailwind; manifesto, service worker e
   caching; verificação local antes de promover mudança.
3. **Banco & Supabase** — tabelas, migrations, auditoria de RLS, RPC/triggers com a
   permissão correta; tipos TypeScript regenerados quando o schema muda.
4. **QA & Automação** — fluxos críticos (carrinho, cupom, checkout, Q&A) em múltiplos
   cenários de rede; responsivo e offline.
5. **Qualidade & Segurança** — roda a verificação e **não aceita o "passou" de quem
   escreveu**; audita contra vulnerabilidade conhecida (`SECURITY_REPORT.md`); variável
   de ambiente crítica nunca exposta; concorrência e integridade.

## Domínio do negócio — entidades, dinheiro e papéis

**Papéis (RLS).** O papel mora em `profiles.role` (CHECK: `admin | gerente | vendedor |
customer`) — **lojista = staff** (`admin` manda: `is_admin()`, SECURITY DEFINER, é a porta
do painel; o front espelha via RPC com cache). `public_profiles` é a projeção pública.
RLS de pedidos: `auth.uid() = user_id` — **convidado não vê pedido nenhum sem OTP**.

**Entidades (36 tabelas vivas).** Catálogo: categorias → produtos → product_variants;
banners; perguntas/respostas; reviews (voto útil com memória no servidor — tabela
`review_votes`, `UNIQUE (review_id, user_id)`: a deduplicação mora na constraint,
não no cliente; `increment_helpful` foi reescrita em cima dela); favoritos. Compra: carrinho →
`marketplace_orders` (status: pending|processing|shipping|delivered|cancelled|new) →
itens (snapshot de preço) + histórico de status + payment_history (registro **manual**
do lojista: recebido|desfeito). Pessoas: profiles, public_profiles, user_addresses.
Loja: store_config (identidade, frete, flags), app_settings, credenciais de frete,
cache/logs de cotação, analytics_events, push_subscriptions(+log), otp_verifications.
Auditoria: `vor_receipts` (recibos de operação com hash SHA-256 encadeado:
`proof_hash`/`previous_hash` — consumida por `src/hooks/useVOR.ts`);
`marketplace_ai_state` é órfã (estado genérico por componente, sem uso vivo no front).
Painel, cartão e devoluções (26/09/2026, PR #666 — **+10 tabelas quando as migrations
`20261175`–`20261178` forem aplicadas**):
- Devoluções: `devolucoes`, `devolucao_itens`, `devolucao_eventos`, `politica_devolucao` e o
  bucket PRIVADO `devolucoes` (foto só na pasta `<uid>/` do cliente; lê o dono e o admin).
  Ninguém escreve por PostgREST — só pelas RPCs de devolução.
- Financeiro: `fin_contas`, `fin_categorias`, `fin_lancamentos`, `fin_caixa_sessoes`. **Venda,
  estorno e reembolso de devolução são DERIVADOS das fontes** (`marketplace_orders`,
  `order_refunds`, `devolucoes`, em `fin__movimentos`), nunca copiados; em `fin_lancamentos`
  mora só o que não tem fonte (`origem` manual, sangria, suprimento, ajuste de caixa). Escrita
  só pelas RPCs `fin_*` (gate `is_admin()` dentro).
- `assinatura_da_loja`: **só leitura no app** (sem grant de escrita; quem grava é o projeto de
  cobrança — [runbook](docs/runbooks/assinatura-da-loja.md)).
- Cartão: `config_pagamento_cartao` e, em `marketplace_orders`, `tentativas_de_pagamento`,
  `metodo_online` (pix|credito|debito), `parcelas` e `estorno_manual_registrado_em`.

**Dinheiro (BRL, numeric 10,2).** `payment_status` CHECK: `aguardando | pago | recusado |
expirado | estornado | pago_apos_expirar | recebido_na_entrega`. O sétimo valor (venda
paga na mão, ex.: PDV) só é gravado pela RPC `registrar_pagamento_recebido`
(SECURITY DEFINER, só admin) — nunca por UPDATE direto. Reserva de estoque de
**30 minutos** (pg_cron expira e devolve estoque); o desafio 3DS do cartão estende
`expires_at` uma vez, até 40 min a partir da cobrança que voltou com desafio (só estende,
nunca encolhe — `expiracaoParaDesafio3ds`, `criar-pagamento/index.ts`).

**Fluxo do dinheiro (PIX e, desde 26/09/2026, cartão de crédito/débito pelo app — o cartão nasce
DESLIGADO em `config_pagamento_cartao` (crédito e débito `false`) e só é ligado no painel depois
do pedido de teste do [runbook de publicação](docs/runbooks/publicar-painel-cartao-devolucoes.md)):**
1. Checkout **exige conta** para pagar online (política P6).
2. `criar-pagamento`: decide criar / reconsultar / recusar; **Orders API** do Mercado Pago
   (`external_reference` = id do pedido, idempotência, PIX PT30M alinhado à reserva,
   realinhamento de `expires_at` com a data do MP); grava o id da cobrança e devolve o QR.
   Cartão: token do Card Payment Brick (o dado do cartão nunca passa pelo app); forma ligada e
   teto de parcelas conferidos em `config_pagamento_cartao` antes de tocar a vaga; 3DS pela
   Orders API (o desafio abre em iframe; quem confirma continua sendo o webhook).
   **Idempotência POR TENTATIVA** (`chaveDeIdempotencia`): PIX `<pedido>` na tentativa 0
   (byte a byte a chave de antes) e `<pedido>:<n>` depois; cartão `<pedido>:c<n>`, **sem o
   token** — no MP real, duas abas ou o retry de resposta perdida batem no MESMO 409
   `idempotency_key_already_used` (chave repetida, corpo diferente a cada token novo), e a vaga
   recebe o SENTINELA `verificando:<pedido>:c<n>` até o webhook ADOTAR a cobrança aprovada ou o
   teto de `sentinelaExpirado` liberar (nenhuma cobrança apareceu); nunca duas cobranças vivas.
   **Cartão recusado não cancela o pedido**: `liberar_cobranca_do_pedido` (só
   service role; não toca `payment_status` nem estoque) solta a vaga (`gateway_payment_id`) se ela ainda for daquela cobrança e o
   pedido seguir `aguardando`, soma `tentativas_de_pagamento`, e o cliente tenta outro cartão
   ou PIX na mesma reserva — `confirmar_pagamento('recusado')` só vale para PIX. Cartão em
   `action_required`/`created` é cancelado no MP antes de virar PIX; em `processing`, 409.
3. `webhook-mercadopago` (sem JWT; autentica por **HMAC x-signature**): nunca confia no
   corpo — reconsulta o MP e **confere o valor (±R$ 0,05)**; chama a RPC
   **`confirmar_pagamento`**, a ÚNICA escrita de pagamento (FOR UPDATE, idempotente).
   Em pago/pago_apos_expirar: push aos admins; só em pago: comprovante por e-mail.
   Recusa/expiração de order de CARTÃO e order cancelada vão para `liberar_cobranca_do_pedido`,
   nunca para `confirmar_pagamento` (sem `payment_method.type` legível, decide o `metodo_online`
   gravado). Notificação da rota `payment` sobre id diferente do gravado só aplica
   pago/estornado se a order GRAVADA confirmar o mesmo desfecho (cobrança órfã não vira pago).
   Na virada para `estornado`, o gatilho `tr_marca_estorno_direto_do_pedido`
   (`marca_estorno_direto_do_pedido`, migration `20261176`) **só carimba
   `estorno_manual_registrado_em`** (BEFORE UPDATE OF payment_status, COALESCE — não toca
   status, valor nem estoque): é a data do estorno que o Financeiro usa.
4. `reconciliar-pagamentos` (pg_cron 10 min, segredo próprio): fila de 24h → MESMA RPC (e a
   mesma liberação da vaga para cartão recusado).
5. Finais: pago segue entrega · pago_apos_expirar é dinheiro fora do fluxo (P1) ·
   expirado teve estoque devolvido · recusado (só PIX; cartão recusado não é final) ·
   estornado (o app não estorna; parcial fica deliberadamente não mapeado).

**Convidado:** OTP por e-mail amarrado a **UM pedido** (e-mail + whatsapp + fragmento do
id; 15 min; 1 envio por pedido a cada 60s — protege a cota ~100/dia do SMTP da loja).

**Integrações:** Mercado Pago (Orders + Payments API; Card Payment Brick do SDK JS v2 no
checkout) · ViaCEP · Melhor Envio e Frenet (frete em `calculate-shipping`; etiqueta de ida e
código de postagem reverso da devolução em `melhor-envio-etiqueta`) · SMTP da loja (OTP e
comprovante) · Web Push (VAPID) · wa.me (deep links) · linkrastreio. Sem axios — tudo `fetch`.

### Políticas declaradas pelo dono (Gabriel)

- **P1 — Pago após expirar: HONRAR.** O app deve reconhecer o pagamento tardio e corrigir
  o pedido. Evolução futura: botão no pedido para reanálise pelo usuário.
- **P2 — Valor divergente** (além da tolerância de ±R$ 0,05): devolver e solicitar novo
  pagamento.
- **P3 — Reembolso:** política de CADA lojista (o assinante configura a sua) — desde 26/09/2026
  em `politica_devolucao` (Ajustes → Trocas e devoluções), com os mínimos da lei por CHECK
  (arrependimento ≥ 7 dias, vício ≥ 30). Devolução de produto entregue: `devolucoes` (local ou
  nacional, etiqueta reversa do Melhor Envio); reembolso pelo ledger `order_refunds` + edge
  `estornar-pagamento` quando o pedido foi pago pelo app (até 180 dias), senão reembolso manual
  registrado na devolução — os dois descontam o que outra devolução do mesmo pedido já devolveu.
- **P4 — Cupons:** regras definidas na criação/edição pelo lojista; ao tocar no código de
  cupom, **eliminar os contadores duplicados** (`usage_count`/`used_count`).
- **P5 — Frete:** hoje flat_fee + cotação (Melhor Envio/Frenet). Direção: presets de
  estratégias de frete grátis (envio local vs nacional via API de transportadora),
  configuráveis pelo lojista — avançado e simples.
- **P6 — Convidado não paga online — permanente.** O app exige login para concluir a
  compra.
- **P7 — Planos/assinaturas:** inexistentes hoje; a arquitetura será definida
  organicamente conforme a entrada de lojistas assinantes.

### Protocolo de papéis (posturas, não cargos)

O antigo time de 10 subagentes vira **posturas de trabalho** executadas com os agentes
nativos do ZCode (general-purpose, Explore, judge, feature-dev):

- **Investigar antes de agir** — fonte oficial primeiro, relatos depois; pesquisa tem a
  profundidade que o custo do erro manda.
- **Escrever o plano antes do código** em tarefa não trivial; uma tarefa por execução.
- **Revisar após escrever** — quem escreveu não é testemunha; revisão é contexto limpo.
- **O risco define o que exige revisão** (tabela abaixo); tamanho não decide nada.
- **Leitura paraleliza, escrita não** — varreduras e verificações em paralelo; escrita
  no mesmo arquivo, nunca.
- **Sócio/decisão:** tudo que é produto, dinheiro, público ou irreversível sobe ao
  Gabriel com recomendação — nunca menu sem conta feita (melhora, piora, conserto, bem maior).

#### Orquestração por camadas de modelo

A sessão orquestra e despacha subagentes; a camada de modelo segue o risco (padrão
oficializado pelo dono em 02/09/2026 — Missão 05.2):

| Trabalho | Camada |
|---|---|
| Explorar, executar, implementar mecânico | subagente **Flash** (leitura paraleliza) |
| Rotina (fora do mapa de risco) | **Flash** escreve + **5.3** revisa |
| Mapa de risco: RLS/migrations, edge functions, auth/OTP, checkout, service worker | **5.3** implementa + **5.3** revisa |
| Debug | **Flash** tenta; **2 falhas** escalam para o **5.3** |

O brief de subagente é SEMPRE autocontido — objetivo, arquivos, travas relevantes e o
que trazer de volta: subagente não vê a sessão. Valem em toda camada as regras de cima:
escrita serial; quem escreveu não revisa; decisão de produto sobe ao Gabriel com a conta feita.

## Banco de dados — regras que não se negociam

- **RLS.** Toda tabela de dado de usuário nasce com Row Level Security ativado.
- **`SECURITY DEFINER`.** Privilégio elevado exige `search_path = public` explícito; só
  crie RPC se for necessária e auditada.
- **Tipagem estática.** Mudou o schema, regenere os tipos (`supabase gen types`) — senão
  o front mente sobre a forma do dado.
- **Este banco é de DESENVOLVIMENTO** (~64 pedidos fictícios em 5 meses). Escrever nele é
  barato; o que o código **faz** se replica em cada loja — é lá que existe dinheiro. O
  rigor é sobre o que se replica, não sobre este banco.
- **Nunca `supabase db push`.** A fila está zerada (105 migrations, todas casadas no
  ledger; um push hoje é no-op) — mas **nenhum cliente pode ter o schema reproduzido a
  partir do repositório** (baseline + 98 históricas colidem num banco zerado; ADR 0002).
  Migration nova chega à loja pelo workflow `aplicar-migrations.yml` (`workflow_dispatch`:
  prova `BEGIN/ROLLBACK` + apply, arquivo por arquivo) — que **não** grava o ledger
  `supabase_migrations.schema_migrations` (quem grava é o `scripts/db-apply.cjs`) e cuja
  verificação final não confere migration nova. As `20261175`–`20261178` (PR #666) sobem por
  ele, com ordem, conferência e rollback no
  [runbook de publicação](docs/runbooks/publicar-painel-cartao-devolucoes.md).
- **Migration não leva `BEGIN`/`COMMIT`.** Com eles, o `ROLLBACK` do script de prova vira
  no-op e a mudança fica gravada.
- **Backup é diário e não há PITR.** Nunca `--no-verify` no commit — o `secretlint` do
  pre-commit é a única trava contra credencial vazada (o histórico já teve chave commitada).

## Verificação — o que realmente cobra

Os comandos do projeto são a fonte de verdade (é o que o CI roda, nesta ordem):

```bash
npm ci
npm run typecheck      # tsc -b --force
npm test               # test:edge + test:unit + test:front
npm run build
npm run lint:links
npm run lint:ratchet
npm run size
```

`npm test` são três suítes com runners diferentes: `test:edge` (Deno,
`supabase/functions/`), `test:unit` (Deno, `tests/`) e `test:front` (Vitest,
`tests/front/`).

**`npm run size` é portão DIVIDIDO** (decisão do dono, 26/09/2026): JS que a cliente pode
baixar **≤ 550 kB** e JS só do painel **≤ 450 kB** (brotli por arquivo), CSS ≤ 100 kB, leitor
zxing ≤ 400 kB (`.size-limit.cjs`). Quem classifica cada chunk é o **grafo real do Rollup**,
nunca o nome do arquivo: o plugin `scripts/portaoDividido.ts` (`generateBundle`, só no build)
faz a busca a partir das entradas sem atravessar a fronteira (entrada dinâmica que contém
`AdminArea.tsx` ou tela de `src/views/admin/**`, exceto `AdminLoginView`, que é pública): o
alcançado é cliente, o resto é painel. Grava `.portao-tamanho/<dist|dist-test>.json`; o
`.size-limit.cjs` falha fechado se o JSON faltar ou não bater com os `assets/*.js` do disco
(`scripts/validarPortaoDeTamanho.cjs`) — rode `npm run build` antes. Subir teto ou mexer na
fronteira é decisão do dono, não ajuste de CI.

Duas leituras que enganam:

- **`eslint` tem teto de warnings pré-existentes e 0 erro — os DOIS reprovam se subirem.**
  `scripts/lint-ratchet.mjs` reprova qualquer contagem acima do teto de
  `.lint-baseline.json` (o arquivo é a fonte; se este texto divergir dele, o arquivo manda).
  Warning pré-existente (dentro do teto) não reprova; warning **novo** reprova como erro.
- **`lint:ratchet` acusa Biome acima do teto no Windows por causa de CRLF** — Biome só é
  cobrado no CI (Linux). Ruído explicado não dispensa olhar: meça a parte que o CRLF não
  cobre para arquivo NOVO.

Hooks de git ativos (`lefthook.yml`): `secretlint` e guarda de branch no pre-commit,
`commitlint` no commit-msg, guarda de branch + `typecheck` no pre-push. As suítes `.bat`
em `C:\Users\Gabriel\Documents\Ferramentas para projetos\` são complementares (acessibilidade,
SEO, PWA) — mas **quem reprova o PR é o CI**. Cole a saída real no relatório: "deve estar
passando" não é evidência.

## Mural e árvore compartilhada

Este repositório costuma ter várias sessões na mesma árvore. Antes de tocar em arquivo:

```
node "C:\Users\Gabriel\.claude\mural\mural.mjs" core_app_mkt
```

Registre sua frente em `~/.claude/mural/core_app_mkt/frentes/<apelido>.md` reivindicando
os arquivos ANTES de editar (protocolo em `~/.claude/mural/COMO-FUNCIONA.md`; terreno e
faixas de migration em `~/.claude/mural/core_app_mkt/_REGRAS.md`). As três travas, que
entram no prompt de TODO subagente:

1. Nunca `git stash`, `checkout`, `restore`, `clean` nem `reset`. Para comparar com o
   original, `git show HEAD:<caminho>`.
2. Nunca `git add` seguido de `git commit` — o índice também é compartilhado. Use
   `git commit -- <caminho> [<caminho>…]`.
3. Arquivo compartilhado não entra no seu commit — vira commit próprio depois que todos
   terminarem, ou entra por montagem cirúrgica.

## Mapa de risco — quando a revisão é cara

**Revisão cara obrigatória, independente do tamanho do diff, se o diff toca:**
`supabase/migrations/` · RLS ou `SECURITY DEFINER` · `supabase/functions/` · auth/OTP ·
checkout/pagamento · service worker · qualquer assinatura consumida por outro módulo.
Desde 26/09/2026 (PR #666) entram também: RPCs de devolução/reembolso e `fin_*` (dinheiro),
todo gatilho em `marketplace_orders` (o `tr_marca_estorno_direto_do_pedido` roda dentro de
todo UPDATE que vira `estornado`, inclusive o de `confirmar_pagamento`), `vercel.json`
(CSP/COEP — o Brick e o desafio 3DS são iframes
do Mercado Pago) e `scripts/portaoDividido.ts` (a fronteira decide o que a cliente baixa).
**Ligar crédito/débito em `config_pagamento_cartao` é decisão de dinheiro do Gabriel**, depois
do teste do runbook — nunca efeito colateral de deploy.
Os erros mais caros daqui foram triviais de escrever (`BEGIN`/`COMMIT` numa migration
gravou em produção; deploy sem `--no-verify-jwt` derrubou o OTP; remetente em sandbox não
entregou e-mail). Ordem de publicação também é risco: function antes da migration derruba
todo PIX (503 — `criar-pagamento` lê `tentativas_de_pagamento`). Quem escreveu não revisa o
próprio trabalho; o revisor pode recusar a classificação de baixo risco (devolve `ESCALAR`).
Na dúvida, revisão cara.

## Deploy e logs

Deploy na Vercel (config em `vercel.json`). Não há MCP de deploy configurado — build e
logs pelo painel da Vercel ou pela CLI. Depois de deploy: aviso de compilação, pacote
duplicado, erro de geração de página; em falha de usuário, os logs de Edge Function.
`version.json` e o service worker são regenerados no build — a atualização do PWA é com
consentimento do usuário (`registerType: "prompt"`).

**Publicação que cruza banco e edge (26/09/2026).** Ordem fixa: migrations pelo
`aplicar-migrations.yml` → functions pelo `publicar-functions.yml` → front. O preview da
Vercel fala com o banco da loja (ADR 0001), então tela nova que chama RPC nova só funciona no
preview depois das migrations. Passo a passo, conferência e rollback do PR #666:
[`docs/runbooks/publicar-painel-cartao-devolucoes.md`](docs/runbooks/publicar-painel-cartao-devolucoes.md).

**Versão por release (22/09/2026).** Cada release pública nova recebe incremento de
patch no `package.json` e nas duas raízes do `package-lock.json` (`1.5.1`, depois
`1.5.2`, `1.5.3`…), com conferência de que o `codeVersion`/`version.json` do build
carrega o número novo. NÃO incrementar por build/preview: o `deliveryVersion` completo
(sha + identity) continua distinguindo builds; o núcleo semver só avança em release —
é ele que o aviso de atualização mostra.

`robots.txt` e `sitemap.xml` (SEO, issue #117) também nascem no build, por loja: o
`scripts/sitemap.mjs` consulta a `vw_produtos_public` e sobrescreve as sementes versionadas
em `public/` (que servem o `vite dev` e envelhecem — o build é a fonte fresca; regenerá-las
é rodar um build database e copiar do `dist/`). Modo fixture não sai para a rede.

## Testes e estabilidade

- **Isolamento antes de promover.** Mudança estrutural em estado global (Context de
  Autenticação, de Carrinho) se testa isolada antes de entrar no código do projeto.
- **Fluxos críticos.** Carrinho, cupom, checkout e Q&A validados em mais de um cenário
  de rede; responsivo e offline.
- **Leia a saída e se autocorrija** quando algo falhar.

## Ferramentas agênticas deste repo (ZCode)

- **Orquestrador de skills:** `skill-router` (MCP) — `buscar_skill` → `carregar_skill` →
  `ler_recurso_skill` antes de tarefa não trivial; **declare as skills usadas** no fim da
  resposta.
- **`context7`** — API de biblioteca (React 19, Vite, Supabase JS, Deno) em vez de memória.
- **`serena`** — navegação de código (símbolos e referências) em vez de grep cego.
- **`supabase` (MCP)** — schema, RLS, RPC, geração de tipos.
- Não invoque ferramenta que não está na sua lista; diga que não tem e siga com o que tem.
