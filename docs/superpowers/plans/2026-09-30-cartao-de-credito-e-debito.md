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

## Revisão de contexto limpo (30/09/2026) — o que mudou por causa dela

- **BLOQUEIO 1 (cobrança dupla PIX + cartão):** a chave de idempotência passou a ser UMA
  por tentativa para os dois meios; resposta ambígua do cartão (timeout, 5xx, 2xx
  ilegível) é repetida com a mesma chave e o mesmo corpo; 409/423 não sugerem mais PIX; o
  webhook ADOTA uma cobrança paga quando o pedido ainda não tem cobrança gravada.
- **IMPORTANTE 2:** cobrança morta decidida pelo `status` da raiz (`failed`/`canceled`/
  `expired`), qualquer que seja o `status_detail`.
- **Menores:** cartão recusado em pedido cancelado pelo cliente; "pago" sem QR vai para a
  tela de aprovado; texto da análise; log do 402 sem dados do pagador; comentários sobre
  negação por RLS.

- **2ª rodada:** a adoção do webhook cobre também a nova tentativa depois de uma recusa
  (cobrança gravada MORTA no MP é substituída); só `status = 'cancelled'` recusa cartão
  (pedido adiantado pelo lojista continua pagável); recusa não gravada vira `console.error`;
  a mesma cobrança já gravada por outro caminho responde 200. **Limite conhecido:** a rota
  clássica `payment` do webhook não adota — o painel do MP precisa estar inscrito no tópico
  `order`.

## Publicação (sessão local) — a ORDEM importa

1. Aplicar `20261160000000` e `20261160000100` (db-apply, com a verificação do mapa).
2. Publicar `webhook-mercadopago` (adoção da cobrança sem registro).
3. Publicar `criar-pagamento`.
4. Publicar o front.

Com a function nova e a RPC velha, a primeira recusa de cartão ainda cancelaria o pedido.

## Medir no sandbox do Mercado Pago antes do merge

Esta sessão não alcança a API do MP; os testes usam respostas escritas a partir da doc.

- **CONDIÇÃO DE MERGE** — corpo do **402** de cartão recusado: a order vem em `data` ou na
  raiz, com `id` `ORD…`? Sem id, a próxima tentativa do mesmo pedido — de cartão **e** de PIX —
  colide na mesma chave até o prazo acabar. Se o id não vier, é preciso outro jeito de marcar
  a recusa no pedido antes de juntar.
- **GET** de uma order recusada: `status` da raiz é `failed`?
- Chave de idempotência **igual com corpo diferente** devolve 409?
- Payment Brick: `selectedPaymentMethod` (`credit_card`/`debit_card`/`bank_transfer`),
  `formData.installments` numérico, `maxInstallments` respeitado.
- Parcelado com juros: `total_amount` da order continua o valor base (a conferência de
  valor do webhook depende disso).
- Débito: aparece `pending_challenge` (3DS) mesmo com `validation` padrão?

## Fora do escopo (anotado)

- Cancelar automaticamente um PIX aberto quando o cliente troca para cartão (hoje: 409 com
  instrução). Pede `POST /v1/orders/{id}/cancel` e revisão própria.
- 3DS (desafio do banco). Padrão do MP é `never`; religar exige iframe do desafio.
- Ligar as chaves salvas no painel às functions (hoje as functions leem
  `MP_ACCESS_TOKEN` do ambiente) — frente própria, vale para PIX e cartão.
