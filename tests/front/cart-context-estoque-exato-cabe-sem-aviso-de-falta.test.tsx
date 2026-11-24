// @vitest-environment jsdom
//
// A FRONTEIRA que os vizinhos não pisam: a quantidade que a cliente pede é
// EXATAMENTE o que ainda há. Cabe tudo -- então o carrinho NÃO pode gritar
// "só restam N" como se tivesse cortado alguma coisa. O aviso só nasce quando
// o pedido PASSA do estoque (quantidade + 1).
//
// Por que importa: `addToCart` transforma o aviso em toast de erro. Com o
// `>` virando `>=` no carrinho, quem leva a ÚLTIMA unidade que existe via
// "Só resta 1 unidade disponível em estoque" logo depois de a unidade entrar:
// parece que a compra falhou, e a cliente desiste de uma venda que deu certo.
//
// Mutação medida (`existing.quantity + qToAdd > availableStock` -> `>=`): os
// testes vizinhos (`cart-context-adicionar-informa-quantas-entraram`,
// `carrinho-limite-usa-o-estoque-da-variacao`, `cart-context-teto-de-500-por-item`)
// ficavam todos verdes. Estes dois reprovam.
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
    stock: 3,
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

describe("CartContext — o estoque exato cabe, e só quantidade + 1 avisa", () => {
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

  it("linha que já existe: 1 no carrinho + 2 pedidos = estoque 3 → entram os 2, sem aviso; pedir mais 1 avisa e não entra", async () => {
    await act(async () => {
      atual.addToCart(produto(), 1);
    });
    toastError.mockClear();

    let entrou: unknown;
    await act(async () => {
      entrou = atual.addToCart(produto(), 2);
    });
    // Cabe exatamente: tudo entra e NADA de aviso de falta.
    expect(entrou).toBe(2);
    expect(quantidadeNoCarrinho()).toBe(3);
    expect(toastError).not.toHaveBeenCalled();

    // Quantidade + 1: agora SIM passa do estoque -- nada entra e o aviso nasce.
    await act(async () => {
      entrou = atual.addToCart(produto(), 1);
    });
    expect(entrou).toBe(0);
    expect(quantidadeNoCarrinho()).toBe(3);
    expect(toastError).toHaveBeenCalledTimes(1);
    expect(toastError.mock.calls[0]?.[0]).toBe(
      "Apenas 3 unidades disponíveis em estoque.",
    );
  });

  it("variação com 1 só unidade: a ÚLTIMA entra sem aviso; a segunda tentativa avisa no singular", async () => {
    const p = produto({ stock: 99, variants: [variacao("v-ultima", 1)] });

    let entrou: unknown;
    await act(async () => {
      entrou = atual.addToCart(p, 1, "v-ultima", "Tamanho: v-ultima");
    });
    expect(entrou).toBe(1);
    expect(toastError).not.toHaveBeenCalled();

    await act(async () => {
      entrou = atual.addToCart(p, 1, "v-ultima", "Tamanho: v-ultima");
    });
    expect(entrou).toBe(0);
    expect(quantidadeNoCarrinho()).toBe(1);
    expect(toastError).toHaveBeenCalledTimes(1);
    expect(toastError.mock.calls[0]?.[0]).toBe(
      "Só resta 1 unidade disponível em estoque.",
    );
  });
});
