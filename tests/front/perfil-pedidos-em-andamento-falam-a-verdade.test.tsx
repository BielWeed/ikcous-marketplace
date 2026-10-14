// @vitest-environment jsdom
//
// Defeito da cliente (14/10/2026): o cartão "Pedidos em Andamento" do Perfil
// listava todo pedido `pending` e só desenhava a linha do tempo.
//   1. PIX/cartão ainda NÃO pago aparecia como um pedido "Recebido" normal
//      (e em 30 minutos a reserva vence e o pedido é cancelado) — sem o selo
//      de pagamento e sem o atalho "Retomar pagamento" que o detalhe já tem.
//   2. Pedido de RETIRADA já liberado (`shipping`) aparecia como "Em rota",
//      enquanto a lista e o detalhe diziam "Pronto para retirar".
//
// RENDER DE VERDADE da tela, do selo e da linha do tempo; só os hooks de
// dados e a lista de endereços são dublês.
import type { Order, PaymentMethod, PaymentStatus } from "@/types";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { podeRetomarPagamento } from "@/lib/pode-retomar-pagamento";

let pedidosAtuais: Order[] = [];

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({
    user: { id: "user-1", email: "cliente@ikcous.com", user_metadata: {} },
    profile: { full_name: "Cliente", avatar_url: null, cover_url: null },
    logout: vi.fn(),
    isAdmin: false,
    loading: false,
    updateProfile: async () => true,
  }),
}));

vi.mock("@/hooks/useAddresses", () => ({
  useAddresses: () => ({
    addresses: [],
    fetchAddresses: async () => {},
    deleteAddress: async () => true,
    loading: false,
  }),
}));

vi.mock("@/hooks/useOrders", () => ({
  useOrders: () => ({
    orders: pedidosAtuais,
    fetchUserOrders: async () => pedidosAtuais,
  }),
}));

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    config: {
      storeName: "IKCOUS - imports",
      businessHours: "Seg-Sex: 8h as 19h",
      whatsappNumber: "34999999999",
    },
  }),
}));

vi.mock("@/components/ui/custom/AddressList", () => ({
  AddressList: () => <div data-testid="address-list-stub" />,
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

class ObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
vi.stubGlobal("ResizeObserver", ObserverStub);
vi.stubGlobal("IntersectionObserver", ObserverStub);

function pedido(parcial: Partial<Order>): Order {
  return {
    id: "pedido-do-perfil-0001",
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
    shipping: 0,
    discount: 0,
    total: 100,
    paymentMethod: "online",
    status: "pending",
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
    cancelledAfterShipping: false,
    ...parcial,
  };
}

describe("podeRetomarPagamento — a regra única do botão de voltar a pagar", () => {
  const casos: Array<{
    status: string;
    pagamento: PaymentStatus | null | undefined;
    logado: boolean;
    esperado: boolean;
  }> = [
    {
      status: "pending",
      pagamento: "aguardando",
      logado: true,
      esperado: true,
    },
    { status: "pending", pagamento: "recusado", logado: true, esperado: true },
    // convidado não paga online
    {
      status: "pending",
      pagamento: "aguardando",
      logado: false,
      esperado: false,
    },
    { status: "pending", pagamento: null, logado: true, esperado: false },
    { status: "pending", pagamento: undefined, logado: true, esperado: false },
    { status: "pending", pagamento: "pago", logado: true, esperado: false },
    { status: "pending", pagamento: "expirado", logado: true, esperado: false },
    {
      status: "pending",
      pagamento: "estornado",
      logado: true,
      esperado: false,
    },
    {
      status: "processing",
      pagamento: "aguardando",
      logado: true,
      esperado: false,
    },
    {
      status: "cancelled",
      pagamento: "aguardando",
      logado: true,
      esperado: false,
    },
  ];

  it.each(casos)(
    "$status × $pagamento × logado=$logado → $esperado",
    ({ status, pagamento, logado, esperado }) => {
      expect(
        podeRetomarPagamento({ status, paymentStatus: pagamento, logado }),
      ).toBe(esperado);
    },
  );
});

describe("ProfileView — cartão Pedidos em Andamento fala a verdade", () => {
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

  async function renderizar(
    pedidos: Order[],
    onRetomarPagamento?: (id: string) => void,
  ) {
    pedidosAtuais = pedidos;
    const { ProfileView } = await import("@/views/customer/ProfileView");
    await act(async () => {
      raiz.render(
        <ProfileView
          onNavigate={() => {}}
          onRetomarPagamento={onRetomarPagamento}
        />,
      );
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
  }

  function botaoRetomar(): HTMLButtonElement | undefined {
    return [...hospedeiro.querySelectorAll("button")].find((b) =>
      b.textContent?.includes("Retomar pagamento"),
    );
  }

  function selo(): string | null {
    return (
      hospedeiro.querySelector('[data-testid="customer-payment-badge"]')
        ?.textContent ?? null
    );
  }

  it("PIX ainda não pago: mostra o selo 'Aguardando pagamento' e o atalho que leva ao pagamento", async () => {
    const onRetomar = vi.fn();
    await renderizar(
      [pedido({ id: "ped-pix-aberto", paymentStatus: "aguardando" })],
      onRetomar,
    );

    expect(selo()).toBe("Aguardando pagamento");
    const botao = botaoRetomar();
    expect(botao).toBeDefined();

    await act(async () => {
      botao?.click();
    });
    expect(onRetomar).toHaveBeenCalledTimes(1);
    expect(onRetomar).toHaveBeenCalledWith("ped-pix-aberto");
  });

  it("pagamento recusado: mostra o selo e ainda oferece tentar de novo", async () => {
    await renderizar([pedido({ paymentStatus: "recusado" })], vi.fn());

    expect(selo()).toBe("Pagamento recusado");
    expect(botaoRetomar()).toBeDefined();
  });

  it("pedido já pago: selo de confirmado e nenhum atalho de pagar", async () => {
    await renderizar([pedido({ paymentStatus: "pago" })], vi.fn());

    expect(selo()).toBe("Pagamento confirmado");
    expect(botaoRetomar()).toBeUndefined();
  });

  it("pedido para pagar na entrega (sem cobrança online): sem selo e sem atalho", async () => {
    await renderizar(
      [pedido({ paymentMethod: "cash", paymentStatus: null })],
      vi.fn(),
    );

    expect(selo()).toBeNull();
    expect(botaoRetomar()).toBeUndefined();
  });

  it("sem a porta de retomada (prop ausente) o atalho não aparece, mesmo com PIX aberto", async () => {
    await renderizar([pedido({ paymentStatus: "aguardando" })]);

    expect(selo()).toBe("Aguardando pagamento");
    expect(botaoRetomar()).toBeUndefined();
  });

  const formas: PaymentMethod[] = ["cash", "card", "pix"];
  it.each(formas)(
    "retirada liberada (%s): a linha do tempo diz 'Pronto para retirar', não 'Em rota'",
    async (forma) => {
      await renderizar([
        pedido({
          status: "shipping",
          paymentMethod: forma,
          paymentStatus: null,
          retiradaNaLoja: true,
        }),
      ]);

      const lista = hospedeiro.querySelector("ol");
      expect(lista?.textContent).toContain("Pronto para retirar");
      expect(lista?.textContent).not.toContain("Em rota");
    },
  );

  it("entrega a caminho: continua 'Em rota' (controle — só a retirada muda)", async () => {
    await renderizar([
      pedido({
        status: "shipping",
        paymentMethod: "cash",
        paymentStatus: null,
        retiradaNaLoja: false,
      }),
    ]);

    const lista = hospedeiro.querySelector("ol");
    expect(lista?.textContent).toContain("Em rota");
    expect(lista?.textContent).not.toContain("Pronto para retirar");
  });
});
