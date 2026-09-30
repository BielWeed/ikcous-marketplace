# Cartão de crédito e débito pelo app — Implementation Plan

**Goal:** o cliente paga com cartão de crédito ou débito no checkout do app, pelo mesmo
Payment Brick e pelas mesmas 3 chaves do Mercado Pago que o PIX já usa. Uma recusa do
cartão deixa o cliente tentar outro cartão (ou o PIX) até o prazo de 30 minutos da
reserva; só o prazo cancela o pedido. O lojista configura no painel quais cartões aceita e
o máximo de parcelas.

**Decisões do dono (30/09/2026):**

1. Cartão recusado → o cliente pode tentar de novo até o prazo; só o prazo cancela o pedido
   e devolve o estoque.
2. Parcelas → o máximo que o Mercado Pago oferecer, configurável pelo lojista no painel.
3. Crédito **e** débito.

**Fatos medidos na documentação oficial (30/09/2026):**

- Cartão na Orders API: `POST /v1/orders` com `transactions.payments[0].payment_method =
  { id: <bandeira>, type: "credit_card" | "debit_card", token, installments }`,
  `processing_mode: "automatic"` (checkout-api-orders/payment-integration/cards).
- Recusa: **HTTP 402** — "Order was created but some transaction failed" (API reference,
  create-order). O detalhe fica em `transactions.payments[].status_detail`
  (`rejected_by_issuer`, `insufficient_amount`, `bad_filled_card_data`…).
- `capture_mode` padrão do cartão é `automatic_async`: a resposta pode vir `processing` e o
  desfecho chega depois pelo webhook — a tela não pode depender só da resposta.
- 3DS: `config.online.transaction_security.validation` tem padrão `never` — não pedimos.
- `X-Idempotency-Key`: 1 a 128 caracteres; chave reusada com corpo diferente → 409
  `idempotency_key_already_used`; em uso → 423 `resource_locked`.
- Parcelamento **sem juros** ("Parcelado vendedor") é configurado na conta do Mercado Pago
  e vale sozinho para o Checkout Transparente — o app não tem campo de API para isso. O
  painel do app mostra o caminho.

## Arquitetura

**Servidor (`criar-pagamento`)** passa a aceitar `metodo: "cartao"` com `tipoCartao`
(`credit_card`/`debit_card`), `token`, `paymentMethodId`, `parcelas`. O caminho clássico
(`/v1/payments`, `montarCorpoCartao`/`criarPagamento`) sai — era código morto.

A raiz do defeito "impagável depois da primeira recusa" tinha três partes, e as três fecham:

| Parte | Hoje | Depois |
|---|---|---|
| Cobrança recusada fica gravada | a próxima tentativa só reconsulta a recusada | cobrança **morta** (recusada/cancelada/vencida no MP) é **substituída** por uma nova, com `UPDATE … WHERE gateway_payment_id = <anterior>` |
| Chave de idempotência = id do pedido | o MP devolveria a mesma recusa | chave por **(pedido, cobrança anterior)** — muda a cada tentativa, mas duas abas na MESMA tentativa colidem (o MP barra a segunda) |
| RPC `confirmar_pagamento` com 'recusado' | cancela o pedido e devolve o estoque em ~6 s | pedido vivo (`pending`, 'aguardando') **não muda**: só o prazo cancela |

Cobrança **viva** de outro método (PIX aberto e cliente escolhe cartão, ou cartão em
análise e cliente escolhe PIX) → 409 sem `terminal`, com mensagem que diz o que fazer —
nunca duas cobranças vivas no mesmo pedido.

Cartão aprovado cujo `UPDATE` perde a corrida para a expiração → segunda gravação no pedido
`expirado`, para o webhook achar a cobrança e aplicar a P1 (pago após expirar). Cartão só é
cobrado com pelo menos 60 s de prazo sobrando.

**Configuração do cartão** mora em `app_settings` (`key = 'pagamentos_cartao'`, JSON
`{credito, debito, parcelas_max}`). Ausente = tudo ligado, parcelas sem limite do app. O
parser é UM só (`supabase/functions/_shared/configuracao-cartao.ts`), importado pelo
servidor e pela tela. Policy nova: `authenticated` lê só essa chave (checkout online exige
conta — P6). Escrita: a policy de admin que já existe.

**Tela:** o Brick oferece crédito/débito conforme a configuração e limita as parcelas.
Cartão recusado → mensagem do motivo + "Tentar de novo" (não é mais terminal). Cartão
aprovado ou em análise → tela "confirmando com o banco"; o `CheckoutView` já troca para a
confirmação quando o webhook grava 'pago'.

## Tarefas

- [ ] T1 `_shared/configuracao-cartao.ts` + testes (parser e regras de parcelas).
- [ ] T2 `_shared/mercadopago.ts`: `montarCorpoCartaoOrders`, `criarOrder` expõe o corpo
      do 402, status de cartão no mapa, motivo de recusa em português; remove o clássico
      de cartão. Testes.
- [ ] T3 `criar-pagamento/index.ts`: cartão, substituição de cobrança morta, chave por
      tentativa, configuração do lojista, margem de prazo, gravação pós-expiração. Testes.
- [ ] T4 Migrations: `confirmar_pagamento` não derruba pedido vivo; policy de leitura da
      configuração. Entrada no `VERIFICACOES` do `db-apply.cjs`. **Não aplicar** — quem
      aplica é a sessão local.
- [ ] T5 Front: `PagamentoOnline` (Brick com cartão, estados de cartão), `useOrders`
      (contrato), `CheckoutView` (rótulo e retomada). Testes.
- [ ] T6 Painel: seção "Cartão de crédito e débito" nos Ajustes. Testes.
- [ ] T7 Verificação completa + revisão por contexto limpo.

## Fora do escopo (anotado)

- Cancelar automaticamente um PIX aberto quando o cliente troca para cartão (hoje: 409 com
  instrução). Pede `POST /v1/orders/{id}/cancel` e revisão própria.
- 3DS (desafio do banco). Padrão do MP é `never`; religar exige iframe do desafio.
- Ligar as chaves salvas no painel às functions (hoje as functions leem
  `MP_ACCESS_TOKEN` do ambiente) — frente própria, vale para PIX e cartão.
