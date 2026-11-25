// @vitest-environment jsdom
//
// O frete que o `CartContext` entrega às telas (`shippingFee`, `freteGratis`,
// `descontoDoFrete`, `freteIndefinido`) e a regra de quando a escolha de frete
// cai: só quando mudam os PRODUTOS ou as VARIAÇÕES do carrinho — a quantidade e
// a ORDEM das linhas não derrubam a escolha. Caça por mutação em
// `src/contexts/CartContext.tsx`: os testes de tela olham a frase, não estes
// números.
import { act, useEffect } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CartProvider, useCartContext } from "@/contexts/CartContext";
import type { CartItem, Product, ShippingOption } from "@/types";

let configAtual: { shippingFee: number; freeShippingMin: number } = {
  shippingFee: 0,
  freeShippingMin: 0,
};

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({ config: configAtual }),
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

function produto(id: string, extra: Partial<Product> = {}): Product {
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
    ...extra,
  };
}

const entregaLocal = {
  id: "local-delivery",
  name: "Entrega local",
  price: 12,
} as unknown as ShippingOption;

const pac = { id: "pac", name: "PAC", price: 25 } as unknown as ShippingOption;

type Contexto = ReturnType<typeof useCartContext>;

function Sonda({ onEstado }: Readonly<{ onEstado: (c: Contexto) => void }>) {
  const contexto = useCartContext();
  useEffect(() => {
    onEstado(contexto);
  }, [contexto, onEstado]);
  return null;
}

describe("CartContext — frete que as telas leem e quando a escolha cai", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let atual: Contexto;

  async function montar(itens: CartItem[]) {
    localStorage.setItem("marketplace_cart_v1", JSON.stringify(itens));
    await act(async () => {
      raiz.render(
        <CartProvider>
          <Sonda onEstado={(c) => (atual = c)} />
        </CartProvider>,
      );
    });
  }

  beforeEach(() => {
    configAtual = { shippingFee: 0, freeShippingMin: 0 };
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

  describe("sem opção escolhida", () => {
    it("o frete é o da loja, ainda não há veredito de grátis e o frete está indefinido", async () => {
      configAtual = { shippingFee: 0, freeShippingMin: 0 };
      await montar([{ product: produto("p1"), quantity: 2 }]);
      expect(atual.shippingFee).toBe(0);
      expect(atual.freteGratis).toBe(false);
      expect(atual.freteIndefinido).toBe(true);
      expect(atual.descontoDoFrete).toBe(0);

      configAtual = { shippingFee: 15, freeShippingMin: 0 };
      await act(async () => {
        raiz.unmount();
      });
      raiz = createRoot(hospedeiro);
      await montar([{ product: produto("p1"), quantity: 2 }]);
      expect(atual.shippingFee).toBe(15);
      expect(atual.freteGratis).toBe(false);
    });
  });

  describe("carrinho vazio", () => {
    it("nunca é 'grátis' nem 'indefinido', mesmo com uma opção marcada e frete zero", async () => {
      await montar([]);
      await act(async () => {
        atual.setSelectedShippingOption(entregaLocal, "cliente");
      });
      expect(atual.selectedShippingOption?.id).toBe("local-delivery");
      expect(atual.shippingFee).toBe(0);
      expect(atual.freteGratis).toBe(false);
      expect(atual.freteIndefinido).toBe(false);
    });

    it("sem opção e sem itens, o frete também não está 'indefinido'", async () => {
      await montar([]);
      expect(atual.freteIndefinido).toBe(false);
      expect(atual.freteGratis).toBe(false);
      expect(atual.shippingFee).toBe(0);
    });
  });

  describe("frete grátis acima de um valor (R$ 100)", () => {
    it("abaixo do valor paga a taxa e não economiza; ao atingir o valor fica grátis e a economia é a taxa", async () => {
      configAtual = { shippingFee: 0, freeShippingMin: 100 };
      await montar([{ product: produto("p1"), quantity: 3 }]);
      await act(async () => {
        atual.setSelectedShippingOption(entregaLocal, "cliente");
      });
      expect(atual.cartTotal).toBe(30);
      expect(atual.shippingFee).toBe(12);
      expect(atual.freteGratis).toBe(false);
      expect(atual.descontoDoFrete).toBe(0);

      await act(async () => {
        atual.updateQuantity("p1", 10);
      });
      expect(atual.cartTotal).toBe(100);
      expect(atual.shippingFee).toBe(0);
      expect(atual.freteGratis).toBe(true);
      expect(atual.descontoDoFrete).toBe(12);
    });

    it("transportadora sem carimbo nacional segue a mesma regra legada do servidor", async () => {
      configAtual = { shippingFee: 0, freeShippingMin: 100 };
      await montar([{ product: produto("p1"), quantity: 10 }]);
      await act(async () => {
        atual.setSelectedShippingOption(pac, "cliente");
      });
      expect(atual.shippingFee).toBe(0);
      expect(atual.freteGratis).toBe(true);
      expect(atual.descontoDoFrete).toBe(25);
    });
  });

  describe("frete grátis por produto marcado", () => {
    it("basta UMA linha marcada entre várias para zerar o frete", async () => {
      configAtual = { shippingFee: 0, freeShippingMin: -1 };
      await montar([
        { product: produto("p1", { freeShipping: true }), quantity: 1 },
        { product: produto("p2"), quantity: 1 },
        { product: produto("p3"), quantity: 1 },
      ]);
      await act(async () => {
        atual.setSelectedShippingOption(entregaLocal, "cliente");
      });
      expect(atual.shippingFee).toBe(0);
      expect(atual.freteGratis).toBe(true);
    });

    it("nenhuma linha marcada: paga a taxa", async () => {
      configAtual = { shippingFee: 0, freeShippingMin: -1 };
      await montar([
        { product: produto("p1"), quantity: 1 },
        { product: produto("p2"), quantity: 1 },
      ]);
      await act(async () => {
        atual.setSelectedShippingOption(entregaLocal, "cliente");
      });
      expect(atual.shippingFee).toBe(12);
      expect(atual.freteGratis).toBe(false);
    });
  });

  describe("quando a escolha de frete cai", () => {
    const duas: CartItem[] = [
      { product: produto("pA"), quantity: 1 },
      { product: produto("pB"), quantity: 1 },
    ];

    it("mexer só na quantidade mantém a escolha e o CEP", async () => {
      await montar(duas);
      await act(async () => {
        atual.setSelectedShippingOption(pac, "cliente");
        atual.setShippingCep("01001000");
      });
      await act(async () => {
        atual.updateQuantity("pA", 4);
      });
      expect(atual.selectedShippingOption?.id).toBe("pac");
      expect(atual.shippingCep).toBe("01001000");
    });

    it("mudar a ORDEM das linhas (mesmos produtos) mantém a escolha e o CEP", async () => {
      await montar(duas);
      await act(async () => {
        atual.setSelectedShippingOption(pac, "cliente");
        atual.setShippingCep("01001000");
      });
      // Tira e põe o mesmo produto no mesmo instante: a linha vai para o fim.
      await act(async () => {
        atual.removeFromCart("pA", undefined, { silencioso: true });
        atual.addToCart(produto("pA"), 1);
      });
      expect(atual.cart.map((i) => i.product.id)).toEqual(["pB", "pA"]);
      expect(atual.selectedShippingOption?.id).toBe("pac");
      expect(atual.shippingCep).toBe("01001000");
    });

    it("tirar um produto derruba a escolha e o CEP", async () => {
      await montar(duas);
      await act(async () => {
        atual.setSelectedShippingOption(pac, "cliente");
        atual.setShippingCep("01001000");
      });
      await act(async () => {
        atual.removeFromCart("pA", undefined, { silencioso: true });
      });
      expect(atual.selectedShippingOption).toBeNull();
      expect(atual.shippingCep).toBeNull();
    });
  });
});
