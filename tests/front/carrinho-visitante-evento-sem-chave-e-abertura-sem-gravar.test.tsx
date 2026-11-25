// @vitest-environment jsdom
//
// Caça por mutação em `src/contexts/CartContext.tsx` (24/11/2026), visitante
// (sem conta) com o app em duas abas:
//  - quando a outra aba LIMPA o armazenamento inteiro (`localStorage.clear()`),
//    o navegador avisa com um evento de chave NULA ("tudo mudou"). Esta aba
//    precisa reler o carrinho guardado, e não ignorar o aviso por não ter o
//    nome da chave carrinho nele;
//  - abrir o app NÃO grava o carrinho de volta antes de a leitura inicial
//    terminar (gravar antes da hora é como um carrinho guardado ser trocado por
//    um vazio).
import { CartProvider, useCartContext } from "@/contexts/CartContext";
import type { CartItem, Product } from "@/types";
import { act, useEffect } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const CHAVE = "marketplace_cart_v1";

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({ config: { shippingFee: 0, freeShippingMin: 0 } }),
}));
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: null, loading: false }),
}));
vi.mock("@/hooks/useLeaderElection", () => ({
  useLeaderElection: () => ({ isLeader: false }),
}));
vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: () => ({
      select: () => ({
        eq: () => Promise.resolve({ data: [], error: null }),
        in: () => Promise.resolve({ data: [], error: null }),
      }),
    }),
    rpc: () => Promise.resolve({ error: null }),
    auth: {
      getSession: () => Promise.resolve({ data: { session: null } }),
    },
    channel: () => ({ on: () => ({ subscribe: () => ({}) }) }),
    removeChannel: () => Promise.resolve(),
  },
}));
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
    stock: 5,
    sold: 0,
    isActive: true,
    isBestseller: false,
    freeShipping: false,
    createdAt: new Date(0).toISOString(),
  };
}

function item(id: string, quantity = 1): CartItem {
  return { product: produto(id), quantity, lastModifiedAt: 1_760_000_000_000 };
}

type Contexto = ReturnType<typeof useCartContext>;

function Sonda({ onEstado }: Readonly<{ onEstado: (c: Contexto) => void }>) {
  const contexto = useCartContext();
  useEffect(() => {
    onEstado(contexto);
  }, [contexto, onEstado]);
  return null;
}

describe("CartContext (visitante) — aviso sem chave e abertura sem gravar", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let atual: Contexto;
  let armazem: Map<string, string>;
  let gravacoesDoCarrinho: number;

  beforeEach(() => {
    armazem = new Map<string, string>();
    gravacoesDoCarrinho = 0;
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => armazem.get(k) ?? null,
      setItem: (k: string, v: string) => {
        if (k === CHAVE) gravacoesDoCarrinho += 1;
        armazem.set(k, v);
      },
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
    vi.restoreAllMocks();
  });

  async function esperar(ms = 40) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, ms));
    });
  }

  async function abrirOApp() {
    await act(async () => {
      raiz.render(
        <CartProvider>
          <Sonda onEstado={(c) => (atual = c)} />
        </CartProvider>,
      );
    });
    await esperar();
  }

  const ids = () => atual.cart.map((i) => i.product.id);

  it("a outra aba limpou o armazenamento (evento de chave nula) e deixou um carrinho: esta aba adota", async () => {
    await abrirOApp();
    expect(ids()).toEqual([]);

    armazem.set(CHAVE, JSON.stringify([item("A", 2)]));
    await act(async () => {
      window.dispatchEvent(new StorageEvent("storage", { key: null }));
    });
    await esperar();

    expect(ids()).toEqual(["A"]);
    expect(atual.cart.at(0)?.quantity).toBe(2);
  });

  it("evento de chave nula com o carrinho guardado vazio: esta aba esvazia também", async () => {
    await abrirOApp();
    armazem.set(CHAVE, JSON.stringify([item("A")]));
    await act(async () => {
      window.dispatchEvent(new StorageEvent("storage", { key: CHAVE }));
    });
    await esperar();
    expect(ids()).toEqual(["A"]);

    armazem.delete(CHAVE);
    await act(async () => {
      window.dispatchEvent(new StorageEvent("storage", { key: null }));
    });
    await esperar();

    expect(ids()).toEqual([]);
  });

  it("abrir o app sem carrinho guardado não grava nada (nem um '[]') no armazenamento", async () => {
    await abrirOApp();

    expect(gravacoesDoCarrinho).toBe(0);
    expect(armazem.has(CHAVE)).toBe(false);
  });

  it("abrir o app com um carrinho guardado também não o regrava", async () => {
    const guardado = JSON.stringify([item("A", 3)], null, 2);
    armazem.set(CHAVE, guardado);

    await abrirOApp();

    expect(ids()).toEqual(["A"]);
    expect(gravacoesDoCarrinho).toBe(0);
    expect(armazem.get(CHAVE)).toBe(guardado);
  });
});
