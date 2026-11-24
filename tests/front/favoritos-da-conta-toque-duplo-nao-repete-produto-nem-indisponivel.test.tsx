// @vitest-environment jsdom
//
// Toque duplo no coração de quem TEM conta. Os dois toques chegam antes do
// próximo render, então os dois enxergam "ainda não é favorito" e os dois
// acrescentam o produto à lista otimista da conta (`dbFavoriteIds`) -- o
// visitante tem teste para isso ("nao-repete-o-mesmo-produto"), a conta não.
//
// O que protege a tela é a leitura da lista, que conta cada id uma vez só:
// - `favorites` não pode mostrar o mesmo cartão duas vezes (chave repetida no
//   React e "2 produtos que você salvou" para um produto só);
// - `favoritosIndisponiveis` não pode contar em dobro um favorito que a loja
//   não tem (o aviso diria "2 favoritos seus não estão disponíveis").
// E um único toque de remover tira o produto inteiro, sem sobrar cópia.
import { act, useContext } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  FavoritesContext,
  FavoritesProvider,
} from "@/contexts/FavoritesContext";
import type { Product } from "@/types";

const mundo = vi.hoisted(() => ({
  usuario: { id: "conta-1" },
  catalogo: [] as Product[],
  upsert: vi.fn(),
}));

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: mundo.usuario }),
}));
vi.mock("@/hooks/useLeaderElection", () => ({
  useLeaderElection: () => ({ isLeader: false }),
}));
vi.mock("@/hooks/useProducts", () => ({
  useProducts: () => ({
    products: mundo.catalogo,
    loading: false,
    catalogoDaRedeAplicado: true,
    catalogoErro: null,
  }),
}));
vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: () => ({
      select: () => ({
        eq: () => Promise.resolve({ data: [], error: null }),
      }),
      upsert: mundo.upsert,
      delete: () => ({
        eq: () => ({ eq: () => Promise.resolve({ error: null }) }),
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
const observar = vi.fn<(valor: Contexto | undefined) => void>();
const atual = () => observar.mock.calls.at(-1)?.[0] as Contexto;

function Sonda() {
  observar(useContext(FavoritesContext));
  return null;
}

const produto = (id: string): Product =>
  ({
    id,
    name: `Produto ${id}`,
    price: 10,
    stock: 5,
    isActive: true,
    images: [],
  }) as unknown as Product;

async function montar() {
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
  mundo.catalogo = [produto("p1")];
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
  hospedeiro = document.createElement("div");
  document.body.appendChild(hospedeiro);
  raiz = createRoot(hospedeiro);
});
afterEach(() => {
  act(() => raiz.unmount());
  hospedeiro.remove();
  vi.unstubAllGlobals();
});

describe("favoritos da conta: toque duplo antes do render", () => {
  it("o produto aparece uma vez só e uma remoção tira tudo", async () => {
    await montar();

    await act(async () => {
      atual().toggleFavorite(produto("p1"));
      atual().toggleFavorite(produto("p1"));
    });

    expect(atual().isFavorite("p1")).toBe(true);
    expect(atual().favorites.map((p) => p.id)).toEqual(["p1"]);

    await act(async () => atual().toggleFavorite(produto("p1")));

    expect(atual().isFavorite("p1")).toBe(false);
    expect(atual().favorites).toEqual([]);
  });

  it("favorito que a loja não tem conta como UM indisponível, não dois", async () => {
    await montar();
    expect(atual().favoritosIndisponiveis).toBe(0);

    await act(async () => {
      atual().toggleFavorite(produto("fora-do-catalogo"));
      atual().toggleFavorite(produto("fora-do-catalogo"));
    });

    expect(atual().favorites).toEqual([]);
    expect(atual().favoritosIndisponiveis).toBe(1);
  });
});
