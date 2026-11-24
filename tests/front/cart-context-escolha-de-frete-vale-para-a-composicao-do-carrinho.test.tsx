// @vitest-environment jsdom
//
// A escolha de frete (e o CEP dela) vale para uma COMPOSIÇÃO de carrinho:
// quais produtos e quais variações. Mudou um deles, a cotação antiga pode nem
// trazer mais aquele id e a escolha cai. Só a QUANTIDADE fica de fora (muda o
// valor, não a escolha). Sem esta fronteira a cliente fecharia o pedido com um
// frete cotado para outra mercadoria.
import { act, useEffect } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CartProvider, useCartContext } from "@/contexts/CartContext";
import type { Product, ProductVariant, ShippingOption } from "@/types";

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({ config: { shippingFee: 15, freeShippingMin: 0 } }),
}));

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: null, loading: false }),
}));

vi.mock("@/hooks/useLeaderElection", () => ({
  useLeaderElection: () => ({ isLeader: true }),
}));

vi.mock("@/lib/supabase", () => {
  const canal = { on: () => canal, subscribe: () => canal };
  return {
    supabase: {
      channel: () => canal,
      removeChannel: async () => {},
      rpc: async () => ({ error: new Error("sem rede") }),
      from: () => {
        throw new Error("sem rede");
      },
    },
  };
});

vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), {
    error: vi.fn(),
    info: vi.fn(),
    success: vi.fn(),
    warning: vi.fn(),
  }),
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const variacao = (id: string): ProductVariant => ({
  id,
  productId: "a",
  name: "Cor",
  value: id,
  stockIncrement: 100,
  active: true,
});

function produto(id: string, variants?: ProductVariant[]): Product {
  return {
    id,
    name: `Produto ${id}`,
    description: "",
    price: 10,
    images: [],
    category: "geral",
    stock: 100,
    sold: 0,
    isActive: true,
    isBestseller: false,
    freeShipping: false,
    createdAt: new Date(0).toISOString(),
    variants,
  };
}

const OPCAO: ShippingOption = {
  id: "local-delivery",
  name: "Entrega local",
  price: 15,
  deliveryDays: 1,
  provider: "local",
};

type Contexto = ReturnType<typeof useCartContext>;

function Sonda({ onEstado }: Readonly<{ onEstado: (c: Contexto) => void }>) {
  const contexto = useCartContext();
  useEffect(() => {
    onEstado(contexto);
  }, [contexto, onEstado]);
  return null;
}

describe("CartContext — a escolha de frete vale para a composição do carrinho", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let atual: Contexto;
  const a = produto("a", [variacao("vA"), variacao("vB")]);
  const b = produto("b");

  beforeEach(async () => {
    const armazem = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (chave: string) => armazem.get(chave) ?? null,
      setItem: (chave: string, valor: string) => {
        armazem.set(chave, valor);
      },
      removeItem: (chave: string) => {
        armazem.delete(chave);
      },
    });
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
    await act(async () => {
      raiz.render(
        <CartProvider>
          <Sonda onEstado={(c) => (atual = c)} />
        </CartProvider>,
      );
    });
    await act(async () => {
      atual.addToCart(a, 1, "vA");
    });
    await act(async () => {
      atual.setSelectedShippingOption(OPCAO, "cliente");
      atual.setShippingCep("01001000");
    });
    // Controle de que o preparo funcionou: a escolha está de pé.
    expect(atual.selectedShippingOption?.id).toBe("local-delivery");
    expect(atual.shippingCep).toBe("01001000");
  });

  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("mexer só na QUANTIDADE (mais uma unidade, ou trocar a quantidade) mantém a escolha e o CEP", async () => {
    await act(async () => {
      atual.addToCart(a, 2, "vA");
    });
    expect(atual.cart[0]?.quantity).toBe(3);
    expect(atual.selectedShippingOption?.id).toBe("local-delivery");
    expect(atual.freteEscolhidoPelaCliente).toBe(true);
    expect(atual.shippingCep).toBe("01001000");

    await act(async () => {
      atual.updateQuantity("a", 5, "vA");
    });
    expect(atual.cart[0]?.quantity).toBe(5);
    expect(atual.selectedShippingOption?.id).toBe("local-delivery");
    expect(atual.shippingCep).toBe("01001000");
  });

  it("entrar OUTRO produto derruba a escolha e o CEP", async () => {
    await act(async () => {
      atual.addToCart(b, 1);
    });

    expect(atual.selectedShippingOption).toBeNull();
    expect(atual.freteEscolhidoPelaCliente).toBe(false);
    expect(atual.shippingCep).toBeNull();
  });

  it("entrar OUTRA VARIAÇÃO do mesmo produto derruba a escolha", async () => {
    await act(async () => {
      atual.addToCart(a, 1, "vB");
    });

    expect(atual.cart).toHaveLength(2);
    expect(atual.selectedShippingOption).toBeNull();
    expect(atual.shippingCep).toBeNull();
  });

  it("trocar a variação (tira A e põe B no mesmo instante, mesma quantidade) derruba a escolha", async () => {
    await act(async () => {
      atual.removeFromCart("a", "vA");
      atual.addToCart(a, 1, "vB");
    });

    expect(atual.cart).toHaveLength(1);
    expect(atual.cart[0]?.variantId).toBe("vB");
    expect(atual.selectedShippingOption).toBeNull();
    expect(atual.shippingCep).toBeNull();
  });

  it("trocar o produto por outro de mesma variação e mesma quantidade (tira A e põe C no mesmo instante) derruba a escolha", async () => {
    const outro = produto("c", [variacao("vA")]);
    await act(async () => {
      atual.removeFromCart("a", "vA");
      atual.addToCart(outro, 1, "vA");
    });

    expect(atual.cart).toHaveLength(1);
    expect(atual.cart[0]?.product.id).toBe("c");
    expect(atual.selectedShippingOption).toBeNull();
    expect(atual.shippingCep).toBeNull();
  });

  it("tirar a linha derruba a escolha (carrinho vazio não guarda frete)", async () => {
    await act(async () => {
      atual.removeFromCart("a", "vA");
    });

    expect(atual.cart).toHaveLength(0);
    expect(atual.selectedShippingOption).toBeNull();
    expect(atual.shippingCep).toBeNull();
    expect(atual.shippingFee).toBe(0);
  });
});
