// @vitest-environment jsdom
//
// "Tentar agora" / evento `online` regravam a fila de favoritos retidos. Só
// quando ALGUM favorito subiu faz sentido reler a lista da conta (a lista
// mudou); se o servidor recusou tudo de novo, reler é uma consulta à toa -- e
// numa rede ruim, que é justamente quando a retentativa roda, cada consulta
// gasta tempo e bateria. Os vizinhos provam que a retentativa BEM-SUCEDIDA relê;
// ninguém provava que a que falha de novo NÃO relê.
import { act, useContext } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import {
  FavoritesContext,
  FavoritesProvider,
} from "@/contexts/FavoritesContext";

const CONTA = "conta-retentativa-1";
const CHAVE_DA_FILA = `ikcous_favorites_pendentes:${CONTA}`;

const mundo = vi.hoisted(() => ({
  // Objeto ESTÁVEL: um literal novo a cada render refaria o efeito de login sem parar.
  usuario: { id: "conta-retentativa-1" },
  consultas: vi.fn(),
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
        eq: () => {
          mundo.consultas();
          return Promise.resolve({ data: [], error: null });
        },
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
  mundo.upsert.mockImplementation(async () => ({
    error: { message: "sem rede" },
  }));
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

async function montar() {
  await act(async () => {
    raiz.render(
      <FavoritesProvider>
        <Sonda />
      </FavoritesProvider>,
    );
  });
}

it("retentativa que o servidor recusa de novo não relê a lista; a que sobe relê", async () => {
  await montar();
  // Login: leitura da lista + uma tentativa de subir a fila (recusada).
  expect(mundo.upsert).toHaveBeenCalledTimes(1);
  expect(atual().pendingCount).toBe(1);
  const leiturasDoLogin = mundo.consultas.mock.calls.length;

  await act(async () => {
    await atual().retentarPendentes();
  });

  // Tentou de novo (2º envio), falhou de novo: a fila continua e NADA foi relido.
  expect(mundo.upsert).toHaveBeenCalledTimes(2);
  expect(atual().pendingCount).toBe(1);
  expect(mundo.consultas.mock.calls.length).toBe(leiturasDoLogin);

  // Controle: quando o servidor aceita, a lista é relida e a fila esvazia.
  mundo.upsert.mockImplementation(async () => ({ error: null }));
  await act(async () => {
    await atual().retentarPendentes();
  });

  expect(mundo.upsert).toHaveBeenCalledTimes(3);
  expect(atual().pendingCount).toBe(0);
  expect(mundo.consultas.mock.calls.length).toBe(leiturasDoLogin + 1);
});
