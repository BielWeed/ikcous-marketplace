// @vitest-environment jsdom
//
// Carrinho "vazio" só depois de ler o carrinho salvo (lote 238, caça 11-D #6).
//
// DEFEITO MEDIDO: o CartContext expõe `isLoading`, mas nenhuma tela o usava. Quem
// entrava de novo na conta (ou abria o app num aparelho novo) via "Seu carrinho
// está vazio" enquanto o carrinho da conta ainda estava sendo lido. Agora a tela
// mostra "Carregando seu carrinho…" nesse intervalo, e o vazio só aparece
// quando a leitura termina — e `isLoading` termina mesmo se a leitura falhar
// (ver cart-context-is-loading-termina-mesmo-se-a-leitura-falha.test.tsx).
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { CartItem } from "@/types";

const itemNoCarrinho: CartItem = {
  product: {
    id: "prod-1",
    name: "Blusa Teste",
    description: "",
    price: 100,
    images: [],
    category: "Roupas",
    stock: 5,
    sold: 0,
    isActive: true,
    isBestseller: false,
    freeShipping: false,
    createdAt: new Date(0).toISOString(),
  },
  quantity: 1,
};

const configDaLoja = { shippingFee: 10, freeShippingMin: 0 };

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({ config: configDaLoja }),
}));

vi.mock("@/hooks/useProducts", () => ({
  useProducts: () => ({ getFreeShippingEligibleProducts: () => [] }),
}));

const estado = vi.hoisted(() => ({ carregando: false, vazio: true }));

vi.mock("@/hooks/useCart", () => ({
  useCart: () => ({
    cart: estado.vazio ? [] : [itemNoCarrinho],
    isLoading: estado.carregando,
    shippingFee: 10,
    updateQuantity: vi.fn(),
    removeFromCart: vi.fn(),
    selectedShippingOption: null,
    setSelectedShippingOption: vi.fn(),
    setShippingCep: vi.fn(),
  }),
}));

vi.mock("@/hooks/useOrders", () => ({
  useOrders: () => ({ fetchUserOrders: vi.fn().mockResolvedValue([]) }),
}));

vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: null }) }));

vi.mock("@/hooks/useDeferredRender", () => ({ useDeferredRender: () => true }));

vi.mock("@/lib/supabase", () => ({ supabase: {} }));

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
vi.mock("@/components/ui/custom/OrderList", () => ({
  OrderList: () => <div data-testid="pedidos" />,
}));
vi.mock("@/components/ui/custom/OrderSearch", () => ({
  OrderSearch: () => <div data-testid="busca-pedido" />,
}));
vi.mock("@/components/ui/custom/EmptyCart", () => ({
  EmptyCart: () => <div data-testid="carrinho-vazio" />,
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe("CartView — não diz 'vazio' enquanto lê o carrinho salvo", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    estado.carregando = false;
    estado.vazio = true;
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

  async function renderizarCarrinho() {
    const { CartView } = await import("@/views/customer/CartView");
    await act(async () => {
      raiz.render(<CartView onNavigate={() => {}} />);
    });
    await act(async () => {
      await Promise.resolve();
    });
  }

  it("lendo o carrinho salvo: mostra 'Carregando seu carrinho' e NÃO o vazio", async () => {
    estado.carregando = true;
    await renderizarCarrinho();

    expect(hospedeiro.textContent).toContain("Carregando seu carrinho");
    expect(
      hospedeiro.querySelector('[data-testid="carrinho-vazio"]'),
    ).toBeNull();
  });

  it("leitura terminou e o carrinho é vazio: aí sim mostra o vazio", async () => {
    estado.carregando = false;
    await renderizarCarrinho();

    expect(
      hospedeiro.querySelector('[data-testid="carrinho-vazio"]'),
    ).not.toBeNull();
    expect(hospedeiro.textContent).not.toContain("Carregando seu carrinho");
  });

  it("ainda lendo, mas já há itens neste aparelho: mostra os itens, sem esperar", async () => {
    estado.carregando = true;
    estado.vazio = false;
    await renderizarCarrinho();

    expect(hospedeiro.querySelector('[data-testid="itens"]')).not.toBeNull();
    expect(hospedeiro.textContent).not.toContain("Carregando seu carrinho");
  });
});
