// @vitest-environment jsdom
//
// O lembrete "Seu carrinho" conta os itens do ESTADO ATUAL (lote 238, caça 11-D
// #7). DEFEITO MEDIDO: o lembrete lia `getCartCount()`, que devolve um ref
// atualizado num efeito DEPOIS do desenho — ao adicionar outro item com o
// lembrete aberto, ele seguia dizendo "1 item" (e a bolinha 1), enquanto o
// "Faltam R$ X", que vem do estado, já considerava os dois.
//
// Provider de verdade (a contagem velha só nasce da ordem render -> efeito do
// CartContext), CartReminder de verdade.
import { act, useEffect } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CartReminder } from "@/components/ui/custom/CartReminder";
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

function produto(id: string): Product {
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
  };
}

let adicionar: (p: Product, q?: number) => unknown;

function Sonda() {
  const { addToCart } = useCartContext();
  useEffect(() => {
    adicionar = addToCart;
  }, [addToCart]);
  return null;
}

describe("CartReminder — a contagem acompanha o carrinho", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    const armazem = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => armazem.get(k) ?? null,
      setItem: (k: string, v: string) => void armazem.set(k, v),
      removeItem: (k: string) => void armazem.delete(k),
    });
    vi.stubGlobal(
      "BroadcastChannel",
      class {
        onmessage = null;
        postMessage() {}
        close() {}
      },
    );
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => raiz.unmount());
    hospedeiro.remove();
    vi.unstubAllGlobals();
  });

  async function esperar(ms: number) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, ms));
    });
  }

  async function montarComUmItem() {
    await act(async () => {
      raiz.render(
        <CartProvider>
          <Sonda />
          <CartReminder docked onAction={() => {}} />
        </CartProvider>,
      );
    });
    await esperar(50);
    await act(async () => {
      adicionar(produto("a"));
    });
    // O lembrete aparece 500 ms depois de haver item (modo acoplado).
    await esperar(700);
  }

  it("com o lembrete aberto, adicionar outro produto muda 'Seu carrinho' para 2 itens", async () => {
    await montarComUmItem();
    expect(hospedeiro.textContent).toContain("1 item no seu carrinho");

    await act(async () => {
      adicionar(produto("b"));
    });

    expect(hospedeiro.textContent).toContain("2 itens no seu carrinho");
    expect(hospedeiro.textContent).not.toContain("1 item no seu carrinho");
  });

  it("a bolinha do ícone também mostra a contagem nova", async () => {
    await montarComUmItem();

    await act(async () => {
      adicionar(produto("b"), 2);
    });

    expect(hospedeiro.textContent).toContain("3 itens no seu carrinho");
    const bolinha = [...hospedeiro.querySelectorAll("span")].find(
      (s) => s.textContent === "3",
    );
    expect(bolinha).toBeDefined();
  });
});
