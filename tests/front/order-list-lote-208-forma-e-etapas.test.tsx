// @vitest-environment jsdom
//
// Lote 208 (caça 8) — "Meus pedidos":
//  (item 5)  a mesma etapa tem o mesmo nome na lista e na linha do tempo do
//            Perfil: Recebido / Separado / A caminho / Entregue;
//  (item 6)  a forma de pagamento usa a MESMA frase da ficha do pedido, e um
//            método que a tela não conhece nunca vira "PIX";
//  (item 10) pedido sem itens mostra "Pedido", nunca "N/A".
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Order, View } from "@/types";

vi.mock("@/utils/haptic", () => ({
  haptic: { light: vi.fn(), medium: vi.fn(), success: vi.fn() },
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/copiar-para-clipboard", () => ({
  copiarParaClipboard: vi.fn().mockResolvedValue(true),
}));

const pedidoBase = {
  id: "11111111-2222-3333-4444-555555555555",
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
  status: "processing",
  createdAt: new Date(0).toISOString(),
  updatedAt: new Date(0).toISOString(),
  cancelledAfterShipping: false,
} as unknown as Order;

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe("OrderList — forma de pagamento, etapas e pedido sem itens (lote 208)", () => {
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

  async function renderizar(pedido: Order) {
    const { OrderList } = await import("@/components/ui/custom/OrderList");
    await act(async () => {
      raiz.render(
        <OrderList
          orders={[pedido]}
          onNavigate={vi.fn<(view: View, id?: string) => void>()}
        />,
      );
    });
    return hospedeiro.textContent ?? "";
  }

  it("método desconhecido NÃO vira 'PIX'", async () => {
    const texto = await renderizar({
      ...pedidoBase,
      paymentMethod: "boleto-misterioso",
    } as unknown as Order);
    expect(texto).not.toContain("PIX");
    expect(texto).toContain("Outro");
  });

  it("cartão e pagamento pelo site usam as frases da ficha", async () => {
    expect(
      await renderizar({ ...pedidoBase, paymentMethod: "card" } as Order),
    ).toContain("Cartão na entrega");
    act(() => {
      raiz.unmount();
    });
    raiz = createRoot(hospedeiro);
    expect(
      await renderizar({ ...pedidoBase, paymentMethod: "online" } as Order),
    ).toContain("Pagamento pelo site");
  });

  it("a trilha chama a etapa de 'Separado' (nome da ficha), não 'Separação'", async () => {
    const texto = await renderizar(pedidoBase);
    expect(texto).toContain("Separado");
    expect(texto).not.toContain("Separação");
  });

  it("pedido sem itens mostra 'Pedido', nunca 'N/A'", async () => {
    const texto = await renderizar({ ...pedidoBase, items: [] } as Order);
    expect(texto).not.toContain("N/A");
    expect(hospedeiro.querySelector("h4")?.textContent).toBe("Pedido");
  });
});

describe("OrderTimeline — mesmos nomes de etapa da ficha (lote 208)", () => {
  it("diz Recebido / Separado / A caminho / Entregue (e não 'Preparando' / 'Em rota')", async () => {
    const { OrderTimeline } = await import(
      "@/components/ui/custom/OrderTimeline"
    );
    const host = document.createElement("div");
    document.body.appendChild(host);
    const r = createRoot(host);
    await act(async () => {
      r.render(<OrderTimeline status="processing" compacto />);
    });
    const texto = host.textContent ?? "";
    for (const etapa of ["Recebido", "Separado", "A caminho", "Entregue"]) {
      expect(texto).toContain(etapa);
    }
    expect(texto).not.toContain("Preparando");
    expect(texto).not.toContain("Em rota");
    act(() => {
      r.unmount();
    });
    host.remove();
  });
});
