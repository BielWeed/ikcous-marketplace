// @vitest-environment jsdom
//
// Pedido CANCELADO com o dinheiro já devolvido (`payment_status = 'estornado'`)
// é o FINAL FELIZ do reembolso, e a tela do cliente o contava como problema
// (04/11/2026):
//   - na lista: "O pagamento foi estornado. Fale com a loja.";
//   - na ficha: descrição genérica "não seguirá para entrega", selo vermelho
//     "Pagamento estornado" e nenhuma frase "Devolução concluída: R$ X", porque
//     a leitura de `order_refunds` só era ligada para `pago`/`pago_apos_expirar`
//     — justamente os estados que deixam de existir quando o estorno conclui.
//
// A tela NÃO afirma PIX nem cartão: `metodo_online` não chega ao app.
// `estornado` também vem de chargeback e do "Já estornei" da loja, então o
// valor só aparece quando existe linha CONCLUÍDA em `order_refunds`; sem linha
// a ficha diz só o que o estado diz (foi estornado), nunca "a loja faz depois".
//
// Fora de pedido cancelado, `estornado` segue como era (controle).
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { customerPaymentStatusEntry } from "@/components/ui/custom/CustomerPaymentBadge";
import type { Order, PaymentStatus } from "@/types";

const pedidoBase: Order = {
  id: "pedido-estornado",
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
  shipping: 0,
  discount: 0,
  total: 100,
  paymentMethod: "online",
  status: "cancelled",
  createdAt: new Date(0).toISOString(),
  updatedAt: new Date(0).toISOString(),
  cancelledAfterShipping: false,
  paymentStatus: "estornado",
};

let pedidoAtual: Order = pedidoBase;
let linhasDeDevolucao: Array<Record<string, unknown>> = [];
const consultasAoLivro = vi.fn();

vi.mock("@/hooks/useOrders", () => ({
  useOrders: () => ({
    orders: [pedidoAtual],
    fetchUserOrders: vi.fn().mockResolvedValue([pedidoAtual]),
    updateOrderStatus: vi.fn(),
  }),
}));
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: { id: "user-1" } }),
}));
vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    config: { enableReviews: false, whatsappNumber: "34999999999" },
  }),
}));
vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: (tabela: string) => {
      if (tabela === "order_refunds") {
        return {
          select: () => ({
            eq: () => ({
              order: () => {
                consultasAoLivro();
                return Promise.resolve({
                  data: linhasDeDevolucao,
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
vi.mock("@/utils/haptic", () => ({
  haptic: { light: vi.fn(), medium: vi.fn(), success: vi.fn() },
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/copiar-para-clipboard", () => ({
  copiarParaClipboard: vi.fn().mockResolvedValue(true),
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function concluida(amount: number) {
  return {
    amount,
    status: "concluido",
    solicitado_por: "cliente",
    concluido_em: "2026-11-03T10:00:00.000Z",
  };
}

describe("selo do pagamento — estornado", () => {
  it("cancelado + estornado: tom neutro, não o vermelho de 'recusado'", () => {
    const entrada = customerPaymentStatusEntry("estornado", "cancelled");
    expect(entrada?.tone).toBe("neutro");
    expect(entrada?.label).toBe("Pagamento estornado");
  });

  it("estornado fora de pedido cancelado (ou sem status): o selo de sempre (controle)", () => {
    expect(customerPaymentStatusEntry("estornado", "pending")?.tone).toBe(
      "recusado",
    );
    expect(customerPaymentStatusEntry("estornado", "delivered")?.tone).toBe(
      "recusado",
    );
    expect(customerPaymentStatusEntry("estornado")?.tone).toBe("recusado");
  });
});

describe("Meus pedidos — cancelado e estornado", () => {
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

  it("a frase da lista diz que o dinheiro foi devolvido e não manda procurar a loja", async () => {
    const { OrderList } = await import("@/components/ui/custom/OrderList");
    await act(async () => {
      raiz.render(
        <OrderList orders={[pedidoBase]} onNavigate={() => undefined} />,
      );
    });
    const painel = hospedeiro.querySelector(
      '[data-testid="order-status-panel"]',
    );
    const texto = painel?.textContent ?? "";
    expect(texto).toContain("O dinheiro deste pedido foi devolvido.");
    expect(texto).not.toContain("Fale com a loja");
    // Não afirma o meio: o app não sabe se foi PIX ou cartão.
    expect(texto).not.toMatch(/pix|cartão|fatura/i);
  });

  it("estornado em pedido NÃO cancelado: a frase da lista não muda (só existe para cancelado)", async () => {
    const { OrderList } = await import("@/components/ui/custom/OrderList");
    await act(async () => {
      raiz.render(
        <OrderList
          orders={[{ ...pedidoBase, status: "pending" }]}
          onNavigate={() => undefined}
        />,
      );
    });
    expect(hospedeiro.textContent ?? "").not.toContain(
      "O dinheiro deste pedido foi devolvido.",
    );
  });
});

describe("OrderDetailsView — cancelado e estornado", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    consultasAoLivro.mockClear();
    linhasDeDevolucao = [];
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

  async function renderizar(pedido: Order) {
    pedidoAtual = pedido;
    const { OrderDetailsView } = await import(
      "@/views/customer/OrderDetailsView"
    );
    await act(async () => {
      raiz.render(
        <OrderDetailsView
          orderId={pedido.id}
          onBack={() => undefined}
          onNavigate={() => undefined}
        />,
      );
    });
    for (let i = 0; i < 4; i++) {
      await act(async () => {
        await Promise.resolve();
      });
    }
    return (hospedeiro.textContent ?? "").replace(/\s+/g, " ");
  }

  it("com a devolução concluída no livro: mostra 'Devolução concluída: R$ X' e a descrição do desfecho", async () => {
    linhasDeDevolucao = [concluida(100)];
    const tela = await renderizar(pedidoBase);
    expect(consultasAoLivro).toHaveBeenCalled();
    expect(tela).toMatch(/Devolução concluída: R\$\s?100,00/);
    expect(tela).toContain("o dinheiro foi devolvido");
    expect(tela).not.toContain("Fale com a loja");
    expect(tela).not.toContain("não seguirá para entrega");
    expect(tela).not.toMatch(/PIX cai|fatura/i);
  });

  it("devolução em duas linhas concluídas: soma as duas", async () => {
    linhasDeDevolucao = [concluida(60), concluida(40)];
    const tela = await renderizar(pedidoBase);
    expect(tela).toMatch(/Devolução concluída: R\$\s?100,00/);
  });

  it("estornado SEM linha no livro (chargeback, 'Já estornei' da loja): não inventa valor nem promete 'a loja faz depois'", async () => {
    linhasDeDevolucao = [];
    const tela = await renderizar({
      ...pedidoBase,
      cancelledAfterShipping: true,
      returnedToSellerAt: null,
    });
    expect(tela).not.toContain("Devolução concluída");
    expect(tela).not.toContain("a loja faz depois");
    expect(tela).not.toContain("Fale com a loja");
    expect(tela).toContain("o dinheiro foi devolvido");
  });

  it("estornado com linha SÓ de falha: não mostra o texto de erro nem 'cuidando disso'", async () => {
    linhasDeDevolucao = [
      {
        amount: 100,
        status: "falhou",
        solicitado_por: "cliente",
        concluido_em: null,
      },
    ];
    const tela = await renderizar(pedidoBase);
    expect(tela).not.toContain("Devolução concluída");
    expect(tela).not.toContain("a loja está cuidando");
  });

  it("estornado em pedido NÃO cancelado: não lê o livro (controle)", async () => {
    await renderizar({ ...pedidoBase, status: "pending" });
    expect(consultasAoLivro).not.toHaveBeenCalled();
  });

  it("PAGO e cancelado continua lendo o livro e mostrando a devolução de sempre (controle)", async () => {
    linhasDeDevolucao = [concluida(100)];
    const tela = await renderizar({
      ...pedidoBase,
      paymentStatus: "pago" as PaymentStatus,
    });
    expect(consultasAoLivro).toHaveBeenCalled();
    expect(tela).toMatch(/Devolução concluída: R\$\s?100,00/);
  });
});
