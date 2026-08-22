// @vitest-environment jsdom
//
// Defeito: cliente paga por PIX, abre a tela do pedido e lê "Aguardando
// confirmação de pagamento" no topo — e, na mesma tela, um selo FIXO
// "Confirmado via Gateway" (texto sem nenhum `{` no JSX, não depende de
// nada) que aparecia idêntico em pedido pago, recusado, expirado e nunca
// pago. As duas telas do cliente (`OrderDetailsView`, `OrderList`) liam só
// `status` (esteira) e ignoravam `payment_status` (se o dinheiro entrou),
// mesmo o dado já chegando ao objeto `Order` via mappers.ts.
//
// POR QUE RENDER DE VERDADE: mesmo raciocínio de
// order-details-codigo-de-rastreio.test.tsx, cujo dublê de hooks este
// arquivo reaproveita.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Order, PaymentStatus } from "@/types";

const pedidoBase: Order = {
  id: "pedido-pgto",
  customer: { name: "Cliente Teste", whatsapp: "34999999999" },
  items: [
    {
      productId: "prod-1",
      name: "Blusa Teste",
      price: 100,
      quantity: 1,
      image: "",
    },
  ],
  subtotal: 100,
  shipping: 20,
  discount: 0,
  total: 120,
  paymentMethod: "pix",
  status: "pending",
  createdAt: new Date(0).toISOString(),
  updatedAt: new Date(0).toISOString(),
};

let pedidoAtual: Order = pedidoBase;

vi.mock("@/hooks/useOrders", () => ({
  useOrders: () => ({
    orders: [pedidoAtual],
    fetchUserOrders: vi.fn().mockResolvedValue([pedidoAtual]),
    updateOrderStatus: vi.fn(),
  }),
}));

const usuario = { id: "user-1" };
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: usuario }) }));

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    config: { enableReviews: false, whatsappNumber: "34999999999" },
  }),
}));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: () => ({
      select: () => ({
        eq: () => ({ in: () => Promise.resolve({ data: [], error: null }) }),
      }),
    }),
  },
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function pedidoComPagamento(
  paymentStatus: PaymentStatus | null | undefined,
): Order {
  return { ...pedidoBase, status: "pending", paymentStatus };
}

describe("OrderDetailsView — o selo de pagamento deixa de mentir (pedido pago por PIX)", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    pedidoAtual = pedidoBase;
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
  });

  async function renderizar() {
    const { OrderDetailsView } = await import(
      "@/views/customer/OrderDetailsView"
    );
    await act(async () => {
      raiz.render(
        <OrderDetailsView
          orderId="pedido-pgto"
          onBack={() => {}}
          onNavigate={() => {}}
        />,
      );
    });
    await act(async () => {
      await Promise.resolve();
    });
  }

  it("status 'pending' + pago: mostra 'Pagamento confirmado' e NÃO mostra o aviso de aguardando", async () => {
    pedidoAtual = pedidoComPagamento("pago");

    await renderizar();

    expect(hospedeiro.textContent).toContain("Pagamento confirmado");
    expect(hospedeiro.textContent).not.toContain(
      "Aguardando confirmação de pagamento",
    );
  });

  it("status 'pending' + aguardando: continua mostrando o texto de aguardando (não quebrou o caminho que já estava certo)", async () => {
    pedidoAtual = pedidoComPagamento("aguardando");

    await renderizar();

    expect(hospedeiro.textContent).toContain(
      "Aguardando confirmação de pagamento",
    );
  });

  it("paymentStatus nulo: nenhum selo de pagamento aparece, e 'Confirmado via Gateway' não existe mais em lugar nenhum do documento", async () => {
    pedidoAtual = pedidoComPagamento(null);

    await renderizar();

    expect(hospedeiro.textContent).not.toContain("Confirmado via Gateway");
    expect(hospedeiro.textContent).not.toContain("Pagamento confirmado");
    expect(hospedeiro.textContent).not.toContain("Aguardando pagamento");
    expect(hospedeiro.textContent).not.toContain("Pagamento recusado");
  });

  it("status 'pending' + recusado: mostra 'Pagamento recusado'", async () => {
    pedidoAtual = pedidoComPagamento("recusado");

    await renderizar();

    expect(hospedeiro.textContent).toContain("Pagamento recusado");
  });

  // Os quatro casos abaixo assertam a DESCRIÇÃO (bloco de texto abaixo do
  // título do status), não o selo — achado do revisor: o teste do selo
  // sozinho não prova nada sobre `pendingDescription`, e os três ramos
  // recusado/expirado/estornado ficavam sem nenhum teste que caísse se o
  // texto estivesse errado, trocado entre si, ou apagado. Cada um também
  // nega a frase antiga de "aguardando", para não passar por coincidência
  // quando os dois textos coexistirem na tela.
  it("status 'pending' + recusado: mostra a descrição de pagamento recusado", async () => {
    pedidoAtual = pedidoComPagamento("recusado");

    await renderizar();

    expect(hospedeiro.textContent).toContain(
      "O pagamento não foi aprovado. Tente novamente ou fale com a loja.",
    );
    expect(hospedeiro.textContent).not.toContain(
      "Aguardando confirmação de pagamento",
    );
  });

  it("status 'pending' + expirado: mostra a descrição de prazo vencido", async () => {
    pedidoAtual = pedidoComPagamento("expirado");

    await renderizar();

    expect(hospedeiro.textContent).toContain(
      "O prazo de pagamento venceu. Fale com a loja para gerar um novo.",
    );
    expect(hospedeiro.textContent).not.toContain(
      "Aguardando confirmação de pagamento",
    );
  });

  it("status 'pending' + estornado: mostra a descrição de pagamento estornado", async () => {
    pedidoAtual = pedidoComPagamento("estornado");

    await renderizar();

    expect(hospedeiro.textContent).toContain(
      "O pagamento foi estornado. Fale com a loja.",
    );
    expect(hospedeiro.textContent).not.toContain(
      "Aguardando confirmação de pagamento",
    );
  });
});

describe("OrderDetailsView — pedido cancelado com pagamento que ficou com a loja", () => {
  // `pago_apos_expirar` SEMPRE vem com `status='cancelled'` na produção real
  // (rastreado no SQL de `confirmar_pagamento`) — é o par que interessa medir
  // aqui, não `pending` + `pago_apos_expirar`, que o banco nunca gera.
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
  });

  function pedidoCanceladoComPagamento(
    paymentStatus: PaymentStatus | null | undefined,
  ): Order {
    return { ...pedidoBase, status: "cancelled", paymentStatus };
  }

  async function renderizar() {
    const { OrderDetailsView } = await import(
      "@/views/customer/OrderDetailsView"
    );
    await act(async () => {
      raiz.render(
        <OrderDetailsView
          orderId="pedido-pgto"
          onBack={() => {}}
          onNavigate={() => {}}
        />,
      );
    });
    await act(async () => {
      await Promise.resolve();
    });
  }

  it("status 'cancelled' + pago_apos_expirar: mostra 'Pago após o vencimento', orienta a falar com a loja, e NÃO mostra 'Pagamento confirmado'", async () => {
    pedidoAtual = pedidoCanceladoComPagamento("pago_apos_expirar");

    await renderizar();

    expect(hospedeiro.textContent).toContain("Pago após o vencimento");
    expect(hospedeiro.textContent).toContain("Fale com a loja para resolver");
    expect(hospedeiro.textContent).not.toContain("Pagamento confirmado");
  });

  it("status 'cancelled' + pago: mostra a mesma orientação de cancelado-mas-pago", async () => {
    pedidoAtual = pedidoCanceladoComPagamento("pago");

    await renderizar();

    expect(hospedeiro.textContent).toContain(
      "Este pedido foi cancelado, mas o seu pagamento foi recebido. Fale com a loja para resolver.",
    );
  });

  it("status 'cancelled' + recusado: mantém o texto original de cancelado (controle — não estendeu demais)", async () => {
    pedidoAtual = pedidoCanceladoComPagamento("recusado");

    await renderizar();

    expect(hospedeiro.textContent).toContain(
      "Este pedido foi cancelado e não seguirá para entrega.",
    );
    expect(hospedeiro.textContent).not.toContain("seu pagamento foi recebido");
  });

  it("B2: status 'cancelled' + recusado: o selo fixo removido ('Confirmado') não aparece em lugar nenhum do documento", async () => {
    pedidoAtual = pedidoCanceladoComPagamento("recusado");

    await renderizar();

    // "Confirmado" (C maiúsculo, palavra isolada) era o texto do selo fixo
    // removido do card "Total Consolidado". É diferente de "Pagamento
    // confirmado" (c minúsculo), rótulo do CustomerPaymentBadge quando o
    // pagamento é 'pago' — `toContain` é sensível a maiúscula/minúscula, e
    // aqui o paymentStatus é 'recusado', então o selo dinâmico mostra
    // "Pagamento recusado": nenhum dos dois teria motivo para conter
    // "Confirmado" com C maiúsculo, exceto o selo fixo que este teste prova
    // que sumiu.
    expect(hospedeiro.textContent).not.toContain("Confirmado");
  });
});

describe("OrderList — o card do cliente também mostra o selo de pagamento", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
  });

  it("status 'pending' + pago: o card mostra 'Pagamento confirmado'", async () => {
    const { OrderList } = await import("@/components/ui/custom/OrderList");
    const order = pedidoComPagamento("pago");

    await act(async () => {
      raiz.render(<OrderList orders={[order]} onNavigate={() => {}} />);
    });

    expect(hospedeiro.textContent).toContain("Pagamento confirmado");
  });
});
