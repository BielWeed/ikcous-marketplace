// @vitest-environment jsdom
//
// Lote 223 (caça 10): remover pelo coração tirava o favorito na hora, com um
// aviso sem saída. Agora o aviso traz "Desfazer" (como o do carrinho), que
// devolve o produto NA MESMA POSIÇÃO da lista do visitante.
import type { Context } from "react";
import { act } from "react";
import { useContext, useEffect } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Product } from "@/types";

const toastSuccess = vi.fn();
vi.mock("sonner", () => ({
  toast: { success: toastSuccess, error: vi.fn(), warning: vi.fn() },
}));
vi.mock("@/hooks/useLeaderElection", () => ({
  useLeaderElection: () => ({ isLeader: false }),
}));

const catalogo: Product[] = ["p1", "p2", "p3"].map(
  (id) =>
    ({
      id,
      name: id,
      price: 10,
      stock: 5,
      isActive: true,
      images: [],
    }) as never,
);
vi.mock("@/hooks/useProducts", () => ({
  useProducts: () => ({ products: catalogo, loading: false }),
}));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: null }) }));
vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: () => {
      throw new Error("visitante não toca o servidor");
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

function storageFake() {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
    clear: () => m.clear(),
    key: (i: number) => Array.from(m.keys()).at(i) ?? null,
    get length() {
      return m.size;
    },
  };
}

let ultimo: {
  favorites: Product[];
  toggleFavorite: (p: Product) => void;
} | null = null;
function Sonda({ contexto }: { contexto: Context<any> }) {
  const ctx = useContext(contexto);
  useEffect(() => {
    ultimo = ctx;
  });
  return null;
}

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let raiz: Root;
let host: HTMLDivElement;

beforeEach(() => {
  vi.resetModules();
  toastSuccess.mockClear();
  ultimo = null;
  const st = storageFake();
  st.setItem("ikcous_favorites", JSON.stringify(["p1", "p2", "p3"]));
  vi.stubGlobal("localStorage", st);
  vi.stubGlobal(
    "BroadcastChannel",
    class {
      postMessage() {}
      addEventListener() {}
      removeEventListener() {}
      close() {}
    },
  );
  host = document.createElement("div");
  document.body.appendChild(host);
  raiz = createRoot(host);
});
afterEach(() => {
  act(() => raiz.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

describe("Favoritos — remover oferece Desfazer", () => {
  it("o aviso traz Desfazer e ele devolve o item na mesma posição", async () => {
    const { FavoritesProvider, FavoritesContext } = await import(
      "@/contexts/FavoritesContext"
    );
    await act(async () => {
      raiz.render(
        <FavoritesProvider>
          <Sonda contexto={FavoritesContext} />
        </FavoritesProvider>,
      );
    });
    expect(ultimo?.favorites.map((p) => p.id)).toEqual(["p1", "p2", "p3"]);

    await act(async () => {
      ultimo?.toggleFavorite(catalogo[1]);
    });
    expect(ultimo?.favorites.map((p) => p.id)).toEqual(["p1", "p3"]);

    const chamada = toastSuccess.mock.calls.find(
      (c) => c[0] === "Removido dos favoritos",
    );
    const opcoes = chamada?.[1] as {
      duration: number;
      action: { label: string; onClick: () => void };
    };
    expect(opcoes.action.label).toBe("Desfazer");
    expect(opcoes.duration).toBeGreaterThanOrEqual(5000);

    await act(async () => {
      opcoes.action.onClick();
    });
    expect(ultimo?.favorites.map((p) => p.id)).toEqual(["p1", "p2", "p3"]);
  });
});
