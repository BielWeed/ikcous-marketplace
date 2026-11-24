// @vitest-environment jsdom
//
// Duas bordas do toque de FAVORITAR (não de remover) para quem tem conta, que
// só a remoção tinha em teste:
//
// 1. Um favorito novo entra no FIM da lista da conta -- a tela promete "Ordem
//    original" (a ordem em que a pessoa salvou) e a releitura do servidor
//    confirma essa mesma ordem. Se o toque entrasse no começo, a lista pularia
//    de ordem na próxima releitura.
// 2. O envio de A que falha DEPOIS de a conta B ter entrado no mesmo aparelho
//    não pode mexer na tela de B: nem avisar "Erro ao salvar favorito" para
//    quem não tocou em nada, nem tirar de B um favorito que B já tinha (o
//    produto é o mesmo, a conta não).
import { act, useContext } from "react";
import { type Root, createRoot } from "react-dom/client";
import { toast } from "sonner";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  FavoritesContext,
  FavoritesProvider,
} from "@/contexts/FavoritesContext";
import type { Product } from "@/types";

const mundo = vi.hoisted(() => ({
  usuario: { id: "A" },
  linhas: new Map<string, string[]>(),
  upsert: vi.fn(),
}));

const produto = (id: string): Product =>
  ({
    id,
    name: `Produto ${id}`,
    price: 10,
    stock: 5,
    isActive: true,
    images: [],
  }) as unknown as Product;

const CATALOGO = [produto("p1"), produto("p2")];

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: mundo.usuario }),
}));
vi.mock("@/hooks/useLeaderElection", () => ({
  useLeaderElection: () => ({ isLeader: false }),
}));
vi.mock("@/hooks/useProducts", () => ({
  useProducts: () => ({
    products: CATALOGO,
    loading: false,
    catalogoDaRedeAplicado: true,
    catalogoErro: null,
  }),
}));
vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: () => ({
      select: () => ({
        eq: (_coluna: string, usuarioId: string) =>
          Promise.resolve({
            data: (mundo.linhas.get(usuarioId) ?? []).map(
              (product_id, indice) => ({
                product_id,
                created_at: new Date(2026, 0, 1, 0, indice).toISOString(),
              }),
            ),
            error: null,
          }),
      }),
      upsert: mundo.upsert,
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
const observar = vi.fn<(valor: Contexto | undefined) => void>();
const atual = () => observar.mock.calls.at(-1)?.[0] as Contexto;

function Sonda() {
  observar(useContext(FavoritesContext));
  return null;
}

async function renderizar() {
  await act(async () => {
    raiz.render(
      <FavoritesProvider>
        <Sonda />
      </FavoritesProvider>,
    );
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mundo.usuario = { id: "A" };
  mundo.linhas = new Map();
  mundo.upsert.mockImplementation(async () => ({ error: null }));
  const valores = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (chave: string) => valores.get(chave) ?? null,
    setItem: (chave: string, valor: string) => void valores.set(chave, valor),
    removeItem: (chave: string) => void valores.delete(chave),
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

describe("favoritos da conta: favoritar", () => {
  it("o favorito novo entra no fim da lista, depois dos que já estavam salvos", async () => {
    mundo.linhas.set("A", ["p1"]);
    await renderizar();
    expect(atual().favorites.map((p) => p.id)).toEqual(["p1"]);

    await act(async () => atual().toggleFavorite(produto("p2")));

    expect(atual().favorites.map((p) => p.id)).toEqual(["p1", "p2"]);
  });

  it("o envio de A que falha depois da troca para B não avisa nem tira o favorito de B", async () => {
    mundo.linhas.set("B", ["p1"]);
    let falhar = () => {};
    mundo.upsert.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          falhar = () => resolve({ error: { message: "sem rede" } });
        }),
    );
    await renderizar();
    expect(atual().favorites).toEqual([]);
    await act(async () => atual().toggleFavorite(produto("p1")));
    expect(mundo.upsert).toHaveBeenCalledTimes(1);

    // Troca direta A -> B no mesmo aparelho; B já tem o mesmo produto salvo.
    mundo.usuario = { id: "B" };
    await renderizar();
    expect(atual().isFavorite("p1")).toBe(true);

    await act(async () => falhar());

    expect(toast.error).not.toHaveBeenCalled();
    expect(atual().isFavorite("p1")).toBe(true);
    expect(atual().favorites.map((p) => p.id)).toEqual(["p1"]);
  });
});
