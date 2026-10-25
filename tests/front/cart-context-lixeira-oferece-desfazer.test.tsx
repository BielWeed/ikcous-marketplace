// @vitest-environment jsdom
//
// UI-170, achado C1 (caçador com navegador real): um toque na lixeira do
// carrinho tirava a linha INTEIRA (8 unidades, por exemplo), sem confirmação, e
// o aviso "Produto removido do carrinho" não tinha como voltar atrás. Agora o
// aviso da LIXEIRA ganha "Desfazer": devolve a linha como estava, uma vez só,
// sem ressuscitar nada que a pessoa não tirou e sem deixar a marca de remoção
// (lápide) de sincronização valendo contra a linha devolvida.
import { act, useEffect } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CartProvider, useCartContext } from "@/contexts/CartContext";
import type { CartItem, Product } from "@/types";

const toastInfo = vi.fn();
const toastError = vi.fn();
let usuarioAtual: { id: string } | null = null;

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({ config: { shippingFee: 0, freeShippingMin: 0 } }),
}));

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: usuarioAtual, loading: false }),
}));

vi.mock("@/hooks/useLeaderElection", () => ({
  useLeaderElection: () => ({ isLeader: true }),
}));

// Sem rede: a leitura do banco falha (o carrinho local segue valendo) e o
// canal em tempo real é um fantoche que não entrega nada.
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

/** A ação "Desfazer" do último aviso que a lixeira soltou. */
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

describe("CartContext — a lixeira do carrinho oferece Desfazer", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let atual: Contexto;

  const itens: CartItem[] = [
    { product: produto("p1"), quantity: 2, lastModifiedAt: 1000 },
    {
      product: produto("p2"),
      quantity: 8,
      variantNames: "Cor: Azul",
      lastModifiedAt: 2000,
    },
    { product: produto("p3"), quantity: 1, lastModifiedAt: 3000 },
  ];

  async function montar() {
    await act(async () => {
      raiz.render(
        <CartProvider>
          <Sonda onEstado={(c) => (atual = c)} />
        </CartProvider>,
      );
    });
  }

  beforeEach(async () => {
    usuarioAtual = null;
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
    localStorage.setItem("marketplace_cart_v1", JSON.stringify(itens));
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
    await montar();
  });

  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("o aviso da lixeira traz a ação Desfazer por tempo razoável", async () => {
    await act(async () => {
      atual.removeFromCart("p2", undefined, { comDesfazer: true });
    });

    expect(toastInfo).toHaveBeenCalledTimes(1);
    expect(toastInfo.mock.calls.at(0)?.at(0)).toBe(
      "Produto removido do carrinho",
    );
    const opcoes = toastInfo.mock.calls.at(0)?.at(1) as {
      duration: number;
      action: { label: string };
    };
    expect(opcoes.action.label).toBe("Desfazer");
    expect(opcoes.duration).toBeGreaterThanOrEqual(5000);
  });

  it("remoção de outros fluxos (sem a opção) segue sem Desfazer, igual a antes", async () => {
    await act(async () => {
      atual.removeFromCart("p2");
    });

    expect(toastInfo).toHaveBeenCalledWith("Produto removido do carrinho");
    expect(toastInfo.mock.calls.at(0)).toHaveLength(1);
  });

  it("remoção silenciosa não avisa nada, mesmo pedindo Desfazer", async () => {
    await act(async () => {
      atual.removeFromCart("p2", undefined, {
        silencioso: true,
        comDesfazer: true,
      });
    });

    expect(toastInfo).not.toHaveBeenCalled();
  });

  it("Desfazer devolve a linha como estava: 8 unidades, variação e a mesma posição", async () => {
    await act(async () => {
      atual.removeFromCart("p2", undefined, { comDesfazer: true });
    });
    expect(atual.cart.map((i) => i.product.id)).toEqual(["p1", "p3"]);

    await act(async () => {
      acaoDesfazer().onClick();
    });

    expect(atual.cart.map((i) => i.product.id)).toEqual(["p1", "p2", "p3"]);
    const devolvida = atual.cart.at(1);
    expect(devolvida?.quantity).toBe(8);
    expect(devolvida?.variantNames).toBe("Cor: Azul");
    expect(devolvida?.product.id).toBe("p2");
  });

  it("a lápide de sincronização sai junto: a linha devolvida não é apagada pela junção", async () => {
    await act(async () => {
      atual.removeFromCart("p2", undefined, { comDesfazer: true });
    });
    expect(lapides()).toContain("p2");

    await act(async () => {
      acaoDesfazer().onClick();
    });

    expect(lapides()).not.toContain("p2");
    // E a linha devolvida é mais nova que qualquer lápide anterior.
    expect(atual.cart.at(1)?.lastModifiedAt ?? 0).toBeGreaterThan(2000);
  });

  it("a lápide de OUTRO item não é tocada pelo Desfazer", async () => {
    await act(async () => {
      atual.removeFromCart("p1", undefined, { silencioso: true });
    });
    await act(async () => {
      atual.removeFromCart("p2", undefined, { comDesfazer: true });
    });
    await act(async () => {
      acaoDesfazer().onClick();
    });

    expect(lapides()).toContain("p1");
    expect(lapides()).not.toContain("p2");
  });

  it("Desfazer só vale uma vez: o segundo toque não dobra a quantidade", async () => {
    await act(async () => {
      atual.removeFromCart("p2", undefined, { comDesfazer: true });
    });
    const { onClick } = acaoDesfazer();

    await act(async () => {
      onClick();
    });
    await act(async () => {
      onClick();
    });

    expect(atual.cart.filter((i) => i.product.id === "p2")).toHaveLength(1);
    expect(atual.cart.find((i) => i.product.id === "p2")?.quantity).toBe(8);
  });

  it("se a pessoa já pôs o mesmo produto de novo, o Desfazer desiste e não mexe na quantidade", async () => {
    await act(async () => {
      atual.removeFromCart("p2", undefined, { comDesfazer: true });
    });
    const { onClick } = acaoDesfazer();
    await act(async () => {
      atual.addToCart(produto("p2"), 1);
    });

    await act(async () => {
      onClick();
    });

    const linhas = atual.cart.filter((i) => i.product.id === "p2");
    expect(linhas).toHaveLength(1);
    expect(linhas.at(0)?.quantity).toBe(1);
    expect(toastInfo).toHaveBeenCalledTimes(2);
  });

  it("depois de esvaziar o carrinho, o Desfazer antigo não ressuscita nada", async () => {
    await act(async () => {
      atual.removeFromCart("p2", undefined, { comDesfazer: true });
    });
    const { onClick } = acaoDesfazer();
    await act(async () => {
      atual.clearCart({ silencioso: true });
    });
    expect(atual.cart).toHaveLength(0);

    await act(async () => {
      onClick();
    });

    expect(atual.cart).toHaveLength(0);
  });

  it("depois de tirar linhas em silêncio (compra concluída), o Desfazer antigo não devolve nada", async () => {
    await act(async () => {
      atual.removeFromCart("p2", undefined, { comDesfazer: true });
    });
    const { onClick } = acaoDesfazer();
    await act(async () => {
      atual.removeFromCart("p1", undefined, { silencioso: true });
    });
    const antes = JSON.stringify(atual.cart);

    await act(async () => {
      onClick();
    });

    expect(JSON.stringify(atual.cart)).toBe(antes);
    expect(atual.cart.some((i) => i.product.id === "p2")).toBe(false);
  });

  it("se entrou OUTRA conta no meio, o Desfazer não devolve item da conta anterior", async () => {
    await act(async () => {
      atual.removeFromCart("p2", undefined, { comDesfazer: true });
    });
    const { onClick } = acaoDesfazer();

    usuarioAtual = { id: "conta-b" };
    await montar();
    const antes = JSON.stringify(atual.cart);

    await act(async () => {
      onClick();
    });

    expect(atual.cart.some((i) => i.product.id === "p2")).toBe(false);
    expect(JSON.stringify(atual.cart)).toBe(antes);
    expect(lapides()).not.toBe("[]");
  });

  it("o Desfazer respeita o estoque de hoje: devolve só o que ainda cabe", async () => {
    const camiseta = produto("cam", {
      variants: [
        { id: "vA", name: "Cor", value: "Azul", stockIncrement: 5 },
        { id: "vB", name: "Tam", value: "M", stockIncrement: 10 },
      ] as Product["variants"],
    });
    localStorage.setItem(
      "marketplace_cart_v1",
      JSON.stringify([
        { product: camiseta, quantity: 3, variantId: "vA", lastModifiedAt: 1 },
      ]),
    );
    await act(async () => {
      raiz.unmount();
    });
    raiz = createRoot(hospedeiro);
    await montar();

    await act(async () => {
      atual.removeFromCart("cam", "vA", { comDesfazer: true });
    });
    const { onClick } = acaoDesfazer();
    // Outra linha passa a levar 4 dos 5 azuis (vB~vA usa as duas variações).
    await act(async () => {
      atual.addToCart(camiseta, 4, "vB~vA");
    });

    await act(async () => {
      onClick();
    });

    const devolvida = atual.cart.find((i) => i.variantId === "vA");
    expect(devolvida?.quantity).toBe(1);
  });
});
