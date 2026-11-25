// @vitest-environment jsdom
//
// Duas bordas do `addToCart` que ninguém vigiava:
//  1. tentar pôr de novo um produto que SAIU do carrinho, mas que está
//     esgotado, não pode apagar a lápide da retirada (nada entrou; a lápide é o
//     que impede o outro aparelho de ressuscitar a linha na junção);
//  2. o nome da variação que chega vazio vira "ausente" (nunca texto vazio
//     gravado na linha).
import { act, useEffect } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CartProvider, useCartContext } from "@/contexts/CartContext";
import type { Product } from "@/types";

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
    error: vi.fn(),
    info: vi.fn(),
    success: vi.fn(),
    warning: vi.fn(),
  }),
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const CHAVE_DAS_LAPIDES_DO_VISITANTE = "marketplace_cart_tombstones_v1";

function produto(extra: Partial<Product> = {}): Product {
  return {
    id: "p1",
    name: "Produto p1",
    description: "",
    price: 10,
    images: [],
    category: "geral",
    stock: 5,
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

describe("CartContext — addToCart: lápide e nome da variação", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let atual: Contexto;
  let armazem: Map<string, string>;

  beforeEach(async () => {
    armazem = new Map<string, string>();
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
  });

  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  function chavesDasLapides(): string[] {
    const bruto = armazem.get(CHAVE_DAS_LAPIDES_DO_VISITANTE);
    if (!bruto) return [];
    return (JSON.parse(bruto) as { key: string }[]).map((t) => t.key);
  }

  it("retirou o produto (lápide gravada) e tentou pôr de novo ESGOTADO: nada entra e a lápide fica", async () => {
    await act(async () => {
      atual.addToCart(produto(), 1);
    });
    await act(async () => {
      atual.removeFromCart("p1");
    });
    expect(atual.cart).toEqual([]);
    expect(chavesDasLapides()).toHaveLength(1);

    let entrou: unknown;
    await act(async () => {
      entrou = atual.addToCart(produto({ stock: 0 }), 1);
    });
    expect(entrou).toBe(0);
    expect(atual.cart).toEqual([]);
    expect(chavesDasLapides()).toHaveLength(1);
  });

  it("retirou e pôs de novo COM estoque: entrou, e a lápide da retirada sai", async () => {
    await act(async () => {
      atual.addToCart(produto(), 1);
    });
    await act(async () => {
      atual.removeFromCart("p1");
    });
    expect(chavesDasLapides()).toHaveLength(1);

    let entrou: unknown;
    await act(async () => {
      entrou = atual.addToCart(produto(), 1);
    });
    expect(entrou).toBe(1);
    expect(atual.cart).toHaveLength(1);
    expect(chavesDasLapides()).toHaveLength(0);
  });

  it("nome da variação vazio vira ausente; nome de verdade é guardado", async () => {
    await act(async () => {
      atual.addToCart(produto({ id: "p-vazio" }), 1, undefined, "");
    });
    await act(async () => {
      atual.addToCart(produto({ id: "p-nome" }), 1, undefined, "Cor: Azul");
    });
    const vazio = atual.cart.find((l) => l.product.id === "p-vazio");
    const nome = atual.cart.find((l) => l.product.id === "p-nome");
    expect(vazio?.variantNames).toBeUndefined();
    expect(nome?.variantNames).toBe("Cor: Azul");
  });
});
