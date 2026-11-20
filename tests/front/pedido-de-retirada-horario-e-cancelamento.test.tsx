// @vitest-environment jsdom
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Order, PaymentStatus } from "@/types";

const { estado, usuario } = vi.hoisted(() => ({
  estado: {
    pedido: null as unknown as Order,
    horario: "" as string | undefined,
  },
  usuario: { id: "user-1" },
}));
vi.mock("@/hooks/useOrders", () => ({
  useOrders: () => ({
    orders: [estado.pedido],
    fetchUserOrders: vi.fn().mockResolvedValue([estado.pedido]),
    updateOrderStatus: vi.fn(),
  }),
}));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: usuario }) }));
vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    config: { enableReviews: false, businessHours: estado.horario },
  }),
}));
vi.mock("@/lib/supabase", () => ({
  supabase: {
    rpc: vi.fn().mockResolvedValue({ data: [], error: null }),
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
// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe("retirada — horário e aviso de cancelamento", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    estado.horario = "Segunda a sexta, 9h às 18h";
    estado.pedido = {
      id: "pedido-retirada",
      customer: { name: "Cliente Teste", whatsapp: "34999999999" },
      items: [],
      subtotal: 100,
      shipping: 0,
      discount: 0,
      total: 100,
      paymentMethod: "cash",
      paymentStatus: null,
      status: "shipping",
      cancelledAfterShipping: false,
      retiradaNaLoja: true,
      enderecoDeRetirada: "Rua Fictícia, 100",
      createdAt: new Date(0).toISOString(),
      updatedAt: new Date(0).toISOString(),
    };
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });
  afterEach(() => {
    act(() => raiz.unmount());
    hospedeiro.remove();
  });

  async function renderizar() {
    const { OrderDetailsView } = await import(
      "@/views/customer/OrderDetailsView"
    );
    await act(async () => {
      raiz.render(
        <OrderDetailsView
          orderId="pedido-retirada"
          onBack={() => {}}
          onNavigate={() => {}}
        />,
      );
    });
    return hospedeiro.textContent ?? "";
  }

  it("retirada cancelada com pagamento aberto orienta a não pagar sem falar em entrega", async () => {
    estado.pedido = {
      ...estado.pedido,
      status: "cancelled",
      paymentMethod: "online",
      paymentStatus: "aguardando",
    };

    const texto = await renderizar();
    expect(texto).toContain(
      "Este pedido foi cancelado. Se o pagamento ainda estiver aberto no seu banco, não pague.",
    );
    expect(texto).not.toContain("não será entregue");
  });

  it("retirada cancelada mantém o endereço como registro, sem mandar retirar", async () => {
    estado.pedido.status = "cancelled";

    const texto = await renderizar();

    expect(texto).toContain("Local de retirada original: Rua Fictícia, 100");
    expect(texto).not.toContain("Retire em:");
  });

  it("mostra o horário junto do endereço quando já pode retirar", async () => {
    const texto = await renderizar();
    expect(texto).not.toContain("Local de retirada original:");
    const endereco = [...hospedeiro.querySelectorAll("p")].find(
      (p) => p.textContent === "Retire em: Rua Fictícia, 100",
    );
    expect(endereco?.parentElement?.textContent).toContain(
      "Horário: Segunda a sexta, 9h às 18h",
    );
  });

  it.each([undefined, "", "   "])(
    "sem horário (%s), pede para confirmar antes de ir",
    async (horario) => {
      estado.horario = horario;
      const texto = await renderizar();
      expect(texto).toContain(
        "Confirme o horário de retirada com a loja antes de vir.",
      );
      expect(texto).not.toContain("Horário:");
    },
  );

  it("não anuncia horário de retirada para entrega", async () => {
    estado.pedido.retiradaNaLoja = false;
    expect(await renderizar()).not.toContain("Horário:");
  });

  // O horário só vale enquanto o pedido está pronto para retirar ("shipping"):
  // separando o pedido ainda não há o que retirar, e depois de entregue não há
  // mais o que anunciar. A loja tem horário preenchido nos dois casos.
  it.each(["processing", "delivered"] as const)(
    "retirada com pedido %s não anuncia o horário",
    async (status) => {
      estado.pedido.status = status;
      expect(await renderizar()).not.toContain("Horário:");
    },
  );

  it.each([null, "recusado"] as const)(
    "retirada cancelada sem pagamento (%s) não fala em entrega",
    async (pagamento: PaymentStatus | null) => {
      estado.pedido.status = "cancelled";
      estado.pedido.paymentStatus = pagamento;
      const texto = await renderizar();
      expect(texto).toContain(
        "Este pedido foi cancelado e não seguirá para retirada.",
      );
      expect(texto).not.toContain("não seguirá para entrega");
    },
  );

  it("entrega cancelada conserva o aviso de entrega", async () => {
    estado.pedido.status = "cancelled";
    estado.pedido.retiradaNaLoja = false;
    expect(await renderizar()).toContain(
      "Este pedido foi cancelado e não seguirá para entrega.",
    );
  });
});
