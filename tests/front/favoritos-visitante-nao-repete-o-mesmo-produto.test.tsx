// @vitest-environment jsdom
import { type ContextType, act, useContext, useEffect } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import {
  FavoritesContext,
  FavoritesProvider,
} from "@/contexts/FavoritesContext";
import type { Product } from "@/types";

vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: null }) }));
vi.mock("@/hooks/useLeaderElection", () => ({
  useLeaderElection: () => ({ isLeader: false }),
}));
vi.mock("@/hooks/useProducts", () => ({
  useProducts: () => ({ products: [], loading: false }),
}));
vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: () => {
      throw new Error("Visitante não deve acessar o banco");
    },
    channel: () => ({
      on() {
        return this;
      },
      subscribe: () => ({}),
    }),
    removeChannel: async () => {},
  },
}));
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let raiz: Root;
let hospedeiro: HTMLDivElement;
let armazem: Map<string, string>;
let atual: NonNullable<ContextType<typeof FavoritesContext>>;
function Sonda() {
  const retorno = useContext(FavoritesContext);
  useEffect(() => {
    if (retorno) atual = retorno;
  });
  return null;
}
const produto = (id: string) =>
  ({
    id,
    name: "Camiseta de teste",
    price: 50,
    stock: 10,
    isActive: true,
    images: [],
  }) as unknown as Product;
const idsNoAparelho = () => JSON.parse(armazem.get("ikcous_favorites") ?? "[]");

beforeEach(() => {
  vi.clearAllMocks();
  armazem = new Map();
  vi.stubGlobal("localStorage", {
    getItem: (chave: string) => armazem.get(chave) ?? null,
    setItem: (chave: string, valor: string) => armazem.set(chave, valor),
    removeItem: (chave: string) => armazem.delete(chave),
  });
  vi.stubGlobal(
    "BroadcastChannel",
    class {
      postMessage() {}
      addEventListener() {}
      removeEventListener() {}
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

it("duas inclusões do mesmo produto guardam um id; outro produto continua sendo acrescentado", async () => {
  await act(async () => {
    raiz.render(
      <FavoritesProvider>
        <Sonda />
      </FavoritesProvider>,
    );
  });

  // Dois pedidos de inclusão antes do próximo render usam o mesmo retrato.
  // É o caminho público que alcança duas chamadas de addToFavorites.
  await act(async () => {
    atual.toggleFavorite(produto("p-1"));
    atual.toggleFavorite(produto("p-1"));
  });
  expect(idsNoAparelho()).toEqual(["p-1"]);
  expect(atual.isFavorite("p-1")).toBe(true);

  // Controle positivo: a deduplicação não pode descartar um id diferente.
  await act(async () => {
    atual.toggleFavorite(produto("p-2"));
  });
  expect(idsNoAparelho()).toEqual(["p-1", "p-2"]);
  expect(atual.isFavorite("p-2")).toBe(true);
});
