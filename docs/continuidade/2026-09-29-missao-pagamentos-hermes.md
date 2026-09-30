# Continuidade — Missão pagamentos (Hermes/GLM, 28-29/09/2026)

Coordenador: Hermes perfil ikcous, glm-5.3 (zai Coding Plan). Workers: glm-5.3-flash
(`delegation.model`, `max_concurrent_children: 64`, profundidade 1, worktree_isolation).
Alvo: árvore viva `C:/Users/Gabriel/Documents/ikcous-marketplace`, branch
`claude/app-major-upgrade-wmc8x2`, HEAD base `090fdbd4`. Frente endereço/mapa encerrada
por outro chat — arquivos preservados, intocados. Testes pesados: só o coordenador.

## Correções concluídas (verificadas)

- **`mp_refund_id` com id da ORDER no caminho Orders** (`_shared/estorno.ts`, 29/09,
  **APROVADO** por revisão independente `sa-0-94170528` + os 4 achados endereçados):
  contrato confirmado na doc primária (refund da Orders API: id da order no TOPO,
  id do REFUND em `transactions.refunds[].id`); `interpretarOrders` gravava o id do
  TOPO — a travessia P0 (`idsJaReivindicados`) nunca casava com refund real. Fix +
  melhorias do revisor: `idDoRefundNaResposta(c, linha)` (só candidatos com id E o
  VALOR da linha em centavos; entre eles o mais recente por date_created; nenhum →
  string vazia, NUNCA o id da order); `resultado.mp_refund_id || null` nos TRÊS
  chamadores da `concluir_estorno` (edge/cron/webhook — '' nunca grava na coluna);
  **423 resource_locked → tentar_depois** com retryAfterS nos dois interpretadores
  (antes: 'falhou' definitivo sem retry; POST idempotente pela chave da linha).
  RED (E14b/c) → GREEN: **estorno 56/0 · estornar 23/0 · reconciliar 57/0 · webhook
  118/0 — todos exit 0** (E14 atualizado conscientemente; novos E14b/c/d e 2× E23-lock).
  Residual declarado pelo revisor: divergência POST×GET na escolha do id sem duplo
  crédito (claimed-set do GET fecha); forma real da resposta do MP pendente de
  medição T8/sandbox.

- **Estorno — linhas `sistema` executáveis pela edge (dupla saída)** (29/09,
  **APROVADO** por revisão independente `sa-0-82ffcb87` + as DUAS melhorias do
  revisor implementadas): `estornar-pagamento/index.ts` não excluía linhas
  `solicitado_por='sistema'` (rastreio de chargeback do webhook) — clique do
  lojista podia disparar POST real de refund DURANTE disputa aberta (o cron já
  excluía por "pagar duas vezes"). Fix: SELECT lê `solicitado_por` + gate 2b
  (409 `estorno_de_sistema` antes de tudo) **+ defesa em profundidade**: a MARCA
  carrega `.neq('solicitado_por','sistema')` (mesmo filtro do cron — refatura
  futura que pule o 2b marca 0 linhas). Testes: F12 (RED→GREEN) prende o gate E a
  coluna do SELECT (dublê agora captura colunas — achado MÉDIO do revisor);
  F12b prende o .neq da marca; F5/F9 estendidos conscientemente com o filtro novo.
  **Suíte: 23 passed | 0 failed, exit 0.** Revisão confirmou: única origem de
  linha sistema VIVA é chargeback in_process; nenhuma linha legítima bloqueada
  (CHECK do banco cobre null); sem conflito com o cron/webhook.

- **Busca MP campo `data`** (`_shared/mercadopago.ts` + 7 testes): a liberação de sentinela
  por busca era CÓDIGO MORTO em produção (corpo real `{data:[...]}` era rejeitado →
  `ok:false` sempre; só `expires_at` liberava). Fix do worker sa-0-0927b3c5 (commit
  `a542cbc8` na worktree) integrado à árvore viva via `git apply` (sem commit/índice).
  Verificação própria: **142 passed | 0 failed**. Ressalva: confirmado contra doc/SDK,
  não contra a API viva — checklist §6 do runbook de publicação segue valendo.
- **Revisão formal do checkout (sa-0-86ed98e2): APROVADO** — fidelidade byte a byte
  (hash-object) ao f076676d, nenhum teste antigo editado, marcador idempotente
  (StrictMode ok), timeouts com timer/rejeição tardia tratados, descarte de cache
  restrito ao mapa do PIX, e RETRY PÓS-TIMEOUT provado seguro contra a edge
  (reconsulta/mesma chave de idempotência → nunca duas cobranças vivas). Run
  independente: 5 arquivos / 96 testes / exit 0. Residual BAIXA documentado: janela
  de falso-positivo do marcador (cartão em cena → montagem falha sem POST → config
  some → troca marca incerteza indevida; direção conservadora, só esconde
  'Cancelar pedido'; exigiria sinal ascendente novo do PagamentoComCartao).
- **Checkout — guarda de cobrança incerta + timeouts** (integrado de `f076676d`
  via `git apply`, verificado pelo coordenador: **5 arquivos / 96 testes passaram,
  exit 0** — 7 novos + 89 regressão): (1) fallback "cartão indisponível" do
  PagamentoOnline não passava mais `cartaoAindaVivo=false` hardcodado quando a tela
  do cartão (possivelmente com cobrança viva em análise/3DS) era desmontada — agora
  `cartaoEsteveEmCena` preserva o estado incerto na troca para PIX (teste RED→GREEN);
  (2) loadings "Gerando o QR code…"/"Carregando o formulário do cartão…" ganharam
  tempo limite local (20s/15s, Promise.race com limpeza de timer); retry do PIX
  descarta o cache por orderId (a edge reconsulta a mesma cobrança — sem segunda
  cobrança). NÃO corrigido de propósito (proposta registrada): fase create()/onReady
  do Brick e POST de cartão sem prazo (rodada dedicada). Polling 'recusado' =
  código morto defensivo, sem defeito ao cliente — nada a corrigir.
- **Sentinela PIX→cartão = RESÍDUO DOCUMENTADO travado por teste** (worker
  sa-0-0927b3c5, mesmo commit `a542cbc8`): fronteira exata (morta<limite+margem→presa;
  viva→adotada; morta+20s→libera; order de outro pedido nunca) — 3 testes novos.
  Recomendação ao dono: NÃO reabrir agora (opções e conta feita no relatório).

- **W9 — webhook estorno com corpo Order na rota payment** (`webhook-mercadopago/index.ts`
  ~1655-1725 + teste W9 em `index_test.ts` ~2715): a guarda B1 reconsulta a ORDER gravada
  mas passava `rota:"payment"` aos leitores (`ehPayments`), que procuravam `refunds[]`/
  `approved`/`transaction_amount_refunded` (formato Payments) numa ORDER — estorno/
  chargeback real notificado pelo tópico clássico nunca entrava no ledger. Fix:
  `formatoConfiavelParaEstorno` vira `"order"` quando o corpo veio da reconsulta.
  RED→GREEN: suíte do webhook **118 passed | 0 failed**. Revisão adversarial independente
  em voo (sa-1-d1dda330).

## Política do PIX — chave de assinatura própria (Gabriel, 29/09/2026) — PENDENTE de revisão

- **Delta aplicado e localmente validado** (ainda NÃO publicado; webhook fallback
  NÃO removido — só planejado): gate no `criar-pagamento/index.ts` (~:986-1020, PIX
  ⇔ `origem:"lojista" && segredoWebhook`, 409 terminal + flag
  `pixSemChaveDeAssinatura`, antes de ler pedido/tocar vaga/chamar MP) + testes:
  matriz 2×2 (4 novos), default do dublê = registro lojista COM chave (string
  pré-serializada p/ não mudar interleaving das corridas), `bancoComEstado` idem,
  `registroMp:null` explícito no laudo 0109, meta-teste de recusas 48→49 documentado.
  **Suíte inteira: 182 passed | 0 failed, exit 0.** Nenhuma expectativa antiga
  enfraquecida (laudo 0109 e corridas preservam a intenção).
- Backup reversível do delta:
  `C:/Users/Gabriel/AppData/Local/hermes/profiles/ikcous/cache/scratch/politica-pix-backup-v2.patch`
  (revert = `git apply -R`, nunca git restore/reset).
- **Re-revisão (sa-0-4b59797c, 29/09): APROVADO.** Seam seguro em produção
  (handler só é invocado com `(req)`; nenhum módulo o importa além do teste;
  logs só origem/motivo), corridas nada perderam (resolver nunca foi objeto delas;
  matriz exercita o resolver de verdade), comentário fiel (rg=0 em src/), teste do
  caso central válido, runs reais 3× 183/0 exit 0 + corridas 4/0. Nota BAIXA
  cosmética (setup de MP_ACCESS_TOKEN sobrescrito no teste do caso central) já
  corrigida no arquivo — verificação da linha roda na próxima execução da suíte.
  **Política PIX: localmente validada de ponta a ponta; aguardando decisão de
  deploy do Gabriel (com checklist por loja viva: registro com webhook_cifrado).**
- Histórico da 1ª revisão (sa-0-493cd3f9, PROBLEMA→endereçado): corridas flaky
  (crypto real do resolver entre corredores — meu 182/0 não reproduzia), comentário
  falsamente afirmava reconhecimento da flag pelo front, e faltava o caso central
  "MP_WEBHOOK_SECRET global setado + lojista sem chave → 409". **TODOS endereçados
  (29/09)**: costura `deps.credenciaisMp` (padrão da casa; produção nunca passa),
  injeção `CREDENCIAIS_LOJISTA_FIXAS` nas corridas, comentário honesto (flag =
  marcador; front não lê hoje — nota de produto para a tela do Gabriel), teste novo
  do caso central. **Estabilidade provada: 3× suíte inteira 183/0 exit 0 + filtro
  'corrida real' 4/0.** Re-revisão focada do delta pós-ajuste em voo. Residuais
  abertos: (c) cartão e2e com credencial de plataforma não exercitado (sem ramo
  comportamental próprio); UX do comprador (texto de operador em caixa terminal,
  sem oferta de cartão) — decisão de produto do Gabriel.
- Revisão da busca MP (`data`): **APROVADO** (`sa-1-de04f078`) — integração
  byte-a-byte fiel ao `a542cbc8`, 142/0 re-executado de forma independente,
  fail-safe preservado ({data:[]}→ok:true+[] e NENHUMA chamadora libera com lista
  vazia), refiltro B2 total, margem de 15s intocada, UNVERIFIED documentado.
  Residuais baixos: paginação não percorrida (>20 orders/janela é irrealista;
  coberto pelo checklist §6 do runbook) e título de teste antigo datado.
- Enfileirado (após validação da política): remoção do fallback global no webhook
  (`:1138-1148`) com a mesma disciplina (matriz, suíte inteira, revisão).
  **Conclusão registrada 29/09 (análise por evidência, sem edição)**: o fallback
  NÃO contorna o gate do PIX (mora na criação) nem aceita notificação sem HMAC
  válido (só ESCOLHE o segredo da plataforma — sem bypass/forja; loja com chave
  própria nunca cai nele). Efeito real: diagnóstico (401 enganoso p/ loja sem
  chave no cartão; confirmação via reconciliador ≤10 min, P1 honrada). É dívida
  arquitetural + decisão de dono já tomada, acoplada ao checklist de deploy por
  loja — não é falha explorável hoje; aplicar na rodada de publicação.

## Frente 10 — cliente não consegue RETOMAR pagamento do pedido pendente (relato do Gabriel, 29/09, FECHADA)

- **APROVADO** por revisão independente `sa-0-2e46f5af` (runs reais: T1/T2 7/7,
  typecheck 0). Verificação profunda: matriz do botão sem estado perigoso;
  VAZAMENTO do `checkoutRetomadaId` rastreado em TODOS os caminhos para
  'checkout' (handleNavigate limpa sempre; popstate auto-consistente; gate
  dirty só no admin); retomada sobre reserva morta → 409 terminal → caixa
  honesta com saída (não beco); 'credito' com cartão desligado → fallback
  PIX seguro no mount; impossível pedido duplicado (early-return). Achados
  endereçados: (BAIXA-UX) **`recusado` agora também mostra o botão** (cobrança
  morta — a edge cria outra com segurança; teste novo na matriz, 8/8);
  (COSMÉTICA) linha em branco do useState removida. Residual documentado
  (estrutural): `cartaoEsteveEmCena` é por-mount — POST de sessão ANTERIOR é
  invisível ao novo mount; mitigado no servidor (guarda P0001 + reconsulta da
  edge). **Final: T1 6/6 + T2 2/2 = 8/8, typecheck 0.**

- **Comportamento observado (diagnóstico em código)**: cliente inicia pagamento,
  sai sem concluir, volta ao card do pedido pendente → NÃO existe caminho de
  volta à tela de pagamento. Causa: `orderId`/`aguardandoPagamento` vivem em
  `useState` do CheckoutView (morrem ao desmontar); OrderDetailsView só
  oferecia WhatsApp; recarregar /checkout cai no fluxo do CARRINHO (vazio — o
  pedido já nasceu). O BACKEND já retomava com segurança (reconsulta → MESMO
  QR; vaga livre → nova cobrança com chave de tentativa nova; 409 terminal se
  não cobrável) — faltava a porta da frente.
- **Fix (front-only, 3 arquivos)**: OrderDetailsView ganha botão **"Retomar
  pagamento"** (só `pending` + `aguardando` + logado — P6; pago/expirado/
  cancelled/guest não mostram); App.tsx ganha `checkoutRetomadaId` (4º param
  `opts` do handleNavigate — limpado em TODA navegação sem a opção, para o
  carrinho→checkout nunca herdar retomada velha); CheckoutView com
  `retomarPedidoId` nasce DIRETO na tela de pagamento do pedido existente
  (busca `total, metodo_online` do próprio pedido — valor cosmético, quem
  decide a cobrança é a edge).
- **Testes**: T1 RED (1/5: botão não existia) → **5/5** (matriz: mostra só no
  caso certo); T2 **2/2** (carrinho vazio → tela "Finalize o pagamento" com
  orderId/valor do pedido; sem prop → fluxo normal intacto); regressão
  **34/34** (cancelar/checkout PIX/guarda de troca/tempo-limite); **typecheck
  0 erros** — inclusive corrigindo 4 erros de tipo PRÉ-EXISTENTES da frente 4
  (falha de verificação minha na integração dela: só vitest, sem typecheck).
- **Revisão independente `sa-0-2e46f5af` (deleg_b229af20) EM VOO**: brief ataca
  matriz do botão, vazamento do `checkoutRetomadaId` (back/popstate),
  retomada sobre reserva morta (409 terminal), método credito com cartão
  desligado, regressão/typecheck reais.

## Frente 9 — recusa ilegível de cartão sob SENTINELA cancelava pedido (29/09, FECHADA)

- **APROVADO** por revisão independente `sa-0-299238ad` (run real 121/0) —
  verificação profunda: EXCLUSIVIDADE do sentinela confirmada (único escritor
  `ocuparVagaComSentinela`, só fluxo de CARTÃO; git -S mostra que nasceu com o
  cartão — SEM janela histórica de PIX; invariante vaga-NULL ⟺ metodo-NULL em
  todos os escritores); passo 2 fechado POR CONSTRUÇÃO (RPC false →
  'nada_a_liberar', pedido NÃO morre; cura pelo resolverVagaEmVerificacao
  testada em Ponto 1); belts Q2/Q2b intactos; MP-W2 rewrite confinado; teste
  'reenvio' íntegro. Único achado BAIXA (fidelidade do teste) CORRIGIDO:
  dublê agora devolve `liberarResultado: false` e o teste afirma a resposta
  real de produção `{resultado: 'nada_a_liberar'}` — **121/0 exit 0** final.

- **Diagnóstico com evidência** (item 3 do inventário): o hardening do webhook
  (`:1416`) decidia "é cartão" na recusa de tipo ilegível só pelo
  `metodo_online` gravado — mas o SENTINELA deixa `metodo_online` NULL por
  desenho (fechamento S3) ⇒ recusa de cartão sob sentinela caía no caminho de
  PIX: `confirmar_pagamento('recusado')` **cancelava o pedido e devolvia o
  estoque** (venda perdida; spec: cartão recusado não cancela).
- **Fix**: SELECT lê também `gateway_payment_id`; novo ramo — método NULL +
  vaga SENTINELA (`vagaEmVerificacao`) ⇒ `liberarAVaga=true` (cartão:
  `liberar_cobranca_do_pedido`; o sentinela é solto pelo
  `resolverVagaEmVerificacao` no retry do cliente). Fundamento: sentinela é
  mecanismo EXCLUSIVO do cartão (Achado B2; PIX não gera — frente 7 manteve
  assim). Fronteira presa por teste: vaga NULL + método NULL segue caminho PIX
  (PIX recusado é final).
- **Testes**: RED (sentinela: `1 failed` — cancelava) → GREEN: **suíte webhook
  121/0 exit 0** (119 + 2 novos; RAM 3,67 GB antes do run). Nota: um patch
  acidental deletou 3 linhas do teste "reenvio da MESMA recusa" — revertido na
  hora; revisor confirmará integridade.
- **Revisão independente `sa-0-299238ad` (deleg_fb2809f3) EM VOO**: brief ataca
  exclusividade histórica do sentinela (PIX já gravou sentinela no passado?),
  passo 2 da liberação sobre vaga sentinela (RPC false → pedido vive?),
  colisões Q2/Q2b (belts), e integridade do teste acidentalmente tocado.

## Frente 8 — fim da reserva global MP_WEBHOOK_SECRET p/ lojista sem chave (29/09, FECHADA)

- **Ordem expressa do dono** ("mantenha-a como próximo item, com diagnóstico
  antes de edição") substituiu a conclusão anterior de "sem edição".
- **Diagnóstico com evidência**: a reserva (`:1149`) autenticava notificação de
  lojista SEM chave própria com o segredo GLOBAL da plataforma — confirmação de
  uma loja dependendo de segredo alheio (o que o dono rejeita), INCONSISTENTE com
  o gate do PIX da criação (frente 3) e com justificativa obsoleta: notificação
  de lojista é assinada com a chave do painel DELE e falharia contra o segredo
  da plataforma de qualquer jeito — a reserva só "funcionava" no setup errado
  (painel da loja configurado com o segredo da plataforma).
- **Fix**: guarda `origem === "lojista" && !segredoWebhook` → **500 nomeado**
  ANTES do HMAC (padrão `indisponivel`); origem "ambiente" MANTÉM o env;
  comentários de topo e do bloco reescritos para a regra nova.
- **Testes**: MP-W2 antigo PINAVA o comportamento removido → reescrito
  conscientemente (500, zero RPC, zero consulta); **MP-W2b novo** prende a
  fronteira (ambiente processa 200 com token do ambiente). RED (200≠500) →
  GREEN: **suíte webhook 119/0 exit 0** (RAM 2,78 GB antes do run).
- **Revisão independente `sa-0-4630fd64` (deleg_33fee9de): APROVADO** — run real
  119/0 exit 0; verificou: resolver nunca devolve segredo do env para lojista
  (:276-295); nenhum outro consumidor da reserva (reconciliador usa
  RECONCILIACAO próprio e só o TOKEN do resolver); ordem das guardas preservada
  (401 barato antes do banco; 500 nomeado; HMAC); dinheiro em voo seguro
  (reconciliador ≤10 min chama a MESMA RPC, honra pago_apos_expirar; MP reenvia
  sobre 5xx e processa sozinho quando a chave é cadastrada); MP-W2 reescrito é
  mudança de contrato consciente, sem dependência residual (119/0). 2 achados
  BAIXA "por desenho": (1) **anunciar no rollout**: loja com painel configurado
  com o segredo da plataforma para de confirmar por webhook no deploy — vira
  confirmado pelo reconciliador (≤10 min, pago_apos_expirar) até cadastrar a
  chave; (2) tópico irrelevante também recebe 500 (mesmo padrão aceito do
  `indisponivel`) — ruído de fila, sem risco.
- **Nota de migração para o runbook** (mencionar ao dono na publicação): loja
  que hoje opera com painel configurado com o segredo DA PLATAFORMA passará a
  receber 500 + confirmação via reconciliador até cadastrar a chave própria.

## Frente 7 — PIX 409 idempotency em criar-pagamento (29/09, FECHADA)

- **APROVADO** por revisão independente `sa-0-b0359d8e` (RED reproduzido por ele
  em cópia scratch do HEAD; suíte 185/0 re-executada por ele) + os achados
  endereçados: **MÉDIA** (busca pode vir sem QR — o detalhe dela é UNVERIFIED):
  helper agora garante QR — se a order recuperada não trouxer `qr_code` legível,
  reconsulta POR ID (`consultarOrder`, corpo completo) e usa essa; nem assim →
  502 honesto, nunca 200 sem QR (teste novo prova: 2 GETs, QR da reconsulta).
  **BAIXA** (sem testes negativos do predicado viva-E-PIX): 2 testes novos —
  order de CARTÃO 3DS viva na busca → 502; order PIX MORTA → 502. **BAIXA**
  (busca não paginada): aceito/documentado. **BAIXA** (diff misto com a frente
  3): anotado para o Gabriel separar em commits na publicação.
- **Verificação final: 188 passed | 0 failed, exit 0** (filtro PIX 409: 5/5).

- **Diagnóstico com evidência**: `index.ts` ramo PIX (`const r = criarOrder` →
 `if (!r.ok)` tratava só 401/403; TODO 409 caía no 502 genérico; o cartão trata
 409 via `idempotencyKeyJaUsado` + sentinela `:2205`).
- **RED**: teste "retry com corpo divergente → recupera order viva" falhava
 (502 ≠ 200) no código anterior.
- **Fix**: helper `recuperarOrderPixDoIdempotencia` (~:421) + bloco 409 no ramo
 PIX (`const r` → `let r`): busca `buscarOrdersDoPedido` (frente 2), filtra order
 VIVA (`action_required`) E PIX (`bank_transfer`); achando → segue o fluxo normal
 (MESMO QR, vaga gravada, UMA order viva); não achando → 502 de sempre SEM
 liberar a tentativa (liberar criaria segunda order viva). Nada de log com dado
 pessoal (pedidoId/orderId).
- **GREEN**: suíte inteira **185/0 exit 0** (183 + 2 novos; o 2º prende o caso
 "busca não acha" → 502 sem liberar).
- **Revisão independente `sa-0-b0359d8e` (deleg_f3c72002) EM VOO**: brief ataca
 seleção da order (cartão vivo × PIX), vaga ocupada, janela/paginação da busca,
 regressão do `let`, privacidade.


- sa-0-0927b3c5: sentinela PIX→cartão (fronteira documentada) **+ fix do campo `data`**
  da busca `/v1/orders` (doc primária: lista vem em `data`; código lia `results`/`elements`/
  raiz → busca sempre `ok:false` → liberação por busca é código morto; fail-safe). Dono:
  `_shared/mercadopago.ts` + teste.
- sa-1-d1dda330: revisão adversarial do W9 + varredura da mesma classe (formato do corpo
  vs rota) em reconciliador/estorno/estorno.ts.
- sa-0-aa430067: transição cartão/PIX no checkout (estado de cobrança incerta) + testes
  `pagamento-*`.

## Inventário de achados (lotes 1-2, 9 diagnósticos) — fila priorizada

1. **MEDIA/dinheiro** `estornar-pagamento/index.ts:207-224` não exclui linhas
   `solicitado_por='sistema'` (o cron exclui com o motivo "pagar duas vezes"): admin pode
   disparar POST de refund real sobre linha de chargeback em análise → dupla saída. →
   **fila: repro+fix** (arquivo sem dono).
2. **MEDIA/dinheiro** `_shared/estorno.ts:272-281,445-452` grava `mp_refund_id` = id do
   TOPO da resposta (id da ORDER/pagamento, não do refund) — viola o contrato da coluna e
   enfraquece a invariante P0. Depende da forma real da resposta (ver relatório de
   contratos MP). → **fila: repro+fix**.
3. **MEDIA** webhook `:1391-1405`: fallback PIX-vs-cartão só cobre `metodo_online`
   credito/debito; com NULL (sentinela não carimba mais método) + `payment_method.type`
   ilegível → recusa de CARTÃO vira `confirmar_pagamento('recusado')` → **cancela pedido e
   devolve estoque com o cliente na tela de retry** (venda perdida). → **fila: coordenador
   (webhook é dele), repro antes**.
4. **MEDIA** `criar-pagamento/index.ts:1788-1793`: ramo PIX não trata 409
   `idempotency_key_already_used` — chave `<pedido>` queimada, retry com corpo divergente
   (CPF/documento) dá 502 em loop até expirar. → fila.
5. **MEDIA** `resolverSentinela` grava `cartao[0]` arbitrário (poderia gravar order MORTA
   de tentativa anterior enquanto order viva não rastreada → duas capturas). Teste atual
   documenta "qualquer uma serve" — para gravar, importa. → fila (dono do arquivo depois
   do sa-0-0927b3c5).
6. **MEDIA** margem de 15s não cobre desvio de relógio MP×Postgres (`MARGEM_RELOGIO_BUSCA_MS`
   existe mas é excluída da liberação) → liberação com cobrança ambígua viva em lista
   parcialmente indexada. → decisão de design + fila.
7. **MEDIA** `credenciais-mercado-pago`: trocar só Public Key mantém `ultimo_teste` velho →
   PIX ligável com chave nova nunca testada. → fila.
8. **MEDIA/robustez** `confirmar_pagamento`/`pagamentos_a_reconciliar`: REVOKE sem GRANT
   EXECUTE a service_role (depende de default privileges). ⚠️ a cópia VIVA pode ser
   `20260901000000` (não auditada — conferir lá antes de qualquer fix).
9. **Decisão do dono (não corrigir por conta própria)**: P6 só na tela — anon executa
   `create_marketplace_order_v24` e nasce pedido pagável online sem dono (RPC sem guarda
   de auth; criar-pagamento atende user_id NULL).
10. **Decisão do dono**: `expirar_pedidos_vencidos` devolve estoque com cartão vivo em
    análise >40min (guarda da 20261180 cobre só cancelamento do cliente) → aprovação
    tardia vira `pago_apos_expirar` em pedido morto — colide com P1 documentada.
11. Front (MEDIA): F5/reload na tela do QR/3DS perde a sessão de pagamento (só estado
    React); sinal `semCobranca` errado no 3DS-URL-não-MP (ACHADO 3 documentado, guardado
    no servidor pela 20261180). → em parte com sa-0-aa430067; resto fila.
12. Cobertura (mapa 567 testes): lacunas — estoque devolve 1×; `recebido_na_entrega` só
    via RPC admin; janela 24h do reconciliador; sentinela em 408/409-sem-código; vaga (f)
    `created` sem 3DS. → fila de testes.

Bloqueios externos: comportamentos do MP marcados UNVERIFIED dependem de sandbox T8;
grants reais no banco não são medíveis sem conexão. Nenhum deploy/push/merge; migrations
novas NUNCA aplicadas por aqui (workflow `aplicar-migrations.yml` é o único caminho).

RAM 28/09 ~00:20: 1,62 GB → rec. 3 workers (3 ativos, zero vagas — reposição só quando
abrir). 429 do provedor registrado às ~00:11 (worker pedido/estoque morreu; trabalho
parcial salvo em transcript + consolidado).
