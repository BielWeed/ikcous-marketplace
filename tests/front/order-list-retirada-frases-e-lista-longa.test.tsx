// @vitest-environment jsdom
//
// Caça 02/11, achados b15 e b11 em "Meus Pedidos" (OrderList).
//
// b15: só a retirada em `shipping` tinha frase própria. Retirada já retirada
// (`delivered`) dizia "Pedido entregue" (a ficha do mesmo pedido diz
// "Retirado") e retirada em separação (`processing`) dizia "Preparando seu
// envio", sendo que ninguém vai enviar nada.
//
// b11: a lista com histórico longo pedia todas as miniaturas de uma vez e dava a
// cada cartão uma animação com atraso de idx*0,05 s (o 60º só entrava depois de
// 3 s). A miniatura passa a ser preguiçosa e o atraso tem teto.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Order, OrderStatus } from "@/types";

vi.mock("@/utils/haptic", () => ({
  haptic: { light: vi.fn(), medium: vi.fn(), success: vi.fn() },
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock("@/lib/copiar-para-clipboard", () => ({
  copiarParaClipboard: vi.fn().mockResolvedValue(true),
}));

// O atraso da animação só se vê no `transition` que o cartão entrega ao motion.
vi.mock("framer-motion", async () => {
  const React = await import("react");
  return {
    motion: {
      div: ({
        transition,
        children,
        className,
      }: {
        transition?: { delay?: number };
        children?: React.ReactNode;
        className?: string;
      }) =>
        React.createElement(
          "div",
          { "data-atraso": String(transition?.delay ?? 0), className },
          children,
        ),
    },
  };
});

const pedidoBase: Order = {
  id: "11111111-2222-3333-4444-555555555555",
  customer: { name: "Cliente Teste", whatsapp: "34999999999" },
  items: [
    {
      productId: "prod-1",
      name: "Blusa Teste",
      price: 100,
      quantity: 1,
      image: "https://exemplo.test/foto.jpg",
    },
  ],
  subtotal: 100,
  shipping: 0,
  discount: 0,
  total: 100,
  paymentMethod: "pix",
  status: "pending",
  createdAt: new Date(0).toISOString(),
  updatedAt: new Date(0).toISOString(),
  cancelledAfterShipping: false,
};

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe("OrderList — retirada na loja e lista longa", () => {
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

  async function renderizar(pedidos: Order[]) {
    const { OrderList } = await import("@/components/ui/custom/OrderList");
    await act(async () => {
      raiz.render(<OrderList orders={pedidos} onNavigate={() => {}} />);
    });
    return hospedeiro.textContent ?? "";
  }

  const pedido = (status: OrderStatus, retiradaNaLoja: boolean): Order => ({
    ...pedidoBase,
    status,
    retiradaNaLoja,
  });

  it("retirada já retirada: 'Pedido retirado na loja', nunca 'Pedido entregue'", async () => {
    const texto = await renderizar([pedido("delivered", true)]);
    expect(texto).toContain("Pedido retirado na loja");
    expect(texto).not.toContain("Pedido entregue");
  });

  it("retirada em separação: 'Separando seu pedido', nunca 'envio'", async () => {
    const texto = await renderizar([pedido("processing", true)]);
    expect(texto).toContain("Separando seu pedido");
    expect(texto).not.toContain("Preparando seu envio");
  });

  it("retirada pronta: 'Venha retirar na loja' (como antes)", async () => {
    const texto = await renderizar([pedido("shipping", true)]);
    expect(texto).toContain("Venha retirar na loja");
  });

  it("entrega comum: as frases de sempre (controle)", async () => {
    expect(await renderizar([pedido("delivered", false)])).toContain(
      "Pedido entregue",
    );
    expect(await renderizar([pedido("processing", false)])).toContain(
      "Preparando seu envio",
    );
  });

  it("lista longa: toda miniatura é preguiçosa e assíncrona", async () => {
    const muitos = Array.from({ length: 20 }, (_, i) => ({
      ...pedido("delivered", false),
      id: `00000000-0000-0000-0000-${String(i).padStart(12, "0")}`,
    }));
    await renderizar(muitos);
    const imagens = Array.from(hospedeiro.querySelectorAll("img"));
    expect(imagens).toHaveLength(20);
    for (const img of imagens) {
      expect(img.getAttribute("loading")).toBe("lazy");
      expect(img.getAttribute("decoding")).toBe("async");
    }
  });

  it("lista longa: o atraso da animação tem teto (0,4 s), não cresce com a posição", async () => {
    const muitos = Array.from({ length: 20 }, (_, i) => ({
      ...pedido("delivered", false),
      id: `00000000-0000-0000-0000-${String(i).padStart(12, "0")}`,
    }));
    await renderizar(muitos);
    const atrasos = Array.from(
      hospedeiro.querySelectorAll("[data-atraso]"),
    ).map((el) => Number(el.getAttribute("data-atraso")));
    expect(atrasos).toHaveLength(20);
    expect(atrasos[0]).toBe(0);
    expect(atrasos[8]).toBeCloseTo(0.4, 5);
    expect(Math.max(...atrasos)).toBeCloseTo(0.4, 5);
  });
});
