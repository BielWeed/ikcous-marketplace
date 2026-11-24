// @vitest-environment jsdom
//
// "Voltar ao app" relê a lista de favoritos da conta, mas só se a última
// leitura foi há pelo menos 5 s (quem alterna de app em rajada não vira rajada
// de consultas). O vizinho prova 1 s (não relê) e 6 s (relê); a FRONTEIRA fica
// sem prova, e é nela que o `<` troca por `<=` sem ninguém ver:
//
//   - 4 999 ms depois da última leitura: ainda não relê;
//   - exatamente 5 000 ms: relê (a regra diz "menos de 5 s bloqueia").
import { act, useContext } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import {
  FavoritesContext,
  FavoritesProvider,
} from "@/contexts/FavoritesContext";

const mundo = vi.hoisted(() => ({
  usuario: { id: "conta-5s" },
  consultas: vi.fn(),
}));

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: mundo.usuario }),
}));
vi.mock("@/hooks/useLeaderElection", () => ({
  useLeaderElection: () => ({ isLeader: false }),
}));
vi.mock("@/hooks/useProducts", () => ({
  useProducts: () => ({
    products: [],
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
    }),
  },
}));
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let raiz: Root;
let hospedeiro: HTMLDivElement;
let agora = 0;

function Sonda() {
  useContext(FavoritesContext);
  return null;
}

async function voltarAoApp() {
  await act(async () => {
    document.dispatchEvent(new Event("visibilitychange"));
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  agora = 2_000_000;
  vi.spyOn(Date, "now").mockImplementation(() => agora);
  vi.spyOn(console, "log").mockImplementation(() => {});
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => "visible",
  });
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
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  Reflect.deleteProperty(document, "visibilityState");
});

it("a 4 999 ms da última leitura não relê; a exatos 5 000 ms relê", async () => {
  await act(async () => {
    raiz.render(
      <FavoritesProvider>
        <Sonda />
      </FavoritesProvider>,
    );
  });
  const aposAMontagem = mundo.consultas.mock.calls.length;
  expect(aposAMontagem).toBeGreaterThan(0);

  agora += 4_999;
  await voltarAoApp();
  expect(mundo.consultas.mock.calls.length).toBe(aposAMontagem);

  // Mais 1 ms: agora são exatamente 5 000 ms desde a leitura da montagem.
  agora += 1;
  await voltarAoApp();
  expect(mundo.consultas.mock.calls.length).toBe(aposAMontagem + 1);
});
