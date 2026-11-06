// @vitest-environment jsdom
//
// Pedido CANCELADO (inclui a venda do balcão anulada) não sai no papel como se
// fosse um recibo normal (04/11/2026). O recibo de papel (`OrderReceipt`) fica
// montado e escondido na ficha e aparece no Ctrl+P / menu do navegador; ele não
// lê `order.status`, então um pedido cancelado saía com "Pedido #…", itens,
// "TOTAL" e "Obrigado pela preferência!", sem marca nenhuma de cancelado, e a
// cliente podia levar para casa um comprovante que não vale mais.
//
// Menor desvio: o botão Imprimir fica desligado com o motivo escrito ao lado
// (mesmo mecanismo `motivoDeNaoImprimir` do tamanho e cor) E o recibo de papel
// nem é montado, para o Ctrl+P não o trazer de volta. Pedido não cancelado
// segue como sempre (controle).
//
// Molde: ficha-do-pedido-imprimir-no-cabecalho.test.tsx.
import type { Order } from "@/types";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase", () => ({
  supabase: {
    rpc: vi.fn(),
    from: vi.fn(),
    functions: { invoke: vi.fn() },
    channel: vi.fn(),
    removeChannel: vi.fn(),
  },
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function pedido(parcial: Partial<Order> = {}): Order {
  return {
    id: "8acf17aa-0000-0000-0000-000000000000",
    customer: { name: "Maria", whatsapp: "34999998888", address: "Rua A" },
    items: [],
    subtotal: 100,
    shipping: 0,
    discount: 0,
    total: 100,
    paymentMethod: "cash",
    status: "pending",
    paymentStatus: "recebido_na_entrega",
    createdAt: "2026-10-08T14:00:00.000Z",
    updatedAt: "2026-10-08T14:00:00.000Z",
    cancelledAfterShipping: false,
    ...parcial,
  };
}

describe("ficha do pedido — cancelado não imprime recibo", () => {
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
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  async function renderizar(order: Order) {
    const { OrderDetail } = await import(
      "@/components/admin/orders/OrderDetail"
    );
    await act(async () => {
      raiz.render(<OrderDetail order={order} onStatusChange={vi.fn()} />);
    });
  }

  const imprimir = () =>
    hospedeiro.querySelector(
      'button[title="Imprimir Pedido"]',
    ) as HTMLButtonElement | null;
  const papel = () => document.querySelector("[data-tema-fixo]");

  it("cancelado: botão desligado, motivo escrito e nenhum recibo de papel montado", async () => {
    const print = vi.fn();
    vi.stubGlobal("print", print);
    await renderizar(pedido({ status: "cancelled" }));
    const botao = imprimir();
    expect(botao?.disabled).toBe(true);
    const motivo = hospedeiro.querySelector("#motivo-de-nao-imprimir");
    expect(motivo?.textContent).toContain("cancelado");
    expect(botao?.getAttribute("aria-describedby")).toBe(
      "motivo-de-nao-imprimir",
    );
    expect(papel()).toBeNull();
    expect(hospedeiro.textContent).not.toContain("Obrigado pela preferência!");
    await act(async () => {
      botao?.click();
    });
    expect(print).not.toHaveBeenCalled();
  });

  it("venda do balcão ANULADA (canal presencial, cancelled): o mesmo", async () => {
    await renderizar(
      pedido({
        status: "cancelled",
        canal: "presencial",
        paymentStatus: null,
      }),
    );
    expect(imprimir()?.disabled).toBe(true);
    expect(papel()).toBeNull();
  });

  it("cancelado e pago: continua sem recibo (o dinheiro não muda o papel)", async () => {
    await renderizar(pedido({ status: "cancelled", paymentStatus: "pago" }));
    expect(imprimir()?.disabled).toBe(true);
    expect(papel()).toBeNull();
  });

  it("pedido entregue (controle): imprime como sempre, com o recibo montado", async () => {
    await renderizar(pedido({ status: "delivered" }));
    expect(imprimir()?.disabled).toBe(false);
    expect(hospedeiro.querySelector("#motivo-de-nao-imprimir")).toBeNull();
    expect(papel()).not.toBeNull();
  });

  it("pedido em andamento (controle): imprime como sempre", async () => {
    await renderizar(pedido({ status: "processing" }));
    expect(imprimir()?.disabled).toBe(false);
    expect(papel()).not.toBeNull();
  });
});
