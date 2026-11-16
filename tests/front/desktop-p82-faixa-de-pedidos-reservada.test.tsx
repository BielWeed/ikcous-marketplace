// @vitest-environment jsdom
//
// P82 (B), parte da tela: no computador, "Meus pedidos" mostra a faixa "Em
// andamento / Histórico" (44 px + 16 px de respiro) só depois que a lista
// chega. Enquanto o esqueleto aparece ela não existe, e o invólucro da lista
// descia 60 px quando ela entrava (o nó que o navegador contou no deslocamento
// de layout). A reserva é um espaço vazio ACIMA do invólucro: sem altura no
// celular (só `lg:`), escondido do leitor de tela, e só enquanto a lista
// carrega sem nenhum pedido.
//
// Harness copiado de cart-view-lote-208-pedidos-e-frete.test.tsx.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { classesDoCelular } from "./classes-do-celular";

const { duble } = vi.hoisted(() => ({
  duble: {
    usuario: null as null | { id: string },
    pedidosDaVez: [] as any[],
    segurarBusca: false,
  },
}));

vi.mock("@/hooks/useOrders", async () => {
  const { useState } = await import("react");
  return {
    useOrders: () => {
      const [orders] = useState(duble.pedidosDaVez);
      const [fetchUserOrders] = useState(() => () => {
        if (!duble.segurarBusca) return Promise.resolve([] as any[]);
        return new Promise<any[]>(() => {});
      });
      return { orders, ordersLoadError: null, fetchUserOrders };
    },
  };
});
vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({ config: { shippingFee: 10, freeShippingMin: 0 } }),
}));
vi.mock("@/hooks/useProducts", () => ({
  useProducts: () => ({ getFreeShippingEligibleProducts: () => [] }),
}));
vi.mock("@/hooks/useCart", () => ({
  useCart: () => ({
    cart: [],
    shippingFee: 10,
    freteIndefinido: false,
    freteGratis: false,
    updateQuantity: () => {},
    removeFromCart: () => {},
    selectedShippingOption: null as null,
    setSelectedShippingOption: () => {},
    setShippingCep: () => {},
  }),
}));
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: duble.usuario }),
}));
vi.mock("@/hooks/useDeferredRender", () => ({
  useDeferredRender: () => true,
}));
vi.mock("@/lib/supabase", () => ({ supabase: {} }));
vi.mock("@/utils/haptic", () => ({
  haptic: { light: vi.fn(), medium: vi.fn(), success: vi.fn() },
}));
vi.mock("@/components/ui/custom/CartItemsList", () => ({
  CartItemsList: () => <div data-testid="itens" />,
}));
vi.mock("@/components/ui/custom/ShippingCalculator", () => ({
  ShippingCalculator: () => <div data-testid="calculadora" />,
}));
vi.mock("@/components/ui/custom/ShippingProgress", () => ({
  ShippingProgress: () => <div data-testid="progresso" />,
}));
vi.mock("@/components/ui/custom/CartFooterSummary", () => ({
  CartFooterSummary: () => <div data-testid="rodape" />,
}));
vi.mock("@/components/ui/custom/OrderSearch", () => ({
  OrderSearch: () => <div data-testid="busca-pedido">Rastrear Pedido</div>,
}));
vi.mock("@/components/ui/custom/EmptyCart", () => ({
  EmptyCart: () => <div data-testid="carrinho-vazio" />,
}));

// @ts-expect-error flag interna do React, sem tipo público — padrão da casa.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe("P82 B — a faixa de abas de Meus pedidos tem o lugar reservado enquanto a lista carrega", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    const armazem = new Map<string, string>();
    const dubleDeArmazem = {
      getItem: (chave: string) => armazem.get(chave) ?? null,
      setItem: (chave: string, valor: string) => {
        armazem.set(chave, valor);
      },
      removeItem: (chave: string) => {
        armazem.delete(chave);
      },
      clear: () => {
        armazem.clear();
      },
    };
    vi.stubGlobal("localStorage", { ...dubleDeArmazem });
    vi.stubGlobal("sessionStorage", { ...dubleDeArmazem });
    duble.usuario = { id: "cliente-1" };
    duble.pedidosDaVez = [];
    duble.segurarBusca = true;
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
    vi.unstubAllGlobals();
  });

  async function montar() {
    const { CartView } = await import("@/views/customer/CartView");
    await act(async () => {
      raiz.render(<CartView onNavigate={() => {}} initialTab="orders" />);
    });
    await act(async () => {
      await Promise.resolve();
    });
    await act(async () => {
      await Promise.resolve();
    });
  }

  const reserva = () =>
    hospedeiro.querySelector<HTMLElement>(
      '#painel-orders > [aria-hidden="true"]',
    );

  it("carregando sem pedidos: o espaço vazio de 44 px + 16 px existe, só no computador, logo acima do invólucro da lista", async () => {
    await montar();
    expect(hospedeiro.textContent).toContain("Carregando pedidos");
    const espaco = reserva();
    expect(espaco).not.toBeNull();
    expect(espaco!.children).toHaveLength(0);
    expect(espaco!.textContent).toBe("");
    // Celular: nenhuma classe (sem altura, sem margem). Computador: 44 + 16.
    expect(classesDoCelular(espaco!.className)).toBe("");
    expect(espaco!.className.split(/\s+/).sort()).toEqual([
      "lg:h-11",
      "lg:mb-4",
    ]);
    const invólucro = espaco!.nextElementSibling!;
    expect(invólucro.className).toContain("overflow-hidden");
    expect(
      invólucro.querySelector('[data-testid="order-card-skeleton"]'),
    ).not.toBeNull();
  });

  it("com pedidos na tela a reserva some (a faixa de verdade ocupa o lugar)", async () => {
    duble.segurarBusca = false;
    duble.pedidosDaVez = [
      {
        id: "11111111-2222-3333-4444-555555555555",
        customer: { name: "Cliente Teste", whatsapp: "34999999999" },
        items: [
          { productId: "p", name: "Blusa", price: 100, quantity: 1, image: "" },
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
      },
    ];
    await montar();
    expect(reserva()).toBeNull();
    expect(hospedeiro.textContent).toContain("Em andamento");
  });

  it("depois da primeira resposta vazia a reserva some (sem esqueleto, sem espaço)", async () => {
    duble.segurarBusca = false;
    await montar();
    expect(hospedeiro.textContent).not.toContain("Carregando pedidos");
    expect(reserva()).toBeNull();
  });
});
