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
  linhas: new Map<string, Set<string>>(),
  upsert: vi.fn(),
  insert: vi.fn(),
  remover: vi.fn(),
  toastSuccess: vi.fn(),
}));
const catalogo = ["p1", "p2"].map(
  (id) =>
    ({
      id,
      name: id,
      price: 10,
      images: [],
    }) as unknown as Product,
);
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: mundo.usuario }),
}));
vi.mock("@/hooks/useProducts", () => ({
  useProducts: () => ({ products: catalogo, loading: false }),
}));
vi.mock("@/hooks/useLeaderElection", () => ({
  useLeaderElection: () => ({ isLeader: false }),
}));
vi.mock("sonner", () => ({
  toast: { success: mundo.toastSuccess, error: vi.fn() },
}));
vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: () => ({
      select: () => ({
        eq: (_: string, uid: string) =>
          Promise.resolve({
            data: Array.from(mundo.linhas.get(uid) ?? []).map((id) => ({
              product_id: id,
            })),
            error: null,
          }),
      }),
      upsert: mundo.upsert,
      insert: mundo.insert,
      delete: () => ({
        eq: (_: string, uid: string) => ({
          eq: (_: string, id: string) => mundo.remover(uid, id),
        }),
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
async function removerECapturarDesfazer() {
  await renderizar();
  expect(atual().favorites.map((p) => p.id)).toEqual(["p1"]);
  await act(async () => atual().toggleFavorite(catalogo[0]));
  expect(atual().favorites).toEqual([]);
  expect(mundo.remover).toHaveBeenCalledExactlyOnceWith("A", "p1");
  const chamada = mundo.toastSuccess.mock.calls.find(
    (c) => c[0] === "Removido dos favoritos",
  );
  expect(chamada).toBeDefined();
  const opcoes = chamada![1] as {
    action: { label: string; onClick: () => void };
  };
  expect(opcoes.action.label).toBe("Desfazer");
  return opcoes.action.onClick;
}

beforeEach(() => {
  vi.clearAllMocks();
  mundo.usuario = { id: "A" };
  mundo.linhas.clear();
  mundo.linhas.set("A", new Set(["p1"]));
  mundo.linhas.set("B", new Set(["p2"]));
  const valores = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => valores.get(k) ?? null,
    setItem: (k: string, v: string) => void valores.set(k, v),
    removeItem: (k: string) => void valores.delete(k),
  });
  vi.stubGlobal(
    "BroadcastChannel",
    class {
      addEventListener() {}
      removeEventListener() {}
      close() {}
    },
  );
  const gravar = async ({
    user_id,
    product_id,
  }: { user_id: string; product_id: string }) => {
    mundo.linhas.get(user_id)!.add(product_id);
    return { error: null };
  };
  mundo.upsert.mockImplementation(gravar);
  mundo.insert.mockImplementation(gravar);
  mundo.remover.mockImplementation(async (uid: string, id: string) => {
    mundo.linhas.get(uid)!.delete(id);
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

it("Desfazer antigo não grava nem mistura o favorito de A na lista de B", async () => {
  const desfazer = await removerECapturarDesfazer();
  expect(mundo.upsert).not.toHaveBeenCalled();
  expect(mundo.insert).not.toHaveBeenCalled();
  mundo.usuario = { id: "B" };
  await renderizar();
  expect(atual().favorites.map((p) => p.id)).toEqual(["p2"]);

  await act(async () => desfazer());

  expect(atual().favorites.map((p) => p.id)).toEqual(["p2"]);
  expect(atual().isFavorite("p1")).toBe(false);
  expect(mundo.upsert).not.toHaveBeenCalled();
  expect(mundo.insert).not.toHaveBeenCalled();
  expect(mundo.remover).toHaveBeenCalledTimes(1);
  expect(Array.from(mundo.linhas.get("A")!)).toEqual([]);
  expect(Array.from(mundo.linhas.get("B")!)).toEqual(["p2"]);
});

it("Desfazer na mesma conta devolve o produto à lista e ao banco", async () => {
  const desfazer = await removerECapturarDesfazer();
  expect(Array.from(mundo.linhas.get("A")!)).toEqual([]);

  await act(async () => desfazer());

  expect(atual().favorites.map((p) => p.id)).toEqual(["p1"]);
  expect(atual().isFavorite("p1")).toBe(true);
  expect(mundo.upsert).toHaveBeenCalledExactlyOnceWith(
    { user_id: "A", product_id: "p1" },
    { onConflict: "user_id,product_id", ignoreDuplicates: true },
  );
  expect(mundo.insert).not.toHaveBeenCalled();
  expect(Array.from(mundo.linhas.get("A")!)).toEqual(["p1"]);
  expect(Array.from(mundo.linhas.get("B")!)).toEqual(["p2"]);
});
