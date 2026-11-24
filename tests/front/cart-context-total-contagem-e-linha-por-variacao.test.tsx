// @vitest-environment jsdom
//
// O que a cliente PAGA e o que ela VÊ no carrinho (provedor real, sem tela):
// o total soma preço x quantidade de TODAS as linhas, a variação com preço
// próprio (inclusive R$ 0) manda no preço da linha, variação diferente é linha
// diferente, e trocar/tirar a quantidade de uma linha nunca mexe na vizinha.
// O aviso de limite de estoque ao trocar a quantidade concorda em número
// (singular/plural) e na fronteira exata (estoque 500 ainda é "estoque", não
// "teto"; pedir exatamente o estoque não avisa nada).
import { act, useEffect } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CartProvider, useCartContext } from "@/contexts/CartContext";
import type { Product, ProductVariant } from "@/types";

const toastInfo = vi.fn();
const toastError = vi.fn();

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
    error: (...args: unknown[]) => toastError(...args),
    info: (...args: unknown[]) => toastInfo(...args),
    success: vi.fn(),
    warning: vi.fn(),
  }),
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function variacao(
  productId: string,
  id: string,
  extra: Partial<ProductVariant> = {},
): ProductVariant {
  return {
    id,
    productId,
    name: "Cor",
    value: id,
    stockIncrement: 100,
    active: true,
    ...extra,
  };
}

function produto(
  id: string,
  preco: number,
  estoque: number,
  variants?: ProductVariant[],
): Product {
  return {
    id,
    name: `Produto ${id}`,
    description: "",
    price: preco,
    images: [],
    category: "geral",
    stock: estoque,
    sold: 0,
    isActive: true,
    isBestseller: false,
    freeShipping: false,
    createdAt: new Date(0).toISOString(),
    variants,
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

describe("CartContext — total, contagem e linha por variação", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let atual: Contexto;

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
    toastInfo.mockClear();
    toastError.mockClear();
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
  });

  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  const adicionar = async (
    p: Product,
    quantidade: number,
    variantId?: string,
  ) => {
    await act(async () => {
      atual.addToCart(p, quantidade, variantId);
    });
  };

  const linha = (productId: string, variantId?: string) =>
    atual.cart.find(
      (l) =>
        l.product.id === productId && (l.variantId ?? "") === (variantId ?? ""),
    );

  describe("total e contagem", () => {
    it("carrinho vazio: total 0, contagem 0 e frete 0 (não cobra frete de nada)", () => {
      expect(atual.cartTotal).toBe(0);
      expect(atual.cartCount).toBe(0);
      expect(atual.getCartTotal()).toBe(0);
      expect(atual.getCartCount()).toBe(0);
      expect(atual.shippingFee).toBe(0);
      expect(atual.freteIndefinido).toBe(false);
      expect(atual.freteGratis).toBe(false);
    });

    it("duas linhas: o total soma preço x quantidade de CADA uma e a contagem soma as unidades", async () => {
      await adicionar(produto("a", 10.5, 50), 2);
      await adicionar(produto("b", 3.25, 50), 3);

      expect(atual.cartTotal).toBeCloseTo(2 * 10.5 + 3 * 3.25, 2);
      expect(atual.cartTotal).toBeCloseTo(30.75, 2);
      expect(atual.cartCount).toBe(5);
      expect(atual.getCartTotal()).toBeCloseTo(30.75, 2);
      expect(atual.getCartCount()).toBe(5);
    });

    it("com itens e sem frete escolhido: o frete é o da loja e fica indefinido (nada de 'grátis' sem escolha)", async () => {
      await adicionar(produto("a", 10, 50), 1);

      expect(atual.shippingFee).toBe(15);
      expect(atual.freteIndefinido).toBe(true);
      expect(atual.freteGratis).toBe(false);
    });

    it("variação com preço próprio cobra o dela; a linha sem variação cobra o do produto", async () => {
      const p = produto("a", 10, 50, [
        variacao("a", "v1", { priceOverride: 7 }),
      ]);
      await adicionar(p, 2, "v1");
      expect(atual.cartTotal).toBe(14);

      await adicionar(p, 1);
      expect(atual.cartTotal).toBe(24);
      expect(atual.cartCount).toBe(3);
    });

    it("variação com preço próprio R$ 0 (brinde) cobra zero, não o preço cheio", async () => {
      const p = produto("a", 10, 50, [
        variacao("a", "brinde", { priceOverride: 0 }),
      ]);
      await adicionar(p, 3, "brinde");

      expect(atual.cartTotal).toBe(0);
      expect(atual.cartCount).toBe(3);
    });

    it("variação sem preço próprio cobra o preço do produto", async () => {
      const p = produto("a", 10, 50, [variacao("a", "v1")]);
      await adicionar(p, 2, "v1");

      expect(atual.cartTotal).toBe(20);
    });

    it("variação que o produto já não tem (tirada do cadastro): cobra o preço do produto, sem quebrar", async () => {
      const p = produto("a", 10, 50, [
        variacao("a", "v1", { priceOverride: 7 }),
      ]);
      await adicionar(p, 2, "some");

      expect(atual.cart).toHaveLength(1);
      expect(atual.cartTotal).toBe(20);
    });
  });

  describe("variação diferente é linha diferente", () => {
    const p = produto("a", 10, 100, [
      variacao("a", "vA", { priceOverride: 12 }),
      variacao("a", "vB", { priceOverride: 20 }),
    ]);

    it("A, B e 'sem variação' são três linhas; repetir A soma só na linha A", async () => {
      await adicionar(p, 1, "vA");
      await adicionar(p, 1, "vB");
      await adicionar(p, 1);
      expect(atual.cart).toHaveLength(3);

      await adicionar(p, 2, "vA");

      expect(atual.cart).toHaveLength(3);
      expect(linha("a", "vA")?.quantity).toBe(3);
      expect(linha("a", "vB")?.quantity).toBe(1);
      expect(linha("a")?.quantity).toBe(1);
      expect(atual.cartTotal).toBe(3 * 12 + 20 + 10);
      expect(atual.cartCount).toBe(5);
    });

    it("trocar a quantidade de B não mexe em A, e o total acompanha", async () => {
      await adicionar(p, 2, "vA");
      await adicionar(p, 1, "vB");

      await act(async () => {
        atual.updateQuantity("a", 4, "vB");
      });

      expect(linha("a", "vA")?.quantity).toBe(2);
      expect(linha("a", "vB")?.quantity).toBe(4);
      expect(atual.cartTotal).toBe(2 * 12 + 4 * 20);
    });

    it("trocar a quantidade da linha SEM variação não mexe nas linhas com variação", async () => {
      await adicionar(p, 2, "vA");
      await adicionar(p, 1);

      await act(async () => {
        atual.updateQuantity("a", 5);
      });

      expect(linha("a")?.quantity).toBe(5);
      expect(linha("a", "vA")?.quantity).toBe(2);
    });

    it("pedir quantidade 0 numa variação tira SÓ essa linha", async () => {
      await adicionar(p, 2, "vA");
      await adicionar(p, 1, "vB");

      await act(async () => {
        atual.updateQuantity("a", 0, "vA");
      });

      expect(linha("a", "vA")).toBeUndefined();
      expect(linha("a", "vB")?.quantity).toBe(1);
      expect(atual.cartTotal).toBe(20);
    });

    it("quantidade negativa também tira a linha, nunca deixa quantidade <= 0 no carrinho", async () => {
      await adicionar(p, 2, "vA");

      await act(async () => {
        atual.updateQuantity("a", -3, "vA");
      });

      expect(atual.cart).toHaveLength(0);
      expect(atual.cartTotal).toBe(0);
      expect(atual.cartCount).toBe(0);
    });

    it("remover uma variação deixa a outra e o total fica só com a que sobrou", async () => {
      await adicionar(p, 2, "vA");
      await adicionar(p, 1, "vB");

      await act(async () => {
        atual.removeFromCart("a", "vA");
      });

      expect(atual.cart).toHaveLength(1);
      expect(linha("a", "vB")?.quantity).toBe(1);
      expect(atual.cartTotal).toBe(20);
      expect(atual.cartCount).toBe(1);
    });

    it("trocar a quantidade de um produto que não está no carrinho não inventa linha", async () => {
      await adicionar(p, 2, "vA");

      await act(async () => {
        atual.updateQuantity("outro", 3);
        atual.updateQuantity("a", 3, "vInexistente");
      });

      expect(atual.cart).toHaveLength(1);
      expect(linha("a", "vA")?.quantity).toBe(2);
    });
  });

  describe("trocar a quantidade respeita o estoque e diz o limite certo", () => {
    it("a quantidade mínima que fica é 1: trocar para 1 mantém a linha com 1 unidade", async () => {
      const p = produto("a", 10, 5);
      await adicionar(p, 3);

      await act(async () => {
        atual.updateQuantity("a", 1);
      });

      expect(linha("a")?.quantity).toBe(1);
      expect(atual.cartTotal).toBe(10);
      expect(toastError).not.toHaveBeenCalled();
    });

    it("pedir exatamente o estoque cabe e NÃO avisa limite", async () => {
      const p = produto("a", 10, 3);
      await adicionar(p, 1);

      await act(async () => {
        atual.updateQuantity("a", 3);
      });

      expect(linha("a")?.quantity).toBe(3);
      expect(toastError).not.toHaveBeenCalled();
    });

    it("pedir uma a mais que o estoque corta no estoque e avisa no plural", async () => {
      const p = produto("a", 10, 3);
      await adicionar(p, 1);

      await act(async () => {
        atual.updateQuantity("a", 4);
      });

      expect(linha("a")?.quantity).toBe(3);
      expect(toastError).toHaveBeenCalledTimes(1);
      expect(toastError.mock.calls[0]?.[0]).toBe(
        "Limite de estoque atingido (3 unidades).",
      );
    });

    it("estoque de 1 unidade: o aviso fala no singular", async () => {
      const p = produto("a", 10, 1);
      await adicionar(p, 1);

      await act(async () => {
        atual.updateQuantity("a", 2);
      });

      expect(linha("a")?.quantity).toBe(1);
      expect(toastError.mock.calls[0]?.[0]).toBe(
        "Limite de estoque atingido (1 unidade).",
      );
    });

    it("estoque exatamente 500 e pede 501: o motivo ainda é o ESTOQUE (o teto só vale quando sobra estoque)", async () => {
      const p = produto("a", 10, 500);
      await adicionar(p, 1);

      await act(async () => {
        atual.updateQuantity("a", 501);
      });

      expect(linha("a")?.quantity).toBe(500);
      expect(toastError.mock.calls[0]?.[0]).toBe(
        "Limite de estoque atingido (500 unidades).",
      );
    });

    it("estoque 501 e pede 501: corta no teto de 500 e avisa o teto, não o estoque", async () => {
      const p = produto("a", 10, 501);
      await adicionar(p, 1);

      await act(async () => {
        atual.updateQuantity("a", 501);
      });

      expect(linha("a")?.quantity).toBe(500);
      expect(toastError.mock.calls[0]?.[0]).toBe(
        "Máximo de 500 unidades por item em cada pedido.",
      );
    });

    it("duas linhas que usam a MESMA variação dividem o estoque dela ao trocar a quantidade", async () => {
      const p = produto("a", 10, 100, [
        variacao("a", "vA", { stockIncrement: 5 }),
        variacao("a", "vB", { stockIncrement: 5 }),
      ]);
      await adicionar(p, 3, "vA");
      await adicionar(p, 1, "vA~vB");
      expect(atual.cart).toHaveLength(2);

      await act(async () => {
        atual.updateQuantity("a", 4, "vA~vB");
      });

      // vA tem 5 e a outra linha já leva 3: sobram 2 para a linha composta.
      const composta = atual.cart.find((l) => l.outrasVariantIds?.length);
      const simples = atual.cart.find((l) => !l.outrasVariantIds?.length);
      expect(composta?.quantity).toBe(2);
      expect(simples?.quantity).toBe(3);
      expect(toastError.mock.calls[0]?.[0]).toBe(
        "Limite de estoque atingido (2 unidades).",
      );
    });

    it("o estoque de um produto não é descontado pelas linhas de OUTRO produto", async () => {
      const a = produto("a", 10, 2);
      const b = produto("b", 10, 2);
      await adicionar(a, 2);
      await adicionar(b, 1);

      await act(async () => {
        atual.updateQuantity("b", 2);
      });

      expect(linha("b")?.quantity).toBe(2);
      expect(toastError).not.toHaveBeenCalled();
    });
  });
});
