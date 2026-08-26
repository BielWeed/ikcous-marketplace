// @vitest-environment jsdom
//
// Redesenho subtrativo (26/08/2026) sobre a correção do vazamento de
// favoritos entre contas — `FavoritesContext.tsx`.
//
// Até 26/08/2026 este arquivo testava a ORDEM de uma mescla
// (`mesclarSemDuplicar([pendingFavorites, daBase])`) que decidia quem
// vencia quando o mesmo produto estava confirmado (`dbFavoriteIds`, com o
// retrato VIVO do catálogo) e pendente (`pendingFavorites`, com um retrato
// SERIALIZADO no momento em que a gravação falhou) ao mesmo tempo. Colocar
// `daBase` por último resolvia aquele caso — mas o mecanismo em si (mesclar
// um retrato antigo da fila no que é exibido) é a raiz de três defeitos
// diferentes, e saiu inteiro do código.
//
// A partir do redesenho, `pendingFavorites` não entra em `favorites` de
// jeito nenhum — não é uma questão de ordem de mescla, é a ausência da
// mescla. Este teste passa a provar isso: mesmo com um retrato antigo (nome
// e preço velhos) parado na fila pendente do MESMO produto que já está
// confirmado no servidor, `favorites` mostra exclusivamente o dado vivo do
// catálogo — porque a fila nunca chega a ser lida para render nenhum. A
// pendência continua visível só como contagem (`pendingCount`), nunca como
// item.
import type { Context } from "react";
import { act } from "react";
import { useContext, useEffect } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Product } from "@/types";

const FAVORITES_KEY = "ikcous_favorites";

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
}));

vi.mock("@/hooks/useLeaderElection", () => ({
  useLeaderElection: () => ({ isLeader: false }),
}));

const produtoNovo: Product = {
  id: "p1",
  name: "Camisa NOVA",
  price: 25,
  images: [],
} as unknown as Product;

vi.mock("@/hooks/useProducts", () => ({
  useProducts: () => ({ products: [produtoNovo], loading: false }),
}));

let usuarioDaVez: { id: string } | null = null;
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: usuarioDaVez }),
}));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: (tabela: string) => {
      if (tabela !== "favorites") {
        throw new Error(`tabela inesperada no dublê: ${tabela}`);
      }
      return {
        // O upsert de p1 "falha" (tempo esgotado) mesmo já tendo gravado —
        // é a assimetria que deixa o mesmo id em `dbFavoriteIds` E em
        // `pendingFavorites` ao mesmo tempo.
        upsert: () =>
          Promise.resolve({ data: null, error: { message: "timeout" } }),
        select: () => ({
          eq: () =>
            Promise.resolve({ data: [{ product_id: "p1" }], error: null }),
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

// Node 25 pisa em `localStorage` global antes do jsdom — mesmo contorno dos
// testes irmãos de FavoritesContext.
function criarStorageFake() {
  const armazem = new Map<string, string>();
  return {
    getItem: (chave: string) => armazem.get(chave) ?? null,
    setItem: (chave: string, valor: string) => {
      armazem.set(chave, valor);
    },
    removeItem: (chave: string) => {
      armazem.delete(chave);
    },
    clear: () => {
      armazem.clear();
    },
    key: (index: number) => Array.from(armazem.keys()).at(index) ?? null,
    get length() {
      return armazem.size;
    },
  };
}

let ultimoContexto: unknown = null;
function Sonda({ contexto }: { contexto: Context<any> }) {
  const ctx = useContext(contexto);
  useEffect(() => {
    ultimoContexto = ctx;
  });
  return null;
}

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let raiz: Root;
let hospedeiro: HTMLDivElement;
let storageFake: ReturnType<typeof criarStorageFake>;

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  usuarioDaVez = null;
  ultimoContexto = null;
  storageFake = criarStorageFake();
  vi.stubGlobal("localStorage", storageFake);
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
  act(() => {
    raiz.unmount();
  });
  hospedeiro.remove();
  vi.unstubAllGlobals();
});

describe("FavoritesContext — a fila pendente nunca entra em `favorites`, nem com retrato desatualizado do mesmo produto confirmado", () => {
  it("p1 confirmado no servidor E com retrato antigo pendente: a tela mostra só o catálogo vivo, e a pendência só existe como contagem", async () => {
    // 1. Visitante favorita p1 sem conta, com o retrato ANTIGO (preço/nome).
    storageFake.setItem(
      FAVORITES_KEY,
      JSON.stringify([
        { id: "p1", name: "Camisa VELHA", price: 10, images: [] },
      ]),
    );

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
    await flush();

    // 2. Loga — o upsert "falha" (mas a linha já existe no servidor), então
    // p1 continua na fila pendente com o retrato velho.
    usuarioDaVez = { id: "userA" };

    await act(async () => {
      raiz.render(
        <FavoritesProvider>
          <Sonda contexto={FavoritesContext} />
        </FavoritesProvider>,
      );
    });
    await flush();

    const ctx = ultimoContexto as {
      favorites: Product[];
      pendingCount: number;
    } | null;

    // Controle: a pendência de fato existe (senão não haveria retrato velho
    // nenhum competindo com o catálogo — "o controle também precisa de
    // controle").
    expect(ctx?.pendingCount).toBe(1);

    // O que importa: `favorites` tem exatamente UM p1 (nunca dois, nunca o
    // retrato velho) — vindo só do catálogo vivo, porque a fila pendente
    // nunca é lida para render.
    const ocorrenciasDeP1 = (ctx?.favorites ?? []).filter((p) => p.id === "p1");
    expect(ocorrenciasDeP1).toHaveLength(1);
    expect(ocorrenciasDeP1[0].name).toBe("Camisa NOVA");
    expect(ocorrenciasDeP1[0].price).toBe(25);
  });
});
