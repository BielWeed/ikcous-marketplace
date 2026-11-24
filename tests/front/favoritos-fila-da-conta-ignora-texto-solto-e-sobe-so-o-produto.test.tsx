// @vitest-environment jsdom
//
// A fila de favoritos que ainda não chegaram ao servidor
// (`ikcous_favorites_pendentes:<conta>`) guarda OBJETOS com `id` -- é o que o
// próprio provedor escreve (`{ id }` quando só cabem os ids). A chave anônima,
// essa sim, aceita texto puro (o id solto). Se um texto solto aparece DENTRO da
// fila (versão velha, edição à mão, disco corrompido), ele tem que ser
// ignorado: tratado como produto, `texto.id` é `undefined` e o login subiria
// para o servidor um favorito com `product_id` indefinido, além de inflar o
// "N favoritos ainda estão sendo salvos".
//
// Os testes de "formato ruim" dos vizinhos usam `null`, `{}` e `1` dentro da
// fila, mas nunca um TEXTO -- justamente a entrada que a chave anônima aceita e
// a fila não.
import { act, useContext } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import {
  FavoritesContext,
  FavoritesProvider,
} from "@/contexts/FavoritesContext";

const CONTA = "conta-fila-1";
const CHAVE_DA_FILA = `ikcous_favorites_pendentes:${CONTA}`;

const mundo = vi.hoisted(() => ({
  // Objeto ESTÁVEL: um literal novo a cada render refaria o efeito de login sem parar.
  usuario: { id: "conta-fila-1" },
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
        eq: () => Promise.resolve({ data: [], error: null }),
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
let armazem: Map<string, string>;
const observar = vi.fn<(valor: Contexto | undefined) => void>();
const atual = () => observar.mock.calls.at(-1)?.[0] as Contexto;

function Sonda() {
  observar(useContext(FavoritesContext));
  return null;
}

beforeEach(() => {
  vi.clearAllMocks();
  // O servidor recusa: a fila em disco é o que sobra depois do login.
  mundo.upsert.mockImplementation(async () => ({
    error: { message: "sem rede" },
  }));
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
  vi.spyOn(console, "error").mockImplementation(() => {});
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

it("texto solto dentro da fila é ignorado: só o produto de verdade é contado e enviado", async () => {
  armazem.set(CHAVE_DA_FILA, JSON.stringify(["texto-solto", { id: "p1" }]));

  await act(async () => {
    raiz.render(
      <FavoritesProvider>
        <Sonda />
      </FavoritesProvider>,
    );
  });

  // Um único envio, do produto real; nada com `product_id` indefinido.
  expect(mundo.upsert).toHaveBeenCalledTimes(1);
  expect(mundo.upsert.mock.calls[0][0]).toEqual({
    user_id: CONTA,
    product_id: "p1",
  });
  // O servidor recusou: sobra UM favorito na fila, e a tela diz um só.
  expect(atual().pendingCount).toBe(1);
  expect(JSON.parse(armazem.get(CHAVE_DA_FILA) ?? "[]")).toEqual([
    expect.objectContaining({ id: "p1" }),
  ]);
});

it("controle: fila só de texto solto vale como fila vazia e nada é enviado", async () => {
  armazem.set(CHAVE_DA_FILA, JSON.stringify(["a", "b"]));

  await act(async () => {
    raiz.render(
      <FavoritesProvider>
        <Sonda />
      </FavoritesProvider>,
    );
  });

  expect(mundo.upsert).not.toHaveBeenCalled();
  expect(atual().pendingCount).toBe(0);
});
