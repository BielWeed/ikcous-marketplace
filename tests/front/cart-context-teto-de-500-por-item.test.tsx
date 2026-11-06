// @vitest-environment jsdom
//
// Estoque maior que 500: a tela deixava pedir 800, o carrinho cortava para 500
// em silêncio e a vitrine celebrava "Adicionado". Agora o corte por teto
// (500 por item) sempre avisa, e o aviso diz o motivo CERTO: estoque quando o
// estoque é o limite, teto quando é o teto. O preço, o total e o frete não
// mudam -- só o que a pessoa lê.
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

describe("CartContext — teto de 500 por item avisa e não celebra", () => {
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

  it("estoque 800, pede 800 (linha nova): entram 500 e avisa o teto, não o estoque", async () => {
    let entrou: unknown;
    await act(async () => {
      entrou = atual.addToCart(produto(800), 800);
    });
    expect(entrou).toBe(500);
    expect(quantidadeNoCarrinho()).toBe(500);
    expect(toastError).toHaveBeenCalledTimes(1);
    expect(toastError.mock.calls[0]?.[0]).toBe(AVISO_DO_TETO);
  });

  it("estoque 800, pede 900 (acima do estoque E do teto): o motivo é o teto, não 'só 800'", async () => {
    await act(async () => {
      atual.addToCart(produto(800), 900);
    });
    expect(quantidadeNoCarrinho()).toBe(500);
    expect(toastError.mock.calls[0]?.[0]).toBe(AVISO_DO_TETO);
  });

  it("item que já existe: 400 + 400 corta em 500 e avisa o teto (antes só console.error)", async () => {
    await act(async () => {
      atual.addToCart(produto(800), 400);
    });
    expect(toastError).not.toHaveBeenCalled();
    let entrou: unknown;
    await act(async () => {
      entrou = atual.addToCart(produto(800), 400);
    });
    expect(entrou).toBe(100);
    expect(quantidadeNoCarrinho()).toBe(500);
    expect(toastError).toHaveBeenCalledTimes(1);
    expect(toastError.mock.calls[0]?.[0]).toBe(AVISO_DO_TETO);
  });

  it("item que já existe no teto: +1 não entra (devolve 0) e avisa o teto", async () => {
    await act(async () => {
      atual.addToCart(produto(800), 500);
    });
    expect(toastError).not.toHaveBeenCalled();
    let entrou: unknown;
    await act(async () => {
      entrou = atual.addToCart(produto(800), 1);
    });
    expect(entrou).toBe(0);
    expect(quantidadeNoCarrinho()).toBe(500);
    expect(toastError.mock.calls[0]?.[0]).toBe(AVISO_DO_TETO);
  });

  it("controle, estoque 800 pedindo exatamente 500: entram 500 e NÃO avisa nada", async () => {
    let entrou: unknown;
    await act(async () => {
      entrou = atual.addToCart(produto(800), 500);
    });
    expect(entrou).toBe(500);
    expect(toastError).not.toHaveBeenCalled();
  });

  it("controle, estoque 500 pedindo 500: entram 500, sem aviso", async () => {
    await act(async () => {
      atual.addToCart(produto(500), 500);
    });
    expect(quantidadeNoCarrinho()).toBe(500);
    expect(toastError).not.toHaveBeenCalled();
  });

  it("controle, estoque 500 pedindo 501: o limite é o ESTOQUE e o aviso segue falando de estoque", async () => {
    await act(async () => {
      atual.addToCart(produto(500), 501);
    });
    expect(quantidadeNoCarrinho()).toBe(500);
    expect(toastError.mock.calls[0]?.[0]).toBe(
      "Apenas 500 unidades disponíveis.",
    );
  });

  it("controle, estoque 3 pedindo 5: aviso de estoque de sempre, nada de teto", async () => {
    await act(async () => {
      atual.addToCart(produto(3), 5);
    });
    expect(quantidadeNoCarrinho()).toBe(3);
    expect(toastError).toHaveBeenCalledTimes(1);
    expect(toastError.mock.calls[0]?.[0]).toBe(
      "Apenas 3 unidades disponíveis.",
    );
  });

  it("trocar a quantidade no carrinho para 800 (estoque 800): fica em 500 e avisa o teto", async () => {
    await act(async () => {
      atual.addToCart(produto(800), 10);
    });
    toastError.mockClear();
    await act(async () => {
      atual.updateQuantity("p1", 800);
    });
    expect(quantidadeNoCarrinho()).toBe(500);
    expect(toastError).toHaveBeenCalledTimes(1);
    expect(toastError.mock.calls[0]?.[0]).toBe(AVISO_DO_TETO);
  });

  it("trocar para 900 com estoque 800: o motivo é o teto, não 'limite de estoque (800)'", async () => {
    await act(async () => {
      atual.addToCart(produto(800), 10);
    });
    toastError.mockClear();
    await act(async () => {
      atual.updateQuantity("p1", 900);
    });
    expect(quantidadeNoCarrinho()).toBe(500);
    expect(toastError.mock.calls[0]?.[0]).toBe(AVISO_DO_TETO);
  });

  it("controle, trocar para 500 (estoque 800): sem aviso", async () => {
    await act(async () => {
      atual.addToCart(produto(800), 10);
    });
    toastError.mockClear();
    await act(async () => {
      atual.updateQuantity("p1", 500);
    });
    expect(quantidadeNoCarrinho()).toBe(500);
    expect(toastError).not.toHaveBeenCalled();
  });

  it("controle, trocar para 5 com estoque 3: aviso de estoque de sempre", async () => {
    await act(async () => {
      atual.addToCart(produto(3), 1);
    });
    toastError.mockClear();
    await act(async () => {
      atual.updateQuantity("p1", 5);
    });
    expect(quantidadeNoCarrinho()).toBe(3);
    expect(toastError).toHaveBeenCalledTimes(1);
    expect(toastError.mock.calls[0]?.[0]).toBe(
      "Limite de estoque atingido (3 unidades).",
    );
  });
});
