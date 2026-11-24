// @vitest-environment jsdom
//
// Caça por mutação (24/11/2026), território "parcelamento". O teste vizinho
// (`meu-pedido-parcelado-nao-diz-total-pago.test.tsx`) só provava o parcelado
// com 12x. O limite que decide a frase é 2x: um mutante que trocava
// `(parcelas ?? 0) > 1` por `> 2` sobrevivia, e quem pagou em 2x no crédito
// via "Total pago" (valor que NÃO é o da fatura) sem o aviso de juros.
// Aqui: 2x e 3x são parcelado (mostram "Total do pedido" e o aviso com o
// número certo de parcelas); 1x segue "Total pago".
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { mapOrderFromDB } from "@/lib/mappers";
import type { Order } from "@/types";
import type { Database } from "@/types/database.types";

type OrderRow = Database["public"]["Tables"]["marketplace_orders"]["Row"];
let pedidoAtual: Order;

vi.mock("@/hooks/useOrders", () => ({
  useOrders: () => ({
    orders: [pedidoAtual],
    fetchUserOrders: vi.fn().mockResolvedValue([pedidoAtual]),
    updateOrderStatus: vi.fn(),
  }),
}));
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: { id: "usuario-teste" } }),
}));
vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({ config: { enableReviews: false } }),
}));
vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: () => ({
      select: () => ({
        eq: () => ({ in: () => Promise.resolve({ data: [], error: null }) }),
      }),
    }),
  },
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe("Meu pedido — crédito parcelado começa em 2x", () => {
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

  async function renderizar(parcelas: number) {
    pedidoAtual = mapOrderFromDB({
      id: "pedido-parcelado",
      customer_name: "Cliente Teste",
      customer_data: {},
      total: 112.4,
      subtotal: 100,
      shipping: 19.9,
      discount: 7.5,
      payment_method: "online",
      payment_status: "pago",
      status: "processing",
      metodo_online: "credito",
      parcelas,
      created_at: "2026-11-17T12:00:00Z",
      updated_at: "2026-11-17T12:00:00Z",
    } as OrderRow);
    const { OrderDetailsView } = await import(
      "@/views/customer/OrderDetailsView"
    );
    await act(async () => {
      raiz.render(
        <OrderDetailsView
          orderId="pedido-parcelado"
          onBack={() => {}}
          onNavigate={() => {}}
        />,
      );
    });
    return hospedeiro.textContent ?? "";
  }

  it.each([2, 3])(
    "%ix no crédito mostra Total do pedido e o aviso de juros com o número de parcelas",
    async (parcelas) => {
      const texto = await renderizar(parcelas);
      expect(texto).toContain("Total do pedido");
      expect(texto).not.toContain("Total pago");
      expect(texto).toContain(
        `Parcelado em ${parcelas}x no cartão. Juros do parcelamento, se houver, vêm na fatura.`,
      );
    },
  );

  it("1x no crédito (à vista) segue Total pago, sem aviso de parcelamento", async () => {
    const texto = await renderizar(1);
    expect(texto).toContain("Total pago");
    expect(texto).not.toContain("Total do pedido");
    expect(texto).not.toContain("Parcelado em");
  });
});
