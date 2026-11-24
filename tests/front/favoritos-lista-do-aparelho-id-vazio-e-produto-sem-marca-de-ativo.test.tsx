// @vitest-environment jsdom
//
// Protege duas bordas da lista de favoritos de quem NÃO tem conta (chave
// `ikcous_favorites`, só de ids) que nenhum teste vizinho observava:
//
// 1. Entrada com id VAZIO (`""` ou `{ id: "" }`) não é favorito. Os testes de
//    "formato ruim" só olham `favorites`, onde um id vazio nunca aparece de
//    qualquer jeito; o dano real é outro: o id vazio ficava na lista do
//    aparelho, entrava na conta de "favoritos indisponíveis" (a tela avisaria
//    "1 favorito seu não está disponível" sem a pessoa ter favoritado nada) e
//    era regravado no disco na próxima gravação.
// 2. Produto do catálogo SEM a marca `isActive` (loja que ainda não preencheu
//    o campo) continua aparecendo; só `isActive === false` esconde. Todos os
//    produtos dos outros testes trazem `isActive: true`, então trocar
//    "diferente de false" por "verdadeiro" passava despercebido.
import { act, useContext } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  FavoritesContext,
  FavoritesProvider,
} from "@/contexts/FavoritesContext";
import type { Product } from "@/types";

const FAVORITES_KEY = "ikcous_favorites";

const mundo = vi.hoisted(() => ({ catalogo: [] as Product[] }));

vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: null }) }));
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

const produto = (id: string, extra: Record<string, unknown> = {}): Product =>
  ({
    id,
    name: `Produto ${id}`,
    price: 10,
    stock: 5,
    isActive: true,
    images: [],
    ...extra,
  }) as unknown as Product;

const idsNoAparelho = (): unknown =>
  JSON.parse(armazem.get(FAVORITES_KEY) ?? "[]");

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
  mundo.catalogo = [produto("a"), produto("p1")];
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

describe("favoritos do aparelho: id vazio não é favorito", () => {
  it.each([
    ["texto vazio", [""]],
    ["objeto com id vazio", [{ id: "" }]],
  ])(
    "%s não conta como favorito indisponível nem sobrevive à próxima gravação",
    async (_nome, guardado) => {
      armazem.set(FAVORITES_KEY, JSON.stringify([...guardado, "a"]));

      await montar();

      // Catálogo confirmado pela rede: um id vazio guardado contaria como
      // "indisponível" e a tela avisaria de um favorito que não existe.
      expect(atual().favoritosIndisponiveis).toBe(0);
      expect(atual().isFavorite("")).toBe(false);
      expect(atual().favorites.map((p) => p.id)).toEqual(["a"]);
      // Nem por um instante: o objeto `{ id: "" }` só vira texto na migração
      // que roda DEPOIS do primeiro render, e esse render já não pode contar.
      expect(
        observar.mock.calls.every(
          ([contexto]) => contexto?.favoritosIndisponiveis === 0,
        ),
      ).toBe(true);

      await act(async () => atual().toggleFavorite(produto("p1")));

      // A gravação seguinte já deixa o disco limpo: só os ids de verdade.
      expect(idsNoAparelho()).toEqual(["a", "p1"]);
      expect(atual().favoritosIndisponiveis).toBe(0);
    },
  );

  it("controle: um id que SAIU do catálogo continua contando como indisponível", async () => {
    armazem.set(FAVORITES_KEY, JSON.stringify(["a", "sumiu"]));

    await montar();

    expect(atual().favorites.map((p) => p.id)).toEqual(["a"]);
    expect(atual().favoritosIndisponiveis).toBe(1);
  });
});

describe("favoritos do aparelho: produto sem a marca isActive", () => {
  it("aparece na lista; só isActive === false esconde", async () => {
    mundo.catalogo = [
      produto("sem-marca", { isActive: undefined }),
      produto("pausado", { isActive: false }),
      produto("ativo"),
    ];
    armazem.set(
      FAVORITES_KEY,
      JSON.stringify(["sem-marca", "pausado", "ativo"]),
    );

    await montar();

    expect(atual().favorites.map((p) => p.id)).toEqual(["sem-marca", "ativo"]);
    // O pausado é o único que o aviso de indisponíveis conta.
    expect(atual().favoritosIndisponiveis).toBe(1);
  });
});
