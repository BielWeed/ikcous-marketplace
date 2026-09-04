// PEDIDO-04 (auditoria de 26/08/2026) — o PIX confirma no banco e o selo da
// tela aberta continua "Aguardando pagamento" até a pessoa sair e voltar.
//
// O DEFEITO: `handleRealtimeUpdate` (useOrders.ts) remontava o pedido com uma
// lista fechada de campos — `status`, `trackingCode` — escrita à mão
// (confirmado em `git show HEAD:src/hooks/useOrders.ts` antes desta
// correção). O realtime do Supabase entrega a LINHA INTEIRA de `marketplace_orders` em
// `payload.new`, não um diff, e `payment_status` (o campo que o webhook do
// Mercado Pago grava) nunca esteve nessa lista. `total` também ficava de
// fora.
//
// `mesclarAtualizacaoRealtime` é a correção isolada do resto do hook para
// poder ser testada sem montar WebSocket nenhum — mesma ideia de
// `escolherRecargaDeReconexao` em use-orders-reconexao-nao-zera-lista-do-
// admin.test.ts.
import { describe, expect, it, vi } from "vitest";

// Importar o módulo do hook instancia o cliente real do Supabase. O dublê
// corta isso: `mesclarAtualizacaoRealtime` não toca em rede nem em sessão.
vi.mock("@/lib/supabase", () => ({ supabase: {} }));

import { mesclarAtualizacaoRealtime } from "@/hooks/useOrders";
import type { Order } from "@/types";

const pedidoEmMemoria: Order = {
  id: "pedido-1",
  userId: "user-1",
  customer: {
    name: "Cliente Teste",
    whatsapp: "34999999999",
    address: "Rua A",
    number: "10",
    complement: "",
    neighborhood: "Centro",
    city: "Uberlândia",
    state: "MG",
    cep: "38400-000",
  },
  items: [
    {
      productId: "prod-1",
      name: "Blusa Teste",
      price: 100,
      quantity: 1,
      image: "https://exemplo.com/blusa.jpg",
    },
  ],
  subtotal: 100,
  shipping: 20,
  discount: 0,
  total: 120,
  paymentMethod: "pix",
  paymentStatus: "aguardando",
  status: "pending",
  createdAt: "2026-08-26T10:00:00.000Z",
  updatedAt: "2026-08-26T10:00:00.000Z",
  cancelledAfterShipping: false,
  returnedToSellerAt: null,
};

/**
 * A linha CRUA que o realtime do Postgres entrega em `payload.new` — a
 * própria linha de `marketplace_orders`, SEM as junções `items`/`address`
 * que `fetchUserOrders` pede. É o que o webhook `confirmar_pagamento` grava
 * depois que o PIX confirma.
 *
 * A FORMA DO `customer_data` ABAIXO É A REAL, não inventada: é o que
 * `create_marketplace_order_v23`/`v24` gravam (`supabase/migrations/
 * 20260960000000_variacao_obrigatoria_no_servidor.sql:344-350`,
 * `jsonb_build_object('whatsapp', ..., 'address_id', p_address_id, 'address',
 * p_address_data, ...)`). `addressData` — usada numa versão anterior deste
 * teste — NÃO existe em nenhuma coluna do banco: `grep -rn "addressData"
 * supabase/` devolve vazio; é só o nome de um argumento no cliente
 * (CheckoutView). E para CLIENTE LOGADO com endereço salvo (`address_id`
 * preenchido, o caso de `pedidoEmMemoria` abaixo, que tem `userId`), o
 * checkout manda `addressData: null` — então `customer_data.address` é
 * `null` na linha real, não um objeto com `street`/`number`/etc.
 */
function linhaRealtimeDePagamentoConfirmado(
  overrides: Record<string, any> = {},
) {
  return {
    id: "pedido-1",
    // Colunas de marketplace_orders (database.types.ts) que este teste não
    // usa em nenhuma asserção, mas que `mapOrderFromDB` — e, desde a
    // correção do achado de lint da revisão, o próprio parâmetro tipado de
    // `mesclarAtualizacaoRealtime` — exigem presentes na linha real.
    address_id: null,
    confirmation_email_sent_at: null,
    coupon_id: null,
    coupon_usage_returned: false,
    customer_phone: null,
    expires_at: null,
    gateway_payment_id: null,
    idempotency_key: null,
    observation: null,
    paid_at: null,
    pagamento_recebido_em: null,
    pagamento_recebido_por: null,
    shipping_cost: null,
    shipping_label_id: null,
    shipping_label_url: null,
    stock_returned_at: null,
    total_amount: null,
    user_id: "user-1",
    customer_name: "Cliente Teste",
    customer_data: {
      whatsapp: "34999999999",
      address_id: "endereco-1",
      address: null,
      shipping_option_id: "padrão",
      destination_cep: "38400-000",
    },
    total: 120,
    subtotal: 100,
    shipping: 20,
    discount: 0,
    payment_method: "pix",
    payment_status: "pago",
    status: "pending",
    notes: null,
    coupon_code: null,
    tracking_code: null,
    cancelled_after_shipping: false,
    returned_to_seller_at: null,
    created_at: "2026-08-26T10:00:00.000Z",
    updated_at: "2026-08-26T10:05:00.000Z",
    ...overrides,
  };
}

describe("mesclarAtualizacaoRealtime (PEDIDO-04) — o realtime carrega a linha inteira, não só status/trackingCode", () => {
  it("payment_status confirmado pelo webhook aparece no pedido mesclado, sem sair da tela", () => {
    const linhaNova = linhaRealtimeDePagamentoConfirmado();

    const mesclado = mesclarAtualizacaoRealtime(pedidoEmMemoria, linhaNova);

    expect(mesclado.paymentStatus).toBe("pago");
  });

  it("O TESTE DO LIMITE — a lista manual antiga também esquecia `total`: o valor gravado no banco chega no pedido mesclado", () => {
    // A lista antiga só copiava status/trackingCode. Um mutante que
    // reintroduzisse essa lista (com payment_status ACRESCENTADO à mão, sem
    // eliminar a lista) passaria no teste acima mas continuaria cego para
    // total. Este teste mata exatamente esse mutante.
    const linhaNova = linhaRealtimeDePagamentoConfirmado({ total: 999.5 });

    const mesclado = mesclarAtualizacaoRealtime(pedidoEmMemoria, linhaNova);

    expect(mesclado.total).toBe(999.5);
  });

  it("O TESTE DO LIMITE — a linha do realtime NÃO traz `items` (sem join): os itens do pedido em memória são preservados, não apagados", () => {
    // mapOrderFromDB, sozinho, devolveria items: [] para uma linha sem
    // `items` — o que apagaria o carrinho da tela aberta. Este é o caso que
    // a auditoria pediu para verificar ANTES de trocar a lista manual pelo
    // mapeador puro.
    const linhaNova = linhaRealtimeDePagamentoConfirmado();
    expect((linhaNova as any).items).toBeUndefined();

    const mesclado = mesclarAtualizacaoRealtime(pedidoEmMemoria, linhaNova);

    expect(mesclado.items).toHaveLength(1);
    expect(mesclado.items[0].productId).toBe("prod-1");
  });

  it("O ACHADO BLOQUEANTE — o endereço de entrega não é apagado pela fusão (cliente logado, sem junção com user_addresses na linha do realtime)", () => {
    // Sem proteger `customer` (só `items` era protegido), `mapOrderFromDB`
    // reconstruiria o endereço a partir de `customer_data` cru: `row.address`
    // (undefined, não há join) -> `customerData.addressData` (não existe,
    // chave inventada) -> `customerData.address` (é `null`, mas
    // `typeof null === "object"` faz a expressão "cair" nele mesmo, que é
    // falsy) -> `customerData` puro, que não tem `street`/`number`/etc. Todo
    // campo de endereço vira "". Este teste reprova exatamente nesse cenário.
    const linhaNova = linhaRealtimeDePagamentoConfirmado();

    const mesclado = mesclarAtualizacaoRealtime(pedidoEmMemoria, linhaNova);

    expect(mesclado.customer).toEqual(pedidoEmMemoria.customer);
    expect(mesclado.customer.address).toBe("Rua A");
    expect(mesclado.customer.number).toBe("10");
    expect(mesclado.customer.neighborhood).toBe("Centro");
    expect(mesclado.customer.city).toBe("Uberlândia");
    expect(mesclado.customer.state).toBe("MG");
    expect(mesclado.customer.cep).toBe("38400-000");
  });

  it("CONTROLE NEGATIVO — customer_data da linha DIVERGE do que está em memória, e ainda assim o pedido mesclado preserva a memória (prova que a preservação é deliberada, não coincidência de valores iguais)", () => {
    // Sem este controle, um `mesclarAtualizacaoRealtime` que só acertasse o
    // endereço por os dois lados terem os MESMOS valores passaria despercebido.
    // Divergir de propósito prova que o campo é ignorado por decisão, não por
    // sorte — mesma lógica do "controle negativo na mesma rodada da medição".
    const linhaNova = linhaRealtimeDePagamentoConfirmado({
      customer_name: "Outro Nome Vindo Do Banco",
      customer_data: {
        whatsapp: "00000000000",
        address_id: "outro-endereco",
        address: null,
        shipping_option_id: "expressa",
        destination_cep: "00000-000",
      },
    });

    const mesclado = mesclarAtualizacaoRealtime(pedidoEmMemoria, linhaNova);

    expect(mesclado.customer).toEqual(pedidoEmMemoria.customer);
  });

  it("cancelamento depois do envio: cancelledAfterShipping e returnedToSellerAt continuam corretos (trava contra regressão do achado de 24/08/2026)", () => {
    const linhaNova = linhaRealtimeDePagamentoConfirmado({
      status: "cancelled",
      cancelled_after_shipping: true,
      returned_to_seller_at: "2026-08-27T09:00:00.000Z",
    });

    const mesclado = mesclarAtualizacaoRealtime(pedidoEmMemoria, linhaNova);

    expect(mesclado.status).toBe("cancelled");
    expect(mesclado.cancelledAfterShipping).toBe(true);
    expect(mesclado.returnedToSellerAt).toBe("2026-08-27T09:00:00.000Z");
  });

  it("o código de rastreio digitado pela lojista aparece ao vivo para quem está com 'Meus Pedidos' aberto (achado da revisão: trackingCode não é campo preservado da memória — ele vem da linha nova)", () => {
    // Cenário real (OrderDetail.tsx:1082): a lojista digita o código de
    // rastreio no painel, isso grava `tracking_code` no banco, o realtime
    // entrega essa linha. Se alguém acrescentasse "trackingCode" ao tipo
    // `CamposPreservadosDaMemoria` — o que a lista convida a fazer, já
    // que ela é escrita por um caminho (updateOrderStatus/painel) e lida por
    // outro (esta função) — o código de rastreio nunca apareceria ao vivo, e
    // é exatamente esse mutante que este teste mata.
    const linhaNova = linhaRealtimeDePagamentoConfirmado({
      tracking_code: "BR123456789BR",
    });

    const mesclado = mesclarAtualizacaoRealtime(pedidoEmMemoria, linhaNova);

    expect(mesclado.trackingCode).toBe("BR123456789BR");
  });

  it("a observação que a lojista grava no pedido aparece ao vivo (achado da revisão: notes não era assertado em lugar nenhum)", () => {
    // Mesmo cenário do teste acima, para o outro campo que a lojista edita
    // pela tela (OrderDetail.tsx:1102, grava `notes`). Mata o mutante que
    // acrescentasse "notes" ao tipo `CamposPreservadosDaMemoria`.
    const linhaNova = linhaRealtimeDePagamentoConfirmado({
      notes: "Embalar com cuidado, é presente.",
    });

    const mesclado = mesclarAtualizacaoRealtime(pedidoEmMemoria, linhaNova);

    expect(mesclado.notes).toBe("Embalar com cuidado, é presente.");
  });

  it("CONTROLE — pedido que NÃO mudou nada (mesma linha, mesmo estado): a fusão não inventa diferença nenhuma", () => {
    // Prova que o instrumento discrimina: se a linha do realtime repetir
    // exatamente o que já estava em memória, TODOS os campos — inclusive os
    // que a correção passou a ler (payment_status/total) e os derivados de
    // JOIN que são sempre preservados (items/customer, ver o tipo
    // `CamposPreservadosDaMemoria` em useOrders.ts) — têm que sair IDÊNTICOS. Sem
    // este controle, um mutante que sempre devolvesse valores diferentes por
    // engano ainda passaria nos testes positivos acima, desde que os campos
    // observados ali batessem por coincidência.
    //
    // Comparado por `toEqual` no objeto INTEIRO, inclusive `customer`: com a
    // correção do achado bloqueante da revisão, `customer` sai sempre do
    // pedido em memória — não há mais divergência legítima a excluir daqui.
    const linhaSemMudanca = linhaRealtimeDePagamentoConfirmado({
      payment_status: "aguardando",
      total: 120,
    });

    const mesclado = mesclarAtualizacaoRealtime(
      pedidoEmMemoria,
      linhaSemMudanca,
    );

    expect(mesclado.paymentStatus).toBe(pedidoEmMemoria.paymentStatus);
    expect(mesclado.total).toBe(pedidoEmMemoria.total);
    expect(mesclado.status).toBe(pedidoEmMemoria.status);
    expect(mesclado.trackingCode).toBe(pedidoEmMemoria.trackingCode);
    expect(mesclado.cancelledAfterShipping).toBe(
      pedidoEmMemoria.cancelledAfterShipping,
    );
    expect(mesclado.returnedToSellerAt).toBe(
      pedidoEmMemoria.returnedToSellerAt,
    );
    expect(mesclado.items).toEqual(pedidoEmMemoria.items);
    expect(mesclado.customer).toEqual(pedidoEmMemoria.customer);
  });
});
