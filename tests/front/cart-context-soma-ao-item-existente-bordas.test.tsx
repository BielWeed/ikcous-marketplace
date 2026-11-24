// @vitest-environment jsdom
//
// Somar ao item que JÁ está no carrinho: duas bordas que as mutações mostraram
// sem teste.
//
//   1. Chegar EXATAMENTE em 500 (499 + 1) não é "corte pelo teto": entra tudo,
//      sem toast de erro. O aviso do teto só vale quando o pedido PASSOU de 500.
//   2. Se o estoque caiu abaixo do que já está no carrinho (a lojista baixou o
//      estoque), somar mais uma unidade não "entra" nada: `entrou` é 0, nunca
//      negativo -- a vitrine usa `entrou === 0` para não comemorar "Adicionado".
//
// Mutações medidas: tirar a condição de excesso do aviso do teto (ou usar `>=`)
// e tirar o `Math.max(..., 0)` do `entrou` deixavam todos os testes de
// CartContext verdes.
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

const AVISO_DO_TETO = "Máximo de 500 unidades por item em cada pedido.";

function produto(estoque: number): Product {
  return {
    id: "p1",
    name: "Produto p1",
    description: "",
    price: 10,
    images: [],
    category: "geral",
    stock: estoque,
    sold: 0,
    isActive: true,
    isBestseller: false,
    freeShipping: false,
    createdAt: new Date(0).toISOString(),
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

describe("CartContext: somar ao item que já existe", () => {
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

  it("499 + 1 chega em 500 sem aviso de teto (o pedido não passou de 500)", async () => {
    await act(async () => {
      atual.addToCart(produto(800), 499);
    });
    let entrou: unknown;
    await act(async () => {
      entrou = atual.addToCart(produto(800), 1);
    });
    expect(entrou).toBe(1);
    expect(quantidadeNoCarrinho()).toBe(500);
    expect(toastError).not.toHaveBeenCalled();
  });

  it("499 + 2 passa de 500: entra 1 e avisa o teto (controle)", async () => {
    await act(async () => {
      atual.addToCart(produto(800), 499);
    });
    let entrou: unknown;
    await act(async () => {
      entrou = atual.addToCart(produto(800), 2);
    });
    expect(entrou).toBe(1);
    expect(toastError.mock.calls[0]?.[0]).toBe(AVISO_DO_TETO);
  });

  it("estoque caiu abaixo do que já está no carrinho: somar não 'entra' nada (0, nunca negativo)", async () => {
    await act(async () => {
      atual.addToCart(produto(10), 8);
    });
    let entrou: unknown;
    await act(async () => {
      // A lojista baixou o estoque para 5 com 8 já no carrinho.
      entrou = atual.addToCart(produto(5), 1);
    });
    expect(entrou).toBe(0);
  });
});
