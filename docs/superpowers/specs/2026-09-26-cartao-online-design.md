# Cartão de crédito e débito pelo app — design ("Fase 3.5")

> 26/09/2026. Pedido do dono: pagamento com cartão de crédito e débito. Religa a Fase 3.5
> prevista em [`2026-08-07-fase-3-webhook-design.md`](2026-08-07-fase-3-webhook-design.md),
> resolvendo as três heranças que ela deixou.

## Decisões

1. **Orders API**, como o PIX — mesma `external_reference`, mesmo webhook, mesma
   reconciliação, mesma `confirmar_pagamento` (intocada). Nada da Payments API clássica volta.
2. **Card Payment Brick** (`bricks().create("cardPayment", …)`) com o SDK oficial
   `https://sdk.mercadopago.com/js/v2` — o dado do cartão nunca passa pelo nosso código
   (PCI SAQ-A). O servidor recebe só o token de uso único.
3. **Recusa não mata o pedido** (herança #2): cartão recusado libera a vaga da cobrança
   (`liberar_cobranca_do_pedido`) e o cliente tenta outro cartão ou PIX na mesma reserva de
   30 min. A chave de idempotência passa a ser por tentativa
   (`<pedido>` na 1ª cobrança PIX, `<pedido>:<n>` depois; cartão `<pedido>:c<n>:<hash do token>`).
4. **3-D Secure** pela Orders API (`config.online.transaction_security`,
   `validation: on_fraud_risk`, `liability_shift: required`): quando o banco pede desafio, a
   resposta traz a URL; o app abre num iframe e espera a confirmação pelo webhook.
5. **Débito**: no Brasil a Orders API só lista débito Elo (`debelo`) — o Brick mostra o que o
   Mercado Pago aceitar para a conta do lojista; o app não inventa bandeira.
6. **Parcelas**: o Brick calcula; o lojista escolhe o teto (1–12). Juros de parcelamento são
   do comprador (padrão do Mercado Pago); a conferência de valor (±R$ 0,05) compara o
   `total_amount` pedido — o que o MP recebeu com juros não entra nela.
7. **Nasce desligado** (crédito e débito `false`): o app envia `COEP: credentialless` e o
   Brick monta iframes seguros de domínio do Mercado Pago que não pudemos provar sob esse
   cabeçalho neste ambiente. O lojista liga depois de pagar um pedido de teste no preview.
   Se o iframe for barrado, a decisão sobre o COEP sobe ao dono.
8. **Tela de sucesso do cartão** (herança #3): aprovado mostra "Pagamento aprovado —
   confirmando o pedido" e segue o mesmo caminho do PIX (tempo real + consulta).

## Estados na tela

`escolher cartão` → `enviando` → (`aprovado, confirmando` | `desafio 3DS` | `recusado: motivo
+ tentar outro cartão / pagar com PIX` | `em análise: aguardando o banco`).

## Fontes

- Orders API — cartões: <https://www.mercadopago.com.br/developers/pt/docs/checkout-api-orders/payment-integration/cards>
- Orders API — 3DS: <https://www.mercadopago.com.br/developers/pt/docs/checkout-api-orders/payment-management/integrate-3ds>
- Status das transações: <https://www.mercadopago.com.br/developers/pt/docs/checkout-api-orders/payment-management/status/transaction-status>
- Card Payment Brick: <https://github.com/mercadopago/sdk-js/blob/main/docs/bricks/card-payment.md>
- PCI: <https://www.mercadopago.com.br/developers/pt/docs/security/pci>
