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
7. **Destino do deploy corrigido na branch efetiva** — **PR #718 MÍNIMA**
   (apenas `publicar-functions.yml`: ref `loja` → `dekxabvqdsuukijblazl` +
   teste) **aprovada independentemente, checks de código verdes**;
   integração na branch-base EM ANDAMENTO; sem dispatch (e precisa alcançar
   develop para `workflow_dispatch`). **O #671 NÃO será mesclado inteiro.**
8. Só então: `publicar-functions` com ESTA release (as 5 de cobrança) →
   checklist por loja (§4) → front → monitoração 24 h.

**Correção estreita examinada e REJEITADA como suficiente (historico)**: trocar
só o ref do workflow (`loja` → `dekxabvqdsuukijblazl`) falharia no 403 do
token (j) e mascararia as pendências f/i — publicação ilusória. Atualização da
coordenação (29/09): destino pela **#718 mínima** e check pelo **#717**;
#671 amplo fora. **Nenhum deploy ao projeto antigo pausado.**

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
