// @vitest-environment jsdom
//
// A PONTA do fio do cartão de etiqueta: o cartão só relê o pedido se a ficha
// (OrderDetail) lhe passar o status e o pagamento. Este teste monta a ficha de
// verdade, com o cartão de verdade dentro, e cancela/conclui o pedido pela
// prop `order` (é assim que a ficha recebe o pedido novo): o botão "Gerar
// etiqueta" tem de sumir, sem remontar a ficha.
import type { Order } from "@/types";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { pedidoNoBanco, leiturasDoPedido } = vi.hoisted(() => ({
  pedidoNoBanco: { data: null as any },
  leiturasDoPedido: { total: 0 },
}));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    rpc: vi.fn(),
    from: vi.fn((tabela: string) => {
      if (tabela === "marketplace_orders") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: () => {
                leiturasDoPedido.total += 1;
                return Promise.resolve({
                  data: pedidoNoBanco.data,
                  error: null,
                });
              },
            }),
          }),
        };
      }
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: () => Promise.resolve({ data: null, error: null }),
          }),
        }),
      };
    }),
    functions: { invoke: vi.fn() },
    channel: vi.fn(),
    removeChannel: vi.fn(),
  },
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function esperarMicrotarefas(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function linhaDoBanco(over: Record<string, unknown> = {}) {
  return {
    id: "ped-etiqueta",
    status: "processing",
    payment_status: "pago",
    shipping: 20,
    shipping_cost: null,
    tracking_code: null,
    shipping_label_id: null,
    shipping_label_url: null,
    notes: null,
    shipping_option_id: "melhor-envio-3",
    cpf: "52998224725",
    ...over,
  };
}

function pedido(over: Partial<Order> = {}): Order {
  return {
    id: "ped-etiqueta",
    customer: {
      name: "Cliente Teste",
      whatsapp: "34999999999",
      address: "Rua das Flores",
      number: "123",
      neighborhood: "Centro",
      city: "Patos de Minas",
      state: "MG",
    },
    items: [],
    subtotal: 100,
    shipping: 20,
    discount: 0,
    total: 120,
    paymentMethod: "online",
    paymentStatus: "pago",
    status: "processing",
    createdAt: "2026-11-01T10:00:00.000Z",
    updatedAt: "2026-11-01T10:00:00.000Z",
    cancelledAfterShipping: false,
    ...over,
  };
}

describe("Ficha do pedido — cancelar ou concluir tira o 'Gerar etiqueta' do cartão", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    leiturasDoPedido.total = 0;
    pedidoNoBanco.data = linhaDoBanco();
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

  const botaoGerar = () =>
    [...hospedeiro.querySelectorAll("button")].find((b) =>
      b.textContent?.includes("Gerar etiqueta"),
    );

  async function desenhar(order: Order) {
    const { OrderDetail } = await import(
      "@/components/admin/orders/OrderDetail"
    );
    await act(async () => {
      raiz.render(<OrderDetail order={order} onStatusChange={vi.fn()} />);
    });
    await act(async () => {
      await esperarMicrotarefas();
    });
    await act(async () => {
      await esperarMicrotarefas();
    });
  }

  it.each([
    ["cancelled", "Pedido cancelado — não gera etiqueta."],
    ["delivered", "Pedido já entregue — não gera etiqueta."],
  ] as const)(
    "pedido que vira %s na ficha: o botão some e o motivo aparece",
    async (status, motivo) => {
      await desenhar(pedido());
      expect(botaoGerar()).toBeTruthy();
      expect(leiturasDoPedido.total).toBe(1);

      pedidoNoBanco.data = linhaDoBanco({ status });
      await desenhar(pedido({ status }));

      expect(leiturasDoPedido.total).toBe(2);
      expect(botaoGerar()).toBeUndefined();
      expect(
        hospedeiro.querySelector('[data-testid="etiqueta-indisponivel"]')
          ?.textContent,
      ).toContain(motivo);
    },
  );

  it("o pedido muda por um campo que não é status nem pagamento: o cartão NÃO relê", async () => {
    await desenhar(pedido());
    await desenhar(pedido({ updatedAt: "2026-11-01T10:09:00.000Z" }));
    expect(leiturasDoPedido.total).toBe(1);
    expect(botaoGerar()).toBeTruthy();
  });
});
