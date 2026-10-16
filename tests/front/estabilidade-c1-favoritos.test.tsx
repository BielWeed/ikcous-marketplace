// @vitest-environment jsdom
import {
  FavoritesContext,
  FavoritesProvider,
} from "@/contexts/FavoritesContext";
import type { Product } from "@/types";
import { act, useContext } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const mundo = vi.hoisted(() => ({
  usuario: { id: "A" },
  linhas: new Set<string>(),
  upsert: vi.fn(),
  remover: vi.fn(),
}));
const produto = {
  id: "p1",
  name: "Produto",
  price: 10,
  images: [],
} as unknown as Product;
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: mundo.usuario }),
}));
vi.mock("@/hooks/useProducts", () => ({
  useProducts: () => ({ products: [produto], loading: false }),
}));
vi.mock("@/hooks/useLeaderElection", () => ({
  useLeaderElection: () => ({ isLeader: false }),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: () => ({
      select: () => ({
        eq: (_: string, uid: string) =>
          Promise.resolve({
            data: mundo.linhas.has(uid) ? [{ product_id: "p1" }] : [],
            error: null,
          }),
      }),
      upsert: mundo.upsert,
      delete: () => ({
        eq: (_: string, uid: string) => ({ eq: () => mundo.remover(uid) }),
      }),
    }),
  },
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function Sonda({
  observar,
}: {
  observar: (valor: React.ContextType<typeof FavoritesContext>) => void;
}) {
  observar(useContext(FavoritesContext));
  return null;
}
let raiz: Root;
let hospedeiro: HTMLDivElement;
const observar = vi.fn();
const atual = () =>
  observar.mock.calls.at(-1)![0] as NonNullable<
    React.ContextType<typeof FavoritesContext>
  >;
const renderizar = async () => {
  await act(async () => {
    raiz.render(
      <FavoritesProvider>
        <Sonda observar={observar} />
      </FavoritesProvider>,
    );
  });
};
beforeEach(() => {
  vi.clearAllMocks();
  mundo.usuario = { id: "A" };
  mundo.linhas.clear();
  const valores = new Map<string, string>();
  const storage = {
    getItem: (k: string) => valores.get(k) ?? null,
    setItem: (k: string, v: string) => void valores.set(k, v),
    removeItem: (k: string) => void valores.delete(k),
  };
  vi.stubGlobal("localStorage", storage);
  vi.stubGlobal(
    "BroadcastChannel",
    class {
      addEventListener() {}
      removeEventListener() {}
      close() {}
    },
  );
  mundo.upsert.mockImplementation(async ({ user_id }: { user_id: string }) => {
    mundo.linhas.add(user_id);
    return { error: null };
  });
  mundo.remover.mockImplementation(async (uid: string) => {
    mundo.linhas.delete(uid);
    return { error: null };
  });
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

it("a remoção de A que falha tarde não adiciona o favorito à conta B", async () => {
  mundo.linhas.add("A");
  let falhar = () => {};
  mundo.remover.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        falhar = () => resolve({ error: { message: "sem rede" } });
      }),
  );
  await renderizar();
  expect(atual().isFavorite("p1")).toBe(true);
  await act(async () => atual().toggleFavorite(produto));
  expect(mundo.remover).toHaveBeenCalledTimes(1);
  mundo.usuario = { id: "B" };
  await renderizar();
  expect(atual().isFavorite("p1")).toBe(false);
  await act(async () => falhar());
  expect(atual().isFavorite("p1")).toBe(false);
  expect(atual().favorites).toEqual([]);
});

it("espera o UPSERT em voo antes de apagar: o último toque vence no banco e na tela", async () => {
  let concluir = () => {};
  mundo.upsert.mockImplementationOnce(
    ({ user_id }: { user_id: string }) =>
      new Promise((resolve) => {
        concluir = () => {
          mundo.linhas.add(user_id);
          resolve({ error: null });
        };
      }),
  );
  await renderizar();
  await act(async () => atual().toggleFavorite(produto));
  expect(atual().isFavorite("p1")).toBe(true);
  expect(mundo.upsert).toHaveBeenCalledTimes(1);
  await act(async () => atual().toggleFavorite(produto));
  expect(atual().isFavorite("p1")).toBe(false);
  expect(mundo.remover).not.toHaveBeenCalled();
  await act(async () => concluir());
  expect(mundo.remover).toHaveBeenCalledTimes(1);
  expect(mundo.linhas.has("A")).toBe(false);
  expect(atual().isFavorite("p1")).toBe(false);
});
