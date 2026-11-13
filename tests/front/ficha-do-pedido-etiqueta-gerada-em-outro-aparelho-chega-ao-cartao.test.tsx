// @vitest-environment jsdom
//
// A PONTA do fio: o aparelho A gera a etiqueta; o aparelho B tem a ficha
// aberta e recebe o pedido novo pela lista ao vivo (prop `order`, com
// `shippingLabelId`/`shippingLabelUrl`, SEM mudar status nem pagamento). A
// ficha precisa passar o vínculo ao cartão para ele reler: "Gerar etiqueta"
// some e "Abrir etiqueta" aparece, sem remontar a ficha.
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

const URL_DA_ETIQUETA = "https://melhorenvio.com.br/imprimir/abc";

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

describe("Ficha do pedido — etiqueta gerada em outro aparelho chega ao cartão", () => {
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
  const linkAbrir = () =>
    [...hospedeiro.querySelectorAll("a")].find((a) =>
      a.textContent?.includes("Abrir etiqueta"),
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

  it("o pedido novo traz a etiqueta (status e pagamento iguais): o cartão relê e mostra 'Abrir etiqueta'", async () => {
    await desenhar(pedido());
    expect(botaoGerar()).toBeTruthy();
    expect(leiturasDoPedido.total).toBe(1);

    pedidoNoBanco.data = linhaDoBanco({
      shipping_label_id: "lbl-1",
      shipping_label_url: URL_DA_ETIQUETA,
    });
    await desenhar(
      pedido({
        shippingLabelId: "lbl-1",
        shippingLabelUrl: URL_DA_ETIQUETA,
        updatedAt: "2026-11-01T10:05:00.000Z",
      }),
    );

    expect(leiturasDoPedido.total).toBe(2);
    expect(botaoGerar()).toBeUndefined();
    expect(linkAbrir()?.getAttribute("href")).toBe(URL_DA_ETIQUETA);
  });
});
