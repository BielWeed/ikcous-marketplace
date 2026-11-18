// @vitest-environment jsdom
//
// O endereço de retirada gravado no pedido é texto da loja e pode ter uma palavra
// longa sem espaço (link, rua com nome enorme). No cartão "Retirada na loja" da
// ficha ele precisa quebrar palavra (`break-words`), senão transborda o cartão.
//
// Molde de montagem: ficha-do-pedido-por-tipo-de-entrega.test.tsx.
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

const ENDERECO_LONGO = `Rua${"Longa".repeat(16)}`; // 83 letras seguidas, sem espaço

function pedidoDeRetirada(): Order {
  return {
    id: "ped-retirada-longa",
    customer: {
      name: "Maria da Silva",
      whatsapp: "34999998888",
      address: "Rua das Flores",
      number: "10",
      neighborhood: "Centro",
      city: "Uberlândia",
      state: "MG",
    },
    items: [],
    subtotal: 100,
    shipping: 0,
    discount: 0,
    total: 100,
    paymentMethod: "cash",
    status: "delivered",
    paymentStatus: "recebido_na_entrega",
    createdAt: "2026-10-08T14:00:00.000Z",
    updatedAt: "2026-10-08T14:00:00.000Z",
    cancelledAfterShipping: false,
    retiradaNaLoja: true,
    enderecoDeRetirada: ENDERECO_LONGO,
    shippingOptionId: "store-pickup",
  };
}

describe("ficha do pedido — endereço de retirada longo quebra linha", () => {
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

  it("a linha 'A cliente busca o pedido em: ...' leva break-words", async () => {
    const { OrderDetail } = await import(
      "@/components/admin/orders/OrderDetail"
    );
    await act(async () => {
      raiz.render(
        <OrderDetail order={pedidoDeRetirada()} onStatusChange={vi.fn()} />,
      );
    });
    const cartao = hospedeiro.querySelector('[aria-label="Retirada na loja"]');
    expect(cartao, "o cartão de retirada existe").not.toBeNull();
    const linha = Array.from(cartao?.querySelectorAll("p") ?? []).find((p) =>
      p.textContent?.includes(ENDERECO_LONGO),
    );
    expect(linha, "o endereço de retirada aparece no cartão").toBeDefined();
    expect(linha?.classList.contains("break-words")).toBe(true);
  });
});
