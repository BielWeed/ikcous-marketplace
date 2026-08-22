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
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

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

  // Achado 1 da revisão: o SELO (CustomerPaymentBadge), não só a descrição
  // acima, tem que deixar de mostrar "Pagamento confirmado" verde quando o
  // pedido morreu com o dinheiro na loja. As duas telas (esta e OrderList)
  // consomem o mesmo componente e têm que concordar sobre o mesmo dado.
  //
  // Rótulo mudou de "Pago — pedido cancelado" para "Pago — fale com a loja"
  // numa revisão seguinte: o original quebra em duas linhas a 375px (achado
  // de largura) e o novo orienta em vez de só informar.
  it("status 'cancelled' + pago: o selo mostra 'Pago — fale com a loja', e NÃO o verde 'Pagamento confirmado' nem o rótulo antigo", async () => {
    pedidoAtual = pedidoCanceladoComPagamento("pago");

    await renderizar();

    expect(hospedeiro.textContent).toContain("Pago — fale com a loja");
    expect(hospedeiro.textContent).not.toContain("Pagamento confirmado");
    expect(hospedeiro.textContent).not.toContain("Pago — pedido cancelado");
  });

  // Achado 1 (degrau 1): o par mais perigoso — pedido cancelado com o
  // pagamento AINDA aguardando (o cliente cancelou um PIX que não pagou).
  // `update_order_status_atomic` grava `status='cancelled'` e devolve o
  // estoque, mas não toca em `payment_status` (continua 'aguardando'). Sem a
  // correção, a description ficava com o texto fixo de "cancelado" — sem
  // avisar nada — e o selo ao lado dizia "Aguardando pagamento", convidando o
  // cliente a pagar um pedido morto.
  it("status 'cancelled' + aguardando: a descrição avisa para NÃO pagar, sem a frase de cancelado sozinha", async () => {
    pedidoAtual = pedidoCanceladoComPagamento("aguardando");

    await renderizar();

    expect(hospedeiro.textContent).toContain(
      "Este pedido foi cancelado. Se o pagamento ainda estiver aberto no seu banco, não pague — o pedido não será entregue.",
    );
    expect(hospedeiro.textContent).not.toContain(
      "Este pedido foi cancelado e não seguirá para entrega.",
    );
  });

  it("status 'cancelled' + aguardando: o selo mostra 'Cancelado — não pague', e NÃO 'Aguardando pagamento'", async () => {
    pedidoAtual = pedidoCanceladoComPagamento("aguardando");

    await renderizar();

    expect(hospedeiro.textContent).toContain("Cancelado — não pague");
    expect(hospedeiro.textContent).not.toContain("Aguardando pagamento");
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

  beforeAll(() => {
    // jsdom não implementa `navigator.clipboard`. Só é preciso aqui porque um
    // teste desta suíte clica de verdade no botão de copiar ID (para simular
    // o estado "Copiado!" e provar que a sentinela escopada não se confunde
    // com ele) — `OrderList.tsx` chama `navigator.clipboard.writeText`
    // incondicionalmente nesse fluxo, e sem o stub o clique lançaria antes de
    // `setCopiedId` rodar.
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
      configurable: true,
    });
  });

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

  // Achado 1: card de "Meus Pedidos" é a PRIMEIRA tela que o cliente abre.
  // Antes da correção mostrava "CANCELADO" (esteira) e, logo abaixo, o selo
  // verde "PAGAMENTO CONFIRMADO" — sem uma palavra sobre o cancelamento.
  //
  // Rótulo mudou de "Pago — pedido cancelado" para "Pago — fale com a loja"
  // (achado de largura: o original quebra em duas linhas a 375px).
  it("status 'cancelled' + pago: o card mostra 'Pago — fale com a loja', e NÃO o verde 'Pagamento confirmado' nem o rótulo antigo", async () => {
    const { OrderList } = await import("@/components/ui/custom/OrderList");
    const order: Order = {
      ...pedidoComPagamento("pago"),
      status: "cancelled",
    };

    await act(async () => {
      raiz.render(<OrderList orders={[order]} onNavigate={() => {}} />);
    });

    expect(hospedeiro.textContent).toContain("Pago — fale com a loja");
    expect(hospedeiro.textContent).not.toContain("Pagamento confirmado");
    expect(hospedeiro.textContent).not.toContain("Pago — pedido cancelado");
  });

  // Controle: o pedido segue vivo (status 'pending'), mesmo pago. O selo tem
  // que continuar exatamente como hoje — nada de "Pago — fale com a loja"
  // vazando para fora do caso 'cancelled'.
  it("status 'pending' + pago (controle): continua 'Pagamento confirmado', sem o texto de cancelado", async () => {
    const { OrderList } = await import("@/components/ui/custom/OrderList");
    const order = pedidoComPagamento("pago");

    await act(async () => {
      raiz.render(<OrderList orders={[order]} onNavigate={() => {}} />);
    });

    expect(hospedeiro.textContent).toContain("Pagamento confirmado");
    expect(hospedeiro.textContent).not.toContain("Pago — fale com a loja");
  });

  // Achado 1 (degrau 1), na primeira tela que o cliente abre: pedido
  // cancelado com pagamento ainda em aberto. Sem a correção, o card mostrava
  // "CANCELADO" e, logo abaixo, o pill âmbar "AGUARDANDO PAGAMENTO" — a tela
  // convidava a pagar um pedido morto.
  it("status 'cancelled' + aguardando: o card mostra 'Cancelado — não pague', e NÃO 'Aguardando pagamento'", async () => {
    const { OrderList } = await import("@/components/ui/custom/OrderList");
    const order: Order = {
      ...pedidoComPagamento("aguardando"),
      status: "cancelled",
    };

    await act(async () => {
      raiz.render(<OrderList orders={[order]} onNavigate={() => {}} />);
    });

    expect(hospedeiro.textContent).toContain("Cancelado — não pague");
    expect(hospedeiro.textContent).not.toContain("Aguardando pagamento");
  });

  // Sentinelas de contraste — um teste por tom, escopadas ao selo
  // (`[data-testid="customer-payment-badge"]`), nunca ao host inteiro.
  // Achado do revisor: a sentinela antiga usava
  // `hospedeiro.querySelector(".text-emerald-600")` sobre o documento
  // inteiro, e `OrderList.tsx` usa exatamente essa classe no botão de ID
  // quando o estado é "Copiado!" — hoje esse estado só aparece depois de um
  // clique, mas a sentinela reprovaria por motivo alheio ao selo no dia em
  // que ele renderizasse.
  it("tom 'confirmado': o selo usa text-emerald-700 (contraste AA), não mais text-emerald-600", async () => {
    const { OrderList } = await import("@/components/ui/custom/OrderList");
    const order = pedidoComPagamento("pago");

    await act(async () => {
      raiz.render(<OrderList orders={[order]} onNavigate={() => {}} />);
    });

    const selo = hospedeiro.querySelector(
      '[data-testid="customer-payment-badge"]',
    );
    expect(selo).not.toBeNull();
    expect(selo?.querySelector(".text-emerald-700")).not.toBeNull();
    expect(selo?.querySelector(".text-emerald-600")).toBeNull();
  });

  // Prova de que o escopo realmente protege contra a colisão descrita acima:
  // com o botão de ID no estado "Copiado!" (que usa text-emerald-600) visível
  // ao lado do selo 'confirmado', a sentinela ESCOPADA continua correta —
  // ela não pode nunca enxergar o emerald-600 do botão.
  it("tom 'confirmado' com o botão de ID em 'Copiado!' (text-emerald-600) ao lado: a sentinela escopada não se confunde", async () => {
    const { OrderList } = await import("@/components/ui/custom/OrderList");
    const order = pedidoComPagamento("pago");

    await act(async () => {
      raiz.render(<OrderList orders={[order]} onNavigate={() => {}} />);
    });

    const botaoId = hospedeiro.querySelector("button");
    await act(async () => {
      botaoId?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    // Confere que a armadilha está de fato presente antes de testar a defesa
    // contra ela: se o botão nunca entrar em "Copiado!", este teste não prova
    // nada sobre a colisão.
    expect(hospedeiro.textContent).toContain("Copiado!");
    expect(hospedeiro.querySelector(".text-emerald-600")).not.toBeNull();

    const selo = hospedeiro.querySelector(
      '[data-testid="customer-payment-badge"]',
    );
    expect(selo).not.toBeNull();
    expect(selo?.querySelector(".text-emerald-700")).not.toBeNull();
    expect(selo?.querySelector(".text-emerald-600")).toBeNull();
  });

  it("tom 'aguardando': o selo usa text-yellow-700 (contraste AA, e distinto do laranja de 'atencao'), não mais text-amber-700", async () => {
    const { OrderList } = await import("@/components/ui/custom/OrderList");
    const order = pedidoComPagamento("aguardando");

    await act(async () => {
      raiz.render(<OrderList orders={[order]} onNavigate={() => {}} />);
    });

    const selo = hospedeiro.querySelector(
      '[data-testid="customer-payment-badge"]',
    );
    expect(selo).not.toBeNull();
    expect(selo?.querySelector(".text-yellow-700")).not.toBeNull();
    expect(selo?.querySelector(".text-amber-700")).toBeNull();
  });

  it("tom 'recusado': o selo usa text-rose-700 (contraste AA), não mais text-rose-600", async () => {
    const { OrderList } = await import("@/components/ui/custom/OrderList");
    const order = pedidoComPagamento("recusado");

    await act(async () => {
      raiz.render(<OrderList orders={[order]} onNavigate={() => {}} />);
    });

    const selo = hospedeiro.querySelector(
      '[data-testid="customer-payment-badge"]',
    );
    expect(selo).not.toBeNull();
    expect(selo?.querySelector(".text-rose-700")).not.toBeNull();
    expect(selo?.querySelector(".text-rose-600")).toBeNull();
  });

  it("tom 'expirado': o selo usa text-zinc-600 (contraste AA), não mais text-zinc-500", async () => {
    const { OrderList } = await import("@/components/ui/custom/OrderList");
    const order = pedidoComPagamento("expirado");

    await act(async () => {
      raiz.render(<OrderList orders={[order]} onNavigate={() => {}} />);
    });

    const selo = hospedeiro.querySelector(
      '[data-testid="customer-payment-badge"]',
    );
    expect(selo).not.toBeNull();
    expect(selo?.querySelector(".text-zinc-600")).not.toBeNull();
    expect(selo?.querySelector(".text-zinc-500")).toBeNull();
  });
});
