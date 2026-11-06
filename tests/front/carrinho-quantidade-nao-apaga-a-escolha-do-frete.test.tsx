// @vitest-environment jsdom
//
// Mudar SÓ a quantidade no carrinho apagava a escolha de frete da cliente
// (inclusive "Retirada na loja") e o CEP guardado: o efeito do CartContext
// zerava os dois a cada mudança da assinatura do carrinho, e a assinatura
// carregava a quantidade. Depois da cotação nova, a mais barata ocupava o
// lugar do que ela tinha tocado.
//
// A regra agora: a escolha e o CEP só caem quando mudam os PRODUTOS ou as
// VARIAÇÕES do carrinho (a lista de opções pode nem trazer mais o id
// escolhido). Quantidade muda só o valor — quem recota é a calculadora, e o
// preço novo entra no objeto fresco da MESMA modalidade
// (tests/front/shipping-calculator-selecao-fresca-mesmo-id.test.tsx).
import { act, useEffect } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CartProvider, useCartContext } from "@/contexts/CartContext";
import type { CartItem, Product, ShippingOption } from "@/types";

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    config: { shippingFee: 0, freeShippingMin: 0, originCep: "38500-000" },
    isLoaded: true,
  }),
}));

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: null, loading: false }),
}));

vi.mock("@/hooks/useLeaderElection", () => ({
  useLeaderElection: () => ({ isLeader: true }),
}));

vi.mock("@/lib/supabase", () => ({ supabase: {} }));

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

const RETIRADA: ShippingOption = {
  id: "store-pickup",
  name: "Retirada na loja",
  price: 0,
  deliveryDays: 0,
  provider: "local",
};
const ENTREGA_LOCAL: ShippingOption = {
  id: "local-delivery",
  name: "Entrega local",
  price: 8,
  deliveryDays: 1,
  provider: "local",
};

function produto(id: string, sobre: Partial<Product> = {}): Product {
  return {
    id,
    name: `Produto ${id}`,
    description: "",
    price: 50,
    images: [],
    category: "geral",
    stock: 50,
    sold: 0,
    isActive: true,
    isBestseller: false,
    freeShipping: false,
    createdAt: new Date(0).toISOString(),
    ...sobre,
  };
}

function linha(p: Product, quantity: number, variantId?: string): CartItem {
  return {
    product: p,
    quantity,
    ...(variantId ? { variantId } : {}),
    lastModifiedAt: Date.now(),
  };
}

type Contexto = ReturnType<typeof useCartContext>;

function Sonda({ onEstado }: Readonly<{ onEstado: (c: Contexto) => void }>) {
  const contexto = useCartContext();
  useEffect(() => {
    onEstado(contexto);
  }, [contexto, onEstado]);
  return null;
}

describe("CartContext — mudar só a quantidade não apaga o frete escolhido", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let atual: Contexto;

  beforeEach(() => {
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
  });

  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  async function montar(itens: CartItem[]) {
    localStorage.setItem("marketplace_cart_v1", JSON.stringify(itens));
    await act(async () => {
      raiz.render(
        <CartProvider>
          <Sonda onEstado={(c) => (atual = c)} />
        </CartProvider>,
      );
    });
    expect(atual.cart).toHaveLength(itens.length);
  }

  async function escolher(
    opcao: ShippingOption,
    origem: "cliente" | "automatica",
    cep = "38500-000",
  ) {
    await act(async () => {
      atual.setSelectedShippingOption(opcao, origem);
      atual.setShippingCep(cep);
    });
    expect(atual.selectedShippingOption?.id).toBe(opcao.id);
    expect(atual.shippingCep).toBe(cep);
  }

  it("Retirada na loja escolhida pela cliente sobrevive ao + (quantidade 1 → 2)", async () => {
    await montar([linha(produto("p1"), 1)]);
    await escolher(RETIRADA, "cliente");

    await act(async () => {
      atual.updateQuantity("p1", 2);
    });

    expect(atual.cart[0]?.quantity).toBe(2);
    expect(atual.selectedShippingOption?.id).toBe("store-pickup");
    expect(atual.freteEscolhidoPelaCliente).toBe(true);
    expect(atual.shippingCep).toBe("38500-000");
    expect(atual.freteIndefinido).toBe(false);
  });

  it("a escolha da cliente sobrevive também ao - e a uma rajada de mudanças de quantidade", async () => {
    await montar([linha(produto("p1"), 3)]);
    await escolher(ENTREGA_LOCAL, "cliente");

    for (const quantidade of [4, 5, 2]) {
      await act(async () => {
        atual.updateQuantity("p1", quantidade);
      });
    }

    expect(atual.cart[0]?.quantity).toBe(2);
    expect(atual.selectedShippingOption?.id).toBe("local-delivery");
    expect(atual.freteEscolhidoPelaCliente).toBe(true);
    expect(atual.shippingCep).toBe("38500-000");
  });

  it("escolha AUTOMÁTICA também fica (a calculadora a refaz contra a lista nova), sem virar 'da cliente'", async () => {
    await montar([linha(produto("p1"), 1)]);
    await escolher(ENTREGA_LOCAL, "automatica");

    await act(async () => {
      atual.updateQuantity("p1", 2);
    });

    expect(atual.selectedShippingOption?.id).toBe("local-delivery");
    expect(atual.freteEscolhidoPelaCliente).toBe(false);
    expect(atual.shippingCep).toBe("38500-000");
  });

  it("controle: um produto DIFERENTE entra no carrinho — a escolha e o CEP caem, como antes", async () => {
    await montar([linha(produto("p1"), 1)]);
    await escolher(RETIRADA, "cliente");

    await act(async () => {
      atual.addToCart(produto("p2"), 1);
    });

    expect(atual.cart).toHaveLength(2);
    expect(atual.selectedShippingOption).toBeNull();
    expect(atual.freteEscolhidoPelaCliente).toBe(false);
    expect(atual.shippingCep).toBeNull();
    expect(atual.freteIndefinido).toBe(true);
  });

  it("controle: um produto SAI do carrinho — a escolha e o CEP caem", async () => {
    await montar([linha(produto("p1"), 1), linha(produto("p2"), 1)]);
    await escolher(RETIRADA, "cliente");

    await act(async () => {
      atual.removeFromCart("p2");
    });

    expect(atual.cart).toHaveLength(1);
    expect(atual.selectedShippingOption).toBeNull();
    expect(atual.shippingCep).toBeNull();
  });

  it("controle: outra VARIAÇÃO do mesmo produto entra — a escolha e o CEP caem", async () => {
    const comVariacoes = produto("p1", {
      variants: [
        {
          id: "v-m",
          productId: "p1",
          name: "Tamanho",
          value: "M",
          stockIncrement: 20,
          active: true,
        },
        {
          id: "v-g",
          productId: "p1",
          name: "Tamanho",
          value: "G",
          stockIncrement: 20,
          active: true,
        },
      ],
    });
    await montar([linha(comVariacoes, 1, "v-m")]);
    await escolher(RETIRADA, "cliente");

    // Mesma variação, outra quantidade: fica.
    await act(async () => {
      atual.updateQuantity("p1", 3, "v-m");
    });
    expect(atual.cart[0]?.quantity).toBe(3);
    expect(atual.selectedShippingOption?.id).toBe("store-pickup");
    expect(atual.shippingCep).toBe("38500-000");

    // Variação nova: cai.
    await act(async () => {
      atual.addToCart(comVariacoes, 1, "v-g");
    });
    expect(atual.cart).toHaveLength(2);
    expect(atual.selectedShippingOption).toBeNull();
    expect(atual.shippingCep).toBeNull();
  });

  it("controle: carrinho esvaziado limpa a escolha e o CEP", async () => {
    await montar([linha(produto("p1"), 2)]);
    await escolher(RETIRADA, "cliente");

    await act(async () => {
      atual.clearCart({ silencioso: true });
    });

    expect(atual.cart).toHaveLength(0);
    expect(atual.selectedShippingOption).toBeNull();
    expect(atual.shippingCep).toBeNull();
  });
});
