// @vitest-environment jsdom
// D4 (investigação do balcão, 28/09/2026): a LISTA de pedidos do painel usava a
// mesma função da planilha e dizia "Crédito Seguro" para todo cartão. O card
// agora passa o PEDIDO inteiro à fonte única, porque "cartão" quer dizer coisa
// diferente no site (na entrega) e no balcão (na maquininha).
import { AdminOrderCard } from "@/components/admin/orders/AdminOrderCard";
import type { Order } from "@/types";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

function pedido(sobre: Partial<Order>): Order {
  return {
    id: "aaaaaaaa-0000-0000-0000-000000eca2d5",
    customer: { name: "João Gabriel Vieira", whatsapp: "34999999999" },
    items: [
      { productId: "p1", name: "Maleta", price: 99.9, quantity: 1, image: "" },
    ],
    subtotal: 99.9,
    shipping: 0,
    discount: 0,
    total: 99.9,
    paymentMethod: "cash",
    status: "pending",
    paymentStatus: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    cancelledAfterShipping: false,
    pagamentoRecebidoEm: null,
    ...sobre,
  } as Order;
}

describe("AdminOrderCard — forma de pagamento na lista (D4)", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => raiz.unmount());
    hospedeiro.remove();
  });

  function textoDoCard(sobre: Partial<Order>): string {
    act(() => {
      raiz.render(
        <AdminOrderCard
          order={pedido(sobre)}
          viewMode="compact"
          onSelect={vi.fn()}
          onWhatsApp={vi.fn()}
          onRegistrarPagamento={vi.fn()}
          registrandoPagamento={false}
        />,
      );
    });
    return hospedeiro.textContent ?? "";
  }

  it("cartão do balcão diz 'na maquininha'; cartão do site diz 'na entrega'; nenhum é 'Crédito Seguro'", () => {
    const balcao = textoDoCard({ paymentMethod: "card", canal: "presencial" });
    expect(balcao).toContain("Cartão na maquininha");
    expect(balcao).not.toContain("Crédito Seguro");

    const site = textoDoCard({ paymentMethod: "card", canal: "online" });
    expect(site).toContain("Cartão na entrega");
    expect(site).not.toContain("Crédito Seguro");
  });

  it("pago pelo app deixa de aparecer como 'Outro'", () => {
    const texto = textoDoCard({ paymentMethod: "online" });
    expect(texto).toContain("Pagamento pelo site");
    expect(texto).not.toMatch(/\bOutro\b/);
  });
});
