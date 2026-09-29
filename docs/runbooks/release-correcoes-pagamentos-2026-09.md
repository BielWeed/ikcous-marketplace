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
pedido **não se perde**: o reconciliador confirma em ≤10 min
(`pago_apos_expirar` honrado pela mesma RPC) e o MP reenvia a notificação;
assim que a loja cadastrar a chave PRÓPRIA em Ajustes, a confirmação volta a
ser imediata (o reenvio processa sozinho).

**Ordem de mitigação recomendada (antes do deploy):**
1. Listar lojas ativas com pagamento online (app_settings/registro do lojista).
2. Para cada uma: orientar o cadastro da chave própria (texto pronto no §4.1)
   e a conferência do painel MP.
3. Só considerar a loja "pronta" com o pedido de teste do passo 3 aprovado.
4. Comunicar à loja o sintoma pós-deploy (pagamento confirma em até 10 min em
   vez de imediato) para evitar pânico durante a janela de transição.

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
