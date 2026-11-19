// @vitest-environment jsdom
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

describe("Meu pedido — total sem prometer o valor da fatura", () => {
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

  async function renderizar(
    metodo: string | null,
    parcelas: number | null | undefined,
    paymentMethod = "online",
    paymentStatus = "pago",
    status = "processing",
  ) {
    // Passa pelo mapper real: o teste também prende o caminho banco → tela.
    pedidoAtual = mapOrderFromDB({
      id: "pedido-parcelado",
      customer_name: "Cliente Teste",
      customer_data: {},
      total: 112.4,
      subtotal: 100,
      shipping: 19.9,
      discount: 7.5,
      payment_method: paymentMethod,
      payment_status: paymentStatus,
      status,
      metodo_online: metodo,
      ...(parcelas !== undefined ? { parcelas } : {}),
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

  it("12x no crédito mostra o total do pedido e explica os juros da fatura", async () => {
    const texto = await renderizar("credito", 12);
    expect(texto).toContain("Total do pedido");
    const rotulo = Array.from(hospedeiro.querySelectorAll("span")).find(
      (span) => span.textContent === "Total do pedido",
    );
    const textoDoValor = rotulo?.nextElementSibling?.textContent;
    const valor = textoDoValor?.replaceAll(" ", " ");
    expect(valor).toBe("R$ 112,40");
    expect(texto).toContain(
      "Parcelado em 12x no cartão. Juros do parcelamento, se houver, vêm na fatura.",
    );
    expect(texto).not.toContain("Total pago");
  });

  it.each([
    ["crédito à vista", "credito", 1, "online"],
    ["PIX", "pix", 12, "pix"],
    ["débito", "debito", 2, "online"],
    ["parcelas ausentes", "credito", undefined, "online"],
    ["parcelas nulas", "credito", null, "online"],
    ["método desconhecido", null, 2, "online"],
  ])(
    "%s mantém Total pago, sem frase de parcelamento",
    async (_, metodo, parcelas, forma) => {
      const texto = await renderizar(metodo, parcelas, forma);
      expect(texto).toContain("Total pago");
      expect(texto).not.toContain("Total do pedido");
      expect(texto).not.toContain("Parcelado em");
    },
  );

  it.each([
    ["aguardando", "pending"],
    ["pago", "cancelled"],
  ])("preserva Total quando %s e %s", async (pagamento, status) => {
    const texto = await renderizar("credito", 12, "online", pagamento, status);
    expect(texto).not.toContain("Total pago");
    expect(texto).not.toContain("Total do pedido");
    expect(texto).not.toContain("Parcelado em");
  });
});
