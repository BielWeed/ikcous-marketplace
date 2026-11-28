import {
  FavoritesContext,
  FavoritesProvider,
} from "@/contexts/FavoritesContext";
import type { Product } from "@/types";
// @vitest-environment jsdom
//
// FAVORITOS NÃO SOMEM NA JANELA EM QUE O TOKEN NÃO RENOVOU (caça 28/11/2026).
//
// A cliente volta ao app depois de horas; a renovação do token falha uns
// segundos e o supabase-js 2.117 guarda a falha por 60 s: `getSession()` dá
// `session: null` com erro de rede, sem SIGNED_OUT. A leitura dos favoritos sai
// com a chave anônima, a RLS devolve `[]`, e os corações apagavam todos ("você
// ainda não tem favoritos") até a próxima leitura.
//
// Regra: lista vazia só vale com a sessão da DONA. Sem ela os favoritos ficam,
// a falha é exposta, e a leitura se refaz quando a sessão desta conta volta.
import { AuthRetryableFetchError } from "@supabase/supabase-js";
import { type ContextType, act, useContext, useEffect } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Ouvinte = (evento: string, sessao: unknown) => void;

const mundo = vi.hoisted(() => ({
  usuario: { id: "conta-a" } as { id: string } | null,
  linhas: [] as string[],
  leituras: 0,
  sessaoDe: "conta-a" as string | null,
  erroDaSessao: null as unknown,
  sessaoPendente: false,
  ouvintes: new Set<(evento: string, sessao: unknown) => void>(),
}));
const produtos = [
  { id: "caneca", name: "Caneca azul", price: 19, images: [] },
  { id: "jarra", name: "Jarra verde", price: 32, images: [] },
] as unknown as Product[];

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: mundo.usuario }),
}));
vi.mock("@/hooks/useProducts", () => ({
  useProducts: () => ({ products: produtos, loading: false }),
}));
vi.mock("@/hooks/useLeaderElection", () => ({
  useLeaderElection: () => ({ isLeader: false }),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/supabase", () => ({
  supabase: {
    channel: () => {
      const canal = {
        on: () => canal,
        subscribe: () => canal,
      };
      return canal;
    },
    removeChannel: () => Promise.resolve(),
    from: () => ({
      select: () => ({
        eq: () => {
          mundo.leituras += 1;
          return Promise.resolve({
            data: mundo.linhas.map((id) => ({ product_id: id })),
            error: null,
          });
        },
      }),
    }),
    auth: {
      getSession: async () => {
        if (mundo.sessaoPendente) return new Promise<never>(() => {});
        return {
          data: {
            session: mundo.sessaoDe ? { user: { id: mundo.sessaoDe } } : null,
          },
          error: mundo.erroDaSessao,
        };
      },
      onAuthStateChange: (ouvinte: Ouvinte) => {
        mundo.ouvintes.add(ouvinte);
        return {
          data: {
            subscription: {
              unsubscribe: () => {
                mundo.ouvintes.delete(ouvinte);
              },
            },
          },
        };
      },
    },
  },
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const observar = vi.fn();
function Sonda() {
  const contexto = useContext(FavoritesContext);
  useEffect(() => {
    observar(contexto);
  });
  return null;
}
const atual = () =>
  observar.mock.calls.at(-1)?.[0] as NonNullable<
    ContextType<typeof FavoritesContext>
  >;
const ids = () => atual().favorites.map((produto) => produto.id);
const deixarAndar = () => new Promise((r) => setTimeout(r, 0));

function avisar(evento: string, userId: string | null) {
  for (const ouvinte of [...mundo.ouvintes]) {
    ouvinte(evento, userId ? { user: { id: userId } } : null);
  }
}
function renovacaoFalhando() {
  mundo.sessaoDe = null;
  mundo.erroDaSessao = new AuthRetryableFetchError("Failed to fetch", 0);
}
function renovacaoVoltou() {
  mundo.sessaoDe = "conta-a";
  mundo.erroDaSessao = null;
}

let raiz: Root;
let hospedeiro: HTMLDivElement;

async function renderizar() {
  await act(async () => {
    raiz.render(
      <FavoritesProvider>
        <Sonda />
      </FavoritesProvider>,
    );
  });
  await act(async () => {
    await deixarAndar();
  });
}
async function voltarARede() {
  await act(async () => {
    window.dispatchEvent(new Event("online"));
    await deixarAndar();
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mundo.usuario = { id: "conta-a" };
  mundo.linhas = [];
  mundo.leituras = 0;
  mundo.sessaoPendente = false;
  mundo.ouvintes.clear();
  renovacaoVoltou();
  const valores = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (chave: string) => valores.get(chave) ?? null,
    setItem: (chave: string, valor: string) => {
      valores.set(chave, valor);
    },
    removeItem: (chave: string) => {
      valores.delete(chave);
    },
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
  vi.spyOn(console, "warn").mockImplementation(() => {});
  hospedeiro = document.createElement("div");
  document.body.appendChild(hospedeiro);
  raiz = createRoot(hospedeiro);
});
afterEach(() => {
  act(() => raiz.unmount());
  hospedeiro.remove();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("Favoritos — lista vazia sem a sessão da dona não apaga os corações", () => {
  it("renovação falhou: o [] não apaga os favoritos e a falha aparece", async () => {
    mundo.linhas = ["caneca", "jarra"];
    await renderizar();
    expect(ids()).toEqual(["caneca", "jarra"]);
    expect(atual().erro).toBeNull();

    renovacaoFalhando();
    mundo.linhas = [];
    await voltarARede();

    expect(ids()).toEqual(["caneca", "jarra"]);
    expect(atual().erro).not.toBeNull();
  });

  it("sessão sem resposta: encerra o carregamento com erro e mantém os favoritos", async () => {
    mundo.linhas = ["caneca"];
    await renderizar();
    expect(ids()).toEqual(["caneca"]);

    vi.useFakeTimers();
    try {
      mundo.linhas = [];
      mundo.sessaoPendente = true;
      await act(async () => {
        atual().refresh();
      });
      expect(atual().loading).toBe(true);

      await act(async () => {
        await vi.advanceTimersByTimeAsync(15_001);
      });

      expect(atual().loading).toBe(false);
      expect(atual().erro).toBe("Não conseguimos carregar seus favoritos.");
      expect(ids()).toEqual(["caneca"]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("renovação voltou (TOKEN_REFRESHED da mesma conta): relê uma vez e acerta a lista", async () => {
    mundo.linhas = ["caneca"];
    await renderizar();
    renovacaoFalhando();
    mundo.linhas = [];
    await voltarARede();
    const leiturasAntes = mundo.leituras;

    await act(async () => {
      avisar("TOKEN_REFRESHED", "outra-conta");
      await deixarAndar();
    });
    expect(mundo.leituras).toBe(leiturasAntes);

    renovacaoVoltou();
    mundo.linhas = ["caneca", "jarra"];
    await act(async () => {
      avisar("TOKEN_REFRESHED", "conta-a");
      await deixarAndar();
      await deixarAndar();
    });

    expect(mundo.leituras).toBe(leiturasAntes + 1);
    expect(ids()).toEqual(["caneca", "jarra"]);
    expect(atual().erro).toBeNull();

    await act(async () => {
      avisar("SIGNED_IN", "conta-a");
      await deixarAndar();
    });
    expect(mundo.leituras).toBe(leiturasAntes + 1);
  });

  it("lista vazia COM a sessão da dona é a verdade: os favoritos saem", async () => {
    mundo.linhas = ["caneca"];
    await renderizar();
    mundo.linhas = [];
    await voltarARede();

    expect(ids()).toEqual([]);
    expect(atual().erro).toBeNull();
  });

  it("saída de verdade (sem conta): a lista é limpa como antes", async () => {
    mundo.linhas = ["caneca"];
    await renderizar();
    expect(ids()).toEqual(["caneca"]);

    mundo.usuario = null;
    mundo.sessaoDe = null;
    await renderizar();

    expect(ids()).toEqual([]);
  });
});
