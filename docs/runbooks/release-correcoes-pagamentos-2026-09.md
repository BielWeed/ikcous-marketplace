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
- Functions: `vercel rm`/redeploy da versão anterior por função (as mudanças
  são independentes por arquivo — reverter UMA function não desarma as outras;
  a frente 3 e a 8 são do MESMO arquivo `criar-pagamento`/`webhook` — reverter
  o webhook reverte W9+8+9 juntas: aceitável, todas aprovadas).
- Front: redeploy do commit anterior (retomada do botão é aditiva; sem porta,
  o cliente volta ao estado de antes — sem quebra).
- Nenhum dado é migrado; nada a reverter no banco.
- **Gatilho de reversão**: qualquer confirmação de pagamento real falhando em
  loja com checklist aprovado (§4) → reverter a function correspondente e
  investigar com o log em mãos.

## 6.1 GATE MATERIAL: conclusão da migração do banco (partes f/h/i/j) — PRÉ-REQUISITO de qualquer publicação financeira na loja viva

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
   (projeto=loja) executa `supabase functions list` sem 403.
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
chave própria + webhook produtivo com a MESMA chave + `ligar_pix`.

**Fase 3 — primeiro pedido orgânico com PREVENÇÃO ATIVA (não passiva).**
- **Pausa imediata**: RPC `desligar_pix` (existente) corta NOVAS cobranças
  por loja em segundos; pedidos pendentes continuam resolvendo (dinheiro
  não fica preso); rollback por function individual pelo workflow.
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
   - **2b [NÃO EXECUTADO — falta exata]**: chamada REAL à API sandbox do
     MP com credencial de TESTE, sem charge, resposta não exposta em log.
     **Falta**: token de teste `APP_USR` (painel do MP do dono — grátis;
     eu não tenho nenhum e nunca peço valor em chat; entrega seria por
     secret isolado). **Como rodaria sem novo ambiente**: o harness já
     aceita `fetchImpl` REAL — chamada oficial atravessaria o handler com
     banco FALSO (isolamento total, zero charge, sem deploy; sandbox
     Supabase removido NÃO é necessário). **Nunca** token produtivo com
     order de teste.
3. **[OK] Travas de publicação inerte**: `pagamento_online` DEFAULT false
   (migration 20261150000000); `ligar_pix` RECUSA sem teste de conexão
   bem-sucedido + Public Key válida (UI Ajustes — ativação autônoma do
   lojista, sem editar banco e sem nós); PIX 409 sem chave própria de
   assinatura (frente 3); cartão nasce desligado; front falha fechada.
4. **[OK] Destino**: #718 na branch-base da release; #720 em develop;
   nenhum deploy executado.
5. **[PENDENTE] Port do `ci.yml` do #717 para a branch-base** (em
   andamento) — último bloco técnico de arquivo; depois disso o CI da
   #711 deve fechar verde (a falha "Código x banco" restante era a da
   base).
6. **[DECISÃO DO DONO] Merge da #711 + dispatch `publicar-functions`
   (`projeto=loja`, agora destino ATIVO) + front** — atos dele ou
   autorização expressa na hora.
7. **[PÓS] Primeira transação orgânica**: monitorar (logs webhook,
   `cron.job_run_details`, `aguardando`>15 min com cobrança), pausa por
   `desligar_pix` (segundos), rollback por function; P1 honra pagamento
   tardio; entrega segue manual no painel.



## 6.5 PLANO EXATO DE DEPLOY/FRONT/ROLLBACK (29/09, base atualizada)

**Pré (verificado)**: base com destino #718 + `ci.yml` #721 (merge
`ec930dd3`); PR #711 **0 conflitos** contra a base (merge-tree) e CI verde
após incorporação — única falha restante é **Vercel rate-limit externo**
(retry 24 h, não é código). Três vereditos adversariais APROVADOS.

**Sequência exata**:
1. **Merge da #711 na base** (ato do dono). Anotar o SHA pré-merge da base
   para rollback: **`ec930dd3`** (= last-known-good pré-release).
2. **Deploy functions**: dispatch `publicar-functions.yml` DO BRANCH-BASE,
   `functions=cobranca`, `projeto=loja` (agora = `dekxabvqdsuukijblazl`
   ATIVO). 5 functions, uma por vez; concurrency do workflow impede
   cancelamento no meio.
3. **Verificação pós-functions (read-only)**: `functions list` com
   `updated_at` novos; diagnóstico read-only mostrando os MARCADORES das
   frentes PRESENTES nos corpos; checkout "na entrega" normal; PIX segue
   INERTE (flag false + gate 409 + cartão off).
4. **Front**: build/deploy Vercel da linha de release — promoção a
   produção **alinhada com a sessão de produto** (linha do incidente
   1.35.0/1.5.12 em recuperação); conferir `version.json`.
5. **Ativação (quando o dono quiser)**: Ajustes → credenciais MP produtivas
   → **Testar conexão** (precisa dar verde) → chave de assinatura própria →
   webhook produtivo com a MESMA chave → `ligar_pix` (recusa 409 sem
   teste verde + Public Key).
6. **Rollback exato**:
   - Functions: dispatch `publicar-functions` do ref **`ec930dd3`** com
     `functions=cobranca` — repõe o bundle anterior function por function.
   - Front: rollback/promote do deployment anterior na Vercel.
   - PIX OFF instantâneo (independe de rede/CDN): `desligar_pix`.
   - Dinheiro em voo: reconciliador (10 min) + P1 honram pagamento tardio;
     estorno manual pelo painel se necessário.
7. **Monitoramento do dia 1 (quando ativo)**: logs da webhook;
   `cron.job_run_details`; pedidos `aguardando` > 15 min com
   `gateway_payment_id` = alerta imediato + `desligar_pix` se necessário.

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
