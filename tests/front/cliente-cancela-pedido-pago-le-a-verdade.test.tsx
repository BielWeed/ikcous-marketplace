// @vitest-environment jsdom
//
// T7 do plano-mãe de estorno pelo app
// (`C:/Users/Gabriel/equipe/entregas/20260907-plano-estorno-pelo-app.md`,
// corrigida pelo brief `20260908-brief-t7-tela-do-cliente-verdade-sobre-o-
// dinheiro.md`): desde 07/09/2026 o cancelamento de um pedido PAGO e NÃO
// ENVIADO grava a linha de devolução em `order_refunds` na MESMA transação, e
// o cron/edge tocam o Mercado Pago sozinhos a partir dela — a tela do
// cliente precisa parar de dizer "o dinheiro NÃO volta automaticamente"
// nesse caso, e passar a mostrar o ESTADO da devolução depois do
// cancelamento.
//
// Três blocos, UM único `vi.mock("@/lib/supabase")` para o arquivo inteiro
// (vitest içça `vi.mock` para o topo do módulo — dois mocks do MESMO
// caminho no mesmo arquivo colidem, por isso todo mundo aqui compartilha
// `linhasOrderRefundsMock` e `contadorDeLeituraOrderRefunds`):
//   A. Testes PUROS de texto-estorno-do-cliente.ts — a tabela inteira, sem
//      montar componente nenhum.
//   B. Testes de RENDER de OrderDetailsView (C1, C2, C4, C6, C7, C8, C9) —
//      mesmo dublê de hooks que cancelar-pedido-pago-avisa-do-dinheiro.test.tsx
//      e cliente-cancela-conforme-o-envio.test.tsx.
//   C. Testes do HOOK useDevolucaoDoPedidoCliente isolado — polling de 15s
//      para quando não há mais linha ativa, e o intervalo é limpo ao
//      desmontar (fake timers).
import { act, createElement } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  textoConfirmarCancelamento,
  textoDevolucao,
} from "@/lib/texto-estorno-do-cliente";
import { formatCurrency } from "@/lib/utils";
import type { Order, PaymentStatus } from "@/types";

// ---------------------------------------------------------------------------
// A. Testes puros — tabela inteira de texto-estorno-do-cliente.ts
// ---------------------------------------------------------------------------
describe("textoConfirmarCancelamento — a tabela inteira", () => {
  it("não pago: texto original, byte a byte", () => {
    expect(
      textoConfirmarCancelamento({
        pagamentoJaEntrou: false,
        jaFoiEnviado: false,
      }),
    ).toBe(
      "Tem certeza que deseja cancelar este pedido? Esta ação não pode ser desfeita.",
    );
  });

  it("pago e NÃO enviado: o dinheiro volta sozinho (PIX/cartão)", () => {
    const texto = textoConfirmarCancelamento({
      pagamentoJaEntrou: true,
      jaFoiEnviado: false,
    });
    expect(texto).toContain("volta sozinho");
    expect(texto).toContain("PIX cai na sua conta");
    expect(texto).toContain("cartão aparece como crédito na fatura");
    expect(texto).not.toContain("NÃO volta automaticamente");
  });

  it("pago e JÁ enviado: a loja devolve depois que o produto voltar", () => {
    const texto = textoConfirmarCancelamento({
      pagamentoJaEntrou: true,
      jaFoiEnviado: true,
    });
    expect(texto).toContain("já foi enviado");
    expect(texto).toContain("depois que o produto chegar de volta");
  });

  it("recebido_na_entrega: combina com a loja, sem falar de PIX/fatura", () => {
    const texto = textoConfirmarCancelamento({
      pagamentoJaEntrou: true,
      jaFoiEnviado: false,
      pagamentoNaEntrega: true,
    });
    expect(texto).toContain("pagou este pedido na entrega");
    expect(texto).toContain(
      "combine a devolução do dinheiro diretamente com a loja",
    );
    expect(texto).not.toMatch(/pix/i);
    expect(texto).not.toMatch(/fatura/i);
  });

  it("recebido_na_entrega ganha prioridade mesmo se jaFoiEnviado for true", () => {
    const texto = textoConfirmarCancelamento({
      pagamentoJaEntrou: true,
      jaFoiEnviado: true,
      pagamentoNaEntrega: true,
    });
    expect(texto).toContain("pagou este pedido na entrega");
  });
});

describe("textoDevolucao — a tabela inteira", () => {
  it("linha solicitado: em andamento", () => {
    const texto = textoDevolucao({
      linhas: [
        {
          amount: 50,
          status: "solicitado",
          solicitado_por: "cliente",
          concluido_em: null,
        },
      ],
      cancelledAfterShipping: false,
      returnedToSellerAt: null,
    });
    expect(texto).toBe(
      "Devolução: em andamento — o dinheiro volta sozinho (PIX na conta; cartão na fatura).",
    );
  });

  it("linha em_processamento: em andamento", () => {
    const texto = textoDevolucao({
      linhas: [
        {
          amount: 50,
          status: "em_processamento",
          solicitado_por: "cliente",
          concluido_em: null,
        },
      ],
      cancelledAfterShipping: false,
      returnedToSellerAt: null,
    });
    expect(texto).toBe(
      "Devolução: em andamento — o dinheiro volta sozinho (PIX na conta; cartão na fatura).",
    );
  });

  it("linha concluido de 100: soma e formata em R$", () => {
    const texto = textoDevolucao({
      linhas: [
        {
          amount: 100,
          status: "concluido",
          solicitado_por: "cliente",
          concluido_em: "2026-09-08T00:00:00Z",
        },
      ],
      cancelledAfterShipping: false,
      returnedToSellerAt: null,
    });
    expect(texto).toBe(`Devolução concluída: ${formatCurrency(100)}`);
  });

  it("duas linhas concluídas: soma as duas", () => {
    const texto = textoDevolucao({
      linhas: [
        {
          amount: 30,
          status: "concluido",
          solicitado_por: "cliente",
          concluido_em: "2026-09-08T00:00:00Z",
        },
        {
          amount: 20,
          status: "concluido",
          solicitado_por: "sistema",
          concluido_em: "2026-09-08T01:00:00Z",
        },
      ],
      cancelledAfterShipping: false,
      returnedToSellerAt: null,
    });
    expect(texto).toBe(`Devolução concluída: ${formatCurrency(50)}`);
  });

  it("concluído + falhou juntos: soma SÓ a concluída, ignora a que falhou", () => {
    // Mutação m3 do brief ("somar linhas não concluídas em 'concluída'") só
    // é pega por um cenário com concluído E outro status juntos — C4/C6 do
    // brief têm um único status cada, então uma soma quebrada em `linhas`
    // em vez de `concluidas` dá o MESMO resultado nos dois. Este teste é o
    // que efetivamente mata a mutação.
    const texto = textoDevolucao({
      linhas: [
        {
          amount: 100,
          status: "concluido",
          solicitado_por: "cliente",
          concluido_em: "2026-09-08T00:00:00Z",
        },
        {
          amount: 50,
          status: "falhou",
          solicitado_por: "sistema",
          concluido_em: null,
        },
      ],
      cancelledAfterShipping: false,
      returnedToSellerAt: null,
    });
    expect(texto).toBe(`Devolução concluída: ${formatCurrency(100)}`);
  });

  it("sem linha, cancelado após envio, produto ainda não voltou: a loja faz depois", () => {
    const texto = textoDevolucao({
      linhas: [],
      cancelledAfterShipping: true,
      returnedToSellerAt: null,
    });
    expect(texto).toBe(
      "Devolução: a loja faz depois de receber o produto de volta.",
    );
  });

  it("sem linha, cancelado após envio, produto já voltou: a loja vai devolver", () => {
    const texto = textoDevolucao({
      linhas: [],
      cancelledAfterShipping: true,
      returnedToSellerAt: "2026-09-08T00:00:00Z",
    });
    expect(texto).toBe(
      "Devolução: a loja já recebeu o produto e vai devolver o dinheiro.",
    );
  });

  it("sem linha e NÃO cancelado após envio: nada a mostrar (null)", () => {
    const texto = textoDevolucao({
      linhas: [],
      cancelledAfterShipping: false,
      returnedToSellerAt: null,
    });
    expect(texto).toBeNull();
  });

  it("linha falhou, sem outra linha viva: fala com a loja, nunca o texto técnico", () => {
    const texto = textoDevolucao({
      linhas: [
        {
          amount: 50,
          status: "falhou",
          solicitado_por: "sistema",
          concluido_em: null,
        },
      ],
      cancelledAfterShipping: false,
      returnedToSellerAt: null,
    });
    expect(texto).toBe(
      "Devolução: a loja está cuidando disso — fale com ela se demorar.",
    );
  });

  it("linha recusada, sem outra linha viva: mesmo texto de 'falhou'", () => {
    const texto = textoDevolucao({
      linhas: [
        {
          amount: 50,
          status: "recusado",
          solicitado_por: "lojista",
          concluido_em: null,
        },
      ],
      cancelledAfterShipping: false,
      returnedToSellerAt: null,
    });
    expect(texto).toBe(
      "Devolução: a loja está cuidando disso — fale com ela se demorar.",
    );
  });

  it("linha em_processamento tem prioridade sobre linha concluída antiga", () => {
    const texto = textoDevolucao({
      linhas: [
        {
          amount: 30,
          status: "concluido",
          solicitado_por: "cliente",
          concluido_em: "2026-09-01T00:00:00Z",
        },
        {
          amount: 20,
          status: "em_processamento",
          solicitado_por: "cliente",
          concluido_em: null,
        },
      ],
      cancelledAfterShipping: false,
      returnedToSellerAt: null,
    });
    expect(texto).toBe(
      "Devolução: em andamento — o dinheiro volta sozinho (PIX na conta; cartão na fatura).",
    );
  });
});

// ---------------------------------------------------------------------------
// Dublê ÚNICO de `@/lib/supabase` para os blocos B e C (içado para o topo do
// módulo pelo vitest — dois `vi.mock` do mesmo caminho neste arquivo
// colidiriam).
// ---------------------------------------------------------------------------
let linhasOrderRefundsMock: Array<{
  amount: number;
  status: string;
  solicitado_por: string;
  concluido_em: string | null;
}> = [];
let contadorDeLeituraOrderRefunds = 0;

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: (tabela: string) => {
      if (tabela === "order_refunds") {
        return {
          select: () => ({
            eq: () => ({
              order: () => {
                contadorDeLeituraOrderRefunds += 1;
                return Promise.resolve({
                  data: linhasOrderRefundsMock,
                  error: null,
                });
              },
            }),
          }),
        };
      }
      return {
        select: () => ({
          eq: () => ({ in: () => Promise.resolve({ data: [], error: null }) }),
        }),
      };
    },
  },
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// ---------------------------------------------------------------------------
// B. Render de OrderDetailsView
// ---------------------------------------------------------------------------
const pedidoBase: Order = {
  id: "pedido-verdade",
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
  cancelledAfterShipping: false,
};

let pedidoAtual: Order = pedidoBase;
const updateOrderStatusMock = vi.fn();

vi.mock("@/hooks/useOrders", () => ({
  useOrders: () => ({
    orders: [pedidoAtual],
    fetchUserOrders: vi.fn().mockResolvedValue([pedidoAtual]),
    updateOrderStatus: updateOrderStatusMock,
  }),
}));

const usuario = { id: "user-1" };
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: usuario }) }));

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    config: { enableReviews: false, whatsappNumber: "34999999999" },
  }),
}));

function pedidoComPagamento(
  status: Order["status"],
  paymentStatus: PaymentStatus | null | undefined,
  extra: Partial<Order> = {},
): Order {
  return { ...pedidoBase, status, paymentStatus, ...extra };
}

describe("OrderDetailsView — a tela do cliente diz a verdade sobre o dinheiro (T7)", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    updateOrderStatusMock.mockClear();
    linhasOrderRefundsMock = [];
    contadorDeLeituraOrderRefunds = 0;
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
    vi.unstubAllGlobals();
  });

  async function renderizar(orderId = "pedido-verdade") {
    const { OrderDetailsView } = await import(
      "@/views/customer/OrderDetailsView"
    );
    await act(async () => {
      raiz.render(
        createElement(OrderDetailsView, {
          orderId,
          onBack: () => {},
          onNavigate: () => {},
        }),
      );
    });
    // Duas voltas de microtarefa: a primeira resolve `fetchUserOrders`
    // (loadOrder), a segunda resolve a leitura de `order_refunds` que o
    // hook dispara depois que `order` (e portanto `mostrarDevolucao`) se
    // assenta.
    await act(async () => {
      await Promise.resolve();
    });
    await act(async () => {
      await Promise.resolve();
    });
  }

  function clicarCancelar() {
    const botao = Array.from(hospedeiro.querySelectorAll("button")).find((b) =>
      b.textContent?.includes("Cancelar Pedido"),
    );
    expect(botao).toBeDefined();
    return act(async () => {
      botao?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });
  }

  // C1
  it("C1: processing pago — confirm 'volta sozinho' e NÃO 'NÃO volta automaticamente'", async () => {
    const confirmMock = vi.fn().mockReturnValue(true);
    vi.stubGlobal("confirm", confirmMock);
    pedidoAtual = pedidoComPagamento("processing", "pago");

    await renderizar();
    await clicarCancelar();

    const texto = confirmMock.mock.calls[0][0] as string;
    expect(texto).toContain("volta sozinho");
    expect(texto).not.toContain("NÃO volta automaticamente");
  });

  // C2
  it("C2: shipping pago — confirm 'depois que o produto chegar de volta'", async () => {
    const confirmMock = vi.fn().mockReturnValue(true);
    vi.stubGlobal("confirm", confirmMock);
    pedidoAtual = pedidoComPagamento("shipping", "pago");

    await renderizar();
    await clicarCancelar();

    const texto = confirmMock.mock.calls[0][0] as string;
    expect(texto).toContain("depois que o produto chegar de volta");
  });

  // C4
  it("C4: cancelado, linha concluido de 100 — 'Devolução concluída: R$ 100,00'", async () => {
    linhasOrderRefundsMock = [
      {
        amount: 100,
        status: "concluido",
        solicitado_por: "cliente",
        concluido_em: "2026-09-08T00:00:00Z",
      },
    ];
    pedidoAtual = pedidoComPagamento("cancelled", "pago");

    await renderizar();

    expect(hospedeiro.textContent).toContain(
      `Devolução concluída: ${formatCurrency(100)}`,
    );
  });

  // C6
  it("C6: cancelado, linha em_processamento — 'em andamento'", async () => {
    linhasOrderRefundsMock = [
      {
        amount: 100,
        status: "em_processamento",
        solicitado_por: "cliente",
        concluido_em: null,
      },
    ];
    pedidoAtual = pedidoComPagamento("cancelled", "pago");

    await renderizar();

    expect(hospedeiro.textContent).toContain("Devolução: em andamento");
  });

  // C7
  it("C7: cancelado após envio, sem linha e sem retorno — 'depois de receber o produto'", async () => {
    linhasOrderRefundsMock = [];
    pedidoAtual = pedidoComPagamento("cancelled", "pago", {
      cancelledAfterShipping: true,
      returnedToSellerAt: null,
    });

    await renderizar();

    expect(hospedeiro.textContent).toContain(
      "depois de receber o produto de volta",
    );
  });

  // C8
  it("C8: recebido_na_entrega — confirm fala da entrega, sem PIX/fatura", async () => {
    const confirmMock = vi.fn().mockReturnValue(true);
    vi.stubGlobal("confirm", confirmMock);
    pedidoAtual = pedidoComPagamento("processing", "recebido_na_entrega");

    await renderizar();
    await clicarCancelar();

    const texto = confirmMock.mock.calls[0][0] as string;
    expect(texto).toContain("pagou este pedido na entrega");
    expect(texto).not.toMatch(/pix/i);
    expect(texto).not.toMatch(/fatura/i);
  });

  // C9 — varredura do DOM em cada estado: nenhum indício de id do MP.
  it("C9: nenhum texto na tela cita id do MP, PAY, api. ou refund_id", async () => {
    const cenarios: Array<[Order, typeof linhasOrderRefundsMock]> = [
      [pedidoComPagamento("processing", "pago"), []],
      [pedidoComPagamento("shipping", "pago"), []],
      [
        pedidoComPagamento("cancelled", "pago"),
        [
          {
            amount: 100,
            status: "concluido",
            solicitado_por: "cliente",
            concluido_em: "2026-09-08T00:00:00Z",
          },
        ],
      ],
      [
        pedidoComPagamento("cancelled", "pago"),
        [
          {
            amount: 100,
            status: "em_processamento",
            solicitado_por: "cliente",
            concluido_em: null,
          },
        ],
      ],
      [
        pedidoComPagamento("cancelled", "pago"),
        [
          {
            amount: 100,
            status: "falhou",
            solicitado_por: "sistema",
            concluido_em: null,
          },
        ],
      ],
      [pedidoComPagamento("processing", "recebido_na_entrega"), []],
    ];

    for (const [pedido, linhas] of cenarios) {
      pedidoAtual = pedido;
      linhasOrderRefundsMock = linhas;
      await renderizar();

      const texto = hospedeiro.textContent || "";
      expect(texto).not.toMatch(/PAY-/i);
      expect(texto).not.toMatch(/mp_[a-z_]*id/i);
      expect(texto).not.toMatch(/api\./i);
      expect(texto).not.toMatch(/refund_id/i);

      act(() => {
        raiz.unmount();
      });
      hospedeiro.remove();
      hospedeiro = document.createElement("div");
      document.body.appendChild(hospedeiro);
      raiz = createRoot(hospedeiro);
    }
  });
});

// ---------------------------------------------------------------------------
// C. Hook useDevolucaoDoPedidoCliente isolado — polling e limpeza
// ---------------------------------------------------------------------------
describe("useDevolucaoDoPedidoCliente — polling de 15s", () => {
  const raizesDoHook: Array<{ unmount: () => void }> = [];

  beforeEach(() => {
    linhasOrderRefundsMock = [];
    contadorDeLeituraOrderRefunds = 0;
  });

  afterEach(() => {
    for (const raiz of raizesDoHook.splice(0)) {
      act(() => {
        raiz.unmount();
      });
    }
    document.body.innerHTML = "";
    vi.useRealTimers();
  });

  async function montarSonda(orderId = "pedido-hook", habilitado = true) {
    const { useDevolucaoDoPedidoCliente } = await import(
      "@/hooks/useDevolucaoDoPedidoCliente"
    );
    const leituras: Array<{ linhas: unknown[]; carregando: boolean }> = [];

    function Sonda() {
      leituras.push(
        useDevolucaoDoPedidoCliente(orderId, habilitado) as unknown as {
          linhas: unknown[];
          carregando: boolean;
        },
      );
      return null;
    }

    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    raizesDoHook.push(root);

    await act(async () => {
      root.render(createElement(Sonda));
    });
    await act(async () => {
      await Promise.resolve();
    });

    return leituras;
  }

  it("com linha em_processamento: recarrega de novo depois de 15s", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    linhasOrderRefundsMock = [
      {
        amount: 50,
        status: "em_processamento",
        solicitado_por: "cliente",
        concluido_em: null,
      },
    ];

    await montarSonda();
    const chamadasAntes = contadorDeLeituraOrderRefunds;
    expect(chamadasAntes).toBe(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(15_000);
    });

    expect(contadorDeLeituraOrderRefunds).toBeGreaterThan(chamadasAntes);
  });

  it("sem linha ativa (só concluído): o polling NÃO dispara depois de 15s", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    linhasOrderRefundsMock = [
      {
        amount: 50,
        status: "concluido",
        solicitado_por: "cliente",
        concluido_em: "2026-09-08T00:00:00Z",
      },
    ];

    await montarSonda();
    const chamadasAntes = contadorDeLeituraOrderRefunds;
    expect(chamadasAntes).toBe(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(20_000);
    });

    expect(contadorDeLeituraOrderRefunds).toBe(chamadasAntes);
  });

  it("desmontar com linha ativa: o intervalo é limpo (nenhuma leitura extra depois do unmount)", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    linhasOrderRefundsMock = [
      {
        amount: 50,
        status: "solicitado",
        solicitado_por: "cliente",
        concluido_em: null,
      },
    ];

    await montarSonda();
    const chamadasAntes = contadorDeLeituraOrderRefunds;

    for (const raiz of raizesDoHook.splice(0)) {
      act(() => {
        raiz.unmount();
      });
    }

    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });

    expect(contadorDeLeituraOrderRefunds).toBe(chamadasAntes);
  });

  it("habilitado=false: nunca lê order_refunds", async () => {
    await montarSonda("pedido-hook", false);

    expect(contadorDeLeituraOrderRefunds).toBe(0);
  });
});
