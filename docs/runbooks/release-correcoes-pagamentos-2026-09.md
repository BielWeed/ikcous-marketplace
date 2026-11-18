# Runbook — Release das 10 correções de pagamentos (29/09/2026, Hermes/IKCOUS)

> **Escopo**: somente correções de PAGAMENTOS (edge functions + front + testes).
> Nenhuma alteração de produto/mapa/endereço, `package*.json`, `vercel.json` ou
> migrations. Branch: `fix/correcoes-pagamentos-2026-09` (commits por caminho,
> sem tocar o índice compartilhado).
>
> **Status**: proposto para revisão do dono. **Nada foi publicado.** Merge,
> deploy e ativação são atos do Gabriel.

---

## 1. As dez correções (todas: RED→GREEN + revisão independente APROVADA)

| # | Frente | Arquivos-chave | Revisores |
|---|--------|----------------|-----------|
| 1 | W9: estorno/chargeback com corpo Order na rota `payment` | `webhook-mercadopago/index.ts` | APROVADO |
| 2 | Busca MP: lista vem em `data` (era código morto) | `_shared/mercadopago.ts` | `sa-1-de04f078` |
| 3 | Política PIX: chave de assinatura PRÓPRIA obrigatória | `criar-pagamento/index.ts` | `sa-0-4b59797c` (re-revisão) |
| 4 | Checkout: guarda de cobrança incerta + timeouts (20s/15s) | `PagamentoOnline/PagamentoComCartao` (+2 testes) | `sa-0-86ed98e2` |
| 5 | Estorno: linhas `sistema` executáveis (dupla saída) | `estornar-pagamento/index.ts` | `sa-0-82ffcb87` |
| 6 | `mp_refund_id`: id do REFUND de verdade + `''→null` + 423→retry | `_shared/estorno.ts` (+3 chamadores) | `sa-0-94170528` |
| 7 | PIX 409 idempotency: recupera a order viva (mesmo QR) | `criar-pagamento/index.ts` | `sa-0-b0359d8e` |
| 8 | Fim da reserva global `MP_WEBHOOK_SECRET` p/ lojista sem chave | `webhook-mercadopago/index.ts` | `sa-0-4630fd64` |
| 9 | Recusa ilegível sob SENTINELA não cancela mais o pedido | `webhook-mercadopago/index.ts` | `sa-0-299238ad` |
| 10 | Retomada de pagamento pelo card do pedido (botão + plumbing) | `OrderDetailsView/App/CheckoutView` | `sa-0-2e46f5af` |

**Migrations: NENHUMA.** As dez correções são 100% código (functions + front).
Não há passo de banco nesta release.

## 2. Evidência local (gates executados nesta árvore)

- Edge (Deno): criar-pagamento **188/0** · webhook **121/0** · estorno **56/0** ·
  estornar **23/0** · reconciliar **57/0** — todos `exit 0` real.
- Front (Vitest): focos **8/8** (frente 10) + regressão **34/34** + frentes 4
  (2 arquivos) verdes; `npm run typecheck` **0 erros**.
- **Suíte front completa + `npm run build` + `lint:ratchet` + `lint:links` +
  `size`**: executados na janela de RAM desta preparação — números colados no
  PR (seção Gates).
- Todas as suítes com dublês/fictures (zero segredo real, zero chamada a
  provedor, zero banco remoto).

## 3. O que NÃO foi validado localmente (distinção obrigatória)

- **API viva do Mercado Pago**: os contratos foram conferidos contra a
  documentação primária/SDK (busca `data`, corpo do refund, x-signature,
  423) — os itens que o próprio repositório marca UNVERIFIED seguem pendentes
  de **medição em sandbox (T8)**, incluindo o atraso de indexação da busca e a
  forma real da resposta de refund (checklist §6 do runbook de publicação
  existente).
- **Cliente SAV**: nenhum identificador/transação/log foi consultado. Nenhuma
  afirmação sobre o caso dela — nem que as dez correções o resolvem.
- **Produção real**: nenhuma loja viva foi tocada.

## 4. Checklist POR LOJA (antes e depois do deploy)

**Antes (por loja que opera pagamentos online):**
1. Confirmar no painel Ajustes que a loja tem **chave de assinatura de webhook
   PRÓPRIA** cadastrada (frente 3/8 tornam isto obrigatório para PIX e para a
   confirmação por webhook).
2. No painel do Mercado Pago (central de notificações): URL do webhook da
   loja configurada, eventos de pagamento/pedido/refund/chargeback marcados,
   assinatura habilitada com a MESMA chave cadastrada no app.
3. Fazer um pedido de teste PIX (sandbox) e conferir: QR aparece, pagamento de
   teste confirma pelo webhook (log da edge), pedido sai de "aguardando".
4. Se a loja usa cartão: um teste de recusa (cartão de teste recusado) deve
   liberar a tentativa sem cancelar o pedido.

**Depois do deploy (primeira hora):**
5. Observar logs da `webhook-mercadopago`: 500 `chave de assinatura não
   configurada` = loja sem chave própria (ver §5); 401 em loja COM chave =
   divergência entre painel MP e Ajustes (rever passo 2).
6. Um pedido de teste por loja em cada meio habilitado (PIX sempre; cartão se
   ligado).
7. `reconciliar-pagamentos` (pg_cron 10 min) segue como backstop — conferir
   execução normal.

## 5. Mitigação da transição — lojas que usavam o SEGREDO GLOBAL

**Quem é afetado (frente 8)**: loja cujo painel do Mercado Pago foi configurado
com o **segredo da plataforma** (o setup que a reserva antiga autenticava).
**Efeito no deploy**: as notificações dela passam a receber 500 nomeado — o
pedido **não se perde por design** (o reconciliador consulta com o TOKEN do
lojista e chama a mesma RPC `confirmar_pagamento`; o MP reenvia a notificação,
que processa sozinha quando a chave própria é cadastrada).

**⚠️ AVISO HONESTO (correção de 29/09 a pedido do dono): a confirmação
"≤10 minutos pelo reconciliador" NÃO é garantia — é desenho.** ATUALIZAÇÃO
(29/09 09:53Z, run diagnóstico somente leitura #716 → GitHub run
`36552091809`, SUCCESS): o sinal (1) está **PROVADO** — pg_cron tem o job
`reconciliar-pagamentos` ativo a cada 10 minutos com as 8 últimas execuções
`succeeded` (08:40–09:50Z). Os sinais (2) logs da function e (3)
`RECONCILIACAO_SECRET` presente **SEGUEM NÃO COMPROVADOS** (o diagnóstico
read-only não lê logs nem env). O registro MP do lojista EXISTE em
`public.app_settings` (presença ≠ validade; env fallback não verificado).
Sem as provas (2)+(3), o prazo continua **risco residual** e a regra
permanece: **a loja NÃO fica liberada para receber PIX/cartão até ter a
chave própria cadastrada e o painel MP conferido** (regra explícita do dono
— e o gate da frente 3 já bloqueia a criação de PIX sem chave própria; o
cartão é ligado só pelo dono após o pedido de teste do runbook de
publicação).

**Ordem de mitigação recomendada (antes do deploy):**
1. Listar lojas ativas com pagamento online (app_settings/registro do lojista).
2. Para cada uma: cadastrar a chave PRÓPRIA (Ajustes) e conferir o painel MP
   (URL, eventos, assinatura com a MESMA chave) — **obrigatório antes de
   habilitar PIX**, não opcional.
3. Só considerar a loja "pronta" com o pedido de teste aprovado (QR gerado,
   confirmação observada NO LOG da function — não presumida).
4. Provar os três sinais do reconciliador (acima) OU registrar formalmente a
   loja como "sem backstop confirmado" na decisão de liberação.

## 6. Plano de publicação (ordem fixa) e REVERSIBILIDADE

**Sem migrations** ⇒ ordem: `publicar-functions.yml` (as 6 functions) → front
(Vercel). Preview fala com o banco da loja (ADR 0001) — testar o passo 3 do §4
no preview por loja antes de promover.

**Reversão (sem dinheiro novo em risco):**
- Functions: reverta o código necessário e publique de novo a função pelo
  `publicar-functions.yml`, no alvo correto, com o SHA completo da execução em `expected_sha`
  (as mudanças são independentes por arquivo — reverter UMA function não desarma as outras;
  a frente 3 e a 8 são do MESMO arquivo `criar-pagamento`/`webhook` — reverter
  o webhook reverte W9+8+9 juntas: aceitável, todas aprovadas).
- Front: redeploy do commit anterior (retomada do botão é aditiva; sem porta,
  o cliente volta ao estado de antes — sem quebra).
- Nenhum dado é migrado; nada a reverter no banco.
- **Gatilho de reversão**: qualquer confirmação de pagamento real falhando em
  loja com checklist aprovado (§4) → reverter a function correspondente e
  investigar com o log em mãos.

## 6.1 GATE MATERIAL: conclusão da migração do banco (partes f/h/i/j) — PRÉ-REQUISITO de qualquer publicação financeira na loja viva

> Histórico de 09/2026 — o destino atual do webhook está em [producao-unica-fonte.md](producao-unica-fonte.md#edge-functions-por-loja); `dekxab…` é o projeto antigo.

Auditoria de 29/09 (somente leitura, evidências no comentário da PR): o front de
produção JÁ aponta para o projeto novo (`dekxabvqdsuukijblazl` — bundle público);
o projeto antigo (`cafkrminfnokvgjqtkle`) está **INACTIVE**; o token Supabase da
conta antiga (máquina do dono e, presumivelmente, `SUPABASE_ACCESS_TOKEN` do
GitHub) recebe **403** no projeto novo (org IKCOUS); as 3 functions financeiras
EXISTEM no novo projeto (sondas 401/400), mas o runbook da própria migração
(PR #671, `docs/runbooks/migrar-banco-da-loja.md`, §"E agora?") declara
PENDENTES: **(f)** publicar functions **com os segredos** — incl. RECOLETAR as
credenciais do Mercado Pago do lojista (o cofre cifrado não sobreviveu à troca
de projeto), **(h)** Auth (Site/Redirect URL, SMTP), **(i)** webhook do Mercado
Pago apontando para o projeto novo, **(j)** segredos do GitHub Actions
(`SUPABASE_ACCESS_TOKEN` da org nova, `DATABASE_URL`).

**Checklist-gate (cada item com prova esperada; sem TODOS verdes, nenhuma
publicação financeira):**
1. **(j) `SUPABASE_ACCESS_TOKEN` novo no GitHub** — prova: `publicar-functions`
   (projeto=loja) (histórico: hoje use `ikcous-publicada` ou `savy`) executa `supabase functions list` sem 403.
2. **(f) Cofre MP do lojista RECRIADO no projeto novo** — lojista cadastra
   token/chave em Ajustes contra o app apontando o novo projeto; prova: teste de
   credencial do painel verde + log da function.
3. **(f) Segredos das functions presentes** (`MP_*`, `RECONCILIACAO_SECRET`,
   `MP_CHAVES_ENCRYPTION_KEY`) — prova: pedido de teste PIX gera QR (resposta
   200 da `criar-pagamento`), sem 500 de credencial.
4. **(i) Webhook MP registrado para `dekxabvqdsuukijblazl`** — prova:
   notificação de teste chega (log da `webhook-mercadopago`) e assinatura valida.
5. **Reconciliador provado** (pg_cron ativo + job executando + logs recentes +
   `RECONCILIACAO_SECRET` válido) — sem isso, loja não habilita PIX (§5).
6. **Check "Código x banco" REAL verde** — **#717 MESCLADA em develop**
   (`26543922`; revisão independente + CI pós-merge verde, 9 jobs, inclusive
   o check; token existente + endpoint SQL read-only do projeto ativo;
   `DATABASE_URL` antigo INTACTO; sem deploy). **Pendência para ESTA
   release: incorporar/reconciliar o `ci.yml` do #717 na branch-base
   (`claude/app-major-upgrade-wmc8x2`) — o check verde em develop não
   esverdeia esta branch sozinho.**
7. **Destino do deploy corrigido na branch efetiva** — **#718 MÍNIMA
   MESCLADA na branch-base** (`claude/app-major-upgrade-wmc8x2`, merge
   `1057d376`; revisão independente; arquivo conferido na branch: `loja` →
   `dekxabvqdsuukijblazl`, sandbox intacto, `workflow_dispatch` +
   `--project-ref` preservados; **sem deploy/dispatch**). Pendências:
   **develop ainda requer o mesmo patch** para dispatch a partir de lá, e
   `DEPLOYMENT.md` (comandos manuais antigos) será corrigido antes da
   release. **O #671 NÃO será mesclado.** Esta release não toca o workflow
   — merge da #711 preserva o arquivo da #718.
8. Só então: `publicar-functions` com ESTA release (as 5 de cobrança) →
   checklist por loja (§4) → front → monitoração 24 h.

**Correção estreita examinada e REJEITADA como suficiente (historico)**: trocar
só o ref do workflow (`loja` → `dekxabvqdsuukijblazl`) falharia no 403 do
token (j) e mascararia as pendências f/i — publicação ilusória. Atualização da
coordenação (29/09): destino pela **#718 mínima** e check pelo **#717**;
#671 amplo fora. **Nenhum deploy ao projeto antigo pausado.**

## 6.2 ESTÁGIOS SEM PIX REAL PAGO (restrição explícita do dono, 29/09: zero custo)

O dono NÃO pagará compra PIX de teste. O gate "PIX real observado" foi
REESTRUTURADO em estágios — cada um declara o que PROVA e o que NÃO prova.

**Estágio A — publicar INERTE (zero custo, zero cliente impactado).**
Fundado nos travadores REAIS do código: (1) checkout online só aparece com
`pagamentoOnline === true` na configuração da loja (`configuracaoDaLoja.ts`,
falha fechada); (2) PIX é bloqueado NO SERVIDOR sem chave própria de
assinatura da loja (`criar-pagamento` → 409 `pixSemChaveDeAssinatura`,
frente 3 — flag por loja de fato); (3) cartão nasce DESLIGADO em
`config_pagamento_cartao` e só o dono liga após pedido de teste. Logo:
publicar as functions com a loja sem credencial válida/chave própria
mantém TODO meio online inerte — "na entrega" segue normal. PROVA:
código no ar sem regressão. NÃO PROVA: nada sobre dinheiro.

**Estágio B — validações GRATUITAS oficiais (test mode, sem custo).**
Com credenciais de TESTE do MP (APP_USR) + projeto sandbox, segundo a doc
oficial atual:
- **PIX**: doc "Realizar uma compra teste com Pix" (checkout-api-orders/
  integration-test/pix) — order com valores PREDEFINIDOS
  (`payer.first_name: "APRO"`) nasce `action_required`/`waiting_transfer`
  **com QR completo** e o status **muda sozinho para approved** — ciclo
  criação→QR→aprovação SEM pagar nada. PROVA: contrato da criação, forma do
  QR, transição de status, leitura da reconciliação/retomada contra dados
  com shape do MP. NÃO PROVA: trilha bancária real de PIX, credenciais de
  produção, prazo real de expiração.
- **Webhook + assinatura**: doc de notificações — URL de TESTE +
  **"Simular notificação"** (tipo de evento + Data ID, envio assinado com a
  chave secreta da aplicação) contra o webhook do sandbox. PROVA: validação
  HMAC (`x-signature`), reconsulta, `confirmar_pagamento` idempotente,
  handlers. NÃO PROVA: entrega assíncrona real em produção com credencial
  produtiva (atrasos/retries vivos).
- **Cartão**: matriz oficial de testes (APRO/OTHE/CONT/CALL… + cartões de
  teste) via Brick — valida 3DS/recusas/sentinela. Meio segue DESLIGADO em
  produção; NÃO PROVA: adquirente real.
- **Estorno**: doc oficial — refund de teste com token APP_USR. PROVA:
  interpretação de status/regras novas (terminal do refund da linha).
  NÃO PROVA: tempos/status reais do MP produtivo (ressalva T8 de sempre).

**Estágio C — primeiro PIX REAL sem custo do dono (decisão dele).**
Caminho sem adiantamento: a loja é real e vive — o primeiro PIX real pode
ser **compra voluntária de um cliente** após o dono liberar (credenciais
produtivas + chave própria + webhook produtivo com a MESMA chave +
`pagamentoOnline=true`). Condições: monitoração de logs no dia, reconciliador
como backstop (pg_cron provado ativo), rollback por function pronto, e
policies P1/P2 tratando pagamento tardio/divergente. RISCOS REAIS a
declarar: cliente paga e pedido não confirma (mitigado pelo reconciliador +
confirmação manual admin + estorno), cobrança duplicada (mitigada pelas
frentes 2/7 + idempotência por tentativa). **NÃO presumimos que acontecerá
nem quando**; se o dono preferir autoteste pagando e estornando a própria
loja, é custo dele — EXCLUÍDO por restrição explícita.

**Rótulo honesto permanente**: o sistema é "validado em test mode + suítes
locais + três revisões adversariais; produção com PIX real PENDENTE de
observação" — **nunca declarar 100% funcional** antes do Estágio C observado.

## 6.3 ESTRATÉGIA DE PUBLICAÇÃO PÚBLICA SEM CUSTO DO DONO (decisão 29/09)

O dono AUTORIZOU publicar as correções para todos e execução técnica
autônoma; a compra de teste paga por ele está FORA. Estratégia concreta:

**Fase 0 — sandbox gratuito: BLOQUEIO MATERIAL (29/09, 10:39Z).** O deploy
das 5 corrigidas foi disparado da branch da release (run
36556837516`, `projeto=sandbox`) e FALHOU no primeiro function:
unexpected list functions status 404: {"message":"Resource has been
removed"}` — o projeto sandbox `lofznuxcvezrhxsgjqyg` **não existe mais no
Supabase** (removido; os workflows ainda o referenciam). Gates gratuitos
(§6.2 Estágio B) ficam BLOQUEADOS até existir alvo. Desbloqueios mínimos,
ambos gratuitos e de painel (dono): (a) criar novo projeto Supabase free
como sandbox e apontar o workflow (PR mínimo de ref); ou (b) fornecer
credenciais de TESTE do MP para uso no ambiente que vier a existir. Sem
alvo, a Fase 1 (produção inerte) NÃO corre antes dos gates gratuitos
(ordem explícita do dono: "não altere produção antes de gates").

**Fase 1 — produção INERTE para todos.** Publicar functions (base já com
destino #718) + front. Meio online permanece travado pelas três portas
existentes: `store_config.pagamento_online=false` (ou cofre inválido
pós-migração), gate PIX 409 sem chave própria, cartão desligado de nascença.
Zero risco financeiro; correções de UX/estorno/webhook já no ar.

**Fase 2 — liberação por loja (checklist §4/§5)**: credenciais produtivas +
chave própria + webhook produtivo com a MESMA chave. Desde 30/09 o pagamento
liga SOZINHO quando a última chave é salva e o teste passa (e a loja não está
pausada): siga a ordem do §6.5 passo 5, que segura a cobrança deixando a Chave
de notificações por último (ou pausando por HTTP antes, se já houver as três).

**Fase 3 — primeiro pedido orgânico com PREVENÇÃO ATIVA (não passiva).**
- **Pausa imediata** (corta NOVAS cobranças da loja em segundos; pedidos
  pendentes continuam resolvendo, dinheiro não fica preso; rollback por
  function individual pelo workflow). **`desligar_pix` NÃO é RPC de banco**
  (não existe função SQL com esse nome nas migrations): é uma AÇÃO da edge
  function `credenciais-mercado-pago`, e "pausar" é o nome dela hoje. O
  caminho que funciona:
  1. **Pela tela (parada de emergência com a loja recebendo):** Ajustes →
     Pagamentos → Mercado Pago → bloco "Receber pelo app (Pix e cartão)" →
     botão **Pausar**. Ele só aparece com o pagamento pelo app já ligado (o
     texto da tela é "Para parar de receber Pix e cartão pelo app por um tempo,
     toque em Pausar."; com transportadora vendendo abre um aviso, confirme em
     "Pausar mesmo assim").
  2. **Pela chamada HTTP (se a tela não oferecer o botão ou não abrir) —
     QUEM EXECUTA É O PROGRAMADOR, não o dono:** este roteiro **não traz receita
     de leigo** para obter o token (não foi provado passo a passo na tela).
     `POST` em `<URL do Supabase da loja>/functions/v1/credenciais-mercado-pago`,
     com o cabeçalho `Authorization: Bearer <token da sessão de um admin logado>`
     e corpo JSON `{ "acao": "desligar_pix" }`. A function é só de admin (chave
     pública da loja ou `service_role` NÃO servem); o token vem da sessão do
     admin logado, sem colar em chat nem em arquivo. Se não houver sessão de
     admin à mão, pare e avise o dono em vez de improvisar.
  3. **Como confirmar que pausou:** a resposta traz `"pix_ligado": false` e
     `"pausado": true`, e a tela passa a dizer "Pausado por você". Se vier
     `pix_ligado: false` mas `pausado: false`, a loja não tem cadastro de
     credenciais (vende pelas chaves da plataforma) e não há pausa gravada. Erro
     409 = a loja ficaria sem forma de pagamento na entrega (ligue uma e repita);
     erro 500 "não consegui registrar a pausa" = o Pix JÁ foi desligado, mas
     pode religar sozinho no próximo teste: **repita a pausa**. Erro 500 "Não
     consegui desligar o PIX na ficha da loja" = **NÃO pausou** (a ficha
     recusou; nada foi gravado): repita até confirmar — **exceto** se a mensagem
     disser que a ficha da loja (`store_config id=1`) não existe: isso não se
     resolve tentando de novo, pare e chame o suporte. Erro 401 = o token não é
     de um admin atual (ou expirou): pegue um novo da sessão do admin.
- **Antídoto contra "cobrança confirmada sem pedido"**: reconciliador
  (pg_cron 10 min, provado ativo com 8 runs succeeded) + política P1
  (`pago_apos_expirar` honra pagamento tardio — nunca 2ª cobrança) +
  painel admin com alerta de DINHEIRO PRESO (`AlertasCancelados`,
  `temDinheiroPreso`) + confirmação manual admin como última instância.
- **Monitoramento do dia 1**: conferir `payment_status='aguardando'` com
  `gateway_payment_id` > 15 min (log da webhook + `cron.job_run_details`).
- **Fulfillment**: entrega é AÇÃO manual do lojista no painel; pedido nasce
  `pending/aguardando` e não avança sozinho — sem código de auto-entrega.

**Rótulo permanente** (§6.2): test mode + suítes + três revisões
adversariais; produção com PIX real PENDENTE de observação — nunca 100%.

## 6.4 GATE FINAL DE RELEASE PÚBLICO (proposta executável, 29/09)

Decisão do dono: publicar para todos com PIX **publicável-desligado**;
ativação é dele/lojista pela UI quando quiser; compra real é observação
POSTERIOR, não condição. Checklist do gate (ordem):

1. **[OK] Código**: 3 vereditos adversariais APROVADOS; suítes —
   criar-pagamento **189/0** (incl. `SANDBOX-OFICIAL`), estorno 56/0,
   estornar-pagamento 23/0, reconciliar 57/0, webhook 123/0, retomada
   12/12.
2. **Prova PIX sandbox oficial — duas camadas, rótulos distintos**:
   - **2a [FEITO, LOCAL]**: teste `SANDBOX-OFICIAL` usa **FIXTURE copiada
     byte a byte da doc oficial** (APRO → `action_required`/
     `waiting_transfer`, QR EMV, `qr_code_base64` vazio). **É fixture —
     NÃO é chamada à API do MP, não é E2E, não valida MP vivo/edge/
     webhook.** Prova: contrato de mapeamento local. Suíte 189/0.
   - **2b [PARCIAL — criação real sandbox MP comprovada, aprovação NÃO
     observada]** (evidência autorizada pelo dono, 29/09): UMA chamada real
     à API oficial `POST /v1/orders` PIX, com token de TESTE apenas em
     memória, dados fictícios `APRO`, valor simulado e idempotency key —
     resultado observado: **HTTP 201, order/payment `action_required`,
     QR presente**. Sem segredo exibido/salvo, sem PIX real, sem Supabase,
     sem deploy; **não repetir o POST** (ordem do dono). **O que prova**:
     o contrato de CRIAÇÃO contra a API viva do sandbox (201 +
     `action_required` + QR — o MESMO shape da fixture 2a e dos
     interpretadores). **NÃO prova/não observado**: transição automática
     para `approved` (GET posterior impossível — id da order não
     preservado), entrega de webhook/assinatura no sandbox, o NOSSO
     handler contra o MP vivo (a chamada foi direta, não pela edge). **Não
     é E2E.** Se um dia houver nova ordem (decisão do dono): preservar o
     id para o GET de aprovação. **Nunca** token produtivo com order de
     teste.
3. **[OK] Travas de publicação inerte**: `pagamento_online` DEFAULT false
   (migration 20261150000000); desde 30/09 nada liga até a loja ter as TRÊS
   chaves salvas + teste de conexão verde + não estar pausada (a function
   liga sozinha nesse ponto, sem editar banco e sem nós; `ligar_pix` virou
   Retomar e recusa 409 se faltar chave); PIX 409 sem chave própria de
   assinatura (frente 3); cartão nasce desligado; front falha fechada.
4. **[OK] Destino**: #718 na branch-base da release; #720 em develop;
   nenhum deploy executado.
5. **[PENDENTE] Port do `ci.yml` do #717 para a branch-base** (em
   andamento) — último bloco técnico de arquivo; depois disso o CI da
   #711 deve fechar verde (a falha "Código x banco" restante era a da
   base).
6. **[DECISÃO DO DONO] Merge da #711 + dispatch `publicar-functions`
   (`projeto=loja`, agora destino ATIVO) (histórico: hoje use `ikcous-publicada` ou `savy`) + front** — atos dele ou
   autorização expressa na hora.
7. **[PÓS] Primeira transação orgânica**: monitorar (logs webhook,
   `cron.job_run_details`, `aguardando`>15 min com cobrança), pausa pelo
   botão Pausar (segundos; §6.3 Fase 3), rollback por function; P1 honra pagamento
   tardio; entrega segue manual no painel.



## 6.5 PLANO EXATO DE DEPLOY/FRONT/ROLLBACK (29/09, base atualizada)

**⚠️ FATO CRÍTICO VERCEL (achado do dono/Codex + confirmação própria por
leitura HTTP, 29/09)**: os DOIS domínios públicos servem HOJE o MESMO
deployment — `ickous-marketplace.vercel.app` e `brandmeliz.vercel.app`
respondem `version.json` idêntico: `codeVersion 1.5.12`, `codeSha
95dbc8c561d4d17a48a2b701bc56a50ec274d689`, `source: database`,
`promotable: true` — um deployment PREVIEW da branch `production`
(`95dbc8c5`), não o target Production, apesar de
`productionBranch=main`. **Consequência**: mesclar a #711 na major OU
publicar Functions **sozinho NÃO coloca o checkout novo nos domínios** — o
release do front exige re-apontar AMBOS os aliases para o deployment da
linha de release, com SHA exato servido e rollback registrado. O check
Vercel da #711 está FAIL por **rate limit 24 h (externo)**; demais checks
re-conferidos no HEAD final.

**Pré (verificado)**: base com destino #718 + `ci.yml` #721 (merge
`ec930dd3`); PR #711 **0 conflitos** contra a base (merge-tree) e CI verde
exceto Vercel rate-limit externo. Três vereditos adversariais APROVADOS.
**Bloqueio restante declarado: COORDENAÇÃO do front (aliases Vercel) + o
rate-limit externo — não é mais bloqueio de arquivo/código.**

**Sequência exata**:
1. **Merge da #711 na base** (ato do dono). Anotar o SHA pré-merge da base
   para rollback: **`ec930dd3`** (= last-known-good pré-release).
2. **Deploy functions**: dispatch `publicar-functions.yml` DO BRANCH-BASE,
   `functions=cobranca`, `projeto=loja` (histórico: hoje use `ikcous-publicada` ou `savy`)
   (então = `dekxabvqdsuukijblazl` ATIVO). 5 functions, uma por vez; concurrency do workflow impede
   cancelamento no meio.
3. **Verificação pós-functions (read-only)**: `functions list` com
   `updated_at` novos; diagnóstico read-only mostrando os MARCADORES das
   frentes PRESENTES nos corpos; checkout "na entrega" normal; PIX segue
   INERTE (flag false + gate 409 + cartão off).
4. **Front — DUAS CLASSES de domínio, verificação por classe** (auditoria
   Vercel do dono/Codex + sondagem própria `version.json`, 29/09):
   - **Classe A (2 aliases ligados à branch `production`)**:
     `brandmeliz` e `ickous-marketplace` — hoje no PREVIEW `95dbc8c5`.
   - **Classe B (7 domínios clientes, `gitBranch=null`, target
     Production)** — ex. `spacelojadoskit`/`almeidastore` — hoje no
     Production `bc1cbc8` (sondagem própria confirmou ambos).
   Para servir a TODOS: (1) **promover o SHA da release a target
   Production** (atualiza a classe B) E (2) **atualizar a branch
   `production` OU reatribuir os 2 aliases** (atualiza a classe A) —
   nenhum dos dois sozinho basta. **Verificação mínima: um domínio de CADA
   classe** com `codeVersion`/`codeSha` novos no `version.json`.
   **Rollback por classe**: classe B = promover o deployment anterior
   (`bc1cbc8`); classe A = re-alias para `95dbc8c5` (registrado; NUNCA o
   `03a89fa2` pré-remoção PII).
5. **Ativação (quando o dono quiser)**. 🔴 **Não existe "só testar":** desde
   30/09 o pagamento pelo app (Pix e cartão) LIGA SOZINHO assim que as três
   chaves da loja (Public Key, Access Token, Chave de notificações) estão
   salvas, o último teste de conexão passou e a loja não está pausada.
   **Salvar credencial nova e Testar conexão rodam o teste e, com credenciais
   de PRODUÇÃO, já podem ligar cobrança real na hora.** (`testar` reconcilia a
   ficha: `credenciais-mercado-pago/index.ts`, `estadoDesejado` e
   `camposDaFicha`.) `ligar_pix` virou **Retomar**: só tira a pausa. **Na
   tela, o botão Pausar só aparece com o pagamento pelo app já ligado**
   (parada de emergência); antes disso a tela só mostra "Falta para receber
   pelo app" (ou "Pausado por você", com Retomar). Por isso o controle da
   PRIMEIRA ativação é a ordem das chaves: **a Chave de notificações é a
   última, e o Salvar dela é o que liga**. Em Ajustes → Pagamentos → Mercado
   Pago, abra o bloco **"Suas chaves"**:
   1. Preencha **Chave pública (Public Key)** e **Chave secreta (Access
      Token)** de produção, deixe vazio **Senha dos avisos (Chave de
      notificações)** e toque em **Salvar chaves**. Falta uma chave, então
      nada liga (a tela mostra "Falta para receber pelo app").
   2. Cadastre o webhook produtivo no Mercado Pago e deixe a Chave de
      notificações à mão — **NÃO cole no app ainda**.
   3. Quando o dono mandar: cole a MESMA Chave de notificações no campo
      **Senha dos avisos (Chave de notificações)** e toque em **Salvar
      chaves**. Esse Salvar roda o teste e, se der verde, **liga a cobrança na
      hora**; aparece o botão **Pausar** (parada de emergência, §6.3 Fase 3).

   **Ramo "a loja já tem as três chaves salvas" (ou já tinha a Chave de
   notificações):** nesse estado a tela diz "Tudo preenchido. Toque em Testar
   conexão (em Avançado) para liberar o pagamento pelo app" — esse toque **LIGA
   a cobrança**. Então: **NÃO toque em Testar conexão nem em Salvar chaves.**
   Para segurar o momento, **PAUSE PRIMEIRO, e só depois salve/teste**:
   - a. A tela não tem botão Pausar nesse estado: a pausa sai pela chamada HTTP
     `desligar_pix` (§6.3 Fase 3, item 2, **executada pelo programador**), que
     grava a pausa em qualquer estado desde que a loja já tenha cadastro de
     credenciais. A pausa vence Salvar e Testar. Confirme que a tela mostra
     "Pausado por você" + Retomar antes de seguir.
   - b. Salve/teste o que for preciso (nada liga com a pausa de pé).
   - c. Quando o dono mandar: **Retomar** (botão da tela; é a ação `ligar_pix`,
     que recusa com 409, sem gravar nada, se faltar chave ou o teste).
   Credenciais de TESTE não ligam cobrança real, mas não use isso como
   controle de produção.
6. **Rollback exato**:
   - Functions: reverta o código para o estado de **`ec930dd3`** e publique pelo
     `publicar-functions.yml`, com `functions=cobranca`, a loja correta e o SHA completo
     da execução em `expected_sha` — repõe o bundle anterior function por function.
   - Front: rollback/promote do deployment anterior na Vercel.
   - PIX OFF em segundos: **Pausar** (`desligar_pix` é ação da edge function,
     não RPC; depende da function no ar e de um admin logado — passo a passo
     e conferência no §6.3, Fase 3).
   - Dinheiro em voo: reconciliador (10 min) + P1 honram pagamento tardio;
     estorno manual pelo painel se necessário.
7. **Monitoramento do dia 1 (quando ativo)**: logs da webhook;
   `cron.job_run_details`; pedidos `aguardando` > 15 min com
   `gateway_payment_id` = alerta imediato + **Pausar** se necessário (§6.3,
   Fase 3).

## 7. Riscos residuais declarados

1. Busca da Orders API UNVERIFIED em produção (nome de campo/param já
   conferidos na doc; atraso de indexação pode atrasar a recuperação do 409 —
   fail-safe: 502 recuperável de sempre).
2. `cartaoEsteveEmCena` é por-mount (frente 4/10): POST de sessão anterior é
   invisível ao mount novo — mitigado no servidor (guarda P0001 + reconsulta).
3. Busca não paginada (>20 orders/janela — improvável na janela de 30 min).
4. Tópico irrelevante de loja sem chave também recebe 500 (ruído de fila do
   MP; mesmo padrão aceito do estado `indisponivel`).
5. Flash cosmético: forward-popstate num pedido já pago remonta a tela de
   pagamento por até 10 s até o polling virar "confirmado" (sem risco —
   servidor reconsulta).

## 8. Passo final (decisão do dono)

Merge do PR → `publicar-functions.yml` → deploy front → checklist §4 por loja
→ monitorar 24 h (logs webhook + execução do cron). **Ligar cartão em loja
nova continua sendo decisão separada do Gabriel** (runbook existente).
