// @vitest-environment jsdom
//
// Varredura de bugs (12/10/2026), frente "contextos": respostas atrasadas de
// uma conta não podem escrever no estado da conta seguinte, e o localStorage
// do carrinho não pode derrubar o Provider quando lança.
import { act, useContext, useEffect } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Product } from "@/types";

vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), {
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
    info: vi.fn(),
  }),
}));

vi.mock("@/hooks/useLeaderElection", () => ({
  useLeaderElection: () => ({ isLeader: false }),
}));

vi.mock("@/hooks/useProducts", () => ({
  useProducts: () => ({
    products: [
      { id: "pA", name: "Produto de A", price: 10, images: [] },
    ] as unknown as Product[],
    loading: false,
  }),
}));

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({ config: { shippingFee: 0, freeShippingMin: 0 } }),
}));

let usuarioDaVez: { id: string } | null = null;
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: usuarioDaVez, loading: false }),
}));

// Respostas controladas por teste: cada consulta fica presa até o teste soltar.
const presas = new Map<string, (linhas: unknown[]) => void>();

function consultaPresaPara(userId: string) {
  return new Promise((resolve) => {
    presas.set(userId, (linhas) => resolve({ data: linhas, error: null }));
  });
}

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: (tabela: string) => {
      if (tabela === "favorites") {
        return {
          select: () => ({
            eq: (_col: string, userId: string) => consultaPresaPara(userId),
          }),
          upsert: () => Promise.resolve({ error: null }),
        };
      }
      // notificacoes: própria (.eq) e campanha (.is)
      return {
        select: () => ({
          eq: (_col: string, userId: string) => ({
            order: () => ({ limit: () => consultaPresaPara(userId) }),
          }),
          is: () => ({
            order: () => ({
              limit: () => Promise.resolve({ data: [], error: null }),
            }),
          }),
        }),
      };
    },
    channel: () => ({
      on() {
        return this;
      },
      subscribe: () => ({}),
    }),
    removeChannel: () => Promise.resolve(),
  },
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function criarStorageFake() {
  const armazem = new Map<string, string>();
  return {
    getItem: (c: string) => armazem.get(c) ?? null,
    setItem: (c: string, v: string) => {
      armazem.set(c, v);
    },
    removeItem: (c: string) => {
      armazem.delete(c);
    },
    clear: () => armazem.clear(),
    key: (i: number) => Array.from(armazem.keys()).at(i) ?? null,
    get length() {
      return armazem.size;
    },
  };
}

let raiz: Root;
let hospedeiro: HTMLDivElement;

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  presas.clear();
  usuarioDaVez = null;
  vi.stubGlobal("localStorage", criarStorageFake());
  vi.stubGlobal(
    "BroadcastChannel",
    class {
      postMessage() {}
      addEventListener() {}
      removeEventListener() {}
      close() {}
      onmessage = null;
    },
  );
  hospedeiro = document.createElement("div");
  document.body.appendChild(hospedeiro);
  raiz = createRoot(hospedeiro);
});

afterEach(() => {
  act(() => {
    raiz.unmount();
  });
  hospedeiro.remove();
  vi.unstubAllGlobals();
});

async function flush() {
  await act(async () => {
    for (let i = 0; i < 6; i++) await Promise.resolve();
  });
}

let ultimo: any = null;
function Sonda({ contexto }: { contexto: React.Context<any> }) {
  const ctx = useContext(contexto);
  useEffect(() => {
    ultimo = ctx;
  });
  return null;
}

describe("FavoritesContext — resposta velha de A não grava após a troca para B", () => {
  it("o select de A que resolve depois da troca não entra em dbFavoriteIds", async () => {
    usuarioDaVez = { id: "userA" };
    const { FavoritesProvider, FavoritesContext } = await import(
      "@/contexts/FavoritesContext"
    );
    const arvore = () => (
      <FavoritesProvider>
        <Sonda contexto={FavoritesContext} />
      </FavoritesProvider>
    );

    await act(async () => {
      raiz.render(arvore());
    });
    const soltarA = presas.get("userA");
    expect(soltarA).toBeDefined();

    // Troca direta A -> B (sem passar por null); o select de A segue preso.
    usuarioDaVez = { id: "userB" };
    await act(async () => {
      raiz.render(arvore());
    });
    const soltarB = presas.get("userB");
    expect(soltarB).toBeDefined();

    // B responde vazio; depois a resposta ATRASADA de A chega.
    soltarB?.([]);
    await flush();
    soltarA?.([{ product_id: "pA" }]);
    await flush();

    expect(ultimo.favorites.map((p: Product) => p.id)).not.toContain("pA");
    expect(ultimo.loading).toBe(false);
  });
});

describe("NotificationContext — resposta velha de A não grava após a troca para B", () => {
  it("a lista de A que resolve depois da troca não aparece para B", async () => {
    usuarioDaVez = { id: "userA" };
    const { NotificationProvider } = await import(
      "@/contexts/NotificationContext"
    );
    const { NotificationContext } = await import(
      "@/contexts/NotificationContextCore"
    );
    const arvore = () => (
      <NotificationProvider>
        <Sonda contexto={NotificationContext} />
      </NotificationProvider>
    );

    await act(async () => {
      raiz.render(arvore());
    });
    const soltarA = presas.get("userA");
    expect(soltarA).toBeDefined();

    usuarioDaVez = { id: "userB" };
    await act(async () => {
      raiz.render(arvore());
    });
    const soltarB = presas.get("userB");
    expect(soltarB).toBeDefined();

    // A responde ANTES de B: a rodada velha não pode encerrar o loading da
    // rodada nova nem gravar a lista de A.
    soltarA?.([
      {
        id: "nA",
        usuario_id: "userA",
        titulo: "Aviso de A",
        mensagem: "",
        tipo: "system",
        lida: false,
        created_at: new Date(0).toISOString(),
      },
    ]);
    await flush();

    expect(ultimo.notifications.map((n: { id: string }) => n.id)).not.toContain(
      "nA",
    );
    expect(ultimo.loading).toBe(true);

    soltarB?.([]);
    await flush();
    expect(ultimo.loading).toBe(false);
  });
});

describe("CartContext — localStorage que lança não derruba o Provider", () => {
  it("getItem/setItem/removeItem lançando: monta com carrinho vazio e clearCart não quebra", async () => {
    const quebrado = () => {
      throw new DOMException("bloqueado", "SecurityError");
    };
    vi.stubGlobal("localStorage", {
      getItem: quebrado,
      setItem: quebrado,
      removeItem: quebrado,
    });
    const { CartProvider, useCartContext } = await import(
      "@/contexts/CartContext"
    );
    let estado: ReturnType<typeof useCartContext> | null = null;
    function SondaCart() {
      const c = useCartContext();
      useEffect(() => {
        estado = c;
      });
      return null;
    }

    await act(async () => {
      raiz.render(
        <CartProvider>
          <SondaCart />
        </CartProvider>,
      );
    });
    await flush();

    expect(estado).not.toBeNull();
    expect(estado!.cart).toEqual([]);
    expect(() => act(() => estado!.clearCart())).not.toThrow();
  });
});
