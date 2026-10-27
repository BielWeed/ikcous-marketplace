// @vitest-environment jsdom
//
// Lote 208 (caça 8) — CartView:
//  (item 2)  "Meus pedidos" na primeira abertura, sem cache: enquanto a
//            primeira busca não respondeu, a tela mostra o esqueleto de
//            carregando — nunca "Nenhum pedido" (que só vale DEPOIS da
//            primeira resposta).
//  (item 10) Convidado: o aviso "Histórico Protegido ... Acesse" (sem botão)
//            não repete o que o bloco de entrar/rastrear já diz e oferece.
//  (item 11) "Adicione mais R$ X para garantir Frete Grátis!" não aparece
//            enquanto o frete ainda está indefinido ("A calcular").
//
// Harness copiado de cart-view-aba-pedidos-falha-de-carregamento.test.tsx.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { duble } = vi.hoisted(() => ({
  duble: {
    usuario: null as null | { id: string },
    pedidosDaVez: [] as any[],
    // Quando preenchido, a busca fica pendente até alguém chamar isto.
    resolverBusca: null as null | (() => void),
    segurarBusca: false,
    // Falso = a tela ainda não "armou" (useDeferredRender de 80 ms): a busca
    // dos pedidos ainda nem começou.
    pronto: true,
    cart: [] as any[],
    freteIndefinido: false,
    config: { shippingFee: 10, freeShippingMin: 0 } as Record<string, unknown>,
  },
}));

vi.mock("@/hooks/useOrders", async () => {
  const { useState } = await import("react");
  return {
    useOrders: () => {
      const [orders] = useState(duble.pedidosDaVez);
      const [fetchUserOrders] = useState(() => () => {
        if (!duble.segurarBusca) return Promise.resolve([] as any[]);
        return new Promise<any[]>((resolver) => {
          duble.resolverBusca = () => resolver([]);
        });
      });
      return { orders, ordersLoadError: null, fetchUserOrders };
    },
  };
});

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({ config: duble.config }),
}));
vi.mock("@/hooks/useProducts", () => ({
  useProducts: () => ({ getFreeShippingEligibleProducts: () => [] }),
}));
vi.mock("@/hooks/useCart", async () => {
  return {
    useCart: () => ({
      cart: duble.cart,
      shippingFee: 10,
      freteIndefinido: duble.freteIndefinido,
      freteGratis: false,
      updateQuantity: () => {},
      removeFromCart: () => {},
      selectedShippingOption: null as null,
      setSelectedShippingOption: () => {},
      setShippingCep: () => {},
    }),
  };
});
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: duble.usuario }),
}));
vi.mock("@/hooks/useDeferredRender", () => ({
  useDeferredRender: () => duble.pronto,
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

describe("CartView — lote 208", () => {
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
    duble.usuario = null;
    duble.pedidosDaVez = [];
    duble.resolverBusca = null;
    duble.segurarBusca = false;
    duble.pronto = true;
    duble.cart = [];
    duble.freteIndefinido = false;
    duble.config = { shippingFee: 10, freeShippingMin: 0 };
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

  async function montar(aba: "orders" | "cart") {
    const { CartView } = await import("@/views/customer/CartView");
    await act(async () => {
      raiz.render(<CartView onNavigate={() => {}} initialTab={aba} />);
    });
    await act(async () => {
      await Promise.resolve();
    });
    await act(async () => {
      await Promise.resolve();
    });
  }

  const texto = () => hospedeiro.textContent ?? "";

  it("item 2: busca ainda pendente, sem cache: esqueleto, nunca 'Nenhum pedido'", async () => {
    duble.usuario = { id: "cliente-1" };
    duble.segurarBusca = true;
    await montar("orders");

    expect(texto()).not.toContain("Nenhum pedido");
    expect(texto()).toContain("Carregando pedidos");
  });

  it("item 2: antes mesmo de a busca começar (tela ainda armando), nunca 'Nenhum pedido'", async () => {
    duble.usuario = { id: "cliente-1" };
    duble.pronto = false;
    await montar("orders");

    expect(texto()).not.toContain("Nenhum pedido");
    expect(texto()).toContain("Carregando pedidos");
  });

  it("item 2: depois da primeira resposta vazia, 'Nenhum pedido' aparece", async () => {
    duble.usuario = { id: "cliente-1" };
    duble.segurarBusca = true;
    await montar("orders");
    expect(texto()).not.toContain("Nenhum pedido");

    await act(async () => {
      duble.resolverBusca?.();
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(texto()).toContain("Nenhum pedido");
    expect(texto()).not.toContain("Carregando pedidos");
  });

  it("item 10: convidado sem pedidos vê um só aviso (o de entrar), sem 'Histórico Protegido'", async () => {
    duble.usuario = null;
    await montar("orders");

    expect(texto()).toContain("Rastrear Pedido");
    expect(texto()).not.toContain("Histórico Protegido");
    expect(texto()).not.toContain("Acesse para visualizar");
  });

  const itemNoCarrinho = {
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

  const lojaComMetaDeFrete = {
    shippingFee: 10,
    freeShippingMin: 300,
  };

  it("item 11 (controle): com o frete conhecido, a meta de frete grátis aparece", async () => {
    duble.usuario = { id: "cliente-1" };
    duble.cart = [itemNoCarrinho];
    duble.freteIndefinido = false;
    duble.config = lojaComMetaDeFrete;
    await montar("cart");

    expect(texto()).toContain("para garantir");
  });

  it("item 11: frete indefinido não promete 'Adicione mais R$ X para Frete Grátis'", async () => {
    duble.usuario = { id: "cliente-1" };
    duble.cart = [itemNoCarrinho];
    duble.freteIndefinido = true;
    duble.config = lojaComMetaDeFrete;
    await montar("cart");

    // A tela do carrinho montou (a âncora prova) e a meta ficou de fora.
    expect(texto()).toContain("A calcular");
    expect(texto()).not.toContain("para garantir");
  });
});
