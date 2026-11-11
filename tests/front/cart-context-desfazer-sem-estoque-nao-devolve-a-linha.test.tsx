// @vitest-environment jsdom
//
// Sem a guarda de estoque zero no Desfazer, a linha removida voltaria com
// quantidade 0 e perderia a lápide, mesmo com todo o estoque em outra escolha.
import { act, useEffect } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CartProvider, useCartContext } from "@/contexts/CartContext";
import type { Product } from "@/types";

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

// Sem rede: o carrinho local segue valendo e o canal não entrega nada.
vi.mock("@/lib/supabase", () => {
  const canal = {
    on: () => canal,
    subscribe: () => canal,
  };
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

function produto(id: string, extra: Partial<Product> = {}): Product {
  return {
    id,
    name: `Produto ${id}`,
    description: "",
    price: 10,
    images: [],
    category: "geral",
    stock: 20,
    sold: 0,
    isActive: true,
    isBestseller: false,
    freeShipping: false,
    createdAt: new Date(0).toISOString(),
    ...extra,
  };
}

const CHAVE_LAPIDES = "marketplace_cart_tombstones_v1";

type Contexto = ReturnType<typeof useCartContext>;

function Sonda({ onEstado }: Readonly<{ onEstado: (c: Contexto) => void }>) {
  const contexto = useCartContext();
  useEffect(() => {
    onEstado(contexto);
  }, [contexto, onEstado]);
  return null;
}

function acaoDesfazer(): { label: string; onClick: () => void } {
  const chamada = toastInfo.mock.calls.at(-1);
  const opcoes = chamada?.[1] as
    | { action?: { label: string; onClick: () => void } }
    | undefined;
  if (!opcoes?.action) throw new Error("o aviso não trouxe a ação Desfazer");
  return opcoes.action;
}

function lapides(): string {
  return localStorage.getItem(CHAVE_LAPIDES) ?? "[]";
}

describe("CartContext — Desfazer sem estoque não devolve a linha", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let atual: Contexto;

  const camiseta = produto("cam", {
    variants: [
      { id: "vA", name: "Cor", value: "Azul", stockIncrement: 5 },
      { id: "vB", name: "Tam", value: "M", stockIncrement: 10 },
    ] as Product["variants"],
  });

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
    localStorage.setItem(
      "marketplace_cart_v1",
      JSON.stringify([
        { product: camiseta, quantity: 3, variantId: "vA", lastModifiedAt: 1 },
      ]),
    );
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

  async function removerEOcuparEstoque(quantidade: number) {
    expect(atual.cart.find((i) => i.variantId === "vA")?.quantity).toBe(3);
    await act(async () => {
      atual.removeFromCart("cam", "vA", { comDesfazer: true });
    });
    const { onClick } = acaoDesfazer();
    expect(atual.cart).toHaveLength(0);
    expect(lapides()).toContain("cam-vA");

    // vB~vA compartilha os mesmos cinco azuis da linha removida.
    await act(async () => {
      atual.addToCart(camiseta, quantidade, "vB~vA");
    });
    expect(atual.cart).toHaveLength(1);
    expect(atual.cart.at(0)?.quantity).toBe(quantidade);
    return onClick;
  }

  it("mantém a linha fora, a lápide e o aviso quando outra escolha leva os cinco azuis", async () => {
    const desfazer = await removerEOcuparEstoque(5);
    const lapidesAntes = lapides();
    const outraLinhaAntes = atual.cart.at(0);

    await act(async () => {
      desfazer();
    });

    expect(atual.cart.find((i) => i.variantId === "vA")).toBeUndefined();
    expect(atual.cart).toEqual([outraLinhaAntes]);
    expect(lapides()).toBe(lapidesAntes);
    expect(toastError).toHaveBeenCalledExactlyOnceWith(
      "Este produto está esgotado.",
    );
  });

  it("controle: se outra escolha leva quatro azuis, devolve um e retira a lápide", async () => {
    const desfazer = await removerEOcuparEstoque(4);

    await act(async () => {
      desfazer();
    });

    expect(atual.cart.find((i) => i.variantId === "vA")?.quantity).toBe(1);
    expect(
      atual.cart.filter((i) => i.variantId !== "vA").map((i) => i.quantity),
    ).toEqual([4]);
    expect(atual.cart).toHaveLength(2);
    expect(lapides()).not.toContain("cam-vA");
    expect(toastError).not.toHaveBeenCalled();
  });
});
