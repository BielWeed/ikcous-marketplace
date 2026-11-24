// @vitest-environment jsdom
//
// Favorito que está no servidor E ainda na fila de retidos (o envio do login
// deu tempo esgotado, mas a linha chegou lá): quando a pessoa o remove, a fila
// em disco já era limpa, mas o NÚMERO da tela ("N favoritos ainda estão sendo
// salvos") só zerava na próxima montagem. O vizinho confere o disco; aqui se
// confere o que a pessoa vê: o contador cai junto com a remoção, e a lista
// também.
import { act, useContext } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import {
  FavoritesContext,
  FavoritesProvider,
} from "@/contexts/FavoritesContext";
import type { Product } from "@/types";

const CONTA = "conta-remocao-1";
const CHAVE_DA_FILA = `ikcous_favorites_pendentes:${CONTA}`;

const mundo = vi.hoisted(() => ({
  // Objeto ESTÁVEL: um literal novo a cada render refaria o efeito de login sem parar.
  usuario: { id: "conta-remocao-1" },
  upsert: vi.fn(),
  remover: vi.fn(),
}));

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: mundo.usuario }),
}));
vi.mock("@/hooks/useLeaderElection", () => ({
  useLeaderElection: () => ({ isLeader: false }),
}));
vi.mock("@/hooks/useProducts", () => ({
  useProducts: () => ({
    products: [
      {
        id: "p1",
        name: "Produto p1",
        price: 10,
        stock: 5,
        isActive: true,
        images: [],
      },
    ],
    loading: false,
    catalogoDaRedeAplicado: true,
    catalogoErro: null,
  }),
}));
vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: () => ({
      select: () => ({
        eq: () =>
          Promise.resolve({
            data: [{ product_id: "p1", created_at: "2026-01-01T00:00:00Z" }],
            error: null,
          }),
      }),
      upsert: mundo.upsert,
      delete: () => ({
        eq: () => ({ eq: () => mundo.remover() }),
      }),
    }),
  },
}));
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

type Contexto = NonNullable<React.ContextType<typeof FavoritesContext>>;

let raiz: Root;
let hospedeiro: HTMLDivElement;
let armazem: Map<string, string>;
const observar = vi.fn<(valor: Contexto | undefined) => void>();
const atual = () => observar.mock.calls.at(-1)?.[0] as Contexto;

function Sonda() {
  observar(useContext(FavoritesContext));
  return null;
}

const p1 = {
  id: "p1",
  name: "Produto p1",
  price: 10,
  images: [],
} as unknown as Product;

beforeEach(() => {
  vi.clearAllMocks();
  // O envio do login nunca confirma: o item fica na fila de retidos.
  mundo.upsert.mockImplementation(async () => ({
    error: { message: "tempo esgotado" },
  }));
  mundo.remover.mockImplementation(async () => ({ error: null }));
  armazem = new Map();
  armazem.set(CHAVE_DA_FILA, JSON.stringify([{ id: "p1" }]));
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
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "log").mockImplementation(() => {});
  hospedeiro = document.createElement("div");
  document.body.appendChild(hospedeiro);
  raiz = createRoot(hospedeiro);
});
afterEach(() => {
  act(() => raiz.unmount());
  hospedeiro.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("remover o favorito que também está na fila zera o contador de retidos", async () => {
  await act(async () => {
    raiz.render(
      <FavoritesProvider>
        <Sonda />
      </FavoritesProvider>,
    );
  });
  expect(atual().favorites.map((p) => p.id)).toEqual(["p1"]);
  expect(atual().pendingCount).toBe(1);

  await act(async () => atual().toggleFavorite(p1));

  expect(mundo.remover).toHaveBeenCalledTimes(1);
  expect(atual().favorites).toEqual([]);
  expect(atual().pendingCount).toBe(0);
  expect(JSON.parse(armazem.get(CHAVE_DA_FILA) ?? "[]")).toEqual([]);
});
