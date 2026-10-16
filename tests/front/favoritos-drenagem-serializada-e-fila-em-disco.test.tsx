// @vitest-environment jsdom
//
// Favoritos logados — três defeitos do mesmo desenho:
//  1. a drenagem da fila pendente gravava FORA da fila serializada por produto:
//     uma drenagem em voo terminava depois de um "remover" e ressuscitava o
//     favorito (ou, ao contrário, repunha o que um remover já tinha tirado);
//  2. quem trocava de conta antes do servidor responder pulava a limpeza da
//     fila pendente em DISCO da conta que saiu — no próximo login dela a
//     retentativa regravava o que ela tinha removido;
//  3. o rollback "só se for o último toque" não tinha teste.
import {
  FavoritesContext,
  FavoritesProvider,
} from "@/contexts/FavoritesContext";
import type { Product } from "@/types";
import { act, useContext } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const pendenteDe = (uid: string) => `ikcous_favorites_pendentes:${uid}`;
const mundo = vi.hoisted(() => ({
  usuario: { id: "A" } as { id: string },
  linhas: new Set<string>(), // `${user_id}|${product_id}`
  upsert: vi.fn(),
  remover: vi.fn(),
}));
const p1 = {
  id: "p1",
  name: "P1",
  price: 10,
  images: [],
} as unknown as Product;
const p2 = {
  id: "p2",
  name: "P2",
  price: 10,
  images: [],
} as unknown as Product;
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: mundo.usuario }),
}));
vi.mock("@/hooks/useProducts", () => ({
  useProducts: () => ({ products: [p1, p2], loading: false }),
}));
vi.mock("@/hooks/useLeaderElection", () => ({
  useLeaderElection: () => ({ isLeader: false }),
}));
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
}));
vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: () => ({
      select: () => ({
        eq: (_: string, uid: string) =>
          Promise.resolve({
            data: [...mundo.linhas]
              .filter((l) => l.startsWith(`${uid}|`))
              .map((l) => ({ product_id: l.split("|")[1] })),
            error: null,
          }),
      }),
      upsert: mundo.upsert,
      delete: () => ({
        eq: (_: string, uid: string) => ({
          eq: (__: string, pid: string) => mundo.remover(uid, pid),
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
let valores: Map<string, string>;
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
const flush = async () => {
  await act(async () => {
    for (let i = 0; i < 8; i++) await Promise.resolve();
  });
};
const FALHA = { error: { message: "sem rede" } };
const OK = { error: null };

/** Resposta que fica no ar até o teste decidir. */
function emVoo(aoTerminar?: () => void) {
  let terminar!: (r: { error: unknown }) => void;
  const promessa = new Promise<{ error: unknown }>((resolve) => {
    terminar = (r) => {
      if (!r.error) aoTerminar?.();
      resolve(r);
    };
  });
  return { promessa, terminar };
}
const semearPendentes = (uid: string, produtos: Product[]) =>
  valores.set(pendenteDe(uid), JSON.stringify(produtos));
const pendentesEmDisco = (uid: string): string[] =>
  (JSON.parse(valores.get(pendenteDe(uid)) ?? "[]") as Product[]).map(
    (p) => p.id,
  );

beforeEach(() => {
  vi.clearAllMocks();
  mundo.usuario = { id: "A" };
  mundo.linhas.clear();
  valores = new Map<string, string>();
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
  mundo.upsert.mockImplementation(
    async (o: { user_id: string; product_id: string }) => {
      mundo.linhas.add(`${o.user_id}|${o.product_id}`);
      return OK;
    },
  );
  mundo.remover.mockImplementation(async (uid: string, pid: string) => {
    mundo.linhas.delete(`${uid}|${pid}`);
    return OK;
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

it("drenagem em voo: o remover espera o upsert e o favorito não ressuscita", async () => {
  mundo.linhas.add("A|p1");
  semearPendentes("A", [p1]);
  // Login: a gravação da fila falha, o servidor já tinha a linha.
  mundo.upsert.mockImplementationOnce(async () => FALHA);
  const retentativa = emVoo(() => mundo.linhas.add("A|p1"));
  mundo.upsert.mockImplementationOnce(() => retentativa.promessa);
  await renderizar();
  await flush();
  expect(atual().isFavorite("p1")).toBe(true);
  await act(async () => {
    window.dispatchEvent(new Event("online"));
  });
  await flush();
  expect(mundo.upsert).toHaveBeenCalledTimes(2);
  // A pessoa remove enquanto a retentativa espera o servidor.
  await act(async () => atual().toggleFavorite(p1));
  expect(atual().isFavorite("p1")).toBe(false);
  expect(mundo.remover).not.toHaveBeenCalled();
  await act(async () => retentativa.terminar(OK));
  await flush();
  expect(mundo.remover).toHaveBeenCalledTimes(1);
  expect(mundo.linhas.has("A|p1")).toBe(false);
  expect(atual().isFavorite("p1")).toBe(false);
});

it("remoção em voo: a drenagem enfileirada atrás dela não repõe o favorito removido", async () => {
  mundo.linhas.add("A|p1");
  semearPendentes("A", [p1]);
  mundo.upsert.mockImplementationOnce(async () => FALHA);
  const remocao = emVoo(() => mundo.linhas.delete("A|p1"));
  mundo.remover.mockImplementationOnce(() => remocao.promessa);
  await renderizar();
  await flush();
  expect(atual().isFavorite("p1")).toBe(true);
  await act(async () => atual().toggleFavorite(p1));
  expect(mundo.remover).toHaveBeenCalledTimes(1);
  // A retentativa lê a fila em disco (p1 ainda está lá) com o DELETE no ar.
  await act(async () => {
    window.dispatchEvent(new Event("online"));
  });
  await flush();
  await act(async () => remocao.terminar(OK));
  await flush();
  expect(mundo.upsert).toHaveBeenCalledTimes(1);
  expect(mundo.linhas.has("A|p1")).toBe(false);
  expect(atual().isFavorite("p1")).toBe(false);
  expect(pendentesEmDisco("A")).toEqual([]);
});

it("remoção que falha não tira o favorito da fila pendente", async () => {
  mundo.linhas.add("A|p1");
  semearPendentes("A", [p1]);
  mundo.upsert.mockImplementationOnce(async () => FALHA);
  mundo.remover.mockImplementationOnce(async () => FALHA);
  await renderizar();
  await flush();
  await act(async () => atual().toggleFavorite(p1));
  await flush();
  expect(atual().isFavorite("p1")).toBe(true);
  expect(pendentesEmDisco("A")).toEqual(["p1"]);
});

it("remover e sair da conta antes do servidor responder limpa a fila pendente dela em disco", async () => {
  mundo.linhas.add("A|p1");
  semearPendentes("A", [p1]);
  mundo.upsert.mockImplementationOnce(async () => FALHA);
  const remocao = emVoo(() => mundo.linhas.delete("A|p1"));
  mundo.remover.mockImplementationOnce(() => remocao.promessa);
  await renderizar();
  await flush();
  await act(async () => atual().toggleFavorite(p1));
  expect(pendentesEmDisco("A")).toEqual(["p1"]);
  mundo.usuario = { id: "B" };
  await renderizar();
  await flush();
  await act(async () => remocao.terminar(OK));
  await flush();
  expect(pendentesEmDisco("A")).toEqual([]);
  // E a tela da conta nova não ganhou nada da que saiu.
  expect(atual().favorites).toEqual([]);
  expect(atual().pendingCount).toBe(0);
});

it("adicionar e sair da conta antes do servidor responder limpa a fila pendente dela em disco", async () => {
  semearPendentes("A", [p2]);
  mundo.upsert.mockImplementationOnce(async () => FALHA);
  const adicao = emVoo(() => mundo.linhas.add("A|p2"));
  await renderizar();
  await flush();
  expect(atual().isFavorite("p2")).toBe(false);
  expect(pendentesEmDisco("A")).toEqual(["p2"]);
  mundo.upsert.mockImplementationOnce(() => adicao.promessa);
  await act(async () => atual().toggleFavorite(p2));
  mundo.usuario = { id: "B" };
  await renderizar();
  await flush();
  await act(async () => adicao.terminar(OK));
  await flush();
  expect(pendentesEmDisco("A")).toEqual([]);
  expect(atual().favorites).toEqual([]);
});

it("remover, adicionar e remover de novo: a falha do primeiro DELETE não devolve o favorito", async () => {
  mundo.linhas.add("A|p1");
  await renderizar();
  await flush();
  expect(atual().isFavorite("p1")).toBe(true);
  const primeiro = emVoo();
  mundo.remover.mockImplementationOnce(() => primeiro.promessa);
  await act(async () => atual().toggleFavorite(p1)); // remove (em voo)
  await act(async () => atual().toggleFavorite(p1)); // adiciona (espera)
  await act(async () => atual().toggleFavorite(p1)); // remove de novo (espera)
  expect(atual().isFavorite("p1")).toBe(false);
  await act(async () => primeiro.terminar(FALHA));
  await flush();
  // O último toque foi remover: o rollback do primeiro não vale mais.
  expect(atual().isFavorite("p1")).toBe(false);
  expect(mundo.linhas.has("A|p1")).toBe(false);
});

it("adicionar, remover e adicionar de novo: a falha do primeiro upsert não tira o favorito", async () => {
  await renderizar();
  await flush();
  expect(atual().isFavorite("p1")).toBe(false);
  const primeiro = emVoo();
  mundo.upsert.mockImplementationOnce(() => primeiro.promessa);
  await act(async () => atual().toggleFavorite(p1)); // adiciona (em voo)
  await act(async () => atual().toggleFavorite(p1)); // remove (espera)
  await act(async () => atual().toggleFavorite(p1)); // adiciona de novo (espera)
  expect(atual().isFavorite("p1")).toBe(true);
  await act(async () => primeiro.terminar(FALHA));
  await flush();
  expect(atual().isFavorite("p1")).toBe(true);
  expect(mundo.linhas.has("A|p1")).toBe(true);
});
