// @vitest-environment jsdom
//
// A data da compra na lista e nos detalhes do pedido do cliente é a do
// calendário da LOJA (America/Sao_Paulo), qualquer que seja o fuso do aparelho.
// Antes ela saía no fuso do aparelho: uma compra de 12/11 às 22h30 de Brasília
// (01h30 UTC de 13/11) aparecia como 13/11 para quem estava em UTC. O formato
// de saída não muda ("12/11/2026" na lista, "12 de nov. de 2026" nos detalhes).
// O fuso do processo é trocado por `process.env.TZ` (o Node relê na hora) e
// volta ao que era depois de cada teste.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { dataNoFusoDaLoja } from "@/lib/data-da-loja";
import type { Order } from "@/types";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("@/utils/haptic", () => ({
  haptic: { light: vi.fn(), medium: vi.fn(), success: vi.fn() },
}));
vi.mock("@/lib/supabase", () => ({
  supabase: {
    rpc: () => Promise.resolve({ data: null, error: null }),
    from: () => ({
      select: () => ({
        eq: () => ({
          in: () => Promise.resolve({ data: [], error: null }),
          order: () => Promise.resolve({ data: [], error: null }),
        }),
      }),
    }),
  },
}));
const { pedidosDoHook } = vi.hoisted(() => ({
  pedidosDoHook: { lista: [] as unknown[] },
}));
vi.mock("@/hooks/useOrders", () => ({
  ErroCancelamentoNaoConcluido: class extends Error {},
  useOrders: () => ({
    orders: pedidosDoHook.lista,
    ordersLoadError: null,
    fetchUserOrders: () => Promise.resolve(pedidosDoHook.lista),
    updateOrderStatus: vi.fn(),
    reenviarComprovante: vi.fn(),
  }),
}));
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: { id: "u-1" }, loading: false }),
}));
vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    config: { enableReviews: false, storeAddress: "Rua A, 10" },
  }),
}));

// 12/11/2026 às 22h30 em Brasília = 13/11/2026 às 01h30 UTC.
const COMPRA_22H30_BRT = "2026-11-13T01:30:00Z";
const ID = "11111111-2222-3333-4444-555555555555";
const pedido: Order = {
  id: ID,
  customer: { name: "Cliente Teste", whatsapp: "34999999999" },
  items: [
    {
      productId: "p-1",
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
  paymentMethod: "pix",
  status: "shipping",
  createdAt: COMPRA_22H30_BRT,
  updatedAt: COMPRA_22H30_BRT,
  cancelledAfterShipping: false,
};

const fusoDaMaquina =
  process.env.TZ ?? new Intl.DateTimeFormat().resolvedOptions().timeZone;

let raiz: Root;
let hospedeiro: HTMLDivElement;

beforeEach(() => {
  pedidosDoHook.lista = [pedido];
  hospedeiro = document.createElement("div");
  document.body.appendChild(hospedeiro);
  raiz = createRoot(hospedeiro);
});

afterEach(() => {
  act(() => raiz.unmount());
  hospedeiro.remove();
  process.env.TZ = fusoDaMaquina;
});

const texto = () => hospedeiro.textContent ?? "";

describe("data da compra no calendário da loja", () => {
  it("o helper usa o dia de Brasília em qualquer fuso do aparelho, sem mudar o formato", () => {
    const quando = new Date(COMPRA_22H30_BRT);
    for (const fuso of ["UTC", "America/Sao_Paulo", "Asia/Tokyo"]) {
      process.env.TZ = fuso;
      expect(dataNoFusoDaLoja(quando)).toBe("12/11/2026");
      expect(
        dataNoFusoDaLoja(quando, {
          day: "numeric",
          month: "short",
          year: "numeric",
        }),
      ).toBe("12 de nov. de 2026");
    }
  });

  it("LIMITE: data inválida não quebra a tela (mesmo texto do JavaScript puro)", () => {
    expect(dataNoFusoDaLoja(new Date("lixo"))).toBe("Invalid Date");
  });

  it("a lista de pedidos mostra 12/11/2026 num aparelho em UTC", async () => {
    process.env.TZ = "UTC";
    const { OrderList } = await import("@/components/ui/custom/OrderList");
    await act(async () => {
      raiz.render(<OrderList orders={[pedido]} onNavigate={() => {}} />);
    });

    expect(texto()).toContain("Blusa Teste");
    expect(texto()).toContain("12/11/2026");
    expect(texto()).not.toContain("13/11/2026");
  });

  it("os detalhes do pedido mostram 12 de nov. de 2026 num aparelho em UTC", async () => {
    process.env.TZ = "UTC";
    const { OrderDetailsView } = await import(
      "@/views/customer/OrderDetailsView"
    );
    await act(async () => {
      raiz.render(
        <OrderDetailsView
          orderId={ID}
          onBack={() => {}}
          onNavigate={() => {}}
        />,
      );
    });
    for (let i = 0; i < 5; i++) {
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
    }

    expect(texto()).toContain("12 de nov. de 2026");
    expect(texto()).not.toContain("13 de nov. de 2026");
  });
});
