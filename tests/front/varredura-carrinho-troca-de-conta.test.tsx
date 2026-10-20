// @vitest-environment jsdom
//
// Varredura de bugs (13/10/2026) — `CartContext.syncFromDB` lê `cart_items` do
// usuário que estava logado quando a leitura COMEÇOU e, ao voltar, mescla o
// resultado no carrinho sem conferir se a conta ainda é a mesma. Se a conta
// sai (ou troca) durante a leitura, o efeito de troca já limpou o carrinho e
// a resposta do usuário antigo reaparece nele: itens de uma conta no
// carrinho de quem está agora (ou do convidado) — e o sync de volta ao banco
// os gravaria na conta nova.
import { CartProvider, useCartContext } from "@/contexts/CartContext";
import type { CartItem } from "@/types";
import { act, useEffect } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const estado = vi.hoisted(() => ({
  usuario: null as null | { id: string },
  liberarItens: null as null | ((itens: unknown[]) => void),
}));

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({ config: { shippingFee: 0, freeShippingMin: 0 } }),
}));
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: estado.usuario, loading: false }),
}));
vi.mock("@/hooks/useLeaderElection", () => ({
  useLeaderElection: () => ({ isLeader: true }),
}));
vi.mock("@/lib/mappers", () => ({
  mapProductFromDB: (r: { id: string }) => ({
    id: r.id,
    name: `Produto ${r.id}`,
    description: "",
    price: 10,
    images: [],
    category: "geral",
    stock: 10,
    sold: 0,
    isActive: true,
    isBestseller: false,
    freeShipping: false,
    createdAt: "2026-01-01T00:00:00.000Z",
  }),
}));
vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: (tabela: string) => ({
      select: () => ({
        eq: () =>
          new Promise((resolve) => {
            estado.liberarItens = (itens) =>
              resolve({ data: itens, error: null });
          }),
        in: () =>
          Promise.resolve({
            data: tabela === "vw_produtos_public" ? [{ id: "pA" }] : [],
            error: null,
          }),
      }),
    }),
    auth: {
      getSession: () => Promise.resolve({ data: { session: { user: {} } } }),
    },
    rpc: vi.fn(() => Promise.resolve({ error: null })),
    channel: vi.fn(() => ({
      on: vi.fn().mockReturnThis(),
      subscribe: vi.fn().mockReturnThis(),
    })),
    removeChannel: vi.fn(() => Promise.resolve("ok")),
  },
}));
vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn(), info: vi.fn(), warning: vi.fn() },
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let cartAtual: CartItem[] = [];
function Sonda() {
  const { cart } = useCartContext();
  useEffect(() => {
    cartAtual = cart;
  }, [cart]);
  return null;
}

describe("CartContext — leitura de uma conta que saiu não volta ao carrinho", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    cartAtual = [];
    estado.liberarItens = null;
    estado.usuario = { id: "uA" };
    const armazem = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => armazem.get(k) ?? null,
      setItem: (k: string, v: string) => void armazem.set(k, v),
      removeItem: (k: string) => void armazem.delete(k),
    });
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => raiz.unmount());
    hospedeiro.remove();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  const montar = () => (
    <CartProvider>
      <Sonda />
    </CartProvider>
  );

  it("a conta sai com a leitura em voo: a resposta tardia não põe itens no carrinho", async () => {
    await act(async () => raiz.render(montar()));
    // A leitura da conta A está pendurada no servidor.
    expect(estado.liberarItens).toBeTruthy();
    const liberarDaContaA = estado.liberarItens as (i: unknown[]) => void;

    // A conta sai (convidado).
    estado.usuario = null;
    await act(async () => raiz.render(montar()));
    expect(cartAtual).toHaveLength(0);

    // A resposta atrasada da conta A chega.
    await act(async () => {
      liberarDaContaA([
        {
          product_id: "pA",
          variant_id: null,
          quantity: 1,
          updated_at: new Date().toISOString(),
        },
      ]);
    });

    expect(cartAtual).toHaveLength(0);
  });

  it("controle: sem troca de conta, a leitura preenche o carrinho", async () => {
    await act(async () => raiz.render(montar()));
    const liberar = estado.liberarItens as (i: unknown[]) => void;
    await act(async () => {
      liberar([
        {
          product_id: "pA",
          variant_id: null,
          quantity: 1,
          updated_at: new Date().toISOString(),
        },
      ]);
    });
    expect(cartAtual.map((i) => i.product.id)).toEqual(["pA"]);
  });
});
