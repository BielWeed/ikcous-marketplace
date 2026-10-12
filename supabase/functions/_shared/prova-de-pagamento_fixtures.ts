// @ts-nocheck
/**
 * Fixtures da PROVA DE PAGAMENTO (`prova-de-pagamento.ts`) — compartilhadas
 * entre `_shared/prova-de-pagamento_test.ts` e `criar-pagamento/index_test.ts`
 * (mesmo motivo de `credenciais-mp_fixtures.ts`: fixture copiado em duas
 * suítes envelhece calado quando a forma muda).
 *
 * POR QUE NÃO `orderAvulsa` (criar-pagamento/index_test.ts): aquele dublê não
 * traz `amount`/`status` no pagamento, nem `type`/`country_code` na raiz — as
 * contradições que a prova recusa (pagamento estornado, moeda/país/tipo
 * trocados, `amount` ≠ `total_amount`) não têm onde aparecer nele.
 *
 * FONTE (consultada em 04/10/2026 pelo context7, doc oficial do Mercado Pago
 * em português):
 *
 * - CARTÃO APROVADO: "Response Example" de
 *   https://www.mercadopago.com.br/developers/pt/docs/checkout-api-orders/payment-integration/cards
 *   — copiado campo a campo, inclusive o que parece estranho e é a razão de
 *   estar aqui: `total_paid_amount: "200.00"` com `total_amount: "50.00"`, e
 *   `paid_amount: "47.28"` no pagamento. A doc publica esses números assim;
 *   comparar `paid_amount`/`total_paid_amount` por IGUALDADE recusaria o
 *   exemplo oficial de um cartão aprovado (regra (g) da prova).
 * - PIX: "Pix Payment Response Structure" de
 *   https://www.mercadopago.com.br/developers/pt/docs/checkout-api-orders/payment-integration/pix
 *   — a doc só publica o PIX recém-criado (`action_required:waiting_transfer`);
 *   o PAGO é o mesmo objeto com o par trocado para `processed:accredited`,
 *   que é o par de pagamento aprovado da página
 *   https://www.mercadopago.com.br/developers/pt/docs/checkout-api-orders/payment-management/status/order-status
 *   ("Successful payments are marked as 'processed' with an 'accredited'
 *   detail"). DERIVADO, não copiado — dito aqui para ninguém citar como
 *   medição. `total_paid_amount` e `paid_amount` (= o valor) também são
 *   derivados: a forma vem da referência do GET (abaixo), que publica os dois
 *   numa order `processed:accredited`.
 * - GET /v1/orders/{id} (a fonte PRIMÁRIA do objeto que a prova lê):
 *   https://www.mercadopago.com.br/developers/en/reference/online-payments/checkout-api/get-order/get
 *   (lida em 04/10/2026) — copiado campo a campo em
 *   `orderDoGetDaReferenciaDaDoc`. Traz `country_code: "BR"` (as duas
 *   páginas acima trazem "BRA"), `amount "24.50"` no pagamento contra
 *   `total_amount "50.00"` e um chargeback `in_process` — a prova RECUSA o
 *   exemplo como publicado (contestação aberta), e o teste diz isso.
 *
 * O `id`, o `external_reference` e os valores são parâmetros: cada teste os
 * casa com o pedido do seu banco falso. O token do cartão da doc fica como
 * está (é o exemplo público, não um token de verdade).
 */

/** Cartão aprovado, Orders API — o exemplo oficial da doc (ver o topo). */
export function orderCartaoAprovadaDaDoc(over: {
  id: string;
  externalReference: string;
  valor?: string;
}): Record<string, unknown> {
  const valor = over.valor ?? "50.00";
  return {
    id: over.id,
    type: "online",
    processing_mode: "automatic",
    external_reference: over.externalReference,
    total_amount: valor,
    total_paid_amount: "200.00",
    country_code: "BRA",
    user_id: "2021490138",
    status: "processed",
    status_detail: "accredited",
    capture_mode: "automatic",
    created_date: "2025-04-17T21:41:33.96Z",
    last_updated_date: "2025-04-17T21:41:35.144Z",
    integration_data: {
      application_id: "874202490252970",
    },
    transactions: {
      payments: [
        {
          id: "PAY01JS2V6CM8KJ0EC4H504R7YE34",
          amount: valor,
          paid_amount: "47.28",
          reference_id: "0002yjis6j",
          status: "processed",
          status_detail: "accredited",
          payment_method: {
            id: "elo",
            type: "credit_card",
            token: "519ada5ac7431ef6ce24ac19c38f6768",
            installments: 1,
          },
        },
      ],
    },
  };
}

/** PIX pago, Orders API — o exemplo oficial do PIX com o par de pago (ver o topo). */
export function orderPixPagaDaDoc(over: {
  id: string;
  externalReference: string;
  valor?: string;
}): Record<string, unknown> {
  const valor = over.valor ?? "50.00";
  return {
    id: over.id,
    type: "online",
    total_amount: valor,
    total_paid_amount: valor,
    external_reference: over.externalReference,
    country_code: "BRA",
    status: "processed",
    status_detail: "accredited",
    capture_mode: "automatic",
    transactions: {
      payments: [
        {
          id: "PAY01HRYFXQ53Q3JPEC48MYWMR0TE",
          reference_id: "123456789",
          status: "processed",
          status_detail: "accredited",
          amount: valor,
          paid_amount: valor,
          payment_method: {
            id: "pix",
            type: "bank_transfer",
            ticket_url: "https://www.mercadopago.com.br/sandbox/payments/00000000000/ticket",
            qr_code: "00020126580014br.gov.bcb.pix-exemplo-da-doc",
            qr_code_base64: "iVBORw0KGgoAAAANSUhEUgAABWQAAAVkAQAAAAB79i",
          },
        },
      ],
    },
    processing_mode: "automatic",
    marketplace: "NONE",
  };
}

/** GET /v1/orders/{id} — o exemplo da REFERÊNCIA, como publicado (ver o topo). */
export function orderDoGetDaReferenciaDaDoc(over: {
  id: string;
  externalReference: string;
}): Record<string, unknown> {
  return {
    id: over.id,
    processing_mode: "automatic",
    external_reference: over.externalReference,
    total_amount: "50.00",
    country_code: "BR",
    type: "online",
    status: "processed",
    status_detail: "accredited",
    capture_mode: "automatic",
    total_paid_amount: "50.00",
    transactions: {
      payments: [
        {
          id: "PAY01J67CQQH5904WDBVZEM4JMEP3",
          amount: "24.50",
          paid_amount: "47.28",
          taxes_amount: "0.50",
          status: "processed",
          status_detail: "accredited",
          payment_method: {
            id: "visa",
            type: "credit_card",
            installments: 1,
          },
        },
      ],
      chargebacks: [
        {
          id: "CBK01J67CQQH5904WDBVZEM4JMEP3",
          transaction_id: "PAY01J67CQQH5904WDBVZEM4JMEP3",
          status: "in_process",
        },
      ],
    },
    created_date: "2024-08-26T13:06:51.045317772Z",
    last_updated_date: "2024-08-26T13:06:51.045317772Z",
  };
}
