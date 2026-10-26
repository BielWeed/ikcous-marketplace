// @vitest-environment jsdom
//
// UI-191 (G1): o card de produto mostrava "Salvo!", voava a bolinha e vibrava
// mesmo quando NADA entrou no carrinho (o estoque já estava todo no carrinho),
// porque `addToCart` devolvia `void` e recusava lá dentro. Agora ele devolve
// quantas unidades entraram: 0 = nada entrou. Quem celebra olha esse número.
import { act, useEffect } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CartProvider, useCartContext } from "@/contexts/CartContext";
import type { Product, ProductVariant } from "@/types";

const toastInfo = vi.fn();
const toastError = vi.fn();

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({ config: { shippingFee: 0, freeShippingMin: 0 } }),
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

function variacao(id: string, estoque: number): ProductVariant {
  return {
    id,
    productId: "p1",
    name: "Tamanho",
    value: id,
    stockIncrement: estoque,
    active: true,
  };
}

function produto(extra: Partial<Product> = {}): Product {
  return {
    id: "p1",
    name: "Produto p1",
    description: "",
    price: 10,
    images: [],
    category: "geral",
    stock: 2,
    sold: 0,
    isActive: true,
    isBestseller: false,
    freeShipping: false,
    createdAt: new Date(0).toISOString(),
    ...extra,
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

describe("CartContext — addToCart informa quantas unidades entraram", () => {
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

  const quantidadeNoCarrinho = () =>
    atual.cart.reduce((soma, linha) => soma + linha.quantity, 0);

  it("sem variação: cabe → devolve a quantidade que entrou", async () => {
    let entrou: unknown;
    await act(async () => {
      entrou = atual.addToCart(produto(), 1);
    });
    expect(entrou).toBe(1);
    expect(quantidadeNoCarrinho()).toBe(1);
  });

  it("sem variação: estoque 2 com 2 no carrinho → devolve 0, nada muda e avisa o limite", async () => {
    await act(async () => {
      atual.addToCart(produto(), 2);
    });
    expect(quantidadeNoCarrinho()).toBe(2);
    toastError.mockClear();

    let entrou: unknown;
    await act(async () => {
      entrou = atual.addToCart(produto(), 1);
    });
    expect(entrou).toBe(0);
    expect(quantidadeNoCarrinho()).toBe(2);
    expect(toastError).toHaveBeenCalledTimes(1);
    expect(toastError.mock.calls[0]?.[0]).toBe(
      "Apenas 2 unidades disponíveis em estoque.",
    );
  });

  it("com variação: estoque 3 todo no carrinho → devolve 0", async () => {
    const p = produto({ stock: 99, variants: [variacao("v-m", 3)] });
    await act(async () => {
      atual.addToCart(p, 3, "v-m", "Tamanho: v-m");
    });
    let entrou: unknown;
    await act(async () => {
      entrou = atual.addToCart(p, 1, "v-m", "Tamanho: v-m");
    });
    expect(entrou).toBe(0);
    expect(quantidadeNoCarrinho()).toBe(3);
  });

  it("entrada parcial: pediu 3, coube 1 → devolve 1 e o aviso explica", async () => {
    await act(async () => {
      atual.addToCart(produto(), 1);
    });
    toastError.mockClear();
    let entrou: unknown;
    await act(async () => {
      entrou = atual.addToCart(produto(), 3);
    });
    expect(entrou).toBe(1);
    expect(quantidadeNoCarrinho()).toBe(2);
    expect(toastError).toHaveBeenCalledTimes(1);
  });

  it("linha nova com pedido acima do estoque: devolve só o que coube", async () => {
    let entrou: unknown;
    await act(async () => {
      entrou = atual.addToCart(produto(), 5);
    });
    expect(entrou).toBe(2);
    expect(toastError.mock.calls[0]?.[0]).toBe(
      "Apenas 2 unidades disponíveis.",
    );
  });

  it("produto esgotado: devolve 0 e diz que esgotou", async () => {
    let entrou: unknown;
    await act(async () => {
      entrou = atual.addToCart(produto({ stock: 0 }), 1);
    });
    expect(entrou).toBe(0);
    expect(quantidadeNoCarrinho()).toBe(0);
    expect(toastError.mock.calls[0]?.[0]).toBe("Este produto está esgotado.");
  });

  it("dois toques no MESMO instante (antes do React renderizar): o segundo já enxerga o primeiro", async () => {
    const resultados: unknown[] = [];
    await act(async () => {
      resultados.push(atual.addToCart(produto(), 2));
      resultados.push(atual.addToCart(produto(), 1));
    });
    expect(resultados).toEqual([2, 0]);
    expect(quantidadeNoCarrinho()).toBe(2);
  });
});
