// @vitest-environment jsdom
//
// A ficha do pedido muda conforme o jeito de entrega: venda de balcão não tem
// endereço, frete nem rastreio; retirada e entrega local não pedem código dos
// Correios; envio fica como sempre. E nunca se esconde um rastreio já gravado.
//
// Molde de montagem: ficha-do-pedido-anular-venda-do-balcao.test.tsx.
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
    id: "ped-tipo-1",
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
    ...parcial,
  };
}

const TIPOS: Record<string, Partial<Order>> = {
  balcao: { canal: "presencial" },
  retirada: {
    retiradaNaLoja: true,
    enderecoDeRetirada: "Av. da Loja, 1",
    shippingOptionId: "store-pickup",
  },
  "entrega-local": { shippingOptionId: "local-delivery" },
  envio: { shippingOptionId: "pac" },
};

describe("ficha do pedido por tipo de entrega", () => {
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

  async function renderizar(order: Order) {
    const { OrderDetail } = await import(
      "@/components/admin/orders/OrderDetail"
    );
    await act(async () => {
      raiz.render(<OrderDetail order={order} onStatusChange={vi.fn()} />);
    });
  }

  const entrega = () =>
    hospedeiro.querySelector('[data-testid="bloco-entrega"]') as HTMLElement;
  const itens = () =>
    hospedeiro.querySelector('[data-testid="bloco-itens"]') as HTMLElement;
  const envio = () =>
    hospedeiro.querySelector('[data-testid="envio-lista"]') as HTMLElement;

  it("balcão: cartão Cliente só com nome e WhatsApp; sem endereço, Maps, frete e rastreio", async () => {
    await renderizar(pedido(TIPOS.balcao));
    expect(entrega().textContent).toContain("Cliente");
    expect(entrega().textContent).not.toContain("Entrega");
    expect(entrega().textContent).toContain("Maria da Silva");
    expect(entrega().textContent).toContain("34999998888");
    expect(
      entrega().querySelector('[aria-label="Conversar no WhatsApp"]'),
    ).not.toBeNull();
    for (const t of ["Rua das Flores", "Copiar endereço", "Ver no Maps"]) {
      expect(entrega().textContent).not.toContain(t);
    }
    expect(
      entrega().querySelector('[data-testid="forma-de-entrega"]'),
    ).toBeNull();
    expect(itens().textContent).not.toContain("Frete");
    expect(itens().textContent).toContain("Subtotal");
    expect(itens().textContent).toContain("Total");
    expect(envio().textContent).not.toContain("Código de rastreio");
  });

  it("balcão com rastreio já gravado: a linha continua visível", async () => {
    await renderizar(
      pedido({ ...TIPOS.balcao, trackingCode: "AA123456789BR" }),
    );
    expect(envio().textContent).toContain("Código de rastreio");
    expect(envio().textContent).toContain("AA123456789BR");
  });

  it("retirada: mantém o cartão de entrega e o frete; esconde só o rastreio", async () => {
    await renderizar(pedido(TIPOS.retirada));
    expect(entrega().textContent).toContain("Entrega");
    expect(entrega().textContent).toContain("Retirada na loja");
    expect(entrega().textContent).toContain("Copiar endereço");
    expect(itens().textContent).toContain("Frete");
    expect(envio().textContent).not.toContain("Código de rastreio");
  });

  it("retirada com rastreio já gravado: a linha continua visível", async () => {
    await renderizar(pedido({ ...TIPOS.retirada, trackingCode: "BB1BR" }));
    expect(envio().textContent).toContain("BB1BR");
  });

  it("entrega local: mantém endereço, Maps e frete; esconde só o rastreio", async () => {
    await renderizar(pedido(TIPOS["entrega-local"]));
    expect(entrega().textContent).toContain("Rua das Flores");
    expect(entrega().textContent).toContain("Copiar endereço");
    expect(entrega().textContent).toContain("Ver no Maps");
    expect(itens().textContent).toContain("Frete");
    expect(envio().textContent).not.toContain("Código de rastreio");
  });

  it("entrega local com rastreio já gravado: a linha continua visível", async () => {
    await renderizar(
      pedido({ ...TIPOS["entrega-local"], trackingCode: "CC1BR" }),
    );
    expect(envio().textContent).toContain("CC1BR");
  });

  it("envio: nada muda — endereço, frete e linha de rastreio com Adicionar", async () => {
    await renderizar(pedido(TIPOS.envio));
    expect(entrega().textContent).toContain("Entrega");
    expect(entrega().textContent).toContain("Rua das Flores");
    expect(entrega().textContent).toContain("Ver no Maps");
    expect(itens().textContent).toContain("Frete");
    expect(envio().textContent).toContain("Código de rastreio");
    expect(envio().textContent).toContain("Adicionar");
  });
});
